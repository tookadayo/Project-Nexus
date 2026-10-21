// Isolated synthetic process only. Exact provider requests terminate at the fixture.
import https from "node:https";
import http from "node:http";
const originalFetch = globalThis.fetch;
const originalHttpRequest = http.request;
const denied = () => { throw new Error("TEST_CHECKOUT_OUTBOUND_DENIED"); };
const localOrigin = "http://127.0.0.1:3161";
globalThis.fetch = (input, init) => {
  let url;
  try { url = new globalThis.URL(input instanceof globalThis.Request ? input.url : String(input)); } catch { return denied(); }
  if (url.username || url.password) return denied();
  if (url.origin === "https://discord.com" && url.pathname.startsWith("/api/v10/")) {
    const mapped = localOrigin + "/fixture/discord" + url.pathname.slice("/api/v10".length) + url.search;
    return originalFetch(input instanceof globalThis.Request ? new globalThis.Request(mapped, input) : mapped, { ...init, redirect: "error" });
  }
  if (url.origin === localOrigin) return originalFetch(input, { ...init, redirect: "error" });
  return denied();
};
function requestOptions(input, options, callback) {
  if (typeof input === "string" || input instanceof globalThis.URL) {
    let url;
    try { url = new globalThis.URL(input); } catch { return denied(); }
    if (url.username || url.password) return denied();
    return [{ protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      ...(typeof options === "object" ? options : {}) }, typeof options === "function" ? options : callback];
  }
  return [input, options];
}
http.request = function(input, options, callback) {
  const [value, listener] = requestOptions(input, options, callback);
  if (value?.socketPath !== undefined || value?._defaultAgent !== undefined) return denied();
  if (!value || value.protocol && value.protocol !== "http:" || (value.hostname ?? value.host) !== "127.0.0.1" || Number(value.port) !== 3161) return denied();
  return originalHttpRequest.call(http, { ...value, hostname: "127.0.0.1", host: "127.0.0.1", port: 3161, protocol: "http:", agent: undefined, createConnection: undefined }, listener);
};
https.request = function(input, options, callback) {
  const [value, listener] = requestOptions(input, options, callback);
  if (value?.socketPath !== undefined || value?._defaultAgent !== undefined) return denied();
  if (!value || value.protocol && value.protocol !== "https:" || (value.hostname ?? value.host) !== "api.stripe.com" || value.port && Number(value.port) !== 443 ||
      typeof value.path !== "string" || !value.path.startsWith("/v1/")) return denied();
  return originalHttpRequest.call(http, { ...value, hostname: "127.0.0.1", host: "127.0.0.1", port: 3161, protocol: "http:", agent: undefined,
    createConnection: undefined, path: "/fixture/stripe" + value.path }, listener);
};
http.get = function(...args) { const request = http.request(...args); request.end(); return request; };
https.get = function(...args) { const request = https.request(...args); request.end(); return request; };
