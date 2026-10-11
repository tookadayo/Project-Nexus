import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  connect,
  migrate,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import {
  BetaOperator,
  type BetaChange,
} from "../../packages/security/src/beta-operator";
import { betaInvitation } from "../../packages/security/src/hosted-beta";
import { betaInteractionAdmission } from "../../packages/security/src/beta-interactions";
import { betaActionPolicy } from "../../packages/security/src/beta-outbox";
import { Components } from "../../packages/security/src/index";
import { ServerAuthorization } from "../../packages/security/src/server-authorization";
import { ServerVerification } from "../../packages/security/src/server-verification";
import { PrivacyService } from "../../packages/security/src/privacy";
import { AnalysisService } from "../../packages/analysis/src/index";
import { OnboardingService } from "../../packages/onboarding/src/index";
import { enqueue } from "../../packages/discord/src/outbox";
import { ActionWorker } from "../../apps/worker/src/actions";
import { InteractionWorker } from "../../apps/worker/src/interactions";
import type { InteractionJob } from "../../apps/interaction/src/server";
import { analysisFixture, analysisVault as vault } from "../fixtures/analysis";
import { isolatedPostgres } from "../fixtures/postgres";

let infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  db: Database,
  operator: BetaOperator,
  serial = 0;
const nextId = () => String(883000000000000000n + BigInt(++serial));
beforeAll(async () => {
  vi.stubEnv("NEXUS_HOSTED_BETA", "on");
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
  operator = new BetaOperator(db, async () => ({
    name: "Synthetic delivery server",
    present: true,
    canObserve: true,
    checkedAt: Date.now(),
  }));
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
  vi.unstubAllEnvs();
});
afterEach(async () => {
  for (const row of await operator.list())
    if (row.status === "ACTIVE" && row.expires_at! > new Date())
      await change(row.guild_id, "pause");
});
async function change(guildId: string, action: BetaChange["action"]) {
  const row = await betaInvitation(db, scopeForGuild(guildId));
  return operator.change({
    guildId,
    action,
    generation: row?.generation ?? null,
    requestId: randomUUID(),
    reason: "Synthetic outbox regression",
  });
}
async function fixture() {
  const guildId = nextId();
  await change(guildId, "register");
  await change(guildId, "activate");
  const f = await analysisFixture(db, "FREE", true, scopeForGuild(guildId));
  f.user = nextId();
  f.actor = {
    ...f.actor,
    key: vault.hash(f.s, f.user),
    encryptedUserId: vault.seal(f.s, f.user),
  };
  f.discord.members.set(f.user, {
    permissions: "8",
    roles: [],
    bot: false,
    joinedAt: new Date().toISOString(),
  });
  const tokens = new Components("synthetic-outbox-components"),
    onboarding = new OnboardingService(db, f.settings, vault),
    privacy = new PrivacyService(db, vault, f.settings),
    interactions = new InteractionWorker(
      db,
      vault,
      tokens,
      f.discord,
      f.settings,
      onboarding,
      (s, user, actor, guild) => privacy.delete(s, user, actor, guild),
    ),
    actions = new ActionWorker(db, vault, f.discord, onboarding),
    verification = new ServerVerification(
      db,
      vault,
      new ServerAuthorization(f.discord, f.settings, vault),
    );
  const challenge = await verification.issue(f.s, f.user);
  await verification.redeem(f.user, challenge.code);
  return { ...f, tokens, interactions, actions, verification };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function stop(f: Fixture, state: "paused" | "expired") {
  if (state === "paused") await change(f.s.guildId, "pause");
  else
    await sql`UPDATE beta_guild_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE ${tenant(f.s)}`.execute(
      db,
    );
}
async function queueInteraction(
  f: Fixture,
  input: Partial<InteractionJob>,
  admission = true,
) {
  const job: InteractionJob = {
    id: nextId(),
    applicationId: "781111111111111111",
    token: "synthetic-interaction-token",
    userId: f.user,
    locale: "en",
    ...input,
  };
  await db.transaction().execute(async (tx) => {
    if (admission)
      await betaInteractionAdmission(
        tx,
        f.s,
        job,
        f.tokens,
        vault.hash(f.s, job.userId),
      );
    await sql`INSERT INTO interaction_jobs(organization_id,guild_id,id,encrypted_payload) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${job.id},${vault.seal(f.s, JSON.stringify(job))})`.execute(
      tx,
    );
  });
  expect(await f.interactions.tick(f.s)).toBe(true);
  return (
    await sql<{
      id: string;
      kind: string;
      payload: Record<string, unknown>;
      state: string;
    }>`SELECT id,kind,payload,state FROM action_outbox WHERE ${tenant(f.s)} AND dedupe_key=${"reply:" + job.id}`.execute(
      db,
    )
  ).rows[0]!;
}
async function deliver(f: Fixture, input: Partial<InteractionJob>) {
  const row = await queueInteraction(f, input);
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(
    (
      await sql<{
        state: string;
      }>`SELECT state FROM action_outbox WHERE ${tenant(f.s)} AND id=${row.id}::uuid`.execute(
        db,
      )
    ).rows[0]?.state,
  ).toBe("SUCCEEDED");
  return f.discord.panels.get("reply");
}
function customIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap(customIds)
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, item]) =>
          key === "custom_id" ? [String(item)] : customIds(item),
        )
      : [];
}
async function button(f: Fixture, body: unknown, action: string) {
  for (const id of customIds(body))
    if ((await f.tokens.read(db, f.s, id, f.actor.key)).action === action)
      return id;
  throw new Error("EXPECTED_BUTTON_" + action);
}
async function state(f: Fixture, id: string) {
  return (
    await sql<{
      state: string;
    }>`SELECT state FROM action_outbox WHERE ${tenant(f.s)} AND id=${id}::uuid`.execute(
      db,
    )
  ).rows[0]?.state;
}

