import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  connect,
  migrate,
  sql,
  tenant,
  json,
  type Database,
} from "../../packages/db/src/index";
import {
  AnalysisService,
  type AnalysisResult,
  type AnalysisRun,
} from "../../packages/analysis/src/index";
import { Components } from "../../packages/security/src/index";
import { analysisInteraction } from "../../apps/worker/src/analysis-interactions";
import { validatePanel } from "../../packages/discord-panels/src/primitives";
import { analysisFixture } from "../fixtures/analysis";
import { infrastructure } from "../fixtures/infrastructure";
let infra: Awaited<ReturnType<typeof infrastructure>>,
  db: Database,
  service: AnalysisService;
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
async function complete() {
  const f = await analysisFixture(db, "STARTER");
  const { run } = await service.request(
    f.s,
    f.actor,
    { type: "OVERALL", days: 30 },
    randomUUID(),
  );
  const claimed = await service.claim(run.id);
  expect(claimed).not.toBeNull();
  await service.execute(claimed!);
  const data = await service.result(f.s, f.actor, run.id);
  expect(data.run.status).toBe("COMPLETED");
  return { f, run: data.run, result: data.result! };
}
async function historical(
  run: AnalysisRun,
  result: AnalysisResult,
  end: Date,
  adjust?: (copy: AnalysisResult) => void,
) {
  const id = randomUUID(),
    start = new Date(end.getTime() - run.period_days * 86400000);
  const copy = structuredClone(result);
  for (const metric of copy.metrics) {
    metric.evidence.windowStart = start.toISOString();
    metric.evidence.windowEnd = end.toISOString();
  }
  adjust?.(copy);
  await sql`INSERT INTO analysis_runs(id,organization_id,guild_id,scheduler_organization_id,analysis_type,status,request_key,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,completed_at,target_channel_ids)
    SELECT ${id}::uuid,organization_id,guild_id,scheduler_organization_id,analysis_type,'COMPLETED',${"past:" + id},${start},${end},period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,now(),target_channel_ids FROM analysis_runs WHERE id=${run.id}::uuid`.execute(
    db,
  );
  await sql`INSERT INTO analysis_results(run_id,organization_id,guild_id,result) VALUES(${id}::uuid,${run.organization_id}::uuid,${run.guild_id},${json(copy)})`.execute(
    db,
  );
  return { id, copy };
}
it("reuses one Attention row and event history, supports withdrawal, and keeps the saved result and usage unchanged", async () => {
  const { f, run, result } = await complete(),
    key = `analysis:${run.id}:waiting_response`;
  const before =
    await sql`SELECT outcome,grant_id FROM analysis_usage_ledger WHERE run_id=${run.id}::uuid`.execute(
      db,
    );
  await Promise.all([
    service.attention(f.s, f.actor, run.id, "waiting_response"),
    service.attention(f.s, f.actor, run.id, "waiting_response"),
  ]);
  expect((await service.result(f.s, f.actor, run.id)).reviews).toEqual([
    { message_id: key, status: "OPEN" },
  ]);
  expect(
    (
      await sql`SELECT id FROM operations_audit_events WHERE ${tenant(f.s)} AND action='ANALYSIS_ATTENTION_ADDED' AND target=${key}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  const item = await service.attentionItem(f.s, f.actor, key);
  expect(item.events.map((event) => event.state)).toEqual(["OPEN"]);
  const operator = { ...f.actor, key: "second-operator" };
  await service.attentionUpdate(
    f.s,
    operator,
    key,
    item.version,
    "ACKNOWLEDGED",
  );
  await expect(
    service.attentionUpdate(f.s, f.actor, key, item.version, "DISMISSED"),
  ).rejects.toThrow("REVISION_CONFLICT");
  await service.attentionUpdate(
    f.s,
    operator,
    key,
    item.version + 1,
    "DISMISSED",
  );
  const withdrawn = await service.attentionItem(f.s, f.actor, key);
  expect(withdrawn.status).toBe("DISMISSED");
  expect(withdrawn.events.map((event) => event.state)).toEqual([
    "DISMISSED",
    "ACKNOWLEDGED",
    "OPEN",
  ]);
  expect(
    (
      await sql<{
        actor_hash: string;
      }>`SELECT actor_hash FROM attention_events WHERE ${tenant(f.s)} AND attention_key=${key} AND version=${withdrawn.version}`.execute(
        db,
      )
    ).rows[0]?.actor_hash,
  ).toBe(operator.key);
  expect(await service.attentionList(f.s, f.actor)).toEqual([]);
  expect(await service.attentionList(f.s, f.actor, 0, "all")).toHaveLength(1);
  await expect(
    service.attentionUpdate(f.s, f.actor, key, withdrawn.version, "RESOLVED"),
  ).rejects.toThrow("ATTENTION_NOT_ACTIVE");
  expect((await service.result(f.s, f.actor, run.id)).result).toEqual(result);
  expect(
    (
      await sql`SELECT outcome,grant_id FROM analysis_usage_ledger WHERE run_id=${run.id}::uuid`.execute(
        db,
      )
    ).rows,
  ).toEqual(before.rows);
});
it("preserves read/operate, organization/guild, expiration and signed-component boundaries across the added entry points", async () => {
  const { f, run } = await complete(),
    key = await service.attention(f.s, f.actor, run.id, "waiting_response");
  const outsider = {
    ...f.actor,
    key: "ordinary-member",
    permissions: "0",
    roles: [],
  };
  await expect(service.result(f.s, outsider, run.id)).rejects.toThrow(
    "ADMIN_REQUIRED",
  );
  await expect(service.compare(f.s, outsider, run.id)).rejects.toThrow(
    "ADMIN_REQUIRED",
  );
  await expect(service.attentionList(f.s, outsider, 0, "all")).rejects.toThrow(
    "ADMIN_REQUIRED",
  );
  await expect(
    service.attentionUpdate(f.s, outsider, key, 0, "DISMISSED"),
  ).rejects.toThrow("ADMIN_REQUIRED");
  const cfg = await f.settings.get(f.s),
    role = "888888888888888888";
  await f.settings.update(f.s, f.actor, cfg.revision, { staffRoleIds: [role] });
  const reader = { ...outsider, key: "read-only-member", roles: [role] };
  expect((await service.result(f.s, reader, run.id)).canOperate).toBe(false);
  expect((await service.attentionItem(f.s, reader, key)).canOperate).toBe(
    false,
  );
  await expect(
    service.attention(f.s, reader, run.id, "waiting_response"),
  ).rejects.toThrow("ADMIN_REQUIRED");
  await expect(
    service.attentionUpdate(f.s, reader, key, 0, "RESOLVED"),
  ).rejects.toThrow("ADMIN_REQUIRED");
  const other = await analysisFixture(db);
  await expect(service.result(other.s, other.actor, run.id)).rejects.toThrow(
    "ANALYSIS_NOT_FOUND",
  );
  await expect(
    service.attentionItem(other.s, other.actor, key),
  ).rejects.toThrow("ANALYSIS_NOT_FOUND");
  const tokens = new Components("alpha11-test-key");
  const token = await tokens.issue(
    db,
    f.s,
    { action: "analysisAttentionUpdate", key, version: 0, status: "DISMISSED" },
    f.actor.key,
    -1,
  );
  await expect(tokens.read(db, f.s, token, f.actor.key)).rejects.toThrow(
    "COMPONENT_EXPIRED",
  );
  await sql`UPDATE analysis_runs SET retention_until=now()-interval '1 second' WHERE id=${run.id}::uuid`.execute(
    db,
  );
  await expect(service.result(f.s, f.actor, run.id)).rejects.toThrow(
    "ANALYSIS_NOT_FOUND",
  );
  await expect(
    service.attentionUpdate(f.s, f.actor, key, 0, "DISMISSED"),
  ).rejects.toThrow("ANALYSIS_NOT_FOUND");
  expect(await service.attentionList(f.s, f.actor, 0, "all")).toEqual([]);
});
it("finds an earlier compatible period across different dates and skips a more recent result with incompatible evidence windows", async () => {
  const { f, run, result } = await complete();
  const good = await historical(
    run,
    result,
    new Date(run.period_start.getTime() - 5 * 86400000),
  );
  const bad = await historical(run, result, run.period_start, (copy) => {
    for (const metric of copy.metrics)
      metric.evidence.windowEnd = new Date(
        run.period_end.getTime() + 86400000,
      ).toISOString();
  });
  const comparison = await service.compare(f.s, f.actor, run.id);
  expect(comparison.comparable).toBe(true);
  expect(comparison.previous?.runId).toBe(good.id);
  expect(comparison.current?.from).not.toBe(comparison.previous?.from);
  await sql`UPDATE analysis_runs SET scope_identity='different' WHERE id=${good.id}::uuid`.execute(
    db,
  );
  const incompatible = await service.compare(f.s, f.actor, run.id);
  expect(incompatible.comparable).toBe(false);
  expect(incompatible.reasons).toContain("WINDOW_MISMATCH");
  await sql`UPDATE analysis_runs SET invalidated_at=now(),invalidation_reason='DATA_REMOVED' WHERE id=${bad.id}::uuid`.execute(
    db,
  );
  expect((await service.compare(f.s, f.actor, run.id)).reasons).toContain(
    "SCOPE_MISMATCH",
  );
});
it("renders result, evidence, comparison, saved review, withdrawal and empty-state routes with the real services", async () => {
  const { f, run } = await complete();
  const issue = async () => "private:" + "a".repeat(60);
  const render = (intent: Record<string, unknown>) =>
    analysisInteraction(
      db,
      f.s,
      f.actor,
      issue,
      "ja",
      intent,
      undefined,
      "test-component",
    );
  for (const action of [
    "analysisResult",
    "analysisEvidence",
    "analysisCompare",
    "analysisAttention",
  ])
    validatePanel(
      await render({ action, runId: run.id, concernKey: "waiting_response" }),
    );
  const key = await service.attention(f.s, f.actor, run.id, "waiting_response");
  validatePanel(
    await render({
      action: "analysisAttentionConfirm",
      runId: run.id,
      concernKey: "waiting_response",
    }),
  );
  validatePanel(await render({ action: "analysisAttentionItem", key }));
  const item = await service.attentionItem(f.s, f.actor, key);
  const dismissed = await render({
    action: "analysisAttentionUpdate",
    key,
    version: item.version,
    status: "DISMISSED",
  });
  validatePanel(dismissed);
  expect(JSON.stringify(dismissed)).toContain("撤回済み");
  const list = await render({ action: "analysisAttentionList", filter: "all" });
  validatePanel(list);
  expect(JSON.stringify(list)).toContain("撤回済み");
  expect(
    JSON.stringify(
      await render({ action: "analysisAttentionList", filter: "active" }),
    ),
  ).toContain("要確認はありません");
  validatePanel(await render({ action: "analysisHistory" }));
  await expect(
    render({ action: "analysisAttentionList", filter: "forged" }),
  ).rejects.toThrow();
  await expect(
    render({
      action: "analysisAttentionUpdate",
      key,
      version: item.version,
      status: "OPEN",
    }),
  ).rejects.toThrow();
});
