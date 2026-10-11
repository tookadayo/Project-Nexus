import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { webAuthMode } from "../../packages/config/src/web-auth";
import { webOrigin } from "../../packages/config/src/web-origin";

const legalPages = new Set([
  "/terms",
  "/privacy",
  "/support",
  "/legal",
  "/legal/beta",
  "/legal/operator",
  "/legal/history",
]);

export function proxy(req: NextRequest) {
  const mode = webAuthMode();
  const path = req.nextUrl.pathname;
  // Public publications have no mutation surface and are read fresh after withdrawal.
  if (legalPages.has(path) || path === "/news" || path.startsWith("/news/")) {
    const response = ["GET", "HEAD"].includes(req.method)
      ? NextResponse.next()
      : new NextResponse(null, {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    if (legalPages.has(path) && path !== "/support")
      response.headers.set("X-Robots-Tag", "noindex, noarchive");
    return response;
  }
  if (path === "/checkout" || path.startsWith("/checkout/"))
    return NextResponse.next();
  if (
    path.startsWith("/auth/") ||
    [
      "/",
      "/product",
      "/pricing",
      "/locale",
      "/billing/webhooks/stripe",
    ].includes(path)
  )
    return NextResponse.next();
  if (mode !== "development") {
    if (path.startsWith("/link/") && req.method !== "GET")
      return NextResponse.next();
    if (!req.cookies.get("nexus_session")?.value) {
      const login = new URL("/auth/login", webOrigin(req));
      if (path === "/link" || /^\/dashboard\/\d{17,20}$/.test(path))
        login.searchParams.set("next", path);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }
  const secret = process.env.NEXUS_WEB_PASSWORD;
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(
    `Basic ${Buffer.from(`nexus:${secret ?? ""}`).toString("base64")}`,
  );
  const actual = Buffer.from(header);
  if (
    !secret ||
    secret.length < 16 ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="NEXUS"',
        "Cache-Control": "no-store",
      },
    });
  return NextResponse.next();
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|nexus/).*)"],
};
