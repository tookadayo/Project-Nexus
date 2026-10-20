import http from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import Stripe from "../../packages/settings/node_modules/stripe/esm/stripe.esm.node.js";
import { StripeBillingProvider } from "../../packages/settings/src/billing/providers/stripe";
import { billingWebhookRequest } from "../../apps/web/app/billing/webhook-request";
import { canonicalWebHost } from "../../apps/web/app/auth/public-boundary";
import {
  checkoutWebhookRelayUrl, checkoutWebhookResponseLimit, checkoutWebhookTimeoutMs,
  createCheckoutWebhookHttpTransport, noCompletedCheckoutSession, relayCheckoutWebhook, writeCheckoutWebhookDiagnostic,
  type CheckoutWebhookTransport,
} from "../e2e/checkout-webhook-relay";

const canary = "SYNTHETIC_WEBHOOK_PRIVATE_CANARY";
const json = (body: string, status = 200) => new Response(body, { status, headers: {
  "Content-Type": "application/json; charset=utf-8", "Set-Cookie": canary, "X-Private": canary,
} });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("bounded synthetic webhook relay", () => {
  it.each([200, 400])("retains HTTP %s JSON without returning response contents", async status => {
    const body = '{"private":"' + canary + '"}', signature = "fixture-signature-" + canary;
    const send = vi.fn<typeof fetch>().mockResolvedValue(json(body, status));
    const result = await relayCheckoutWebhook(body, signature, send);
    expect(result).toMatchObject({ status, jsonParsed: true, errorClass: null, responseBytes: Buffer.byteLength(body) });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(checkoutWebhookRelayUrl, {
      method: "POST", redirect: "error", signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json", "Stripe-Signature": signature,
        Host: "checkout.nexus.test:3160", "X-Forwarded-Proto": "https" }, body,
    });
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(Number.isFinite(result.elapsedMs)).toBe(true);
  });
  it("retains a non-JSON 503 and never treats non-JSON 200 as success", async () => {
    for (const status of [503, 200]) {
      const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(canary, { status, headers: { "Content-Type": "text/html" } }));
      expect(await relayCheckoutWebhook("{}", canary, send)).toMatchObject({
        status, jsonParsed: false, errorClass: "NON_JSON_RESPONSE", responseBytes: Buffer.byteLength(canary),
      });
      expect(send).toHaveBeenCalledTimes(1);
    }
  });
  it("retains a 200 with invalid JSON as an explicit failure", async () => {
    const result = await relayCheckoutWebhook("{}", canary, vi.fn<typeof fetch>().mockResolvedValue(json(canary)));
    expect(result).toMatchObject({ status: 200, jsonParsed: false, errorClass: "INVALID_JSON" });
    expect(JSON.stringify(result)).not.toContain(canary);
  });
  it("preserves headers status when the body aborts", async () => {
    let first = true;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (first) { first = false; controller.enqueue(new TextEncoder().encode("{")); }
      else controller.error(Object.assign(new Error(canary), { name: "AbortError" }));
    } });
    const response = new Response(body, { status: 400, headers: { "Content-Type": "application/json" } });
    const result = await relayCheckoutWebhook("{}", canary, vi.fn<typeof fetch>().mockResolvedValue(response));
    expect(result).toMatchObject({ status: 400, jsonParsed: false, errorClass: "BODY_ABORTED", responseBytes: 1 });
    expect(JSON.stringify(result)).not.toContain(canary);
  });
  it("distinguishes a preheaders reset without returning the exception", async () => {
    const error = Object.assign(new Error(canary), { cause: { code: "ECONNRESET", private: canary } });
    const send = vi.fn<typeof fetch>().mockRejectedValue(error);
    const result = await relayCheckoutWebhook("{}", canary, send);
    expect(result).toMatchObject({ status: null, jsonParsed: false, errorClass: "NETWORK_RESET", responseBytes: 0 });
    expect(send).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain(canary);
  });
  it("bounds a preheaders transport that ignores abort to five seconds", async () => {
    vi.useFakeTimers();
    const send = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = relayCheckoutWebhook("{}", canary, send);
    await vi.advanceTimersByTimeAsync(checkoutWebhookTimeoutMs);
    expect(await pending).toEqual({ status: null, jsonParsed: false, errorClass: "TIMEOUT", responseBytes: 0, elapsedMs: 5000 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("applies the same overall deadline after headers and cancels the owned body", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn(), body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
    const pending = relayCheckoutWebhook("{}", canary, send);
    await vi.advanceTimersByTimeAsync(checkoutWebhookTimeoutMs);
    expect(await pending).toEqual({ status: 200, jsonParsed: false, errorClass: "TIMEOUT", responseBytes: 0, elapsedMs: 5000 });
    expect(cancelled).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("caps response bytes and cancels an oversized response", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(json("x".repeat(checkoutWebhookResponseLimit + 1)));
    const result = await relayCheckoutWebhook("{}", canary, send);
    expect(result).toMatchObject({ status: 200, jsonParsed: false, errorClass: "RESPONSE_TOO_LARGE", responseBytes: 16384 });
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(JSON.stringify(result)).not.toContain(canary);
  });
  it("aborts and cancels an invalid-status open body, including cancel failures", async () => {
    vi.useFakeTimers();
    for (const behavior of ["fulfill", "reject", "throw"] as const) {
      const body = new ReadableStream<Uint8Array>(), cancel = vi.spyOn(body, "cancel");
      if (behavior === "reject") cancel.mockRejectedValue(new Error(canary));
      if (behavior === "throw") cancel.mockImplementation(() => { throw new Error(canary); });
      const send = vi.fn<CheckoutWebhookTransport>().mockResolvedValue({ status: 600, headers: new Headers(), body });
      const result = await relayCheckoutWebhook("{}", canary, send);
      expect(result).toEqual({ status: null, jsonParsed: false, errorClass: "INVALID_RESPONSE_STATUS", responseBytes: 0, elapsedMs: 0 });
      expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
      expect(JSON.stringify(result)).not.toContain(canary);
      cancel.mockRestore(); await body.cancel();
    }
  });
  it("reports missing completion once with a fixed schema and no extra values", () => {
    const missing = noCompletedCheckoutSession(), write = vi.fn<(line: string) => void>();
    writeCheckoutWebhookDiagnostic({ ...missing, privatePayload: canary } as typeof missing, write);
    writeCheckoutWebhookDiagnostic({ ...missing, errorClass: "NETWORK_ERROR" }, write);
    expect(missing).toEqual({ status: null, jsonParsed: false, errorClass: "NO_COMPLETED_SESSION", responseBytes: 0, elapsedMs: 0 });
    expect(write).toHaveBeenCalledTimes(1);
    const line = write.mock.calls[0]![0];
    expect(line.split("\n")).toHaveLength(2); expect(line).not.toContain(canary);
    expect(JSON.parse(line)).toEqual({ event: "NEXUS_CHECKOUT_WEBHOOK_RELAY", ...missing });
  });
});

it("closes the owned HTTP socket on invalid 600 headers with an unfinished body", async () => {
  const sockets = new Set<Socket>();
  let markClosed!: () => void, requests = 0;
  const socketClosed = new Promise<void>(accept => { markClosed = accept; });
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) { void chunk; /* Drain this fixed synthetic request only. */ }
    response.writeHead(600, { "Content-Type": "application/json" });
    response.write("{");
  });
  server.on("connection", socket => {
    sockets.add(socket); socket.once("close", () => { sockets.delete(socket); markClosed(); });
  });
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); accept(); }); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("TEST_LOOPBACK_NOT_OWNED");
  const transport = createCheckoutWebhookHttpTransport(((options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
    requests++; return http.request({ ...options, port: address.port }, callback);
  }) as typeof http.request);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await relayCheckoutWebhook("{}", "fixture-signature", transport);
    expect(result).toMatchObject({ status: null, jsonParsed: false, errorClass: "INVALID_RESPONSE_STATUS", responseBytes: 0 });
    expect(requests).toBe(1);
    const closed = await Promise.race([socketClosed.then(() => true),
      new Promise<false>(accept => { closeTimer = setTimeout(() => accept(false), 1000); })]);
    expect(closed).toBe(true);
  } finally {
    clearTimeout(closeTimer);
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept()));
  }
});

