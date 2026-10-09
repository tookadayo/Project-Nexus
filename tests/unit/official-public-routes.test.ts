import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "../../apps/web/node_modules/next/server";
import { proxy } from "../../apps/web/proxy";

afterEach(() => vi.unstubAllEnvs());
describe("public publications keep the operator and mutation boundaries", () => {
  const paths = [
    "/news",
    "/news/11111111-1111-4111-8111-111111111111",
    "/terms",
    "/privacy",
    "/support",
    "/legal",
    "/legal/beta",
    "/legal/operator",
    "/legal/history",
  ];
  it.each(["oauth", "development"])(
    "serves only fresh public reads in %s mode",
    (mode) => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("NEXUS_WEB_AUTH_MODE", mode);
      vi.stubEnv("NEXUS_WEB_PASSWORD", "synthetic-test-password");
      for (const path of paths)
        for (const method of ["GET", "HEAD"]) {
          const response = proxy(
            new NextRequest("http://127.0.0.1:3100" + path, { method }),
          );
          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toContain("no-store");
          expect(response.headers.get("location")).toBeNull();
        }
    },
  );
  it("rejects all public publication writes, including server-action POSTs", () => {
    vi.stubEnv("NEXUS_WEB_AUTH_MODE", "oauth");
    for (const path of paths)
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = proxy(
          new NextRequest("http://127.0.0.1:3100" + path, {
            method,
            headers: { "Next-Action": "synthetic-action" },
          }),
        );
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, HEAD");
        expect(response.headers.get("cache-control")).toContain("no-store");
      }
  });
  it("does not open operator routes, similarly named paths, or the dashboard", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXUS_WEB_AUTH_MODE", "development");
    vi.stubEnv("NEXUS_WEB_PASSWORD", "synthetic-test-password");
    for (const path of [
      "/operator/legal",
      "/operator/publications",
      "/newsletter",
      "/legal-private",
      "/legal/candidates/terms.ja.md",
      "/dashboard",
    ]) {
      expect(
        proxy(new NextRequest("http://127.0.0.1:3100" + path)).status,
      ).toBe(401);
    }
  });
  it("keeps unpublished legal status pages out of search indexing", () => {
    vi.stubEnv("NEXUS_WEB_AUTH_MODE", "oauth");
    for (const path of [
      "/terms",
      "/privacy",
      "/legal",
      "/legal/beta",
      "/legal/operator",
      "/legal/history",
    ])
      expect(
        proxy(new NextRequest("http://127.0.0.1:3100" + path)).headers.get(
          "x-robots-tag",
        ),
      ).toContain("noindex");
  });
});
