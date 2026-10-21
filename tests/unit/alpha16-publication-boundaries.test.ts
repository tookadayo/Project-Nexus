import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalWebHost, webRouteBoundary } from "../../apps/web/app/auth/public-boundary";
import { createCsrfToken, csrfFormField, matchesCsrfToken, suppliedCsrfToken } from "../../apps/web/app/auth/csrf";
import { consumePublicApiNonce, createPublicApiProof, publicApiBodyHash, readPublicApiProof } from "../../packages/security/src/public-api";

const secret = "fixture-only-secret-".repeat(4), binding = "fixture-session-reference";
const scope = { organizationId: "11111111-1111-4111-8111-111111111111", guildId: "222222222222222222" };

describe("alpha16 actual PC web route boundary", () => {
  it("defaults to deny for internal, Operator, debug and unknown authentication routes", () => {
    for (const path of ["/internal/pc/health", "/__internal/v1/publications", "/operator", "/operator/v1/status", "/api/unknown", "/auth/not-registered", "/metrics", "/.env", "/api/rules/%2e%2e/operator", "/auth//callback", "/auth/%63allback"]) expect(webRouteBoundary(path)).toBeNull();
  });
  it("admits exact callbacks separately from browser sessions and CSRF", () => {
    expect(webRouteBoundary("/auth/callback")).toEqual({ kind: "OAUTH_CALLBACK", methods: ["GET"] });
    expect(webRouteBoundary("/billing/webhooks/stripe")).toEqual({ kind: "MACHINE_CALLBACK", methods: ["POST"] });
    expect(webRouteBoundary("/billing/webhooks/stripe/extra")).toBeNull();
  });
  it("keeps reviewed route verbs and the Rule BFF registered without opening all /api", () => {
    expect(webRouteBoundary("/auth/select")?.methods).toContain("POST");
    expect(webRouteBoundary("/api/automation/flows/example/draft")?.methods).toContain("PUT");
    expect(webRouteBoundary("/api/rules/suggestions/example/apply")?.methods).toEqual(["POST"]);
    expect(webRouteBoundary("/api/rules/catalog")?.methods).not.toContain("POST");
    expect(webRouteBoundary("/api/rules/rule-evaluations")?.methods).toContain("POST");
  });
  it("does not trust forwarded Host/proto values and requires production HTTPS", () => {
    const request = new Request("https://app.nexus.example/", { headers: { host: "attacker.example", "x-forwarded-host": "app.nexus.example", "x-forwarded-proto": "https" } });
    expect(canonicalWebHost(request, "https://app.nexus.example", true)).toBe(false);
    const valid = new Request("http://127.0.0.1/", { headers: { host: "app.nexus.example", "x-forwarded-host": "attacker.example" } });
    expect(canonicalWebHost(valid, "https://app.nexus.example", true)).toBe(true);
    expect(canonicalWebHost(valid, "http://app.nexus.example", true)).toBe(false);
  });
  it("registers the reviewed authoring routes with exact methods and keeps unknown report actions closed", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    for (const path of ["/health", "/automation/managed-roles", "/onboarding-flows", "/reports/definitions", "/rules/issues", "/rules/sources", "/rules/config", "/rules/context", "/rules/evaluations", "/api/rules/source-config", "/api/rules/source-config/options", `/api/rules/source-config/${id}`, "/api/report-definitions/templates", `/api/report-definitions/templates/${id}`, `/api/report-definitions/drafts/${id}`, `/api/report-definitions/drafts/${id}/preview`])
      expect(webRouteBoundary(path)).toEqual({kind: "BROWSER", methods: ["GET", "HEAD"]});
    expect(webRouteBoundary("/onboarding-flows/data")).toEqual({kind: "BROWSER", methods: ["GET", "HEAD", "POST"]});
    expect(webRouteBoundary("/api/rule-issues")).toEqual({kind: "BROWSER", methods: ["GET", "HEAD", "POST"]});
    expect(webRouteBoundary("/api/rule-context")).toEqual({kind: "BROWSER", methods: ["GET", "HEAD", "POST"]});
    expect(webRouteBoundary("/api/rules/source-config/revisions")).toEqual({kind: "BROWSER", methods: ["POST"]});
    expect(webRouteBoundary(`/api/rules/source-config/${id}/disable`)).toEqual({kind: "BROWSER", methods: ["POST"]});
    for (const path of ["/api/rules/config/activate", "/api/rules/config/retire", "/api/rules/source-health/observations", "/api/rules/evaluation-request-status"]) expect(webRouteBoundary(path)).toEqual({kind: "BROWSER", methods: ["POST"]});
    for (const path of ["/api/report-definitions/drafts", ...["revisions", "commit", "cancel"].map(action => `/api/report-definitions/drafts/${id}/${action}`)])
      expect(webRouteBoundary(path)).toEqual({kind: "BROWSER", methods: ["POST"]});
    for (const path of ["/api/report-definitions/templates/list", "/api/report-definitions/templates/not-a-uuid", `/api/report-definitions/drafts/${id}/publish`, `/api/report-definitions/drafts/${id}/preview/extra`, "/onboarding-flows/unknown", "/api/rule-issues/extra", "/api/rules/source-config/unknown", `/api/rules/source-config/${id}/activate`])
      expect(webRouteBoundary(path)).toBeNull();
  });
  it("accounts for the existing actual page/route files without automatically allowing future files", async () => {
    const root = join(process.cwd(), "apps/web/app");
    async function files(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
    }
    const paths = (await files(root)).filter(path => /(?:page\.tsx|route\.ts)$/.test(path)).map(path => "/" + relative(root, path).replaceAll("\\", "/").replace(/\/(?:page\.tsx|route\.ts)$/, "").replace(/^page\.tsx$/, ""));
    for (const path of paths.filter(path => !path.includes("["))) expect(webRouteBoundary(path), path).not.toBeNull();
    const source = await readFile(join(root, "auth/public-boundary.ts"), "utf8");
    expect(source).not.toContain("readdir");
  });
});

