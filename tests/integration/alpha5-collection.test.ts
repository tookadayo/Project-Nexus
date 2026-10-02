import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import { FakeDiscord } from "../fixtures/discord";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { SettingsService } from "../../packages/settings/src/index";
import { LifecycleService } from "../../packages/lifecycle/src/index";
import {
  integrationHealth,
  collectionEpochs,
} from "../../packages/lifecycle/src/observation";
import {
  evidenceContext,
  buildMetricEvidence,
} from "../../packages/analytics/src/evidence";
import { observationIntents } from "../../packages/shared/src/integration-health";
import type { Envelope } from "../../packages/events/src/index";
import type { Scope } from "../../packages/shared/src/index";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32)),
  at = new Date("2026-10-02T00:00:00Z");
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function fixture(
  s: Scope = { organizationId: randomUUID(), guildId: "111111111111111188" },
) {
  await ensureGuild(db, s);
  const settings = new SettingsService(db);
  return {
    s,
    settings,
    service: new LifecycleService(db, vault, settings, new FakeDiscord()),
  };
}
function event(
  s: Scope,
  sequence: number,
  kind: Envelope["kind"],
  offset = 0,
  fields: Partial<Envelope> = {},
): Envelope {
  return {
    ...s,
    sequence,
    kind,
    shardId: 0,
    gatewaySessionId: "collection",
    context: "PRODUCTION",
    at: new Date(at.getTime() + offset).toISOString(),
    requestedIntents: [...observationIntents],
    ...fields,
  };
}
it("scopes epochs and intent state independently for two organizations sharing a guild ID", async () => {
  const a = await fixture(),
    b = await fixture();
  await a.service.process(event(a.s, 1, "telemetry.connected"));
  await b.service.process(
    event(b.s, 1, "telemetry.connected", 0, { requestedIntents: ["voice"] }),
  );
  expect((await integrationHealth(db, a.s, at)).intents.members).toBe(
    "AVAILABLE",
  );
  expect((await integrationHealth(db, b.s, at)).intents.members).toBe(
    "UNAVAILABLE",
  );
  expect(
    (
      await sql`SELECT id FROM collection_epochs WHERE ${tenant(a.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await sql`SELECT id FROM collection_epochs WHERE ${tenant(b.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("attributes facts to epochs and keeps replay idempotent, including dispatch ordinals", async () => {
  const f = await fixture();
  const e = event(f.s, 1, "telemetry.connected");
  await f.service.process(e);
  await f.service.process(e);
  const member = event(f.s, 2, "member.joined", 1, {
    joinedAt: new Date(at.getTime() + 1).toISOString(),
    encryptedUserId: vault.seal(f.s, "222222222222222222"),
    pending: false,
    memberFlags: 0,
    ordinal: 1,
  });
  await f.service.process(member);
  await f.service.process(member);
  await f.service.process({ ...member, ordinal: 2 });
  expect(
    (
      await sql`SELECT id FROM collection_epochs WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  const facts = (
    await sql<{
      collection_epoch_id: string | null;
      definition_version: string;
    }>`SELECT collection_epoch_id,definition_version FROM lifecycle_events WHERE ${tenant(f.s)} AND kind='member.joined'`.execute(
      db,
    )
  ).rows;
  expect(facts).toHaveLength(1);
  expect(facts[0]!.collection_epoch_id).toBeTruthy();
  expect(facts[0]!.definition_version).toBe("observation-v3");
  expect(
    (
      await sql`SELECT dedupe_key FROM event_inbox WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(3);
});
it("propagates disconnect, resume and historical gaps without accepting an old disconnect as current health", async () => {
  const f = await fixture();
  await f.service.process(event(f.s, 1, "telemetry.connected"));
  await f.service.process(event(f.s, 2, "telemetry.disconnected", 60000));
  await f.service.process(
    event(f.s, 3, "telemetry.connected", 120000, {
      healthReason: "GATEWAY_RESUMED",
    }),
  );
  await f.service.process(event(f.s, 4, "telemetry.disconnected", 30000));
  expect(
    (await integrationHealth(db, f.s, new Date(at.getTime() + 120000))).gateway,
  ).toBe("CONNECTED");
  const epochs = await collectionEpochs(
    db,
    f.s,
    at,
    new Date(at.getTime() + 180000),
  );
  expect(epochs).toHaveLength(2);
  expect(epochs[1]!.startReason).toBe("GATEWAY_RESUMED");
  const context = await evidenceContext(
    db,
    f.s,
    at,
    new Date(at.getTime() + 120001),
  );
  const m = buildMetricEvidence(
    "new_members",
    {
      value: 0,
      numerator: 0,
      denominator: null,
      sample: 0,
      minimumSample: 0,
      definition: "Observed joins",
    },
    null,
    await f.settings.get(f.s),
    context,
  );
  expect(m.value).toBe(0);
  expect(m.comparable).toBe(false);
  expect(m.comparisonBlockers).toContain("COLLECTION_GAP");
});
it("does not fabricate intent availability from heartbeat without an accepted Identify configuration", async () => {
  const f = await fixture();
  await f.service.process(
    event(f.s, 1, "telemetry.heartbeat", 0, { requestedIntents: undefined }),
  );
  expect((await integrationHealth(db, f.s, at)).intents.members).toBe(
    "UNKNOWN",
  );
  await f.service.process(
    event(f.s, 2, "telemetry.disconnected", 1, {
      healthReason: "INTENT_UNAVAILABLE",
      requestedIntents: ["messages", "voice"],
    }),
  );
  const c = await evidenceContext(db, f.s, at, new Date(at.getTime() + 2));
  const m = buildMetricEvidence(
    "new_members",
    {
      value: 0,
      numerator: 0,
      denominator: 0,
      sample: 0,
      definition: "Observed joins",
    },
    null,
    await f.settings.get(f.s),
    c,
  );
  expect(m.value).toBeNull();
  expect(m.observationState).toBe("UNKNOWN");
  expect(c.health.intents.members).toBe("UNAVAILABLE");
});
it("restores obfuscated channel visibility only from a newer full payload", async () => {
  const f = await fixture(),
    id = "333333333333333333";
  await f.service.process(
    event(f.s, 1, "channel.changed", 0, {
      channelId: id,
      channelType: 0,
      channelObfuscated: false,
    }),
  );
  await f.service.process(
    event(f.s, 2, "channel.changed", 1000, {
      channelId: id,
      channelType: 0,
      channelObfuscated: true,
    }),
  );
  await f.service.process(
    event(f.s, 3, "channel.changed", 500, {
      channelId: id,
      channelType: 0,
      channelObfuscated: false,
    }),
  );
  expect(
    (
      await sql<{
        visibility_state: string;
      }>`SELECT visibility_state FROM discord_surface_state WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows[0]!.visibility_state,
  ).toBe("OBFUSCATED");
  await f.service.process(
    event(f.s, 4, "channel.changed", 2000, {
      channelId: id,
      channelType: 0,
      channelObfuscated: false,
    }),
  );
  expect(
    (
      await sql<{
        visibility_state: string;
      }>`SELECT visibility_state FROM discord_surface_state WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows[0]!.visibility_state,
  ).toBe("VISIBLE");
});
