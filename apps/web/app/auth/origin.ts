import { webOrigin } from "../../../../packages/config/src/web-origin";
export function sameOrigin(req: Request) {
  try {
    const configured = process.env.NEXUS_WEB_URL;
    if (!configured && process.env.NEXUS_WEB_AUTH_MODE !== "development")
      return false;
    const origin = new URL(req.headers.get("origin") ?? ""),
      expected = new URL(webOrigin(req));
    return (
      origin.origin === expected.origin &&
      origin.host === req.headers.get("host") &&
      req.headers.get("sec-fetch-site") === "same-origin"
    );
  } catch {
    return false;
  }
}
