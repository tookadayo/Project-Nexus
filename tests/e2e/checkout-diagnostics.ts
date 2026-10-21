import http from "node:http";
import { performance } from "node:perf_hooks";

// At most five GET / probes, one in flight, each bounded to one second.
// At most sixteen allowlisted JSON rows, including lifecycle and final state.
export const checkoutProbeOffsetsMs = [0, 2000, 10000, 30000, 55000] as const;
export const checkoutDiagnosticMaxRows = 16;
const errorClasses = ["CONNECTION_REFUSED", "CONNECTION_RESET", "TIMEOUT", "CANCELLED", "RESPONSE_ABORTED", "INVALID_RESPONSE", "NETWORK_ERROR", "NOT_OBSERVED"] as const;
type ProbeError = typeof errorClasses[number];
export type CheckoutProbe = { status: number | null; errorClass: ProbeError | null; connected?: boolean };
export type CheckoutDiagnosticRow = {
  event: "readiness" | "readiness-final" | "child-spawn" | "child-error" | "child-exit" | "child-close" | "child-signal";
  elapsedMs: number;
  status?: number | null;
  connected?: boolean | null;
  errorClass?: ProbeError | "PROCESS_NOT_FOUND" | "PROCESS_ACCESS_DENIED" | "PROCESS_ERROR" | null;
  exitCode?: number | null;
  signal?: string | null;
  sampleElapsedMs?: number | null;
  pending?: boolean;
};
function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
}
export function classifyCheckoutProbeError(error: unknown): ProbeError {
  switch (errorCode(error)) {
    case "ECONNREFUSED": return "CONNECTION_REFUSED";
    case "ECONNRESET": case "EPIPE": return "CONNECTION_RESET";
    case "ETIMEDOUT": return "TIMEOUT";
    case "ABORT_ERR": return "CANCELLED";
    default: return "NETWORK_ERROR";
  }
}
const safeStatus = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const safeExit = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
function safeSignal(value: unknown) {
  if (value === null) return null;
  return typeof value === "string" && ["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP", "SIGABRT", "SIGSEGV", "SIGILL", "SIGPIPE", "SIGQUIT", "SIGBUS", "SIGFPE", "SIGTRAP", "SIGUSR1", "SIGUSR2"].includes(value) ? value : "OTHER";
}
export function probeCheckoutRoot(port: number, signal: AbortSignal): Promise<CheckoutProbe> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return Promise.resolve({ status: null, errorClass: "NETWORK_ERROR", connected: false });
  if (signal.aborted) return Promise.resolve({ status: null, errorClass: "CANCELLED", connected: false });
  return new Promise(accept => {
    let complete = false, connected = false, status: number | null = null;
    let request: http.ClientRequest | undefined;
    const finish = (errorClass: ProbeError | null) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      request?.destroy();
      accept({ status, errorClass, connected });
    };
    const abort = () => finish("CANCELLED");
    const timer = setTimeout(() => finish("TIMEOUT"), 1000);
    signal.addEventListener("abort", abort, { once: true });
    try {
      request = http.request({ hostname: "127.0.0.1", port, path: "/", method: "GET", agent: false }, response => {
        status = safeStatus(response.statusCode);
        response.once("end", () => finish(status === null ? "INVALID_RESPONSE" : null));
        response.once("aborted", () => finish("RESPONSE_ABORTED"));
        response.once("error", error => finish(classifyCheckoutProbeError(error)));
        response.resume(); // Discard bytes; never retain, parse, or print body/headers.
      });
      request.once("socket", socket => {
        if (!socket.connecting && socket.readyState === "open") connected = true;
        socket.once("connect", () => { connected = true; });
      });
      request.once("error", error => finish(classifyCheckoutProbeError(error)));
      request.end();
    } catch (error) { finish(classifyCheckoutProbeError(error)); }
  });
}
export function createCheckoutDiagnostics(options: {
  port: number;
  emit?: (row: CheckoutDiagnosticRow) => void;
  probe?: (port: number, signal: AbortSignal) => Promise<CheckoutProbe>;
  now?: () => number;
}) {
  const now = options.now ?? (() => performance.now()), began = now();
  const emit = options.emit ?? (row => process.stderr.write("CHECKOUT_DIAGNOSTIC " + JSON.stringify(row) + "\n"));
  const elapsed = () => Math.max(0, Math.round(now() - began));
  let rows = 0, stopped = false, active: AbortController | undefined;
  let last: CheckoutProbe | undefined, sampleElapsedMs: number | null = null;
  const seen = new Set<string>();
  const write = (row: Omit<CheckoutDiagnosticRow, "elapsedMs">) => {
    if (rows >= checkoutDiagnosticMaxRows) return;
    rows++;
    try { emit({ ...row, elapsedMs: elapsed() }); } catch { /* Diagnostics never replace child outcome. */ }
  };
  const once = (key: string, row: Omit<CheckoutDiagnosticRow, "elapsedMs">) => { if (!seen.has(key)) { seen.add(key); write(row); } };
  const timers = checkoutProbeOffsetsMs.map((offset, index) => {
    const timer = setTimeout(() => {
      if (stopped || active) return;
      const controller = new AbortController();
      active = controller;
      void Promise.resolve().then(() => (options.probe ?? probeCheckoutRoot)(options.port, controller.signal)).catch(error => ({ status: null, errorClass: classifyCheckoutProbeError(error) })).then(result => {
        if (stopped) return;
        const next: CheckoutProbe = { status: safeStatus(result.status), connected: "connected" in result && typeof result.connected === "boolean" ? result.connected : undefined, errorClass: result.errorClass === null ? null : errorClasses.includes(result.errorClass) ? result.errorClass : "NETWORK_ERROR" };
        const changed = !last || next.status !== last.status || next.errorClass !== last.errorClass || next.connected !== last.connected;
        last = next;
        sampleElapsedMs = elapsed();
        if (changed || index === 0 || index === checkoutProbeOffsetsMs.length - 1) write({ event: "readiness", status: next.status, errorClass: next.errorClass, connected: next.connected ?? null });
      }).finally(() => { if (active === controller) active = undefined; });
    }, offset);
    timer.unref();
    return timer;
  });
  const finish = () => {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    const pending = Boolean(active);
    active?.abort();
    write({ event: "readiness-final", status: last?.status ?? null, connected: last?.connected ?? null, errorClass: last ? last.errorClass : "NOT_OBSERVED", sampleElapsedMs, pending });
  };
  return {
    spawn: () => once("spawn", { event: "child-spawn" }),
    error: (error: unknown) => once("error", { event: "child-error", errorClass: errorCode(error) === "ENOENT" ? "PROCESS_NOT_FOUND" : errorCode(error) === "EACCES" ? "PROCESS_ACCESS_DENIED" : "PROCESS_ERROR" }),
    exit: (code: unknown, signal: unknown) => once("exit", { event: "child-exit", exitCode: safeExit(code), signal: safeSignal(signal) }),
    close: (code: unknown, signal: unknown) => { once("close", { event: "child-close", exitCode: safeExit(code), signal: safeSignal(signal) }); finish(); },
    signal: (value: unknown) => { const signal = safeSignal(value); once("signal-" + signal, { event: "child-signal", signal }); finish(); },
    finish,
  };
}
