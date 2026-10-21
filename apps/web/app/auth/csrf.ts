import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const csrfCookieName = "nexus_csrf";
export const browserCookieName = "nexus_browser";
export const csrfFieldName = "_nexus_csrf";
export const csrfHeaderName = "X-Nexus-CSRF";
const equal = (left: string, right: string) => {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const csrfMac = (binding: string, nonce: string, secret: string) => createHmac("sha256", secret).update(`nexus-csrf:v1:${binding}:${nonce}`).digest("base64url");
export function createCsrfToken(binding: string, secret: string, nonce = randomBytes(24).toString("base64url")) {
  if (!binding || secret.length < 16 || !/^[A-Za-z0-9_-]{32}$/.test(nonce)) throw new Error("CSRF_UNAVAILABLE");
  return `${nonce}.${csrfMac(binding, nonce, secret)}`;
}
export function validCsrfToken(value: string | undefined, binding: string | undefined, secret: string | undefined) {
  if (!value || !binding || !secret || secret.length < 16 || value.length > 128) return false;
  const [nonce, mac, extra] = value.split(".");
  return Boolean(nonce && /^[A-Za-z0-9_-]{32}$/.test(nonce) && mac && !extra && equal(mac, csrfMac(binding, nonce, secret)));
}
export function matchesCsrfToken(cookie: string | undefined, supplied: string | undefined, binding: string | undefined, secret: string | undefined) {
  return Boolean(cookie && supplied && equal(cookie, supplied) && validCsrfToken(cookie, binding, secret));
}
export function csrfFormField(token: string | undefined) {
  return token && /^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(token) ? `<input type="hidden" name="${csrfFieldName}" value="${token}">` : "";
}

/** Read a clone only. Domain parsers still receive the original bytes unchanged. */
export async function suppliedCsrfToken(request: Request) {
  const header = request.headers.get(csrfHeaderName);
  if (header) return header;
  const type = request.headers.get("content-type")?.split(";")[0]?.trim();
  if (type !== "application/x-www-form-urlencoded" && type !== "multipart/form-data") return undefined;
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 1048576) return undefined;
  try {
    const copy = request.clone(), reader = copy.body?.getReader();
    if (!reader) return undefined;
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1048576) { void reader.cancel(); return undefined; }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bounded = new Request(copy.url, { method: "POST", headers: copy.headers, body: Buffer.concat(chunks) });
    const value = (await bounded.formData()).get(csrfFieldName);
    return typeof value === "string" && value.length <= 128 ? value : undefined;
  } catch { return undefined; }
}
