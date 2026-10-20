import http from "node:http";
import { Readable } from "node:stream";

export const checkoutWebhookRelayUrl = "http://127.0.0.1:3162/billing/webhooks/stripe";
export const checkoutWebhookTimeoutMs = 5000;
export const checkoutWebhookResponseLimit = 16384;
export type CheckoutWebhookError =
  | "NO_COMPLETED_SESSION" | "NETWORK_RESET" | "NETWORK_ERROR" | "TIMEOUT"
  | "BODY_ABORTED" | "BODY_ERROR" | "NON_JSON_RESPONSE" | "INVALID_JSON"
  | "RESPONSE_TOO_LARGE" | "INVALID_RESPONSE_STATUS";
export type CheckoutWebhookRelayResult = {
  status: number | null; jsonParsed: boolean; errorClass: CheckoutWebhookError | null;
  responseBytes: number; elapsedMs: number;
};
type RelayResponse = { status: number; headers: Pick<Headers, "get">; body: ReadableStream<Uint8Array> | null };
export type CheckoutWebhookTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<RelayResponse>;

/** Native fetch removes Host in the installed Node version. Keep the exact
 * synthetic Host on a single fixed HTTP request; no redirect is followed.
 * Only the request primitive is injectable for an owned unit-test listener. */
export function createCheckoutWebhookHttpTransport(request: typeof http.request = http.request): CheckoutWebhookTransport {
  return (input, init) => new Promise((accept, reject) => {
    const headers = init?.headers as Record<string, string> | undefined;
    if (input !== checkoutWebhookRelayUrl || init?.method !== "POST" || init.redirect !== "error" ||
        typeof init.body !== "string" || headers?.Host !== "checkout.nexus.test:3160" ||
        headers["X-Forwarded-Proto"] !== "https" || headers["Content-Type"] !== "application/json" ||
        typeof headers["Stripe-Signature"] !== "string") {
      reject(new Error("TEST_WEBHOOK_RELAY_REQUEST_NOT_ALLOWED")); return;
    }
    const outgoing = request({ hostname: "127.0.0.1", port: 3162, path: "/billing/webhooks/stripe",
      method: "POST", agent: false, signal: init.signal ?? undefined,
      headers: { "Content-Type": "application/json", "Stripe-Signature": headers["Stripe-Signature"],
        Host: "checkout.nexus.test:3160", "X-Forwarded-Proto": "https" },
    }, incoming => {
      let body: ReadableStream<Uint8Array>;
      try { body = Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>; }
      catch (error) {
        incoming.destroy();
        body = new ReadableStream({ start(controller) { controller.error(error); } });
      }
      accept({ status: incoming.statusCode ?? 0, body, headers: { get(name) {
        const value = incoming.headers[name.toLowerCase()];
        return Array.isArray(value) ? value.join(", ") : value ?? null;
      } } });
    });
    outgoing.on("error", reject); outgoing.end(init.body);
  });
}
const checkoutWebhookHttpTransport = createCheckoutWebhookHttpTransport();

function errorCode(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error) return error.code;
  const cause = "cause" in error ? error.cause : undefined;
  return cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
}
function isAbortedBody(error: unknown) {
  return errorCode(error) === "ECONNRESET" || errorCode(error) === "UND_ERR_SOCKET" || errorCode(error) === "ERR_STREAM_PREMATURE_CLOSE" ||
    Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}
export function noCompletedCheckoutSession(): CheckoutWebhookRelayResult {
  return { status: null, jsonParsed: false, errorClass: "NO_COMPLETED_SESSION", responseBytes: 0, elapsedMs: 0 };
}

/** One exact synthetic request. DI changes only the transport used by unit tests. */
export async function relayCheckoutWebhook(
  body: string, signature: string, send: CheckoutWebhookTransport = checkoutWebhookHttpTransport,
): Promise<CheckoutWebhookRelayResult> {
  const started = Date.now(), controller = new AbortController();
  let status: number | null = null, responseBytes = 0, timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_accept, reject) => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error("TEST_WEBHOOK_RELAY_TIMEOUT")); }, checkoutWebhookTimeoutMs);
  });
  const result = (jsonParsed: boolean, errorClass: CheckoutWebhookError | null): CheckoutWebhookRelayResult => ({
    status, jsonParsed, errorClass, responseBytes, elapsedMs: Math.max(0, Date.now() - started),
  });
  try {
    const pending = Promise.resolve().then(() => send(checkoutWebhookRelayUrl, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", "Stripe-Signature": signature,
        Host: "checkout.nexus.test:3160", "X-Forwarded-Proto": "https" },
      body,
    }));
    // A test transport may ignore AbortSignal; late bodies still belong to us.
    void pending.then(response => {
      if (timedOut) void response.body?.cancel().catch(() => {});
    }, () => {});
    const response = await Promise.race([pending, timeout]);
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      controller.abort();
      try { void response.body?.cancel().catch(() => {}); }
      catch { /* Abort already closes the owned HTTP request if cancel throws. */ }
      return result(false, "INVALID_RESPONSE_STATUS");
    }
    status = response.status; // Preserve actual HTTP status before any body operation.
    const jsonType = /^(?:application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "");
    const chunks: Uint8Array[] = [];
    reader = response.body?.getReader();
    if (reader) for (;;) {
      const part = await Promise.race([reader.read(), timeout]);
      if (Date.now() - started >= checkoutWebhookTimeoutMs) {
        timedOut = true; controller.abort(); return result(false, "TIMEOUT");
      }
      if (part.done) break;
      if (!part.value.byteLength) continue;
      const length = responseBytes + part.value.byteLength;
      responseBytes = Math.min(checkoutWebhookResponseLimit, length);
      if (length > checkoutWebhookResponseLimit) {
        controller.abort();
        return result(false, "RESPONSE_TOO_LARGE");
      }
      chunks.push(part.value);
    }
    if (!jsonType) return result(false, "NON_JSON_RESPONSE");
    const bytes = new Uint8Array(responseBytes);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { return result(false, "INVALID_JSON"); }
    return result(true, null);
  } catch (error) {
    if (timedOut) return result(false, "TIMEOUT");
    if (status !== null) return result(false, isAbortedBody(error) ? "BODY_ABORTED" : "BODY_ERROR");
    return result(false, errorCode(error) === "ECONNRESET" ? "NETWORK_RESET" : "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
    if (reader) {
      void reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch { /* Pending cancellation may still own the lock. */ }
    }
  }
}

let diagnosticWritten = false;
/** Fixed schema, one line per module/process; no response or request values. */
export function writeCheckoutWebhookDiagnostic(
  result: CheckoutWebhookRelayResult, write: (line: string) => void = line => { process.stderr.write(line); },
) {
  if (diagnosticWritten) return;
  diagnosticWritten = true;
  write(JSON.stringify({ event: "NEXUS_CHECKOUT_WEBHOOK_RELAY", status: result.status,
    jsonParsed: result.jsonParsed, errorClass: result.errorClass,
    responseBytes: result.responseBytes, elapsedMs: result.elapsedMs }) + "\n");
}