it.each(["paused", "expired"] as const)(
  "delivers unlink confirmation and confirmed unlink through the outbox while %s, without changing another Guild",
  async (mode) => {
    const f = await fixture(),
      other = await fixture(),
      invitation = await betaInvitation(db, f.s);
    const notification = await enqueue(
      db,
      f.s,
      "notification-before-stop",
      "TEST_MESSAGE",
      { channelId: f.channel, body: { content: "Must not be sent" } },
    );
    await stop(f, mode);
    const row = await queueInteraction(f, { command: "unlink" });
    expect(betaActionPolicy(vault, f.s, row.kind, row.payload).mode).toBe(
      "maintenance",
    );
    expect(await f.actions.tick(f.s)).toBe(true);
    expect(await state(f, notification)).toBe("FAILED");
    expect(f.discord.calls).not.toContain("sendPanel");
    expect(await f.actions.tick(f.s)).toBe(true);
    expect(await state(f, row.id)).toBe("SUCCEEDED");
    const confirm = await button(
      f,
      f.discord.panels.get("reply"),
      "unlinkConfirm",
    );
    await deliver(f, { customId: confirm });
    expect(JSON.stringify(f.discord.panels.get("reply"))).toContain(
      "Data deletion for this server has been requested",
    );
    expect((await f.verification.connection(f.s)).state).toBe(
      "INSTALLED_NOT_VERIFIED",
    );
    expect((await betaInvitation(db, f.s))?.status).toBe("DELETING");
    expect(
      (
        await sql`SELECT id FROM entitlement_grants WHERE id=${invitation!.grant_id}::uuid AND revoked_at IS NOT NULL`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await sql`SELECT id FROM beta_deletion_jobs WHERE ${tenant(f.s)} AND reason='UNLINK' AND state='PENDING'`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(1);
    expect((await betaInvitation(db, other.s))?.status).toBe("ACTIVE");
    expect((await other.verification.connection(other.s)).state).toBe(
      "VERIFIED",
    );
    expect(
      (
        await sql`SELECT id FROM beta_deletion_jobs WHERE ${tenant(other.s)}`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
  },
);

it.each(["paused", "expired"] as const)(
  "delivers authorized history while %s, but refuses expired retention and new analysis",
  async (mode) => {
    const f = await fixture();
    await new AnalysisService(db).request(
      f.s,
      f.actor,
      { type: "OVERALL", days: 30 },
      randomUUID(),
      undefined,
      true,
    );
    await stop(f, mode);
    const history = await queueInteraction(f, { command: "analysisHistory" });
    expect(
      betaActionPolicy(vault, f.s, history.kind, history.payload).mode,
    ).toBe("read");
    expect(await f.actions.tick(f.s)).toBe(true);
    expect(await state(f, history.id)).toBe("SUCCEEDED");
    expect(JSON.stringify(f.discord.panels.get("reply"))).toContain(
      "Detailed analysis history",
    );
    await expect(
      queueInteraction(f, { command: "analysisStart" }),
    ).rejects.toThrow("BETA_UNAVAILABLE");
    const staleHistory = await queueInteraction(f, {
      command: "analysisHistory",
    });
    const sent = f.discord.calls.filter((c) => c === "editReply").length;
    await sql`UPDATE beta_guild_invitations SET expires_at=clock_timestamp()-interval '31 days' WHERE ${tenant(f.s)}`.execute(
      db,
    );
    expect(await f.actions.tick(f.s)).toBe(true);
    expect(await state(f, staleHistory.id)).toBe("FAILED");
    expect(f.discord.calls.filter((c) => c === "editReply")).toHaveLength(sent);
  },
);

it("rejects pre-pause ordinary jobs after resume, retains the old dedupe generation, and delivers a new notification", async () => {
  const f = await fixture(),
    payload = {
      channelId: f.channel,
      body: { content: "Synthetic notification" },
    };
  const old = await enqueue(
      db,
      f.s,
      "old-notification",
      "TEST_MESSAGE",
      payload,
    ),
    first = (await betaInvitation(db, f.s))!.generation;
  await change(f.s.guildId, "pause");
  await change(f.s.guildId, "resume");
  expect(
    await enqueue(db, f.s, "old-notification", "TEST_MESSAGE", payload),
  ).toBe(old);
  expect(
    (
      await sql<{
        payload: { betaGeneration: number };
      }>`SELECT payload FROM action_outbox WHERE ${tenant(f.s)} AND id=${old}::uuid`.execute(
        db,
      )
    ).rows[0]!.payload.betaGeneration,
  ).toBe(first);
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await state(f, old)).toBe("FAILED");
  expect(f.discord.calls).not.toContain("sendPanel");
  const current = await enqueue(
    db,
    f.s,
    "new-notification",
    "TEST_MESSAGE",
    payload,
  );
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await state(f, current)).toBe("SUCCEEDED");
  expect(f.discord.calls.filter((c) => c === "sendPanel")).toHaveLength(1);
});

it("delivers privacy, personal deletion confirmation and completion without granting Guild deletion to a member", async () => {
  const f = await fixture();
  await change(f.s.guildId, "pause");
  f.discord.members.get(f.user)!.permissions = "0";
  const privacy = await deliver(f, { command: "privacy" });
  const personal = await button(f, privacy, "deleteMemberConfirm");
  const confirm = await deliver(f, { customId: personal });
  await deliver(f, { customId: await button(f, confirm, "deleteMember") });
  expect(
    (
      await sql`SELECT id FROM deletion_requests WHERE ${tenant(f.s)} AND lookup_hash=${f.actor.key} AND completed_at IS NOT NULL`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  expect((await betaInvitation(db, f.s))?.status).toBe("PAUSED");
  expect(
    (
      await sql`SELECT id FROM beta_deletion_jobs WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    f.interactions.dispatch(f.s, {
      id: nextId(),
      applicationId: "781111111111111111",
      token: "synthetic",
      userId: f.user,
      customId: await f.tokens.issue(
        db,
        f.s,
        { action: "deleteGuildConfirm" },
        f.actor.key,
      ),
    }),
  ).rejects.toThrow("ADMIN_REQUIRED");
});

it("delivers a private lifecycle followup from the shared panel and purges its receipt on the existing short schedule", async () => {
  const f = await fixture();
  await change(f.s.guildId, "pause");
  const messageId = nextId();
  await sql`INSERT INTO settings_panels(organization_id,guild_id,channel_id,message_id) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${f.channel},${messageId})`.execute(
    db,
  );
  const customId = await f.tokens.issue(
    db,
    f.s,
    { action: "privacy" },
    f.actor.key,
  );
  const row = await queueInteraction(f, { customId, messageId });
  expect(row.kind).toBe("REPLY_FOLLOWUP");
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await state(f, row.id)).toBe("SUCCEEDED");
  expect(f.discord.calls).toContain("followup");
  const ordinary = { ...row.payload };
  delete ordinary.betaReply;
  const legacy = await enqueue(
    db,
    f.s,
    "existing-followup",
    "REPLY_FOLLOWUP",
    ordinary,
  );
  await sql`UPDATE action_outbox SET created_at=now()-interval '16 minutes' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await new PrivacyService(db, vault, f.settings).purge(f.s);
  expect(await state(f, row.id)).toBeUndefined();
  expect(await state(f, legacy)).toBe("PENDING");
});

it("delivers confirmed Guild deletion completion after actual scoped erase without reviving history", async () => {
  const f = await fixture(),
    other = await fixture();
  await change(f.s.guildId, "pause");
  const privacy = await deliver(f, { command: "privacy" });
  const confirmation = await deliver(f, {
    customId: await button(f, privacy, "deleteGuildConfirm"),
  });
  await deliver(f, { customId: await button(f, confirmation, "deleteGuild") });
  expect((await betaInvitation(db, f.s))?.status).toBe("DELETED");
  expect(
    (
      await sql`SELECT id FROM beta_deletion_jobs WHERE ${tenant(f.s)} AND state='DONE'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (await sql`SELECT id FROM analysis_runs WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toHaveLength(0);
  await expect(
    queueInteraction(f, { command: "analysisHistory" }),
  ).rejects.toThrow("BETA_UNAVAILABLE");
  expect((await betaInvitation(db, other.s))?.status).toBe("ACTIVE");
});

it("rechecks authority before reply delivery and before confirmed unlink", async () => {
  const f = await fixture();
  await change(f.s.guildId, "pause");
  const pending = await queueInteraction(f, { command: "unlink" });
  f.discord.members.get(f.user)!.permissions = "0";
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await state(f, pending.id)).toBe("FAILED");
  expect(f.discord.calls).not.toContain("editReply");
  f.discord.members.get(f.user)!.permissions = "8";
  const confirmation = await deliver(f, { command: "unlink" }),
    customId = await button(f, confirmation, "unlinkConfirm");
  f.discord.members.get(f.user)!.permissions = "0";
  const denied = await queueInteraction(f, { customId });
  expect(denied.payload.betaReply).toBeUndefined();
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await state(f, denied.id)).toBe("FAILED");
  expect((await f.verification.connection(f.s)).state).toBe("VERIFIED");
  expect(
    (
      await sql`SELECT id FROM beta_deletion_jobs WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
});

it("rechecks current read permission before sending retained history", async () => {
  const f = await fixture();
  await change(f.s.guildId, "pause");
  const history = await queueInteraction(f, { command: "analysisHistory" });
  f.discord.members.get(f.user)!.permissions = "0";
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await state(f, history.id)).toBe("FAILED");
  expect(f.discord.calls).not.toContain("editReply");
});

it.each(["generation", "revoked"] as const)(
  "rejects a queued read reply after its %s changes",
  async (mode) => {
    const f = await fixture();
    const history = await queueInteraction(f, { command: "analysisHistory" });
    if (mode === "generation") {
      await change(f.s.guildId, "pause");
      await change(f.s.guildId, "resume");
    } else await change(f.s.guildId, "revoke");
    expect(await f.actions.tick(f.s)).toBe(true);
    expect(await state(f, history.id)).toBe("FAILED");
    expect(f.discord.calls).not.toContain("editReply");
  },
);

it("rejects copied tenant/Guild reply authority, actor-owned confirmation theft, and modified reply bodies", async () => {
  const f = await fixture(),
    other = await fixture();
  await change(f.s.guildId, "pause");
  await change(other.s.guildId, "pause");
  const pending = await queueInteraction(f, { command: "unlink" });
  const copied = await enqueue(
    db,
    other.s,
    "copied-reply",
    "REPLY_EDIT",
    pending.payload,
  );
  expect(await other.actions.tick(other.s)).toBe(true);
  expect(await state(other, copied)).toBe("FAILED");
  expect(other.discord.calls).not.toContain("editReply");
  await sql`UPDATE action_outbox SET payload=jsonb_set(payload,'{body}',${JSON.stringify({ content: "Substituted retained data" })}::jsonb) WHERE ${tenant(f.s)} AND id=${pending.id}::uuid`.execute(
    db,
  );
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await state(f, pending.id)).toBe("FAILED");
  const body = await deliver(f, { command: "unlink" }),
    confirm = await button(f, body, "unlinkConfirm"),
    thief = nextId();
  f.discord.members.set(thief, {
    permissions: "8",
    roles: [],
    bot: false,
    joinedAt: new Date().toISOString(),
  });
  await expect(
    queueInteraction(f, { customId: confirm, userId: thief }),
  ).rejects.toThrow("COMPONENT_OWNER");
  await expect(queueInteraction(other, { customId: confirm })).rejects.toThrow(
    "COMPONENT_EXPIRED",
  );
  expect((await f.verification.connection(f.s)).state).toBe("VERIFIED");
  expect((await other.verification.connection(other.s)).state).toBe("VERIFIED");
});

it("does not exempt uncertified replies or normal notifications carrying reply metadata, and rejects legacy unversioned jobs", async () => {
  const f = await fixture();
  const certified = await queueInteraction(f, { command: "unlink" });
  const masquerade = await enqueue(
    db,
    f.s,
    "masquerade-notification",
    "TEST_MESSAGE",
    { ...certified.payload, channelId: f.channel },
  );
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await state(f, certified.id)).toBe("SUCCEEDED");
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await state(f, masquerade)).toBe("FAILED");
  const legacy = await enqueue(db, f.s, "legacy-notification", "TEST_MESSAGE", {
    channelId: f.channel,
    body: {},
  });
  await sql`UPDATE action_outbox SET payload=payload-'betaGeneration' WHERE ${tenant(f.s)} AND id=${legacy}::uuid`.execute(
    db,
  );
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await state(f, legacy)).toBe("FAILED");
  await change(f.s.guildId, "pause");
  const plain = { ...certified.payload };
  delete plain.betaReply;
  const reply = await enqueue(
    db,
    f.s,
    "uncertified-reply",
    "REPLY_EDIT",
    plain,
  );
  const sent = f.discord.calls.filter((c) => c === "editReply").length;
  expect(await f.actions.tick(f.s)).toBe(true);
  expect(await state(f, reply)).toBe("FAILED");
  expect(f.discord.calls.filter((c) => c === "editReply")).toHaveLength(sent);
  expect(f.discord.calls).not.toContain("sendPanel");
});
