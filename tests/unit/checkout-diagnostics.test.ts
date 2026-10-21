import { spawn } from "node:child_process";
import http from "node:http";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutDiagnosticMaxRows, checkoutProbeOffsetsMs, classifyCheckoutProbeError, createCheckoutDiagnostics, probeCheckoutRoot, type CheckoutDiagnosticRow } from "../e2e/checkout-diagnostics";

const canary = "SYNTHETIC_CANARY_NOT_A_SECRET";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function stubHttp(status: number, mode: "complete" | "hold-headers" = "complete") {
  const options: http.RequestOptions[] = [];
  let listener!: (response: http.IncomingMessage) => void;
  const socket = Object.assign(new EventEmitter(), { connecting: true, readyState: "opening" });
  const response = Object.assign(new EventEmitter(), {
    statusCode: status, headers: { "set-cookie": canary },
    resume: vi.fn(() => { response.emit("data", Buffer.from(canary)); response.emit("end"); }),
  });
  const request = Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
    end: vi.fn(() => {
      request.emit("socket", socket);
      socket.emit("connect");
      if (mode === "complete") listener(response as unknown as http.IncomingMessage);
    }),
  });
  vi.spyOn(http, "request").mockImplementation(((value: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
    options.push(value); listener = callback;
    return request as unknown as http.ClientRequest;
  }) as typeof http.request);
  return { request, response, options };
}
describe("bounded checkout diagnostics", () => {
  it.each([
    ["ECONNREFUSED", "CONNECTION_REFUSED"], ["ECONNRESET", "CONNECTION_RESET"], ["EPIPE", "CONNECTION_RESET"],
    ["ETIMEDOUT", "TIMEOUT"], ["ABORT_ERR", "CANCELLED"], [canary, "NETWORK_ERROR"],
  ])("classifies %s without including raw errors", (code, expected) => {
    const error = { code, message: canary, stack: canary, headers: { cookie: canary }, url: "https://invalid.example/?token=" + canary };
    expect(classifyCheckoutProbeError(error)).toBe(expected);
    expect(classifyCheckoutProbeError(error)).not.toContain(canary);
  });
  it("rejects invalid ports and an already cancelled probe without creating a request", async () => {
    const controller = new AbortController();
    expect(await probeCheckoutRoot(1, controller.signal)).toEqual({ status: null, errorClass: "NETWORK_ERROR", connected: false });
    controller.abort();
    expect(await probeCheckoutRoot(3160, controller.signal)).toEqual({ status: null, errorClass: "CANCELLED", connected: false });
  });
  it.each([200, 421])("observes HTTP %s using only fixed loopback GET / and discards response canaries", async status => {
    vi.useFakeTimers();
    const fixture = stubHttp(status);
    const result = await probeCheckoutRoot(3160, new AbortController().signal);
    expect(fixture.options).toEqual([{ hostname: "127.0.0.1", port: 3160, path: "/", method: "GET", agent: false }]);
    expect(result).toEqual({ status, errorClass: null, connected: true });
    expect(fixture.response.resume).toHaveBeenCalledTimes(1);
    expect(fixture.request.destroy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(JSON.stringify(result)).not.toMatch(/cookie|body|argv|headers|https:/i);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("destroys an owned request at the finite deadline after TCP connects but before headers", async () => {
    vi.useFakeTimers();
    const fixture = stubHttp(200, "hold-headers");
    const result = probeCheckoutRoot(3160, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ status: null, errorClass: "TIMEOUT", connected: true });
    expect(fixture.request.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("destroys an owned request on cancellation without leaking an abort reason", async () => {
    vi.useFakeTimers();
    const fixture = stubHttp(200, "hold-headers"), controller = new AbortController();
    const result = probeCheckoutRoot(3160, controller.signal);
    controller.abort(canary);
    expect(await result).toEqual({ status: null, errorClass: "CANCELLED", connected: true });
    expect(fixture.request.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("caps probes and rows, preserving status transitions without any canary fields", async () => {
    vi.useFakeTimers();
    const rows: CheckoutDiagnosticRow[] = [];
    const probe = vi.fn(async () => ({ status: 421, errorClass: null, body: canary, cookie: canary, argv: [canary] }));
    const diagnostics = createCheckoutDiagnostics({ port: 3160, emit: row => rows.push(row), probe, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(60000);
    expect(probe).toHaveBeenCalledTimes(checkoutProbeOffsetsMs.length);
    for (let count = 0; count < 40; count++) {
      diagnostics.spawn(); diagnostics.error({ code: "ENOENT", message: canary }); diagnostics.exit(7, canary);
      diagnostics.signal(canary); diagnostics.close(7, null);
    }
    expect(rows.length).toBeLessThanOrEqual(checkoutDiagnosticMaxRows);
    expect(rows.filter(row => row.event === "readiness")).toHaveLength(2);
    expect(rows.filter(row => row.event === "readiness-final")).toHaveLength(1);
    expect(rows.find(row => row.event === "readiness-final")).toMatchObject({ status: 421, errorClass: null, pending: false, sampleElapsedMs: 55000 });
    expect(rows.find(row => row.event === "child-exit")).toMatchObject({ exitCode: 7, signal: "OTHER" });
    expect(JSON.stringify(rows)).not.toContain(canary);
    expect(JSON.stringify(rows)).not.toMatch(/cookie|body|argv|headers|https:/i);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts an unfinished observation and reports it as pending, without a late success", async () => {
    vi.useFakeTimers();
    const rows: CheckoutDiagnosticRow[] = [];
    let release!: () => void;
    let observedSignal: AbortSignal | undefined;
    const probe = vi.fn((_port: number, signal: AbortSignal) => { observedSignal = signal; return new Promise<{ status: number; errorClass: null }>(accept => { release = () => accept({ status: 200, errorClass: null }); }); });
    const diagnostics = createCheckoutDiagnostics({ port: 3160, emit: row => rows.push(row), probe });
    await vi.advanceTimersByTimeAsync(0);
    diagnostics.signal("SIGTERM");
    expect(observedSignal?.aborted).toBe(true);
    expect(rows.at(-1)).toMatchObject({ event: "readiness-final", status: null, errorClass: "NOT_OBSERVED", pending: true });
    release();
    await vi.advanceTimersByTimeAsync(60000);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(rows.some(row => row.status === 200)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("observes a synthetic process exit without starting an HTTP fixture", async () => {
    const rows: CheckoutDiagnosticRow[] = [];
    const diagnostics = createCheckoutDiagnostics({ port: 3160, emit: row => rows.push(row), probe: async () => ({ status: 200, errorClass: null }) });
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
    for (const name of ["SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP"]) if (process.env[name]) env[name] = process.env[name];
    const child = spawn(process.execPath, ["-e", "process.exit(7)"], { env, shell: false, windowsHide: true, stdio: "ignore" });
    child.once("spawn", () => diagnostics.spawn());
    child.once("error", error => diagnostics.error(error));
    child.once("exit", (code, signal) => diagnostics.exit(code, signal));
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(accept => child.once("close", (code, signal) => { diagnostics.close(code, signal); accept({ code, signal }); }));
    expect(result).toEqual({ code: 7, signal: null });
    expect(rows.find(row => row.event === "child-spawn")).toBeDefined();
    expect(rows.find(row => row.event === "child-exit")).toMatchObject({ exitCode: 7, signal: null });
    expect(rows.find(row => row.event === "child-close")).toMatchObject({ exitCode: 7, signal: null });
    expect(rows.filter(row => row.event === "readiness-final")).toHaveLength(1);
  });
});
