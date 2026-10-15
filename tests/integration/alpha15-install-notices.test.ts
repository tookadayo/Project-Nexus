import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  connect,
  migrate,
  sql,
  tenant,
  ensureGuild,
  json,
  type Database,
} from "../../packages/db/src/index";
import { InstallNotices } from "../../apps/gateway/src/install-notices";
import { setupInteraction } from "../../apps/worker/src/setup-interactions";
import { ActionWorker } from "../../apps/worker/src/actions";
import { OnboardingService } from "../../packages/onboarding/src/index";
import { DiscordFailure, DiscordRest } from "../../packages/discord/src/rest";
import { SettingsService } from "../../packages/settings/src/index";
import { analysisVault as vault } from "../fixtures/analysis";
import { FakeDiscord } from "../fixtures/discord";
import { isolatedPostgres } from "../fixtures/postgres";
let infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  db: Database,
  serial = 0;
const channel = "822222222222222222",
  system = "833333333333333333";
beforeAll(async () => {
  vi.stubEnv("NEXUS_HOSTED_BETA", "off");
  vi.stubEnv("NEXUS_WEB_URL", "https://nexus.example");
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db, { throughVersion: 52 });
  for (const name of ["053_web_setup", "055_alpha15_install_notices"])
    await sql
      .raw(
        await readFile(
          new URL(`../../migrations/${name}.sql`, import.meta.url),
          "utf8",
        ),
      )
      .execute(db);
}, 60000);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
  vi.unstubAllEnvs();
}, 60000);
async function fixture(admin: string | null = channel) {
  const s = {
    organizationId: randomUUID(),
    guildId: String(811111111111111111n + BigInt(++serial)),
  };
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_settings(organization_id,guild_id,settings) VALUES(${s.organizationId}::uuid,${s.guildId},${json({ adminNotificationChannelId: admin })})`.execute(
    db,
  );
  const discord = new FakeDiscord(),
    notices = new InstallNotices(db, discord);
  const evidence = {
    source: "created" as const,
    botJoinedAt: Date.now(),
    firstRegistration: true,
    systemChannelId: system,
  };
  return {
    s,
    discord,
    notices,
    evidence,
    actions: new ActionWorker(
      db,
      vault,
      discord,
      new OnboardingService(db, new SettingsService(db), vault),
    ),
  };
}
async function rows(s: Awaited<ReturnType<typeof fixture>>["s"]) {
  return (
    await sql<{
      state: string;
    }>`SELECT state FROM install_notices WHERE ${tenant(s)}`.execute(db)
  ).rows;
}

it("queues one notice across duplicate install events and sends once through the shared worker", async () => {
  const f = await fixture();
  await Promise.all([
    f.notices.observe(f.s, f.evidence),
    f.notices.observe(f.s, f.evidence),
  ]);
  expect(await rows(f.s)).toEqual([{ state: "UNSENT" }]);
  const outbox = (
    await sql<{
      payload: unknown;
    }>`SELECT payload FROM action_outbox WHERE ${tenant(f.s)}`.execute(db)
  ).rows;
  expect(outbox).toHaveLength(1);
  expect(Object.keys(outbox[0]!.payload as object)).toEqual(["generation"]);
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await f.actions.tick(f.s)).toBe(false);
  expect(f.discord.calls.filter((c) => c === "sendInstallNotice")).toHaveLength(
    1,
  );
  expect(await f.notices.status(f.s)).toMatchObject({ state: "SUCCEEDED" });
  expect(
    await f.notices.observe(f.s, {
      ...f.evidence,
      source: "ready",
      firstRegistration: false,
    }),
  ).toBe("SUCCEEDED");
});
it("preserves unknown after a disconnected send, restart, re-addition and a different target", async () => {
  const f = await fixture();
  await f.notices.observe(f.s, f.evidence);
  vi.spyOn(f.discord, "sendInstallNotice").mockImplementation(
    async (_channel, _body, _nonce, before) => {
      await before?.();
      throw new DiscordFailure(0, 0, { kind: "timeout" });
    },
  );
  await f.actions.tick(f.s);
  expect(await f.notices.status(f.s)).toMatchObject({ state: "UNKNOWN" });
  await sql`UPDATE guild_settings SET settings=settings||${json({ adminNotificationChannelId: system })} WHERE ${tenant(f.s)}`.execute(
    db,
  );
  const restarted = new InstallNotices(db, f.discord);
  expect(
    await restarted.observe(f.s, {
      ...f.evidence,
      source: "ready",
      firstRegistration: false,
    }),
  ).toBe("UNKNOWN");
  expect(
    await restarted.observe(f.s, {
      ...f.evidence,
      botJoinedAt: Date.now(),
      firstRegistration: false,
    }),
  ).toBe("UNKNOWN");
  expect(await f.actions.tick(f.s)).toBe(false);
  expect(f.discord.calls.filter((c) => c === "sendInstallNotice")).toHaveLength(
    0,
  );
  expect(f.discord.sendInstallNotice).toHaveBeenCalledTimes(1);
});
it("uses Web only for an existing or restored guild with missing evidence, even with a recent join", async () => {
  const f = await fixture();
  expect(await f.notices.observe(f.s, { ...f.evidence, source: "ready" })).toBe(
    "WEB_ONLY",
  );
  expect(
    await f.notices.observe(f.s, { ...f.evidence, firstRegistration: false }),
  ).toBe("WEB_ONLY");
  expect(await rows(f.s)).toEqual([]);
  expect(await f.actions.tick(f.s)).toBe(false);
});
it("accepts an independently verified absent-before-join request exactly once", async () => {
  const f = await fixture();
  await sql`INSERT INTO web_setup_install_requests(organization_id,guild_id,id,actor_hash,bot_absent_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,'synthetic',${new Date(f.evidence.botJoinedAt - 1000)})`.execute(
    db,
  );
  expect(
    await f.notices.observe(f.s, { ...f.evidence, firstRegistration: false }),
  ).toBe("UNSENT");
  expect(
    (
      await sql<{
        notice_claimed_at: Date | null;
      }>`SELECT notice_claimed_at FROM web_setup_install_requests WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows[0]!.notice_claimed_at,
  ).toBeInstanceOf(Date);
  await sql`UPDATE guild_settings SET settings=settings||${json({ enabled: false })} WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await f.actions.tick(f.s);
  expect(await f.notices.status(f.s)).toMatchObject({ state: "FAILED" });
  expect(f.discord.calls.filter((c) => c === "sendInstallNotice")).toHaveLength(
    0,
  );
});
it("never chooses an arbitrary channel or an unapproved system channel; only a definite pre-send denial can fall back", async () => {
  const f = await fixture(null);
  expect(await f.notices.observe(f.s, f.evidence)).toBe("WEB_ONLY");
  expect(f.discord.calls).toEqual([]);
  const g = await fixture();
  const check = vi
    .spyOn(g.discord, "checkChannel")
    .mockImplementation(async (_guild, id) => {
      if (id === channel) throw new DiscordFailure(403);
    });
  const approved = new InstallNotices(
    db,
    g.discord,
    async (_s, id) => id === system,
  );
  expect(await approved.observe(g.s, g.evidence)).toBe("UNSENT");
  expect(check.mock.calls.map((c) => c[1])).toEqual([channel, system]);
  const h = await fixture();
  const noFallback = vi
    .spyOn(h.discord, "checkChannel")
    .mockRejectedValue(new DiscordFailure(0));
  expect(
    await new InstallNotices(db, h.discord, async () => true).observe(
      h.s,
      h.evidence,
    ),
  ).toBe("WEB_ONLY");
  expect(noFallback).toHaveBeenCalledTimes(1);
});
it("purges delivery metadata and outbox within seven days without reviving an expired notice", async () => {
  const f = await fixture();
  await f.notices.observe(f.s, f.evidence);
  await sql`UPDATE install_notices SET observed_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await sql`UPDATE action_outbox SET created_at=clock_timestamp()-interval '8 days' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await f.notices.purge();
  expect(await rows(f.s)).toEqual([]);
  expect(
    (await sql`SELECT id FROM action_outbox WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toEqual([]);
  expect(
    await f.notices.observe(f.s, {
      ...f.evidence,
      source: "ready",
      firstRegistration: false,
    }),
  ).toBe("WEB_ONLY");
  expect(
    await f.notices.observe(f.s, {
      ...f.evidence,
      firstRegistration: false,
      botJoinedAt: Date.now(),
    }),
  ).toBe("WEB_ONLY");
});
it("treats a crashed send-intent and expired outbox lease as unknown without another send", async () => {
  const f = await fixture();
  await f.notices.observe(f.s, f.evidence);
  await sql`UPDATE install_notices SET state='SENDING' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await sql`UPDATE action_outbox SET state='RUNNING',lease_until=clock_timestamp()-interval '1 second',lease_token=${randomUUID()}::uuid WHERE ${tenant(f.s)}`.execute(
    db,
  );
  expect(await f.notices.status(f.s)).toMatchObject({ state: "UNKNOWN" });
  await f.actions.tick(f.s);
  expect(await f.notices.status(f.s)).toMatchObject({ state: "UNKNOWN" });
  expect(f.discord.calls).toEqual([]);
});
it("turns stale Discord wizard confirmation into a Web link without changing drafts or settings", async () => {
  const f = await fixture();
  const before = (
    await sql`SELECT * FROM guild_settings WHERE ${tenant(f.s)}`.execute(db)
  ).rows;
  const body = await setupInteraction(
    db,
    f.discord,
    f.s,
    {
      key: "synthetic",
      permissions: "8",
      roles: [],
      source: "DISCORD_PANEL",
      requestId: randomUUID(),
    },
    async () => "unused",
    "ja",
    { action: "setupWizardConfirm", draftId: "invalid", version: -1 },
  );
  expect(body.content).toContain("Set up NEXUS on the web");
  expect(
    (await sql`SELECT * FROM guild_settings WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toEqual(before);
  expect(
    (await sql`SELECT id FROM setup_drafts WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toHaveLength(0);
});

it("requires a live usable Beta invitation and rejects queued delivery after pause or generation change", async () => {
  const f = await fixture();
  vi.stubEnv("NEXUS_HOSTED_BETA", "on");
  try {
    await expect(f.notices.observe(f.s, f.evidence)).rejects.toThrow(
      "BETA_UNAVAILABLE",
    );
    expect(await rows(f.s)).toEqual([]);
    const grant = randomUUID();
    await sql`INSERT INTO entitlement_grants(id,organization_id,guild_id,source,ends_at,reason) VALUES(${grant}::uuid,${f.s.organizationId}::uuid,${f.s.guildId},'PARTNER',now()+interval '1 day','Synthetic notice test')`.execute(
      db,
    );
    await sql`INSERT INTO beta_guild_invitations(organization_id,guild_id,status,generation,guild_name,bot_present,bot_checked_at,activated_at,expires_at,grant_id) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},'ACTIVE',1,'Synthetic guild',true,now(),now(),now()+interval '1 day',${grant}::uuid)`.execute(
      db,
    );
    expect(await f.notices.observe(f.s, f.evidence)).toBe("UNSENT");
    await sql`UPDATE beta_guild_invitations SET status='PAUSED',generation=2 WHERE ${tenant(f.s)}`.execute(
      db,
    );
    await f.actions.tick(f.s);
    expect(await f.notices.status(f.s)).toMatchObject({ state: "FAILED" });
    expect(
      f.discord.calls.filter((c) => c === "sendInstallNotice"),
    ).toHaveLength(0);
  } finally {
    vi.stubEnv("NEXUS_HOSTED_BETA", "off");
  }
});

it("rejects expired or later-than-join absent proofs without collecting or sending anything", async () => {
  const f = await fixture();
  await sql`INSERT INTO web_setup_install_requests(organization_id,guild_id,id,actor_hash,bot_absent_at,expires_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,'synthetic',now()-interval '1 hour',now()-interval '1 minute'),(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,'synthetic',now()+interval '1 hour',now()+interval '2 hours')`.execute(
    db,
  );
  expect(
    await f.notices.observe(f.s, { ...f.evidence, firstRegistration: false }),
  ).toBe("WEB_ONLY");
  expect(await rows(f.s)).toEqual([]);
  expect(f.discord.calls).toEqual([]);
});

it("retains a confirmed late success after a lease expires without sending again", async () => {
  const f = await fixture();
  await f.notices.observe(f.s, f.evidence);
  const send = vi
    .spyOn(f.discord, "sendInstallNotice")
    .mockImplementation(async (_channel, _body, _nonce, before) => {
      await before?.();
      await sql`UPDATE action_outbox SET state='UNKNOWN',lease_until=NULL,lease_token=NULL WHERE ${tenant(f.s)}`.execute(
        db,
      );
      await sql`UPDATE install_notices SET state='UNKNOWN' WHERE ${tenant(f.s)}`.execute(
        db,
      );
      return "844444444444444444";
    });
  await f.actions.tick(f.s);
  expect(await f.notices.status(f.s)).toMatchObject({ state: "SUCCEEDED" });
  expect(await f.actions.tick(f.s)).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
});

it("retries a definite rate-limit response with the same action while keeping unknown writes terminal", async () => {
  const f = await fixture();
  await f.notices.observe(f.s, f.evidence);
  const send = vi
    .spyOn(f.discord, "sendInstallNotice")
    .mockImplementationOnce(async (_channel, _body, _nonce, before) => {
      await before?.();
      throw new DiscordFailure(429, 1);
    })
    .mockImplementationOnce(async (_channel, _body, _nonce, before) => {
      await before?.();
      return "855555555555555555";
    });
  await f.actions.tick(f.s);
  expect(await f.notices.status(f.s)).toMatchObject({ state: "UNSENT" });
  await sql`UPDATE action_outbox SET available_at=clock_timestamp() WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await f.actions.tick(f.s);
  expect(await f.notices.status(f.s)).toMatchObject({ state: "SUCCEEDED" });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0]![2]).toBe(send.mock.calls[1]![2]);
});

