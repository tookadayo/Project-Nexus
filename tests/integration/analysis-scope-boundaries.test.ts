import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  connect,
  migrate,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import {
  AnalysisService,
  analysisUsage,
} from "../../packages/analysis/src/index";
import { analysisFixture } from "../fixtures/analysis";
import { infrastructure } from "../fixtures/infrastructure";

let infra: Awaited<ReturnType<typeof infrastructure>>,
  db: Database,
  service: AnalysisService,
  serial = 0;
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
  service = new AnalysisService(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function fixture(plan = "GROWTH") {
  return analysisFixture(db, plan, true, {
    organizationId: randomUUID(),
    guildId: String(823000000000000000n + BigInt(++serial)),
  });
}
async function queue(f: Awaited<ReturnType<typeof fixture>>) {
  return service.request(
    f.s,
    f.actor,
    { type: "OVERALL", days: 30 },
    randomUUID(),
    undefined,
    true,
  );
}
async function group(root: Awaited<ReturnType<typeof fixture>>) {
  await sql`INSERT INTO operations_organizations VALUES(${root.s.organizationId}::uuid,'Boundary fixture',${root.s.guildId})`.execute(
    db,
  );
}
async function link(
  root: Awaited<ReturnType<typeof fixture>>,
  child: Awaited<ReturnType<typeof fixture>>,
) {
  await sql`INSERT INTO operations_org_guilds(root_organization_id,organization_id,guild_id) VALUES(${root.s.organizationId}::uuid,${child.s.organizationId}::uuid,${child.s.guildId})`.execute(
    db,
  );
}
it.each(["SUPPORT", "BUG_REPORT"] as const)(
  "allows detailed SUPPORT for confirmed %s places without a global server mode",
  async (purpose) => {
    const f = await fixture(),
      cfg = await f.settings.get(f.s);
    await f.settings.update(f.s, f.actor, cfg.revision, {
      communityModel: {
        ...cfg.communityModel,
        modes: [],
        confirmed: true,
        channels: [{ channelId: f.channel, purpose }],
      },
    });
    const preview = await service.preview(f.s, f.actor, {
      type: "SUPPORT",
      days: 30,
    });
    expect(["AVAILABLE", "PARTIAL"]).toContain(preview.availability);
    expect(
      preview.metrics.find((m) => m.key === "observed_posts")?.evidence.value,
    ).toBe(7);
    const accepted = await service.request(
      f.s,
      f.actor,
      preview.request,
      randomUUID(),
      {
        revision: preview.configRevision,
        fingerprint: preview.inputFingerprint,
      },
    );
    expect(accepted.run.status).toBe("QUEUED");
    expect(accepted.run.analysis_type).toBe("SUPPORT");
  },
);
it("keeps the five-guild pending limit when already queued work is linked to an organization", async () => {
  const root = await fixture("SCALE"),
    f = await fixture();
  for (let index = 0; index < 5; index++) await queue(f);
  await group(root);
  await link(root, f);
  const before = await analysisUsage(db, f.s);
  await expect(queue(f)).rejects.toThrow("ANALYSIS_BUSY");
  expect(
    (
      await sql<{
        n: number;
      }>`SELECT count(*)::int AS n FROM analysis_runs WHERE ${tenant(f.s)} AND status='QUEUED'`.execute(
        db,
      )
    ).rows[0]!.n,
  ).toBe(5);
  expect(await analysisUsage(db, f.s)).toEqual(before);
});
it("counts all 25 queued runs under their current organization before admitting another guild", async () => {
  const root = await fixture("SCALE"),
    children = [];
  for (let index = 0; index < 5; index++) {
    const f = await fixture();
    children.push(f);
    for (let run = 0; run < 5; run++) await queue(f);
  }
  await group(root);
  for (const f of children) await link(root, f);
  const next = await fixture();
  await link(root, next);
  const before = await analysisUsage(db, next.s);
  await expect(queue(next)).rejects.toThrow("ANALYSIS_BUSY");
  expect(
    (
      await sql<{
        n: number;
      }>`SELECT count(*)::int AS n FROM analysis_runs WHERE ${tenant(next.s)}`.execute(
        db,
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(await analysisUsage(db, next.s)).toEqual(before);
});
