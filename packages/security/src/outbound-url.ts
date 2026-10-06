import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { assert } from "../../shared/src/index";
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const n = address.split(".").map(Number),
      [a, b] = n;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a! >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized.startsWith("2") || normalized.startsWith("3")
      ? !normalized.startsWith("2001:db8") &&
          !normalized.startsWith("2001:0:") &&
          !normalized.startsWith("2002:")
      : false;
  }
  return false;
}
export function outboundUrl(input: string) {
  const url = new URL(input);
  assert(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === "443") &&
      url.hostname.length <= 253,
    "INVALID_WEBHOOK_URL",
  );
  const host = url.hostname.replace(/^\[|\]$/g, "");
  assert(
    host.includes(".") &&
      !host.endsWith(".") &&
      !host.endsWith(".localhost") &&
      !host.endsWith(".local") &&
      (!isIP(host) || publicAddress(host)),
    "WEBHOOK_PRIVATE_ADDRESS",
  );
  return url;
}
/** Resolve on every attempt and pin a validated address into TLS transport.
 * No redirects, proxies, response bodies, or payment/provider SDKs are involved. */
export async function sendWebhook(
  urlString: string,
  body: string,
  headers: Record<string, string>,
): Promise<number> {
  const url = outboundUrl(urlString),
    deadline = Date.now() + 8000;
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const resolved = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_resolve, reject) => {
      dnsTimer = setTimeout(() => reject(new Error("WEBHOOK_TIMEOUT")), 8000);
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  assert(
    resolved.length > 0 &&
      resolved.every((record) => publicAddress(record.address)),
    "WEBHOOK_PRIVATE_ADDRESS",
  );
  const pinned = resolved[0]!;
  return new Promise((resolve, reject) => {
    const req = request(
        url,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          lookup: (_host, _options, callback) =>
            callback(null, pinned.address, pinned.family),
        },
        (response) => {
          const status = response.statusCode ?? 0;
          response.destroy();
          resolve(status);
        },
      ),
      timer = setTimeout(
        () => req.destroy(new Error("WEBHOOK_TIMEOUT")),
        Math.max(1, deadline - Date.now()),
      );
    req.once("close", () => clearTimeout(timer));
    req.once("error", reject);
    req.end(body);
  });
}
