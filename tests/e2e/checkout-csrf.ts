import type { BrowserContext } from "@playwright/test";
import { checkoutOrigin } from "./checkout-transport.js";

export type CheckoutCsrfContext = Pick<BrowserContext, "request" | "cookies">;
/** Ask the real proxy for this context's current session-bound proof.
 * No token is minted here, and intentional rejection requests stay explicit. */
export async function checkoutSessionCsrfHeaders(context: CheckoutCsrfContext) {
  const issued = await context.request.get(checkoutOrigin + "/billing/payments", { maxRedirects: 0, timeout: 10000 });
  if (issued.status() !== 200) throw new Error("TEST_CHECKOUT_CSRF_ISSUE_FAILED");
  const cookies = await context.cookies(checkoutOrigin);
  const session = cookies.find(cookie => cookie.name === "nexus_session")?.value;
  const proof = cookies.find(cookie => cookie.name === "nexus_csrf")?.value;
  if (!session || !/^[A-Za-z0-9_-]{43}$/.test(session)) throw new Error("TEST_CHECKOUT_SESSION_REQUIRED");
  if (!proof || !/^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(proof)) throw new Error("TEST_CHECKOUT_CSRF_NOT_ISSUED");
  return { Origin: checkoutOrigin, "Sec-Fetch-Site": "same-origin", "X-Nexus-CSRF": proof };
}
