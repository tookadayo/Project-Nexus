import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import {
  connect,
  migrate,
  sql,
  tenant,
  privacyReadLock,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import {
  BetaOperator,
  type BetaChange,
} from "../../packages/security/src/beta-operator";
import {
  betaAccess,
  betaInvitation,
  betaWork,
  requestBetaDeletion,
} from "../../packages/security/src/hosted-beta";
import { BetaLifecycle } from "../../packages/security/src/beta-lifecycle";
import { PrivacyService } from "../../packages/security/src/privacy";
import { SettingsService } from "../../packages/settings/src/index";
import { AnalysisService } from "../../packages/analysis/src/index";
import { GatewayPublisher } from "../../apps/gateway/src/index";
import { LifecycleService } from "../../packages/lifecycle/src/index";
import { ServerAuthorization } from "../../packages/security/src/server-authorization";
import { ServerVerification } from "../../packages/security/src/server-verification";
import {
  captureDeletionTombstones,
  sealDeletionTombstones,
  openDeletionTombstones,
  applyDeletionTombstones,
} from "../../packages/security/src/tombstones";
import { PublicSessions } from "../../packages/security/src/public-sessions";
import { createApi } from "../../apps/api/src/server";
import type { AnalyticsService } from "../../packages/analytics/src/index";
import type { Envelope } from "../../packages/events/src/index";
import { analysisMetrics } from "../../packages/analytics/src/analysis";
import { analysisFixture, analysisVault } from "../fixtures/analysis";
import { isolatedPostgres } from "../fixtures/postgres";
let infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  db: Database,
  operator: BetaOperator,
  analysis: AnalysisService,
  serial = 0;
const nextId = () => String(882000000000000000n + BigInt(++serial));
beforeAll(async () => {
  vi.stubEnv("NEXUS_HOSTED_BETA", "on");
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
  operator = new BetaOperator(db, async (id) => ({
    name: "Synthetic server " + id,
    present: true,
    canObserve: true,
    checkedAt: Date.now(),
  }));
  analysis = new AnalysisService(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
  vi.unstubAllEnvs();
});
afterEach(async () => {
  for (const row of await operator.list())
    if (row.status === "ACTIVE") await change(row.guild_id, "pause");
});
async function change(
  guildId: string,
  action: BetaChange["action"],
  extra: Partial<BetaChange> = {},
) {
  const row = await betaInvitation(db, scopeForGuild(guildId));
  return operator.change({
    guildId,
    action,
    generation: row?.generation ?? null,
    requestId: randomUUID(),
    reason: "Synthetic local acceptance check",
    ...extra,
  });
}
async function invite(guildId = nextId()) {
  await change(guildId, "register");
  return change(guildId, "activate");
}
async function fixture() {
  const row = await invite();
  return analysisFixture(db, "FREE", true, scopeForGuild(row.guild_id));
}
async function waitForExclusive() {
  for (let n = 0; n < 40; n++) {
    if (
      (
        await sql`SELECT pid FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted`.execute(
          db,
        )
      ).rows.length
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("EXPECTED_CONCURRENT_FENCE");
}
const queue = (f: Awaited<ReturnType<typeof fixture>>, key = randomUUID()) =>
  analysis.request(
    f.s,
    f.actor,
    { type: "OVERALL", days: 30 },
    key,
    undefined,
    true,
  );
it("rejects unavailable, stale and future Bot proofs without registering or collecting a Guild", async () => {
  for (const proof of [
    { present: false, canObserve: true, checkedAt: Date.now() },
    { present: true, canObserve: false, checkedAt: Date.now() },
    { present: true, canObserve: true, checkedAt: Date.now() - 11000 },
    { present: true, canObserve: true, checkedAt: Date.now() + 60000 },
  ]) {
    const guildId = nextId(),
      ops = new BetaOperator(db, async () => ({
        name: "Synthetic proof",
        ...proof,
      }));
    await expect(
      ops.change({
        guildId,
        action: "register",
        generation: null,
        requestId: randomUUID(),
        reason: "Synthetic invalid Bot proof",
      }),
    ).rejects.toThrow("BETA_BOT_UNAVAILABLE");
    expect(await betaInvitation(db, scopeForGuild(guildId))).toBeNull();
  }
});
it("serializes simultaneous activation and resume and never admits an eleventh active Guild", async () => {
  const ids = Array.from({ length: 12 }, nextId);
  for (const id of ids) await change(id, "register");
  const activated = await Promise.allSettled(
    ids.map((id) => change(id, "activate")),
  );
  expect(activated.filter((r) => r.status === "fulfilled")).toHaveLength(10);
  expect(
    activated
      .filter((r) => r.status === "rejected")
      .every(
        (r) =>
          r.status === "rejected" && r.reason.message === "BETA_GUILD_LIMIT",
      ),
  ).toBe(true);
  const rows = await operator.list(),
    active = rows.filter((r) => r.status === "ACTIVE"),
    rejected = rows.filter(
      (r) => ids.includes(r.guild_id) && r.status === "REGISTERED",
    );
  expect(active).toHaveLength(10);
  expect(
    active.every(
      (r) =>
        r.activated_at &&
        r.expires_at &&
        Math.abs(
          r.expires_at.getTime() - r.activated_at.getTime() - 30 * 86400000,
        ) < 100,
    ),
  ).toBe(true);
  await change(active[0]!.guild_id, "pause");
  await change(rejected[0]!.guild_id, "activate");
  await expect(change(active[0]!.guild_id, "resume")).rejects.toThrow(
    "BETA_GUILD_LIMIT",
  );
  expect(
    (await operator.list()).filter((r) => r.status === "ACTIVE"),
  ).toHaveLength(10);
});
it("starts expiry at first activation, preserves it through pause/resume, rejects time expiry immediately, and requires a separate extension", async () => {
  const row = await invite(),
    s = scopeForGuild(row.guild_id),
    first = row.activated_at!.toISOString(),
    end = row.expires_at!.toISOString();
  await change(s.guildId, "pause");
  const resumed = await change(s.guildId, "resume");
  expect(resumed.activated_at!.toISOString()).toBe(first);
  expect(resumed.expires_at!.toISOString()).toBe(end);
  await sql`UPDATE beta_guild_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE ${tenant(s)}`.execute(
    db,
  );
  await expect(
    db.transaction().execute((tx) => betaAccess(tx, s)),
  ).rejects.toThrow("BETA_UNAVAILABLE");
  expect(
    await db.transaction().execute((tx) => betaAccess(tx, s, "read")),
  ).not.toBeNull();
  await expect(change(s.guildId, "resume")).rejects.toThrow("BETA_EXPIRED");
  const extended = await change(s.guildId, "extend", {
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  expect(extended.status).toBe("PAUSED");
  const again = await change(s.guildId, "resume");
  expect(again.activated_at!.toISOString()).toBe(first);
  expect(again.expires_at!.toISOString()).toBe(
    extended.expires_at!.toISOString(),
  );
  const old = again.generation,
    input = {
      guildId: s.guildId,
      action: "pause" as const,
      generation: old,
      requestId: randomUUID(),
      reason: "Synthetic idempotent pause",
    };
  const once = await operator.change(input),
    twice = await operator.change(input);
  expect(twice.generation).toBe(once.generation);
  await expect(
    operator.change({ ...input, requestId: randomUUID() }),
  ).rejects.toThrow("REVISION_CONFLICT");
  await expect(
    operator.change({ ...input, reason: "Changed reason" }),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  const audit = (
    await sql`SELECT id FROM operator_audit WHERE request_id=${input.requestId}::uuid`.execute(
      db,
    )
  ).rows;
  expect(audit).toHaveLength(1);
});
it("refuses uninvited and registered events before DB/stream writes, keeps durable inbox on Redis failure, and rejects old generations after resuming", async () => {
  const xadd = vi.fn(async () => "synthetic-stream-id"),
    publisher = new GatewayPublisher(
      { xadd } as unknown as Redis,
      db,
      analysisVault,
    ),
    s = scopeForGuild(nextId());
  const event: Envelope = {
    ...s,
    kind: "telemetry.heartbeat",
    context: "PRODUCTION",
    shardId: 0,
    gatewaySessionId: randomUUID(),
    sequence: 1,
    at: new Date().toISOString(),
  };
  await publisher.publish(event);
  expect(
    (await sql`SELECT guild_id FROM guilds WHERE ${tenant(s)}`.execute(db))
      .rows,
  ).toHaveLength(0);
  expect(xadd).not.toHaveBeenCalled();
  await change(s.guildId, "register");
  await publisher.publish(event);
  expect(
    (await sql`SELECT * FROM gateway_ingest WHERE ${tenant(s)}`.execute(db))
      .rows,
  ).toHaveLength(0);
  expect(xadd).not.toHaveBeenCalled();
  await change(s.guildId, "activate");
  xadd.mockRejectedValueOnce(new Error("synthetic-stream-down"));
  await expect(publisher.publish(event)).rejects.toThrow(
    "Gateway stream unavailable",
  );
  const persisted = (
    await sql<{
      payload: Envelope;
      published_at: Date | null;
    }>`SELECT payload,published_at FROM gateway_ingest WHERE ${tenant(s)}`.execute(
      db,
    )
  ).rows[0]!;
  expect(persisted.payload.betaGeneration).toBe(1);
  expect(persisted.published_at).toBeNull();
  await change(s.guildId, "pause");
  await change(s.guildId, "resume");
  xadd.mockClear();
  await publisher.recover();
  expect(xadd).not.toHaveBeenCalled();
  const f = await analysisFixture(db, "FREE", true, s),
    lifecycle = new LifecycleService(db, analysisVault, f.settings, f.discord);
  await lifecycle.process(persisted.payload);
  expect(
    (await sql`SELECT * FROM event_inbox WHERE ${tenant(s)}`.execute(db)).rows,
  ).toHaveLength(0);
  await publisher.publish({ ...event, sequence: 2 });
  expect(xadd).toHaveBeenCalledTimes(1);
  await expect(
    new GatewayPublisher({ xadd } as unknown as Redis).publish(event),
  ).rejects.toThrow("BETA_STATE_REQUIRED");
  expect(() => createApi({} as AnalyticsService, "synthetic-api-key")).toThrow(
    "BETA_STATE_REQUIRED",
  );
  const api = createApi({} as AnalyticsService, "synthetic-api-key", db);
  expect((await api.inject("/operator/session")).statusCode).toBe(404);
  await api.close();
});
it("uses existing reservations/ledger for daily, Guild waiting and global running limits, and releases cancellation only once", async () => {
  const f = await fixture(),
    other = await fixture();
  const [one, two] = await Promise.all([queue(f), queue(f)]);
  expect(
    (
      await analysis.request(
        f.s,
        f.actor,
        { type: "OVERALL", days: 30 },
        one.run.request_key,
        undefined,
        true,
      )
    ).reused,
  ).toBe(true);
  await expect(queue(f)).rejects.toThrow("ANALYSIS_BUSY");
  const first = await analysis.claim(one.run.id);
  expect(first).not.toBeNull();
  const competing = await queue(other);
  expect(await analysis.claim(competing.run.id)).toBeNull();
  const three = await queue(f);
  await analysis.execute(first!);
  expect((await analysis.result(f.s, f.actor, one.run.id)).run.status).toBe(
    "COMPLETED",
  );
  const second = await analysis.claim(two.run.id);
  expect(second).not.toBeNull();
  await expect(queue(f)).rejects.toThrow("BETA_USAGE_LIMIT");
  await change(f.s.guildId, "pause");
  await db
    .transaction()
    .execute((tx) => requestBetaDeletion(tx, f.s, "DELETE_REQUEST"));
  expect(await analysis.claim(two.run.id)).toBeNull();
  expect(await analysis.claim(three.run.id)).toBeNull();
  const reservations = (
    await sql<{
      state: string;
    }>`SELECT state FROM analysis_reservations WHERE ${tenant(f.s)} ORDER BY state`.execute(
      db,
    )
  ).rows.map((r) => r.state);
  expect(reservations).toEqual(["CONSUMED", "RELEASED", "RELEASED"]);
  const ledger = (
    await sql<{
      outcome: string;
    }>`SELECT outcome FROM analysis_usage_ledger WHERE ${tenant(f.s)} ORDER BY outcome`.execute(
      db,
    )
  ).rows.map((r) => r.outcome);
  expect(ledger).toEqual(["CONSUMED", "RELEASED", "RELEASED"]);
  expect(
    (
      await sql<{
        reserved: number;
        consumed: number;
      }>`SELECT reserved,consumed FROM analysis_grants WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows[0],
  ).toMatchObject({ reserved: 0, consumed: 1 });
});
it("enforces a lowered monthly limit despite a larger immutable existing grant and applies the strictest global waiting ceiling", async () => {
  const f = await fixture();
  const run = (await queue(f)).run,
    claim = await analysis.claim(run.id);
  await analysis.execute(claim!);
  await change(f.s.guildId, "limits", {
    limits: { monthly: 1, daily: 3, guildPending: 2, globalPending: 1 },
  });
  await expect(queue(f)).rejects.toThrow("BETA_USAGE_LIMIT");
  const b = await fixture(),
    c = await fixture();
  await queue(b);
  await expect(queue(c)).rejects.toThrow("ANALYSIS_BUSY");
  await expect(
    change(f.s.guildId, "limits", {
      limits: { monthly: 21, daily: 3, guildPending: 2, globalPending: 10 },
    }),
  ).rejects.toThrow();
});
it("lets pause win between calculation and publication, discards the result, and releases its reservation once", async () => {
  const f = await fixture(),
    run = (await queue(f)).run,
    claim = await analysis.claim(run.id);
  let pause!: ReturnType<typeof change>;
  await analysis.execute(claim!, undefined, async (...args) => {
    const result = await analysisMetrics(...args);
    pause = change(f.s.guildId, "pause");
    await waitForExclusive();
    return result;
  });
  await pause;
  expect(
    (
      await sql`SELECT run_id FROM analysis_results WHERE run_id=${run.id}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await sql<{
        status: string;
      }>`SELECT status FROM analysis_runs WHERE id=${run.id}::uuid`.execute(db)
    ).rows[0]!.status,
  ).toBe("CANCELED");
  expect(
    (
      await sql<{
        outcome: string;
      }>`SELECT outcome FROM analysis_usage_ledger WHERE run_id=${run.id}::uuid`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ outcome: "RELEASED" }]);
});
it("does not deadlock nested guarded service writes while pause or deletion waits for a bounded worker", async () => {
  for (const deleting of [false, true]) {
    const f = await fixture(),
      privacy = new PrivacyService(db, analysisVault, new SettingsService(db));
    let started!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve)),
      hold = new Promise<void>((resolve) => (release = resolve));
    const work = betaWork(db, f.s, async () => {
      started();
      await hold;
      return db.transaction().execute(async (tx) => {
        await sql`SET LOCAL lock_timeout='1s'`.execute(tx);
        await privacyReadLock(tx, f.s);
        await betaAccess(tx, f.s);
        return true;
      });
    });
    await ready;
    const stop = deleting
      ? privacy.delete(f.s, f.user, f.actor, true)
      : change(f.s.guildId, "pause");
    await waitForExclusive();
    release();
    const result = await Promise.allSettled([work, stop]);
    if (result[0]!.status === "rejected") throw result[0]!.reason;
    expect(result[0]).toMatchObject({ status: "fulfilled", value: true });
    expect(result[1]!.status).toBe("fulfilled");
  }
});
it("fences bounded worker effects before stop acknowledgement and rejects subsequent work while preserving authorized history", async () => {
  const f = await fixture(),
    run = (await queue(f)).run;
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => (started = resolve)),
    hold = new Promise<void>((resolve) => (release = resolve)),
    effect = vi.fn();
  const work = betaWork(db, f.s, async () => {
    started();
    await hold;
    effect();
  });
  await ready;
  const pause = change(f.s.guildId, "pause");
  await waitForExclusive();
  expect(effect).not.toHaveBeenCalled();
  release();
  await work;
  await pause;
  await expect(betaWork(db, f.s, async () => effect())).rejects.toThrow(
    "BETA_UNAVAILABLE",
  );
  expect(effect).toHaveBeenCalledTimes(1);
  expect(
    (await analysis.history(f.s, f.actor)).some((row) => row.id === run.id),
  ).toBe(true);
  const cfg = await f.settings.get(f.s);
  await expect(
    f.settings.update(f.s, f.actor, cfg.revision, { uiLanguage: "en" }),
  ).rejects.toThrow("BETA_UNAVAILABLE");
  await expect(
    analysis.history(f.s, { ...f.actor, permissions: "0" }),
  ).rejects.toThrow("ADMIN_REQUIRED");
});
it("keeps current authority and tenant deletion boundaries, unlinks a paused Guild promptly, and retries stream scrub independently of admission", async () => {
  const f = await fixture(),
    other = await fixture(),
    settings = new SettingsService(db),
    scrub = vi.fn(async (_scope: typeof f.s, _hash: string | null) => {}),
    privacy = new PrivacyService(db, analysisVault, settings, scrub);
  await change(f.s.guildId, "pause");
  await expect(
    privacy.delete(f.s, f.user, { ...f.actor, permissions: "0" }, true),
  ).rejects.toThrow("ADMIN_REQUIRED");
  await expect(privacy.delete(other.s, f.user, f.actor, true)).rejects.toThrow(
    "ACTOR_MISMATCH",
  );
  const version = randomUUID();
  await sql`INSERT INTO server_web_links(organization_id,guild_id,verified_at,updated_at,revision) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},now(),now(),${version}::uuid)`.execute(
    db,
  );
  const authority = new ServerAuthorization(f.discord, settings, analysisVault),
    verification = new ServerVerification(db, analysisVault, authority);
  f.discord.members.get(f.user)!.permissions = "0";
  await expect(verification.disconnect(f.s, f.user, version)).rejects.toThrow(
    "ADMIN_REQUIRED",
  );
  expect((await betaInvitation(db, f.s))!.status).toBe("PAUSED");
  f.discord.members.get(f.user)!.permissions = "8";
  await verification.disconnect(f.s, f.user, version);
  expect((await betaInvitation(db, f.s))!.status).toBe("DELETING");
  let failed = false;
  scrub.mockImplementation(async (scope) => {
    if (scope.guildId === f.s.guildId && !failed) {
      failed = true;
      throw new Error("synthetic-scrub-down");
    }
  });
  const lifecycle = new BetaLifecycle(db, privacy);
  await lifecycle.tick();
  expect((await betaInvitation(db, f.s))!.status).toBe("DELETED");
  const job = (
    await sql<{
      id: string;
      state: string;
      attempts: number;
    }>`SELECT * FROM beta_deletion_jobs WHERE ${tenant(f.s)}`.execute(db)
  ).rows[0]!;
  expect(job.state).toBe("ERASED");
  expect(job.attempts).toBe(1);
  await sql`UPDATE beta_deletion_jobs SET attempts=5,available_at=now()+interval '1 hour' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await change(f.s.guildId, "retryDeletion");
  await lifecycle.tick();
  expect(
    (
      await sql<{
        state: string;
      }>`SELECT state FROM beta_deletion_jobs WHERE ${tenant(f.s)}`.execute(db)
    ).rows[0]!.state,
  ).toBe("DONE");
  expect(
    (await sql`SELECT id FROM analysis_runs WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toHaveLength(0);
  expect(
    (
      await sql`SELECT id FROM member_identity_map WHERE ${tenant(other.s)}`.execute(
        db,
      )
    ).rows.length,
  ).toBeGreaterThan(0);
  await expect(change(f.s.guildId, "resume")).rejects.toThrow(
    "PRIVACY_DELETED",
  );
  expect(
    scrub.mock.calls.filter((call) => call[0].guildId === f.s.guildId),
  ).toHaveLength(2);
});
it("reapplies encrypted Guild/member tombstones to restored sources, revokes restored sessions, and refuses missing identity evidence", async () => {
  const f = await fixture(),
    other = await fixture(),
    privacy = new PrivacyService(db, analysisVault, new SettingsService(db)),
    sessions = new PublicSessions(
      db,
      "synthetic-session-key-for-restore-tests",
      async () => {
        throw new Error("not-used");
      },
    );
  const session = await sessions.create(
      "833333333333333333",
      { accessToken: "synthetic-restored-token" },
      3600,
    ),
    scope = { organizationId: f.s.organizationId, guildId: f.s.guildId };
  const snapshot = { version: 1 as const, guilds: [scope], members: [] },
    key = "synthetic-backup-key-for-test-only-123456";
  const encrypted = sealDeletionTombstones(snapshot, key);
  expect(encrypted).not.toContain(scope.guildId);
  expect(() =>
    openDeletionTombstones(encrypted, "wrong-key-with-more-than-32-characters"),
  ).toThrow();
  await applyDeletionTombstones(
    db,
    analysisVault,
    privacy,
    openDeletionTombstones(encrypted, key),
  );
  expect(await sessions.read(session)).toBeNull();
  await expect(
    db.transaction().execute((tx) => betaAccess(tx, f.s)),
  ).rejects.toThrow("BETA_UNAVAILABLE");
  await expect(change(f.s.guildId, "register")).rejects.toThrow(
    "PRIVACY_DELETED",
  );
  const userId = other.user,
    hash = analysisVault.hash(other.s, userId);
  await applyDeletionTombstones(db, analysisVault, privacy, {
    version: 1,
    guilds: [],
    members: [{ ...other.s, lookupHash: hash }],
  });
  expect(
    (
      await sql`SELECT id FROM member_identity_map WHERE ${tenant(other.s)} AND lookup_hash=${hash}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect((await betaInvitation(db, other.s))!.status).toBe("ACTIVE");
  await expect(
    applyDeletionTombstones(db, analysisVault, privacy, {
      version: 1,
      guilds: [],
      members: [{ ...other.s, lookupHash: "00".repeat(32) }],
    }),
  ).rejects.toThrow("TOMBSTONE_IDENTITY_UNAVAILABLE");
  expect(
    (await captureDeletionTombstones(db)).guilds.some(
      (row) => row.guildId === f.s.guildId,
    ),
  ).toBe(true);
});