it.each([
  "network",
  "server",
  "malformed",
  "missing-id",
  "invalid-id",
  "no-content",
])(
  "makes exactly one real REST attempt and persists unknown for %s notice responses",
  async (failure) => {
    const f = await fixture(),
      rest = new DiscordRest("synthetic-token", "899999999999999999");
    const fetcher = vi.fn(async () => {
      if (failure === "network") throw new TypeError("Synthetic disconnect");
      if (failure === "server") return new Response("{}", { status: 503 });
      if (failure === "malformed") return new Response("{", { status: 200 });
      if (failure === "no-content") return new Response(null, { status: 204 });
      return new Response(
        JSON.stringify(failure === "missing-id" ? {} : { id: "invalid" }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(f.discord, "sendInstallNotice").mockImplementation((...args) =>
      rest.sendInstallNotice(...args),
    );
    await f.notices.observe(f.s, f.evidence);
    await f.actions.tick(f.s);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await f.notices.status(f.s)).toMatchObject({ state: "UNKNOWN" });
    const restarted = new InstallNotices(db, f.discord);
    expect(
      await restarted.observe(f.s, { ...f.evidence, firstRegistration: false }),
    ).toBe("UNKNOWN");
    expect(await f.actions.tick(f.s)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("requires the dedicated non-retrying sender instead of falling back to a panel sender", async () => {
  const f = await fixture(),
    panel = vi.spyOn(f.discord, "sendPanel"),
    unsupported = new InstallNotices(db, {
      checkChannel: f.discord.checkChannel.bind(f.discord),
    });
  expect(await unsupported.observe(f.s, f.evidence)).toBe("WEB_ONLY");
  expect(await f.actions.tick(f.s)).toBe(false);
  expect(panel).not.toHaveBeenCalled();
  // Existing queued work must also fail closed after an adapter downgrade.
  await f.notices.observe(f.s, f.evidence);
  Object.defineProperty(f.discord, "sendInstallNotice", { value: undefined });
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await f.notices.status(f.s)).toMatchObject({ state: "FAILED" });
  expect(panel).not.toHaveBeenCalled();
});

it("returns a real 429 to the outbox and rechecks settings before another request", async () => {
  const f = await fixture(),
    rest = new DiscordRest("synthetic-token", "899999999999999999"),
    fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ retry_after: 0 }), { status: 429 }),
    );
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(f.discord, "sendInstallNotice").mockImplementation((...args) =>
    rest.sendInstallNotice(...args),
  );
  await f.notices.observe(f.s, f.evidence);
  await f.actions.tick(f.s);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await f.notices.status(f.s)).toMatchObject({ state: "UNSENT" });
  await sql`UPDATE action_outbox SET available_at=clock_timestamp() WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await sql`UPDATE guild_settings SET settings=settings||${json({ enabled: false })} WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await f.actions.tick(f.s);
  expect(await f.notices.status(f.s)).toMatchObject({ state: "FAILED" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("classifies lease expiry in the final transport guard as not started", async () => {
  const f = await fixture(),
    rest = new DiscordRest("synthetic-token", "899999999999999999"),
    fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(f.discord, "sendInstallNotice").mockImplementation((...args) =>
    rest.sendInstallNotice(...args),
  );
  await f.notices.observe(f.s, f.evidence);
  let checks = 0;
  vi.spyOn(f.discord, "checkChannel").mockImplementation(async () => {
    if (++checks === 2)
      await sql`UPDATE action_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE ${tenant(f.s)}`.execute(
        db,
      );
  });
  await f.actions.tick(f.s);
  expect(checks).toBe(2);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await f.notices.status(f.s)).toMatchObject({ state: "FAILED" });
});

it("uses the current permitted system channel by default for a proven new installation", async () => {
  const f = await fixture(null);
  f.discord.installationSystemChannelId = system;
  const metadata = vi.spyOn(f.discord, "installationSystemChannel");
  expect(
    await f.notices.observe(f.s, { ...f.evidence, systemChannelId: channel }),
  ).toBe("UNSENT");
  expect(await f.notices.status(f.s)).toEqual({
    state: "UNSENT",
    reason: "QUEUED",
    nextAction: "CONTINUE_WEB_SETUP",
  });
  expect(
    (
      await sql`SELECT channel_id,destination_kind FROM install_notices WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ channel_id: system, destination_kind: "SYSTEM" }]);
  await f.actions.tick(f.s);
  expect(await f.notices.status(f.s)).toEqual({
    state: "SUCCEEDED",
    reason: "DELIVERED",
    nextAction: "CONTINUE_WEB_SETUP",
  });
  expect(metadata).toHaveBeenCalledTimes(3);
  expect(f.discord.calls).toEqual(["sendInstallNotice"]);
  const body = [...f.discord.panels.values()][0];
  expect(JSON.stringify(body)).toContain(
    `https://nexus.example/setup?guild=${f.s.guildId}`,
  );
  expect(JSON.stringify(body)).toContain("current management permissions");
});

it.each(["no-system", "permission", "metadata-unknown"])(
  "keeps a %s destination Web-only with a clear continuation",
  async (failure) => {
    const f = await fixture(null);
    f.discord.installationSystemChannelId =
      failure === "no-system" ? null : system;
    if (failure === "permission")
      vi.spyOn(f.discord, "checkChannel").mockRejectedValue(
        new DiscordFailure(403),
      );
    if (failure === "metadata-unknown")
      vi.spyOn(f.discord, "installationSystemChannel").mockRejectedValue(
        new DiscordFailure(0),
      );
    expect(await f.notices.observe(f.s, f.evidence)).toBe("WEB_ONLY");
    expect(await f.notices.status(f.s)).toEqual({
      state: "WEB_ONLY",
      reason: "DELIVERY_UNAVAILABLE",
      nextAction: "CONTINUE_WEB_SETUP",
    });
    expect(await f.actions.tick(f.s)).toBe(false);
    expect(f.discord.calls).toEqual([]);
  },
);

it("revalidates a system target at dispatch and never follows a replacement target", async () => {
  const f = await fixture(null);
  f.discord.installationSystemChannelId = system;
  await f.notices.observe(f.s, f.evidence);
  f.discord.installationSystemChannelId = channel;
  await f.actions.tick(f.s);
  expect(await f.notices.status(f.s)).toEqual({
    state: "FAILED",
    reason: "DELIVERY_UNAVAILABLE",
    nextAction: "CONTINUE_WEB_SETUP",
  });
  expect(f.discord.calls).toEqual([]);
});

it("prefers saved administrator notifications and falls back only after a definite pre-send denial", async () => {
  const f = await fixture();
  f.discord.installationSystemChannelId = system;
  const metadata = vi.spyOn(f.discord, "installationSystemChannel");
  expect(await f.notices.observe(f.s, f.evidence)).toBe("UNSENT");
  expect(metadata).not.toHaveBeenCalled();
  const g = await fixture();
  g.discord.installationSystemChannelId = system;
  vi.spyOn(g.discord, "checkChannel").mockImplementation(async (_guild, id) => {
    if (id === channel) throw new DiscordFailure(403);
  });
  expect(await g.notices.observe(g.s, g.evidence)).toBe("UNSENT");
  expect(
    (
      await sql`SELECT channel_id,destination_kind FROM install_notices WHERE ${tenant(g.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ channel_id: system, destination_kind: "SYSTEM" }]);
  const h = await fixture();
  h.discord.installationSystemChannelId = system;
  vi.spyOn(h.discord, "checkChannel").mockRejectedValue(new DiscordFailure(0));
  const unverified = vi.spyOn(h.discord, "installationSystemChannel");
  expect(await h.notices.observe(h.s, h.evidence)).toBe("WEB_ONLY");
  expect(unverified).not.toHaveBeenCalled();
});

it("does not turn a usable system channel into proof of a new installation", async () => {
  const f = await fixture(null);
  f.discord.installationSystemChannelId = system;
  expect(
    await f.notices.observe(f.s, { ...f.evidence, firstRegistration: false }),
  ).toBe("WEB_ONLY");
  expect(await f.notices.status(f.s)).toEqual({
    state: "WEB_ONLY",
    reason: "NO_VERIFIED_NOTICE",
    nextAction: "CONTINUE_WEB_SETUP",
  });
  expect(await rows(f.s)).toEqual([]);
});

it("returns the dashboard continuation only for completed settings and an active server connection", async () => {
  const f = await fixture(null);
  await sql`UPDATE guild_settings SET settings=settings||${json({ setupVersion: 3, managerRoleIds: [], newMemberGoals: [], helperChannelId: null })} WHERE ${tenant(f.s)}`.execute(
    db,
  );
  expect((await f.notices.status(f.s)).nextAction).toBe("CONTINUE_WEB_SETUP");
  await sql`INSERT INTO server_web_links(organization_id,guild_id,verified_at,updated_at,revision) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},now(),now(),${randomUUID()}::uuid)`.execute(
    db,
  );
  expect(await f.notices.status(f.s)).toEqual({
    state: "WEB_ONLY",
    reason: "NO_VERIFIED_NOTICE",
    nextAction: "OPEN_DASHBOARD",
  });
});