describe("alpha16 session-bound CSRF", () => {
  it("requires the matching cookie/header token and the same session binding", () => {
    const value = createCsrfToken(binding, secret);
    expect(matchesCsrfToken(value, value, binding, secret)).toBe(true);
    for (const [cookie, supplied, session] of [[value, undefined, binding], [value, value, "other-session"], [value, value + "x", binding]] as const) expect(matchesCsrfToken(cookie, supplied, session, secret)).toBe(false);
    expect(matchesCsrfToken(value, value, binding, "other-secret".repeat(4))).toBe(false);
    expect(csrfFormField('"><script>')).toBe("");
  });
  it("reads native form tokens without consuming the domain request body", async () => {
    const value = createCsrfToken(binding, secret), body = new URLSearchParams({ _nexus_csrf: value, guild: "222222222222222222" });
    const request = new Request("https://app.nexus.example/auth/select", { method: "POST", body });
    expect(await suppliedCsrfToken(request)).toBe(value);
    expect((await request.formData()).get("guild")).toBe("222222222222222222");
  });
});

describe("alpha16 signed internal request v2", () => {
  it("binds body/query while accepting the same canonical JSON object order", () => {
    const path = "/v3/organizations/x/guilds/y/automation/flows?b=2&a=1", body = { title: "fixture", nested: { a: 1, b: 2 } };
    const proof = createPublicApiProof({ scope, userId: "333333333333333333", sessionReference: binding, method: "POST", path, body }, secret, 100000);
    expect(readPublicApiProof(proof, "POST", path, scope, secret, 100001, { nested: { b: 2, a: 1 }, title: "fixture" }).version).toBe(2);
    expect(() => readPublicApiProof(proof, "POST", path + "&a=3", scope, secret, 100001, body)).toThrow();
    expect(() => readPublicApiProof(proof, "POST", path, scope, secret, 100001, { ...body, title: "changed" })).toThrow();
    expect(publicApiBodyHash(JSON.stringify(body))).toBe(publicApiBodyHash(body));
  });
  it("rejects nonce replay, expires old replay state and preserves the 30s proof limit", () => {
    const nonce = "11111111-1111-4111-8111-111111111111", next = "22222222-2222-4222-8222-222222222222";
    const consumed = consumePublicApiNonce({}, nonce, 130000, 100000);
    expect(() => consumePublicApiNonce(consumed, nonce, 130000, 100001)).toThrow("PROOF_REPLAY_REJECTED");
    expect(Object.keys(consumePublicApiNonce(consumed, next, 150000, 130001))).toHaveLength(1);
    expect(() => consumePublicApiNonce({}, next, 130001, 100000)).toThrow();
  });
  it("does not accept a correctly MACed legacy-v1 proof at the new boundary", () => {
    const body = Buffer.from(JSON.stringify({ scope, userId: "333333333333333333", sessionDigest: "0".repeat(64), method: "GET", path: "/example", issuedAt: 100000, expiresAt: 130000 })).toString("base64url");
    const signature = createHmac("sha256", secret).update("public-api:v1:" + body).digest("base64url");
    expect(() => readPublicApiProof(`${body}.${signature}`, "GET", "/example", scope, secret, 100001)).toThrow();
  });
});