it("preserves raw bytes, Host and signatures through owned HTTP and real readers/adapters", async () => {
  const env = { NODE_ENV: "test" as const, NEXUS_STRIPE_ENABLED: "true", NEXUS_STRIPE_MODE: "SANDBOX",
    STRIPE_SECRET_KEY: "sk_test_fixture_webhook_relay", STRIPE_WEBHOOK_SECRET: "whsec_fixture_webhook_relay" };
  const sdk = new Stripe(env.STRIPE_SECRET_KEY), provider = new StripeBillingProvider({ env, client: sdk });
  const raw = '{\r\n "id":"evt_fixture_relay", "object":"event", "type":"checkout.session.completed", "livemode":false,\r\n "data":{"object":{"id":"cs_fixture_relay","object":"checkout.session","livemode":false,"mode":"subscription","subscription":"sub_fixture_relay","customer":"cus_fixture_relay","label":"雪"}}\r\n}';
  const signature = sdk.webhooks.generateTestHeaderString({ payload: raw, secret: env.STRIPE_WEBHOOK_SECRET });
  const received: { body: Buffer; host: string | undefined; signature: string | undefined; protocol: string | string[] | undefined; length: number | null }[] = [];
  const adapterErrors: string[] = [];
  let adapterCalls = 0, signals = 0;
  const sockets = new Set<Socket>();
  const server = http.createServer(async (incoming, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk as Uint8Array));
      const bytes = Buffer.concat(chunks), headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const request = new Request("https://checkout.nexus.test:3160/billing/webhooks/stripe", { method: "POST", headers, body: new Uint8Array(bytes) });
      const record = { body: bytes, host: incoming.headers.host, signature: incoming.headers["stripe-signature"] as string | undefined,
        protocol: incoming.headers["x-forwarded-proto"], length: null as number | null };
      received.push(record);
      if (!canonicalWebHost(request, "https://checkout.nexus.test:3160", true)) {
        response.writeHead(421, { "Content-Type": "application/json" }); response.end('{"error":"HOST_REJECTED"}'); return;
      }
      const decoded = await billingWebhookRequest(request);
      record.length = decoded.actualBodyLength;
      adapterCalls++;
      try {
        signals += (await provider.verifyWebhook(decoded.body, decoded.headers)).length;
        response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"ok":true}');
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNEXPECTED_ADAPTER_FAILURE";
        adapterErrors.push(code);
        response.writeHead(400, { "Content-Type": "application/json" }); response.end('{"ok":false}');
      }
    } catch {
      response.writeHead(500, { "Content-Type": "application/json" }); response.end('{"error":"FIXTURE_READER_FAILED"}');
    }
  });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); accept(); }); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("TEST_LOOPBACK_NOT_OWNED");
  let alterHost = false;
  const requests: { fixedTarget: boolean; fixedHost: boolean; noAgent: boolean }[] = [];
  const request = ((options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
    const headers = { ...options.headers as Record<string, string> };
    requests.push({ fixedTarget: options.hostname === "127.0.0.1" && options.port === 3162 &&
      options.path === "/billing/webhooks/stripe" && options.method === "POST",
      fixedHost: headers.Host === "checkout.nexus.test:3160", noAgent: options.agent === false });
    if (alterHost) headers.Host = "foreign.invalid";
    return http.request({ ...options, port: address.port, headers }, callback);
  }) as typeof http.request;
  const send = vi.fn(createCheckoutWebhookHttpTransport(request));
  try {
    const first = await relayCheckoutWebhook(raw, signature, send);
    expect(first).toMatchObject({ status: 200, jsonParsed: true, errorClass: null });
    const changed = raw.replace("雪", "雨");
    expect(await relayCheckoutWebhook(changed, signature, send)).toMatchObject({ status: 400, jsonParsed: true, errorClass: null });
    expect(await relayCheckoutWebhook(raw, "", send)).toMatchObject({ status: 400, jsonParsed: true, errorClass: null });
    alterHost = true;
    expect(await relayCheckoutWebhook(raw, signature, send)).toMatchObject({ status: 421, jsonParsed: true, errorClass: null });
    expect(adapterCalls).toBe(3); expect(signals).toBe(1);
    expect(adapterErrors).toEqual(["STRIPE_SIGNATURE_INVALID", "STRIPE_SIGNATURE_REQUIRED"]);
    expect(received.map(value => value.body.equals(Buffer.from(value === received[1] ? changed : raw)))).toEqual([true, true, true, true]);
    expect(received.slice(0, 3).map(value => value.length)).toEqual([Buffer.byteLength(raw), Buffer.byteLength(changed), Buffer.byteLength(raw)]);
    expect(received.map(value => value.protocol)).toEqual(["https", "https", "https", "https"]);
    expect(received.map(value => value.signature)).toEqual([signature, signature, "", signature]);
    expect(requests).toEqual(Array.from({ length: 4 }, () => ({ fixedTarget: true, fixedHost: true, noAgent: true })));
    expect(send).toHaveBeenCalledTimes(4);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections();
    await new Promise<void>(accept => server.close(() => accept()));
  }
});
