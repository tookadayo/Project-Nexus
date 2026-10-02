import { it, expect, beforeAll, afterAll } from "vitest";
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
import {
  DiscoveryWorker,
  requestCapabilityRefresh,
} from "../../packages/lifecycle/src/discovery";
import { IdentityVault } from "../../packages/identity/src/index";
import { representativeSource } from "../fixtures/community-profiles";
import { enqueue } from "../../packages/discord/src/outbox";
import { ActionWorker } from "../../apps/worker/src/actions";
import { OnboardingService } from "../../packages/onboarding/src/index";
import { SettingsService } from "../../packages/settings/src/index";
import { DiscordFailure } from "../../packages/discord/src/rest";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32));
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function scope() {
  const s = { organizationId: randomUUID(), guildId: "111111111111111199" };
  await ensureGuild(db, s);
  return s;
}
it("coalesces refresh requests during a lease without losing the manual request", async () => {
  const s = await scope(),
    discord = new FakeDiscord();
  let calls = 0;
  discord.capabilityState = async () => {
    calls++;
    await requestCapabilityRefresh(db, s, "manual");
    return representativeSource(0);
  };
  await requestCapabilityRefresh(db, s, "install");
  const worker = new DiscoveryWorker(db, discord, vault);
  expect(await worker.tick()).toBe(true);
  const job = (
    await sql<{
      reason: string;
      priority: number;
      lease_token: string | null;
    }>`SELECT * FROM capability_refresh_jobs WHERE ${tenant(s)}`.execute(db)
  ).rows[0]!;
  expect(job.reason).toBe("manual");
  expect(job.priority).toBe(100);
  expect(job.lease_token).toBeNull();
  expect(calls).toBe(1);
  await sql`DELETE FROM capability_refresh_jobs WHERE ${tenant(s)}`.execute(db);
});
it("claims one refresh once under concurrent workers", async () => {
  const s = await scope(),
    discord = new FakeDiscord();
  let calls = 0;
  discord.capabilityState = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    return representativeSource(0);
  };
  await requestCapabilityRefresh(db, s, "manual");
  const worker = new DiscoveryWorker(db, discord, vault);
  expect(
    (await Promise.all([worker.tick(), worker.tick(), worker.tick()])).filter(
      Boolean,
    ),
  ).toHaveLength(1);
  expect(calls).toBe(1);
});
it("does not retain a database privacy lock during a slow Discord write or restore deleted panel routing", async () => {
  const s = await scope(),
    discord = new FakeDiscord(),
    settings = new SettingsService(db);
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    pending = new Promise<void>((r) => (release = r));
  discord.sendPanel = async () => {
    entered();
    await pending;
    return "444444444444444444";
  };
  await enqueue(db, s, "slow-panel", "PANEL_UPSERT", {
    channelId: "333333333333333333",
    body: { components: [] },
  });
  const worker = new ActionWorker(
      db,
      vault,
      discord,
      new OnboardingService(db, settings, vault),
    ),
    running = worker.tick(s);
  await started;
  const free = await db.transaction().execute(
    async (tx) =>
      (
        await sql<{
          locked: boolean;
        }>`SELECT pg_try_advisory_xact_lock(hashtextextended(${"privacy:" + s.organizationId + ":" + s.guildId},0)) AS locked`.execute(
          tx,
        )
      ).rows[0]!.locked,
  );
  expect(free).toBe(true);
  await sql`DELETE FROM action_outbox WHERE ${tenant(s)}`.execute(db);
  release();
  await running;
  expect(
    (await sql`SELECT * FROM settings_panels WHERE ${tenant(s)}`.execute(db))
      .rows,
  ).toEqual([]);
  expect(discord.calls).toContain("deletePanel");
});
it("does not automatically retry a panel create with an unknown outcome", async () => {
  const s = await scope(),
    discord = new FakeDiscord(),
    settings = new SettingsService(db);
  discord.sendPanel = async () => {
    throw new DiscordFailure(0, 0, { kind: "timeout" });
  };
  await enqueue(db, s, "create-unknown", "PANEL_UPSERT", {
    channelId: "333333333333333333",
    body: { components: [] },
  });
  const worker = new ActionWorker(
    db,
    vault,
    discord,
    new OnboardingService(db, settings, vault),
  );
  await worker.tick(s);
  expect(
    (
      await sql<{
        state: string;
      }>`SELECT state FROM action_outbox WHERE ${tenant(s)}`.execute(db)
    ).rows[0]?.state,
  ).toBe("UNKNOWN");
  expect(await worker.tick(s)).toBe(false);
});
