import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { infrastructure } from "../fixtures/infrastructure";
import { FakeDiscord } from "../fixtures/discord";
import { IdentityVault } from "../../packages/identity/src/index";
import { SettingsService } from "../../packages/settings/src/index";
import { PublicSessions } from "../../packages/security/src/public-sessions";
import { apiToken, scopeForGuild } from "../../packages/security/src/scoping";
import { createPublicApiProof } from "../../packages/security/src/public-api";
import { registerAlpha15Setup } from "../../apps/api/src/alpha15-setup";
import { isDomainError } from "../../packages/shared/src/index";
import { SetupWizard } from "../../packages/operations/src/setup-wizard";
import { createApi } from "../../apps/api/src/server";
import { AnalyticsService } from "../../packages/analytics/src/index";
let infra: Awaited<ReturnType<typeof infrastructure>>,
  db: Database,
  sequence = 0;
const key = "a".repeat(64),
  secret = "s".repeat(64),
  vault = new IdentityVault("ab".repeat(32), "cd".repeat(32)),
  user = "333333333333333333";
beforeAll(async () => {
  vi.stubEnv("NEXUS_SESSION_SECRET", secret);
  vi.stubEnv("NEXUS_WEB_URL", "https://nexus.example");
  vi.stubEnv("NEXUS_HOSTED_BETA", "off");
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
  vi.unstubAllEnvs();
});
async function fixture(combined = false) {
  const s = scopeForGuild(String(811111111111111111n + BigInt(++sequence))),
    discord = new FakeDiscord(),
    settings = new SettingsService(db);
  await ensureGuild(db, s);
  discord.members.set(user, {
    permissions: "32",
    roles: [],
    joinedAt: "2026-01-01T00:00:00Z",
    bot: false,
    guildName: "Fixture guild",
  });
  const sessions = new PublicSessions(db, secret, async () => {
      throw new Error("unexpected refresh");
    }),
    reference = await sessions.create(
      user,
      { accessToken: "synthetic-oauth" },
      3600,
    );
  const app = combined
    ? createApi(
        new AnalyticsService(db, settings),
        key,
        db,
        discord,
        undefined,
        vault,
      )
    : Fastify();
  if (!combined) {
    app.setErrorHandler((error, _req, reply) =>
      reply
        .code(isDomainError(error) ? error.status : 400)
        .send({ error: isDomainError(error) ? error.code : "VALIDATION" }),
    );
    registerAlpha15Setup(app, db, key, discord, vault);
  }
  const base = `/v3/organizations/${s.organizationId}/guilds/${s.guildId}/web-setup`;
  async function call(
    method: "GET" | "POST",
    suffix: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const path = base + suffix;
    return app.inject({
      method,
      url: path,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiToken(key, s)}`,
        "x-nexus-user-proof": createPublicApiProof({
          scope: s,
          userId: user,
          sessionReference: reference,
          method,
          path,
          ...(method === "POST" ? { origin: "https://nexus.example" } : {}),
        }),
        ...(method === "POST" ? { origin: "https://nexus.example" } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  }
  return { s, app, discord, settings, sessions, reference, call };
}
it("finishes Web setup without a Discord code and preserves optional/legacy semantics with replay-safe apply", async () => {
  const f = await fixture();
  try {
    expect((await f.call("GET", "/status")).json().state).toBe("LINK_REQUIRED");
    const verify = { requestId: randomUUID() };
    expect((await f.call("POST", "/verify", verify)).json().state).toBe(
      "VERIFIED",
    );
    expect((await f.call("POST", "/verify", verify)).json().state).toBe(
      "VERIFIED",
    );
    expect(
      (
        await sql`SELECT 1 FROM server_web_links WHERE ${tenant(f.s)}`.execute(
          db,
        )
      ).rows.length,
    ).toBe(1);
    const initial = await f.settings.get(f.s);
    const draftRequest = {
      requestId: randomUUID(),
      patch: {
        uiLanguage: "ja",
        timezone: "Asia/Tokyo",
        helperChannelId: null,
        managerRoleIds: [],
        newMemberGoals: [],
        goalPreset: "early_access",
      },
    };
    const saved = (await f.call("POST", "/draft", draftRequest)).json();
    expect((await f.call("POST", "/draft", draftRequest)).json()).toEqual(
      saved,
    );
    expect((await f.settings.get(f.s)).revision).toBe(initial.revision);
    const apply = {
      requestId: randomUUID(),
      draftId: saved.id,
      expectedDraftRevision: saved.version,
      expectedSettingsRevision: initial.revision,
    };
    const results = await Promise.all([
      f.call("POST", "/apply", apply),
      f.call("POST", "/apply", apply),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(results[0]!.json()).toEqual(results[1]!.json());
    const current = await f.settings.get(f.s);
    expect(current.revision).toBe(initial.revision + 1);
    expect(current.setupVersion).toBe(3);
    expect(current.helperEnabled).toBe(initial.helperEnabled);
    expect(current.newMemberGoals).toEqual([]);
    expect(current.managerRoleIds).toEqual([]);
    expect(current.goalPreset).toBe("early_access");
    expect(current.analysisScope).toEqual({ mode: "include", channelIds: [] });
    expect((await f.call("GET", "/status")).json().state).toBe("COMPLETE");
    expect(
      (await f.call("GET", "/requests/" + apply.requestId)).json().state,
    ).toBe("COMPLETED");
    const legacyActor = {
        key: vault.hash(f.s, user),
        permissions: "32",
        roles: [],
        source: "DISCORD_PANEL" as const,
        requestId: randomUUID(),
      },
      legacy = new SetupWizard(db);
    let oldDraft = await legacy.open(f.s, legacyActor);
    for (let step = 0; step < 4; step++)
      oldDraft = await legacy.move(
        f.s,
        legacyActor,
        oldDraft.id,
        oldDraft.version,
        "skip",
      );
    expect(
      (await legacy.confirm(f.s, legacyActor, oldDraft.id, oldDraft.version))
        .setupVersion,
    ).toBe(3);
    expect(f.discord.calls.length).toBe(0);
  } finally {
    await f.app.close();
  }
});
it("rejects static service token alone, cross-origin, actor spoofing and revoked sessions", async () => {
  const f = await fixture();
  try {
    const path = `/v3/organizations/${f.s.organizationId}/guilds/${f.s.guildId}/web-setup/status`;
    expect(
      (
        await f.app.inject({
          url: path,
          headers: { authorization: `Bearer ${apiToken(key, f.s)}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await f.call(
          "POST",
          "/verify",
          { requestId: randomUUID() },
          { origin: "https://attacker.example" },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await f.call("POST", "/draft", {
          requestId: randomUUID(),
          patch: { helperEnabled: true },
        })
      ).statusCode,
    ).toBe(400);
    await f.sessions.revoke(f.reference);
    expect((await f.call("GET", "/status")).statusCode).toBe(401);
  } finally {
    await f.app.close();
  }
});
it("requires native first-link authority and rechecks delegated authority and concurrent settings revisions", async () => {
  const f = await fixture(),
    role = "444444444444444444";
  try {
    const actor = {
      key: vault.hash(f.s, user),
      permissions: "32",
      roles: [],
      source: "WEB_DASHBOARD" as const,
      requestId: randomUUID(),
    };
    await f.settings.update(f.s, actor, 0, {
      managerRoleIds: [role],
      setupVersion: 1,
    });
    f.discord.members.set(user, {
      permissions: "0",
      roles: [role],
      joinedAt: "2026-01-01T00:00:00Z",
      bot: false,
    });
    expect(
      (await f.call("POST", "/verify", { requestId: randomUUID() })).statusCode,
    ).toBe(403);
    f.discord.members.get(user)!.permissions = "32";
    expect(
      (await f.call("POST", "/verify", { requestId: randomUUID() })).statusCode,
    ).toBe(200);
    f.discord.members.get(user)!.permissions = "0";
    const cfg = await f.settings.get(f.s),
      draft = (
        await f.call("POST", "/draft", {
          requestId: randomUUID(),
          patch: { timezone: "UTC" },
        })
      ).json();
    await f.settings.update(f.s, actor, cfg.revision, { uiLanguage: "en" });
    expect(
      (
        await f.call("POST", "/apply", {
          requestId: randomUUID(),
          draftId: draft.id,
          expectedDraftRevision: draft.version,
          expectedSettingsRevision: cfg.revision,
        })
      ).statusCode,
    ).toBe(409);
    f.discord.members.get(user)!.roles = [];
    expect((await f.call("GET", "/status")).statusCode).toBe(403);
    expect((await f.settings.get(f.s)).setupVersion).toBe(1);
  } finally {
    await f.app.close();
  }
});
it("checks actual Bot absence before a bounded invite request and hides user-inaccessible candidate names", async () => {
  const f = await fixture(),
    visible = "555555555555555555",
    hidden = "666666666666666666";
  try {
    vi.stubEnv("DISCORD_TOKEN", "synthetic-bot");
    vi.stubEnv("DISCORD_APPLICATION_ID", "777777777777777777");
    f.discord.members.delete(user);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) =>
          new Response(
            JSON.stringify(
              String(
                (init?.headers as Record<string, string>)?.Authorization,
              ).startsWith("Bot ")
                ? []
                : [
                    {
                      id: f.s.guildId,
                      name: "Managed fixture",
                      owner: true,
                      permissions: "32",
                    },
                  ],
            ),
            { status: 200 },
          ),
      ),
    );
    expect((await f.call("GET", "/status")).json().state).toBe("BOT_REQUIRED");
    const input = { requestId: randomUUID() },
      first = await f.call("POST", "/requests", input),
      replay = await f.call("POST", "/requests", input);
    expect(first.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const row = (
      await sql<{
        notice_claimed_at: Date | null;
        bot_absent_at: Date;
        expires_at: Date;
      }>`SELECT * FROM web_setup_install_requests WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows[0]!;
    expect(row.notice_claimed_at).toBeNull();
    expect(
      row.expires_at.getTime() - row.bot_absent_at.getTime(),
    ).toBeLessThanOrEqual(900100);
    f.discord.members.set(user, {
      permissions: "32",
      roles: [],
      joinedAt: "2026-01-01T00:00:00Z",
      bot: false,
    });
    Object.assign(f.discord, {
      options: async () => ({
        channels: [
          { id: visible, label: "Allowed name" },
          { id: hidden, label: "Private secret name" },
        ],
        roles: [],
        events: [],
      }),
      canReadAttentionChannel: async (_guild: string, channel: string) =>
        channel === visible,
    });
    const candidates = await f.call("GET", "/candidates");
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json().channels.map((c: { id: string }) => c.id)).toEqual(
      [visible],
    );
    expect(candidates.body).not.toContain("Private secret name");
  } finally {
    vi.unstubAllGlobals();
    await f.app.close();
  }
});
it("returns the committed result when a permitted update removes the caller's own configured delegation", async () => {
  const f = await fixture(),
    role = "444444444444444444";
  try {
    const actor = {
      key: vault.hash(f.s, user),
      permissions: "32",
      roles: [],
      source: "WEB_DASHBOARD" as const,
      requestId: randomUUID(),
    };
    const current = await f.settings.update(f.s, actor, 0, {
      managerRoleIds: [role],
    });
    expect(
      (await f.call("POST", "/verify", { requestId: randomUUID() })).statusCode,
    ).toBe(200);
    f.discord.members.get(user)!.permissions = "0";
    f.discord.members.get(user)!.roles = [role];
    const draft = (
      await f.call("POST", "/draft", {
        requestId: randomUUID(),
        patch: { managerRoleIds: [] },
      })
    ).json();
    const result = await f.call("POST", "/apply", {
      requestId: randomUUID(),
      draftId: draft.id,
      expectedDraftRevision: draft.version,
      expectedSettingsRevision: current.revision,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().complete).toBe(true);
    expect((await f.call("GET", "/status")).statusCode).toBe(403);
  } finally {
    await f.app.close();
  }
});
it("registers setup and automation in the real API factory and narrowly admits only pre-install setup during registered Beta", async () => {
  const f = await fixture(true);
  try {
    const prefix = `/v3/organizations/${f.s.organizationId}/guilds/${f.s.guildId}`;
    const unsignedAutomation = await f.app.inject({
      url: prefix + "/automation/overview",
      headers: { authorization: `Bearer ${apiToken(key, f.s)}` },
    });
    expect(unsignedAutomation.statusCode).toBe(401);
    vi.stubEnv("NEXUS_HOSTED_BETA", "on");
    vi.stubEnv("DISCORD_TOKEN", "synthetic-bot");
    vi.stubEnv("DISCORD_APPLICATION_ID", "777777777777777777");
    await sql`INSERT INTO beta_guild_invitations(organization_id,guild_id,guild_name,bot_present,bot_checked_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},'Fixture',false,clock_timestamp())`.execute(
      db,
    );
    f.discord.members.delete(user);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) =>
          new Response(
            JSON.stringify(
              String(
                (init?.headers as Record<string, string>)?.Authorization,
              ).startsWith("Bot ")
                ? []
                : [
                    {
                      id: f.s.guildId,
                      name: "Managed fixture",
                      owner: true,
                      permissions: "32",
                    },
                  ],
            ),
            { status: 200 },
          ),
      ),
    );
    expect((await f.call("GET", "/status")).json().state).toBe("BOT_REQUIRED");
    expect(
      (await f.call("POST", "/requests", { requestId: randomUUID() }))
        .statusCode,
    ).toBe(200);
    expect(
      (await f.call("POST", "/verify", { requestId: randomUUID() })).statusCode,
    ).toBe(403);
    for (const endpoint of ["/home", "/automation/overview"])
      expect(
        (
          await f.app.inject({
            url: prefix + endpoint,
            headers: { authorization: `Bearer ${apiToken(key, f.s)}` },
          })
        ).statusCode,
      ).toBe(403);
  } finally {
    vi.stubEnv("NEXUS_HOSTED_BETA", "off");
    vi.unstubAllGlobals();
    await f.app.close();
  }
});
