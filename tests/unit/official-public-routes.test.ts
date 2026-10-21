import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "../../apps/web/node_modules/next/server";
import { proxy } from "../../apps/web/proxy";

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXUS_WEB_URL", "http://127.0.0.1:3100");
});
const request = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("host", "127.0.0.1:3100");
  return new NextRequest("http://127.0.0.1:3100" + path, {...init, headers, signal: init.signal ?? undefined});
};
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
    async (mode) => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("NEXUS_WEB_AUTH_MODE", mode);
      vi.stubEnv("NEXUS_WEB_PASSWORD", "synthetic-test-password");
      for (const path of paths)
        for (const method of ["GET", "HEAD"]) {
          const response = await proxy(request(path, {method}));
          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toContain("no-store");
          expect(response.headers.get("location")).toBeNull();
        }
    },
  );
  it("rejects all public publication writes, including server-action POSTs", async () => {
    vi.stubEnv("NEXUS_WEB_AUTH_MODE", "oauth");
    for (const path of paths)
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await proxy(
          request(path, {
            method,
            headers: { "Next-Action": "synthetic-action" },
          }),
        );
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, HEAD");
        expect(response.headers.get("cache-control")).toContain("no-store");
      }
  });
  it("does not open operator routes, similarly named paths, or the dashboard", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXUS_WEB_AUTH_MODE", "development");
    vi.stubEnv("NEXUS_WEB_PASSWORD", "synthetic-test-password");
    for (const path of [
      "/operator/legal",
      "/operator/publications",
      "/newsletter",
      "/legal-private",
      "/legal/candidates/terms.ja.md",
    ]) {
      const response = await proxy(request(path));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({error: "NOT_FOUND"});
    }
    expect((await proxy(request("/dashboard"))).status).toBe(401);
  });
  it("keeps unpublished legal status pages out of search indexing", async () => {
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
        (await proxy(request(path))).headers.get(
          "x-robots-tag",
        ),
      ).toContain("noindex");
  });
});
