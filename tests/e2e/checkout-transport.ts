import http from "node:http";
import https from "node:https";
import net from "node:net";
import { classifyCheckoutProbeError, type CheckoutProbe } from "./checkout-diagnostics.js";

// Fixed synthetic profile. No production endpoint or caller-selected destination.
export const checkoutOrigin = "https://checkout.nexus.test:3160";
export const checkoutFixtureOrigin = "http://127.0.0.1:3161";
export const checkoutProxyOrigin = "http://127.0.0.1:3165";
export const checkoutContextOptions = {
  baseURL: checkoutOrigin, ignoreHTTPSErrors: true, serviceWorkers: "block" as const,
  proxy: { server: checkoutProxyOrigin },
};
export function checkoutBrowserUrlAllowed(value: string) {
  try { const url = new URL(value); return !url.username && !url.password && [checkoutOrigin, checkoutFixtureOrigin].includes(url.origin); }
  catch { return false; }
}
export function checkoutForwardHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const forwarded = { ...headers };
  for (const key of Object.keys(forwarded)) if (key === "forwarded" || key.startsWith("x-forwarded-")) delete forwarded[key];
  // The TLS listener itself establishes this single synthetic trusted hop.
  return { ...forwarded, "x-forwarded-proto": "https", "x-forwarded-host": headers.host };
}
/** Deny destinations before DNS/connect, including redirects and request contexts. */
export function createCheckoutBrowserProxy(track: (socket: net.Socket) => net.Socket = socket => socket) {
  const server = http.createServer((request, response) => {
    let url: URL | undefined;
    try { url = new URL(request.url ?? ""); } catch { /* Denied below. */ }
    if (!url || url.username || url.password || url.origin !== checkoutFixtureOrigin) { response.writeHead(403); response.end(); return; }
    const upstream = http.request({ hostname: "127.0.0.1", port: 3161, method: request.method,
      path: url.pathname + url.search, headers: { ...request.headers, host: url.host } }, incoming => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers); incoming.pipe(response);
    });
    upstream.on("socket", track);
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on("aborted", () => upstream.destroy()); response.on("close", () => upstream.destroy()); request.pipe(upstream);
  });
  server.on("connect", (request, client, head) => {
    client.on("error", () => client.destroy());
    const port = request.url === "checkout.nexus.test:3160" ? 3160 : request.url === "127.0.0.1:3161" ? 3161 : undefined;
    if (!port) { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    const upstream = track(net.connect(port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client);
    }));
    upstream.on("error", () => client.destroy()); client.on("error", () => upstream.destroy()); client.on("close", () => upstream.destroy());
  });
  return server;
}
/** Same bounded diagnostic GET /, now through TLS with the owned certificate. */
export function probeCheckoutHttpsRoot(cert: Buffer, signal: AbortSignal): Promise<CheckoutProbe> {
  if (signal.aborted) return Promise.resolve({ status: null, errorClass: "CANCELLED", connected: false });
  return new Promise(accept => {
    let complete = false, connected = false, status: number | null = null;
    let request: http.ClientRequest | undefined;
    const finish = (errorClass: CheckoutProbe["errorClass"]) => {
      if (complete) return;
      complete = true; clearTimeout(timer); signal.removeEventListener("abort", abort); request?.destroy(); accept({ status, errorClass, connected });
    };
    const abort = () => finish("CANCELLED"), timer = setTimeout(() => finish("TIMEOUT"), 1000);
    signal.addEventListener("abort", abort, { once: true });
    try {
      request = https.request({ hostname: "127.0.0.1", port: 3160, servername: "checkout.nexus.test", headers: { Host: "checkout.nexus.test:3160" },
        path: "/", method: "GET", agent: false, ca: cert, rejectUnauthorized: true }, response => {
        status = typeof response.statusCode === "number" && response.statusCode >= 100 && response.statusCode <= 599 ? response.statusCode : null;
        response.once("end", () => finish(status === null ? "INVALID_RESPONSE" : null));
        response.once("aborted", () => finish("RESPONSE_ABORTED")); response.once("error", error => finish(classifyCheckoutProbeError(error)));
        response.resume();
      });
      request.once("socket", socket => { if (!socket.connecting && socket.readyState === "open") connected = true; socket.once("connect", () => { connected = true; }); });
      request.once("error", error => finish(classifyCheckoutProbeError(error))); request.end();
    } catch (error) { finish(classifyCheckoutProbeError(error)); }
  });
}
