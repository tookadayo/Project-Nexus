"use client";

/** Explicit header helper for new clients. The root bridge covers the existing
 * native forms/fetch callers while they adopt this API. No token goes off-origin. */
export function csrfHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  const token = typeof document === "undefined" ? undefined : document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("nexus_csrf="))?.slice("nexus_csrf=".length);
  if (token) result.set("X-Nexus-CSRF", decodeURIComponent(token));
  return result;
}
