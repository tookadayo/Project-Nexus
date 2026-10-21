import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../packages/db/src/index";
import { createPublicApiProof, publicApiIdentity } from "../../packages/security/src/public-api";
import { apiToken } from "../../packages/security/src/scoping";
import { PublicTokenCipher, publicSessionDigest } from "../../packages/security/src/public-sessions";
import { sameOrigin } from "../../apps/web/app/auth/origin";

const memory = vi.hoisted(() => ({ row: undefined as undefined | Record<string, unknown>, digest: "", selects: 0, writes: 0 }));
vi.mock("../../packages/db/src/index", async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  sql: (parts: TemplateStringsArray, ...parameters: unknown[]) => ({ execute: async () => {
    if (parts[0]?.startsWith("SELECT ")) {
      memory.selects++;
      return { rows: memory.row && parameters[0] === memory.digest ? [memory.row] : [] };
    }
    memory.writes++; return { rows: [] };
  } }),
}));

const secret = "s".repeat(64), serviceKey = "verification-api-key";
const scope = { organizationId: "11111111-1111-4111-8111-111111111111", guildId: "931111111111111111" };
const userId = "911111111111111111", reference = "synthetic-session-reference";
const origin = "https://app.nexus.test:3150";
const path = `/v3/organizations/${scope.organizationId}/guilds/${scope.guildId}/web-setup/status`;
const database = { transaction: () => ({ execute: async (run: (tx: unknown) => unknown) => run({}) }) } as unknown as Database;
const request = (options: { method?: "GET" | "POST"; origin?: string; signingSecret?: string; sessionReference?: string; userId?: string } = {}) => {
  const method = options.method ?? "GET";
  const proof = createPublicApiProof({ scope, userId: options.userId ?? userId,
    sessionReference: options.sessionReference ?? reference, method, path,
    ...(options.origin === undefined ? {} : { origin: options.origin }) }, options.signingSecret ?? secret);
  return { params: scope, method, url: path, id: "synthetic-request", headers: {
    authorization: `Bearer ${apiToken(serviceKey, scope)}`, "x-nexus-user-proof": proof,
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  } };
};

beforeEach(() => {
  vi.stubEnv("NEXUS_SESSION_SECRET", secret);
  vi.stubEnv("NEXUS_WEB_URL", origin);
  vi.stubEnv("NEXUS_WEB_AUTH_MODE", "oauth");
  const digest = publicSessionDigest(reference), cipher = new PublicTokenCipher(secret);
  memory.digest = digest;
  memory.row = { user_ciphertext: cipher.seal(digest, userId), token_ciphertext: cipher.seal(digest, JSON.stringify({ accessToken: "synthetic-oauth-only" })), proof_nonces: {} };
  memory.selects = 0; memory.writes = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("synthetic API receiver session boundary", () => {
  it("rejects a missing receiver secret before touching the mock database", async () => {
    vi.stubEnv("NEXUS_SESSION_SECRET", undefined);
    await expect(publicApiIdentity(request(), database, serviceKey)).rejects.toMatchObject({ code: "SESSION_REQUIRED", status: 401 });
    expect(memory.selects).toBe(0);
  });
  it("accepts the matching synthetic secret through the real receiver and cipher", async () => {
    const identity = await publicApiIdentity(request(), database, serviceKey);
    expect(identity).toMatchObject({ scope, userId });
    expect(memory.selects).toBe(1);
    expect(memory.writes).toBe(1);
  });
  it("rejects a mismatched receiver secret and a forged identity", async () => {
    await expect(publicApiIdentity(request({ signingSecret: "x".repeat(64) }), database, serviceKey))
      .rejects.toMatchObject({ code: "SESSION_REQUIRED", status: 401 });
    expect(memory.selects).toBe(0);
    await expect(publicApiIdentity(request({ userId: "911111111111111112" }), database, serviceKey))
      .rejects.toMatchObject({ code: "SESSION_REQUIRED", status: 401 });
  });
  it("rejects an absent or forged session rather than granting access from the service proof alone", async () => {
    await expect(publicApiIdentity(request({ sessionReference: "forged-synthetic-reference" }), database, serviceKey))
      .rejects.toMatchObject({ code: "SESSION_EXPIRED", status: 401 });
    memory.row = undefined;
    await expect(publicApiIdentity(request(), database, serviceKey))
      .rejects.toMatchObject({ code: "SESSION_EXPIRED", status: 401 });
  });
  it("rejects mutation origins before database access and accepts the exact configured synthetic origin", async () => {
    await expect(publicApiIdentity(request({ method: "POST", origin: "https://foreign.invalid" }), database, serviceKey))
      .rejects.toMatchObject({ code: "CROSS_ORIGIN", status: 403 });
    expect(memory.selects).toBe(0);
    await expect(publicApiIdentity(request({ method: "POST", origin }), database, serviceKey)).resolves.toMatchObject({ scope, userId });
  });
  it("reproduces the fixture's missing canonical origin after the secret boundary is corrected", async () => {
    vi.stubEnv("NEXUS_WEB_URL", undefined);
    vi.stubEnv("NODE_ENV", "test");
    await expect(publicApiIdentity(request({ method: "POST", origin }), database, serviceKey))
      .rejects.toMatchObject({ code: "CROSS_ORIGIN", status: 403 });
    expect(memory.selects).toBe(0);
  });
  it("preserves the Web same-origin and fetch-site CSRF gates", () => {
    const make = (value: string, site: string) => new Request(origin + "/data/setup/draft", { method: "POST", headers: {
      origin: value, host: "app.nexus.test:3150", "sec-fetch-site": site,
    } });
    expect(sameOrigin(make(origin, "same-origin"))).toBe(true);
    expect(sameOrigin(make("https://foreign.invalid", "same-origin"))).toBe(false);
    expect(sameOrigin(make(origin, "cross-site"))).toBe(false);
  });
});
