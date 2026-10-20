import http from "node:http";
import https from "node:https";
import net from "node:net";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutBrowserUrlAllowed, checkoutContextOptions, checkoutForwardHeaders, createCheckoutBrowserProxy, probeCheckoutHttpsRoot } from "../e2e/checkout-transport";
import { trackOwnedSocket } from "../e2e/alpha17-owned-sockets";

const canary = "SYNTHETIC_TRANSPORT_CANARY";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function stubHttps(status: number, hold = false) {
  let listener!: (response: http.IncomingMessage) => void;
  const socket = Object.assign(new EventEmitter(), { connecting: true, readyState: "opening" });
  const response = Object.assign(new EventEmitter(), { statusCode: status, headers: { "set-cookie": canary },
    resume: vi.fn(() => { response.emit("data", canary); response.emit("end"); }) });
  const request = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn(() => {
    request.emit("socket", socket); socket.emit("connect"); if (!hold) listener(response as unknown as http.IncomingMessage);
  }) });
  const call = vi.spyOn(https, "request").mockImplementation(((options: https.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
    listener = callback; return request as unknown as http.ClientRequest;
  }) as typeof https.request);
  return { request, call };
}
function preload() {
  const rawRequest = vi.fn((..._args: unknown[]) => ({ end: vi.fn() })), fetch = vi.fn(async (..._args: unknown[]) => ({ synthetic: true }));
  const localHttp = { request: rawRequest, get: vi.fn() }, localHttps = { request: vi.fn((..._args: unknown[]) => undefined), get: vi.fn() };
  const source = readFileSync(resolve("tests/e2e/checkout-fetch.mjs"), "utf8").replace(/^import .*;\r?\n/gm, "");
  const sandbox = vm.createContext({ http: localHttp, https: localHttps, fetch, URL, Request });
  vm.runInContext(source, sandbox);
  return { rawRequest, fetch, localHttp, localHttps, redirectedFetch: sandbox.fetch as typeof fetch };
}
describe("isolated checkout HTTPS transport", () => {
  it("forces one synthetic context profile and rejects lookalike/userinfo origins", () => {
    expect(checkoutContextOptions).toEqual({ baseURL: "https://checkout.nexus.test:3160", ignoreHTTPSErrors: true, serviceWorkers: "block", proxy: { server: "http://127.0.0.1:3165" } });
    for (const url of ["https://checkout.nexus.test:3160/checkout", "http://127.0.0.1:3161/fixture/stats"]) expect(checkoutBrowserUrlAllowed(url)).toBe(true);
    for (const url of ["https://checkout.nexus.test.evil:3160", "https://u:p@checkout.nexus.test:3160", "http://checkout.nexus.test:3160", "https://api.stripe.com", "http://127.0.0.1:3162"]) expect(checkoutBrowserUrlAllowed(url)).toBe(false);
  });
  it("preserves a negative Host while replacing spoofed proxy metadata only", () => {
    const headers = checkoutForwardHeaders({ host: "wrong.invalid", forwarded: canary, "x-forwarded-host": canary, "x-forwarded-proto": "http", "x-forwarded-for": canary, "stripe-signature": "signed-fixture" });
    expect(headers).toEqual({ host: "wrong.invalid", "stripe-signature": "signed-fixture", "x-forwarded-proto": "https", "x-forwarded-host": "wrong.invalid" });
    expect(JSON.stringify(headers)).not.toContain(canary);
  });
  it("denies HTTP and CONNECT destinations before any DNS or upstream request", () => {
    const connect = vi.spyOn(net, "connect"), request = vi.spyOn(http, "request"), proxy = createCheckoutBrowserProxy();
    const response = { writeHead: vi.fn(), end: vi.fn() };
    proxy.emit("request", { url: "http://external.invalid/?private=" + canary }, response);
    const client = Object.assign(new EventEmitter(), { end: vi.fn() });
    proxy.emit("connect", { url: "external.invalid:443" }, client, Buffer.alloc(0));
    expect(response.writeHead).toHaveBeenCalledWith(403); expect(client.end).toHaveBeenCalledWith("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    expect(request).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); proxy.close();
  });
  it("allows only the fixed synthetic CONNECT endpoint without DNS", () => {
    const upstream = Object.assign(new EventEmitter(), { pipe: vi.fn(), destroy: vi.fn(), write: vi.fn() });
    const connect = vi.spyOn(net, "connect").mockReturnValue(upstream as unknown as net.Socket), proxy = createCheckoutBrowserProxy();
    const client = Object.assign(new EventEmitter(), { end: vi.fn(), write: vi.fn(), pipe: vi.fn(), destroy: vi.fn() });
    proxy.emit("connect", { url: "checkout.nexus.test:3160" }, client, Buffer.alloc(0));
    expect(connect).toHaveBeenCalledWith(3160, "127.0.0.1", expect.any(Function));
    client.emit("close"); expect(upstream.destroy).toHaveBeenCalledTimes(1); proxy.close();
  });
  it.each([200, 421])("validates exact CA and canonical TLS name while observing %s without response contents", async status => {
    vi.useFakeTimers(); const fixture = stubHttps(status), cert = Buffer.from("synthetic-certificate-canary");
    const result = await probeCheckoutHttpsRoot(cert, new AbortController().signal);
    expect(fixture.call.mock.calls[0]?.[0]).toEqual({ hostname: "127.0.0.1", port: 3160, servername: "checkout.nexus.test", headers: { Host: "checkout.nexus.test:3160" }, path: "/", method: "GET", agent: false, ca: cert, rejectUnauthorized: true });
    expect(result).toEqual({ status, errorClass: null, connected: true }); expect(JSON.stringify(result)).not.toContain(canary);
    expect(fixture.request.destroy).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds the TLS diagnostic and aborts the owned request", async () => {
    vi.useFakeTimers(); const fixture = stubHttps(200, true), controller = new AbortController();
    const pending = probeCheckoutHttpsRoot(Buffer.from(canary), controller.signal); controller.abort(canary);
    expect(await pending).toEqual({ status: null, errorClass: "CANCELLED", connected: true }); expect(fixture.request.destroy).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    const timeout = probeCheckoutHttpsRoot(Buffer.from(canary), new AbortController().signal); await vi.advanceTimersByTimeAsync(1000);
    expect(await timeout).toEqual({ status: null, errorClass: "TIMEOUT", connected: true }); expect(vi.getTimerCount()).toBe(0);
  });
  it("owns a reused socket once and releases it on close", () => {
    const sockets = new Set<net.Socket>(), socket = new EventEmitter() as net.Socket;
    trackOwnedSocket(sockets, socket); trackOwnedSocket(sockets, socket);
    expect(socket.listenerCount("close")).toBe(1); expect(sockets.size).toBe(1); socket.emit("close"); expect(sockets.size).toBe(0);
  });
  it.each(["socketPath", "_defaultAgent"])("rejects %s overrides before either mapped TCP request", option => {
    const fixture = preload(), hook = vi.fn(), override = option === "socketPath" ? "/synthetic/" + canary : { addRequest: hook };
    expect(() => fixture.localHttp.request({ hostname: "127.0.0.1", port: 3161, [option]: override })).toThrow("TEST_CHECKOUT_OUTBOUND_DENIED");
    expect(() => fixture.localHttps.request({ hostname: "api.stripe.com", path: "/v1/checkout/sessions", [option]: override })).toThrow("TEST_CHECKOUT_OUTBOUND_DENIED");
    expect(fixture.rawRequest).not.toHaveBeenCalled(); expect(fixture.fetch).not.toHaveBeenCalled(); expect(hook).not.toHaveBeenCalled();
  });
  it("maps OAuth and Stripe requests only to the fixture and refuses unknown outbound canaries", async () => {
    const fixture = preload();
    await fixture.redirectedFetch("https://discord.com/api/v10/oauth2/token", { method: "POST" });
    expect(fixture.fetch).toHaveBeenCalledWith("http://127.0.0.1:3161/fixture/discord/oauth2/token", { method: "POST", redirect: "error" });
    fixture.localHttps.request({ hostname: "api.stripe.com", path: "/v1/checkout/sessions", method: "POST" });
    expect(fixture.rawRequest).toHaveBeenCalledWith(expect.objectContaining({ hostname: "127.0.0.1", port: 3161, protocol: "http:", path: "/fixture/stripe/v1/checkout/sessions" }), undefined);
    const count = fixture.rawRequest.mock.calls.length;
    expect(() => fixture.redirectedFetch("https://external.invalid/?private=" + canary)).toThrow("TEST_CHECKOUT_OUTBOUND_DENIED");
    expect(() => fixture.localHttps.request({ hostname: "external.invalid", path: "/" })).toThrow("TEST_CHECKOUT_OUTBOUND_DENIED");
    expect(() => fixture.localHttp.request({ hostname: "127.0.0.1", port: 9999 })).toThrow("TEST_CHECKOUT_OUTBOUND_DENIED");
    expect(fixture.rawRequest.mock.calls.length).toBe(count); expect(fixture.fetch).toHaveBeenCalledTimes(1);
  });
});
