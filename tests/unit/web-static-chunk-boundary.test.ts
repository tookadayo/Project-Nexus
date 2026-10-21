import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { webRouteBoundary } from "../../apps/web/app/auth/public-boundary";

const web = createRequire(resolve("apps/web/package.json"));
const { encodeURIPath } = web("next/dist/shared/lib/encode-uri-path") as {
  encodeURIPath: (path: string) => string;
};
const asset = { kind: "ASSET", methods: ["GET", "HEAD"] };

describe("generated Next chunk route boundary", () => {
  it.each([
    "[turbopack]_browser_dev_hmr-client_hmr-client_ts_1r7-a2a._.js",
    "0zix_@swc_helpers_cjs_0hi-e47._.js",
    "apps_web_[app]_@scope_styles.css",
  ])("admits Next's actual URL encoding for %s with read methods only", filename => {
    const path = "/_next/static/chunks/" + encodeURIPath(filename);
    expect(path).toMatch(/%5B|%40/);
    expect(webRouteBoundary(path)).toEqual(asset);
  });

  it.each([
    "/_next/static/chunks/%5bturbopack%5d_runtime.js",
    "/_next/static/chunks/%5Bapp%5d_%40scope.css",
    "/_next/static/chunks/plain-chunk.js",
    "/_next/static/chunks/@scope_helpers.js",
    "/_next/static/media/plain-font.woff2",
    "/nexus/logo.svg",
  ])("preserves supported chunk spellings and existing plain assets: %s", path => {
    expect(webRouteBoundary(path)).toEqual(asset);
  });

  it.each([
    "/_next/static/chunks/%2e%2e/%40helpers.js",
    "/_next/static/chunks/%2E%2E/%5Bapp%5D.js",
    "/_next/static/chunks/../%40helpers.js",
    "/_next/static/chunks/a/%5Bapp%5D.js",
    "/_next/static/chunks/%5Bapp%5D/../helpers.js",
    "/_next/static/chunks/%5Bapp%5D%2foperator.js",
    "/_next/static/chunks/%5Bapp%5D%2Foperator.js",
    "/_next/static/chunks/%5Bapp%5D%5coperator.js",
    "/_next/static/chunks/%5Bapp%5D%5Coperator.js",
    "/_next/static/chunks/%5Bapp%5D%00.js",
    "/_next/static/chunks/%5Bapp%5D%0a.js",
    "/_next/static/chunks/%5Bapp%5D%20.js",
    "/_next/static/chunks/%255Bapp%255D.js",
    "/_next/static/chunks/%2540helpers.js",
    "/_next/static/chunks/%252e%252e.js",
    "/_next/static/chunks/%5Gapp%5D.js",
    "/_next/static/chunks/%5Bapp%.js",
    "/_next/static/chunks/%61pp.js",
    "/_next/static/chunks/%40helpers%3fquery.js",
    "/_next/static/chunks/%40helpers%23fragment.js",
    "/_next/static/chunks/%40helpers%3acolon.js",
    "/_next/static/chunks/%40helpers.json",
    "/_next/static/chunks/%40helpers.html",
    "/_next/static/chunks/%40helpers.js/extra",
    "/_next/static/chunks/[turbopack]_runtime.js",
    "/_next/static/%5Bapp%5D.js",
    "/_next/static/media/%40font.woff2",
    "/_next/static/chunks-extra/%40helpers.js",
    "/nexus/%40logo.svg",
    "/nexus/%5Bapp%5D.js",
    "/api/%40helpers.js",
    "/operator/%5Bapp%5D.js",
    "/auth/%63allback",
    "/.env",
  ])("rejects non-generated spellings and namespace escapes: %s", path => {
    expect(webRouteBoundary(path)).toBeNull();
  });

  it("retains exact protected and callback classifications", () => {
    expect(webRouteBoundary("/dashboard")).toEqual({ kind: "BROWSER", methods: ["GET", "HEAD"] });
    expect(webRouteBoundary("/data/attention")).toEqual({ kind: "BROWSER", methods: ["GET", "HEAD", "POST"] });
    expect(webRouteBoundary("/auth/callback")).toEqual({ kind: "OAUTH_CALLBACK", methods: ["GET"] });
    expect(webRouteBoundary("/billing/webhooks/stripe")).toEqual({ kind: "MACHINE_CALLBACK", methods: ["POST"] });
    expect(webRouteBoundary("/api/unknown")).toBeNull();
  });
});
