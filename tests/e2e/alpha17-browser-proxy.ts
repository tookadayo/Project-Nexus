import http from "node:http";
import net from "node:net";

/** Synthetic test transport only. Denied destinations never reach DNS/connect. */
export function createBrowserProxy(
  track: (socket: net.Socket) => net.Socket = socket => socket,
  observed: (event: "HTTP_DENIED" | "CONNECT_DENIED" | "CONNECT_ALLOWED" | "CONNECT_ALLOWED_FIXTURE") => void = () => {},
) {
  const allowedHttp = new Set(["http://127.0.0.1:3151", "http://127.0.0.1:3153"]);
  const tunnels = new Map([["app.nexus.test:3150", 3150], ["127.0.0.1:3151", 3151], ["127.0.0.1:3153", 3153]]);
  const server = http.createServer((request, response) => {
    let url: URL | undefined;
    try { url = new URL(request.url ?? ""); } catch { /* Denied below. */ }
    if (!url || url.username || url.password || !allowedHttp.has(url.origin)) {
      observed("HTTP_DENIED");
      response.writeHead(403);
      response.end();
      return;
    }
    const upstream = http.request({
      hostname: "127.0.0.1", port: Number(url.port), method: request.method,
      path: url.pathname + url.search, headers: { ...request.headers, host: url.host },
    }, incoming => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    });
    upstream.on("socket", track);
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on("aborted", () => upstream.destroy());
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on("connect", (request, client, head) => {
    client.on("error", () => client.destroy());
    const port = tunnels.get(request.url ?? "");
    if (!port) {
      observed("CONNECT_DENIED");
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    observed(port === 3150 ? "CONNECT_ALLOWED" : "CONNECT_ALLOWED_FIXTURE");
    const upstream = track(net.connect(port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    }));
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
  });
  return server;
}
