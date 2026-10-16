import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  createPublicApiProof,
  readPublicApiProof,
} from "../../packages/security/src/public-api";
import { webSetupPatchSchema } from "../../packages/operations/src/web-setup";
const scope = {
    organizationId: "11111111-1111-4111-8111-111111111111",
    guildId: "222222222222222222",
  },
  secret = "s".repeat(64),
  userId = "333333333333333333",
  path = "/v3/organizations/x/guilds/y/web-setup/draft";
describe("alpha15 request-local public identity proof", () => {
  it("binds the exact method, path, scope and short lifetime without exposing a raw session", () => {
    const proof = createPublicApiProof(
      {
        scope,
        userId,
        sessionReference: "private-session-reference",
        method: "POST",
        path,
        origin: "https://nexus.example",
      },
      secret,
      100000,
    );
    expect(
      readPublicApiProof(proof, "POST", path, scope, secret, 100001).userId,
    ).toBe(userId);
    for (const run of [
      () => readPublicApiProof(proof, "GET", path, scope, secret, 100001),
      () =>
        readPublicApiProof(
          proof,
          "POST",
          path + "/other",
          scope,
          secret,
          100001,
        ),
      () =>
        readPublicApiProof(
          proof,
          "POST",
          path,
          { ...scope, guildId: "444444444444444444" },
          secret,
          100001,
        ),
      () => readPublicApiProof(proof, "POST", path, scope, secret, 130000),
      () =>
        readPublicApiProof(proof, "POST", path, scope, "x".repeat(64), 100001),
    ])
      expect(run).toThrow();
    expect(
      Buffer.from(proof.split(".")[0]!, "base64url").toString(),
    ).not.toContain("private-session-reference");
  });
  it("rejects malformed proof and supplied actor/enable flags in setup patches", () => {
    for (const value of [undefined, "bad", ".", "x.y.z", "x".repeat(5000)])
      expect(() =>
        readPublicApiProof(value, "GET", path, scope, secret),
      ).toThrow();
    for (const patch of [
      { helperEnabled: true },
      { actor: "web-admin" },
      { managerRoleIds: [userId, userId] },
      { timezone: "Not/A/Region" },
      { newMemberGoals: ["reply", "reply"] },
    ])
      expect(webSetupPatchSchema.safeParse(patch).success).toBe(false);
    expect(
      webSetupPatchSchema.parse({
        helperChannelId: null,
        managerRoleIds: [],
        newMemberGoals: [],
        goalPreset: null,
      }),
    ).toEqual({
      helperChannelId: null,
      managerRoleIds: [],
      newMemberGoals: [],
      goalPreset: null,
    });
  });
  it("requires v2 body/query binding, preserves repeated query order and does not downgrade to v1", () => {
    const target = path + "?filter=a&filter=b&range=7", body = { patch: { timezone: "UTC", enabled: false }, revision: 3 };
    const proof = createPublicApiProof({ scope, userId, sessionReference: "private-session-reference", method: "POST", path: target, body, origin: "https://nexus.example" }, secret, 100000);
    const parsed = readPublicApiProof(proof, "POST", path + "?range=7&filter=a&filter=b", scope, secret, 100001, { revision: 3, patch: { enabled: false, timezone: "UTC" } });
    expect(parsed).toMatchObject({ version: 2, keyId: "public-session:v2", query: "filter=a&filter=b&range=7" });
    expect(parsed.nonce).toMatch(/^[a-f0-9-]{36}$/);
    expect(() => readPublicApiProof(proof, "POST", target, scope, secret, 100001)).toThrow();
    expect(() => readPublicApiProof(proof, "POST", target, scope, secret, 100001, { ...body, revision: 4 })).toThrow();
    expect(() => readPublicApiProof(proof, "POST", path + "?filter=b&filter=a&range=7", scope, secret, 100001, body)).toThrow();
    const legacy = Buffer.from(JSON.stringify({ scope, userId, sessionDigest: parsed.sessionDigest, method: "POST", path, origin: "https://nexus.example", issuedAt: 100000, expiresAt: 130000 })).toString("base64url");
    const mac = createHmac("sha256", secret).update("public-api:v1:" + legacy).digest("base64url");
    expect(() => readPublicApiProof(`${legacy}.${mac}`, "POST", path, scope, secret, 100001)).toThrow();
  });
});
