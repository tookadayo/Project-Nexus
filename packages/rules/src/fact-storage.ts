import { randomUUID } from 'node:crypto';
import { sql, tenant, type Tx } from '../../db/src/index';
import { assert, type Scope } from '../../shared/src/index';
import { canonicalDecimal, canonicalRuleJson, canonicalRuleTimestamp, hashRuleValue, normalizeFact, normalizeSourceHealth } from './facts';
import type { FactRef, FactSnapshot, FactValue, SourceHealthObservation, SourceHealthRef } from './facts';
import { assertRegisteredFact } from './rule-catalog';
import { projectFactValue, restoreFactValue } from './source-adapters';
import type { FactScalarComponent, ScalarKind } from './source-adapters';
import { ALPHA16_RETENTION_CONTRACT } from './retention-contract';

const uuid = (value: string) => assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), 'RULE_STORAGE_ID_INVALID');
const iso = (value: string | Date) => canonicalRuleTimestamp(value instanceof Date ? value.toISOString() : value);
const pgTime = (column: string) => sql.raw(`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
const minimum = (...dates: Date[]) => new Date(Math.min(...dates.map((at) => at.getTime())));
/** A copy/reinsert of an old observation cannot restart its retention duration. */
export function boundObservationExpiry(sourceExpiry:string,observedAt:string,capturedAt:Date,policyExpiry:Date):Date {
  const duration=Math.min(policyExpiry.getTime()-capturedAt.getTime(),ALPHA16_RETENTION_CONTRACT.factSnapshot.maximumSeconds*1000);
  assert(Number.isFinite(duration)&&duration>0,'RULE_STORAGE_RETENTION_INVALID');
  assert(Date.parse(observedAt)<=capturedAt.getTime(),'RULE_STORAGE_OBSERVATION_IN_FUTURE');
  return minimum(new Date(sourceExpiry),policyExpiry,new Date(capturedAt.getTime()+duration),new Date(Date.parse(observedAt)+duration));
}
export interface FactStoragePolicyExpiry { fact: Date; sourceHealth: Date }
export interface RuleFactStorageRefs { facts: readonly FactRef[]; sourceHealth: readonly SourceHealthRef[] }
export interface RuleInputStorageRef { kind: 'FACT' | 'SOURCE_HEALTH'; id: string; revision: string }

/** Expand the API's snapshot references once, inside the first enqueue transaction. */
export async function expandRuleInputRefs(tx: Tx, s: Scope, inputs: readonly RuleInputStorageRef[]): Promise<{facts:FactRef[];sourceHealth:SourceHealthRef[];expiresAt:Date}> {
  assert(tx.isTransaction, 'RULE_TRANSACTION_REQUIRED', 500);
  assert(inputs.length > 0 && inputs.length <= 2000, 'RULE_INPUT_HARD_LIMIT');
  const facts: FactRef[] = [], health = new Map<string, SourceHealthRef>(), expiries: Date[] = [];
  for (const ref of inputs) {
    uuid(ref.id);
    if (ref.kind === 'FACT') {
      const snapshot = (await sql<{expires_at:Date}>`SELECT expires_at FROM rule_fact_snapshots WHERE ${tenant(s)} AND id=${ref.id}::uuid AND registry_version=${ref.revision} AND state='SEALED' AND expires_at>clock_timestamp()`.execute(tx)).rows[0];
      assert(snapshot, 'RULE_FACT_REF_UNAVAILABLE', 409); expiries.push(snapshot.expires_at);
      const group = (await sql<{fact_id:string;source_revision:string;expires_at:Date}>`SELECT fact_id,source_revision,expires_at FROM rule_fact_groups WHERE ${tenant(s)} AND snapshot_id=${ref.id}::uuid ORDER BY fact_id`.execute(tx)).rows;
      assert(group.length > 0, 'RULE_FACT_REF_UNAVAILABLE', 409);
      facts.push(...group.map((row) => ({snapshotId:ref.id,factId:row.fact_id,sourceRevision:row.source_revision}))); expiries.push(...group.map((row) => row.expires_at));
      const sourceRefs = (await sql<{health_id:string;health_revision:string}>`SELECT DISTINCT health_id,health_revision FROM rule_fact_health_refs WHERE ${tenant(s)} AND snapshot_id=${ref.id}::uuid ORDER BY health_id`.execute(tx)).rows;
      for (const source of sourceRefs) {
        const previous = health.get(source.health_id);
        assert(!previous || previous.revision === source.health_revision, 'RULE_HEALTH_REVISION_AMBIGUOUS');
        health.set(source.health_id,{observationId:source.health_id,revision:source.health_revision});
      }
    } else {
      assert(ref.kind === 'SOURCE_HEALTH', 'RULE_INPUT_REF_INVALID');
      const previous = health.get(ref.id); assert(!previous || previous.revision === ref.revision, 'RULE_HEALTH_REVISION_AMBIGUOUS');
      health.set(ref.id,{observationId:ref.id,revision:ref.revision});
    }
  }
  assert(facts.length <= 2000 && health.size <= 2000 && new Set(facts.map((ref) => `${ref.snapshotId}:${ref.factId}`)).size === facts.length, 'RULE_INPUT_HARD_LIMIT');
  for (const ref of health.values()) {
    const row = (await sql<{expires_at:Date}>`SELECT expires_at FROM rule_source_health WHERE ${tenant(s)} AND id=${ref.observationId}::uuid AND revision=${ref.revision} AND expires_at>clock_timestamp()`.execute(tx)).rows[0];
    assert(row, 'RULE_HEALTH_REF_UNAVAILABLE', 409); expiries.push(row.expires_at);
  }
  assert(expiries.length > 0, 'RULE_INPUT_REF_INVALID');
  return { facts:facts.sort((a,b) => a.snapshotId.localeCompare(b.snapshotId)||a.factId.localeCompare(b.factId)), sourceHealth:[...health.values()].sort((a,b)=>a.observationId.localeCompare(b.observationId)), expiresAt:minimum(...expiries) };
}

/** Requires the caller's authorized scoped transaction/tombstone locks. No own transaction or I/O dispatch. */
export async function persistRuleFacts(tx: Tx, s: Scope, factInputs: readonly FactSnapshot[], healthInputs: readonly SourceHealthObservation[], capturedAt: Date, policyExpiry: FactStoragePolicyExpiry): Promise<void> {
  assert(tx.isTransaction, 'RULE_TRANSACTION_REQUIRED', 500);
  assert(Number.isFinite(capturedAt.getTime()) && policyExpiry.fact > capturedAt && policyExpiry.sourceHealth > capturedAt, 'RULE_STORAGE_RETENTION_INVALID');
  assert(factInputs.length <= 2000 && healthInputs.length <= 2000, 'RULE_INPUT_HARD_LIMIT');
  const facts = factInputs.map(normalizeFact), health = healthInputs.map(normalizeSourceHealth);
  facts.forEach((fact) => { uuid(fact.factId); uuid(fact.snapshotId); assertRegisteredFact(fact); });
  for (const item of health) {
    uuid(item.observationId);
    const expiresAt = boundObservationExpiry(item.expiresAt,item.observedAt,capturedAt,policyExpiry.sourceHealth);
    assert(expiresAt > capturedAt, 'RULE_STORAGE_EVIDENCE_EXPIRED');
    const contentHash = hashRuleValue(item);
    await sql`INSERT INTO rule_source_health(organization_id,guild_id,id,revision,source_id,observed_at,expires_at,source_expires_at,quality,health_state,target_type,target_id,live_version,last_success_at,never_succeeded,coverage,content_hash)
      VALUES(${s.organizationId}::uuid,${s.guildId},${item.observationId}::uuid,${item.revision},${item.sourceType},${item.observedAt}::timestamptz,${expiresAt},${item.expiresAt}::timestamptz,${item.quality},${item.state},${item.target.targetType},${item.target.targetId},${item.target.liveVersion},${item.lastSuccessfulIngestAt}::timestamptz,${item.neverSucceeded},${item.coverage}::numeric,${contentHash})
      ON CONFLICT(organization_id,guild_id,id) DO NOTHING`.execute(tx);
    const saved = (await sql<{content_hash:string}>`SELECT content_hash FROM rule_source_health WHERE ${tenant(s)} AND id=${item.observationId}::uuid`.execute(tx)).rows[0];
    assert(saved?.content_hash === contentHash, 'RULE_STORAGE_IMMUTABLE_CONFLICT', 409);
  }
  const snapshots = new Map<string, FactSnapshot[]>();
  for (const fact of facts) { const group = snapshots.get(fact.snapshotId) ?? []; group.push(fact); snapshots.set(fact.snapshotId, group); }
  for (const [snapshotId, inputGroup] of snapshots) {
    const group = [...inputGroup].sort((a, b) => a.factId.localeCompare(b.factId)), first = group[0]!;
    assert(group.every((fact) => fact.metricDefinitionVersion === first.metricDefinitionVersion && canonicalRuleJson(fact.target) === canonicalRuleJson(first.target)), 'RULE_SNAPSHOT_SCOPE_MISMATCH');
    const expiresAt = minimum(...group.map((fact) => boundObservationExpiry(fact.expiresAt,fact.observedAt,capturedAt,policyExpiry.fact)));
    assert(expiresAt > capturedAt, 'RULE_STORAGE_EVIDENCE_EXPIRED');
    const contentHash = hashRuleValue(group);
    const windowStart = group.map((fact) => fact.windowStart).sort()[0]!, windowEnd = group.map((fact) => fact.windowEnd).sort().at(-1)!;
    await sql`INSERT INTO rule_fact_snapshots(organization_id,guild_id,id,registry_version,target_type,target_id,live_version,window_start,window_end,captured_at,state,content_hash,expires_at)
      VALUES(${s.organizationId}::uuid,${s.guildId},${snapshotId}::uuid,${first.metricDefinitionVersion},${first.target.targetType},${first.target.targetId},${first.target.liveVersion},${windowStart}::timestamptz,${windowEnd}::timestamptz,${capturedAt},'SEALED',${contentHash},${expiresAt}) ON CONFLICT(organization_id,guild_id,id) DO NOTHING`.execute(tx);
    const saved = (await sql<{content_hash:string;state:string}>`SELECT content_hash,state FROM rule_fact_snapshots WHERE ${tenant(s)} AND id=${snapshotId}::uuid`.execute(tx)).rows[0];
    assert(saved?.content_hash === contentHash && saved.state === 'SEALED', 'RULE_STORAGE_IMMUTABLE_CONFLICT', 409);
    for (const fact of group) {
      const c = fact.comparison;
      await sql`INSERT INTO rule_fact_groups(organization_id,guild_id,snapshot_id,fact_id,metric_id,definition_version,dimension_key,dimension,period_role,window_start,window_end,source_id,source_revision,observed_at,source_expires_at,expires_at,unit,target_type,target_id,live_version,composite_kind,quality,coverage,sample_size,cohort_definition_version,campaign_class,maturity_offset,window_kind,time_zone,cohort_id,content_hash)
        VALUES(${s.organizationId}::uuid,${s.guildId},${snapshotId}::uuid,${fact.factId}::uuid,${fact.metricId},${fact.metricDefinitionVersion},${canonicalRuleJson(fact.dimension)},${JSON.stringify(fact.dimension)}::jsonb,${fact.periodRole},${fact.windowStart}::timestamptz,${fact.windowEnd}::timestamptz,${fact.sourceType},${fact.sourceRevision},${fact.observedAt}::timestamptz,${fact.expiresAt}::timestamptz,${boundObservationExpiry(fact.expiresAt,fact.observedAt,capturedAt,policyExpiry.fact)},${fact.unit},${fact.target.targetType},${fact.target.targetId},${fact.target.liveVersion},${fact.value?.kind ?? null},${fact.quality},${fact.coverage}::numeric,${fact.sampleSize}::bigint,${c?.cohortDefinitionVersion ?? null},${c?.campaignClass ?? null},${c?.maturityOffset ?? null},${c?.windowKind ?? null},${c?.timeZone ?? null},${c?.cohortId ?? null},${hashRuleValue(fact)}) ON CONFLICT(organization_id,guild_id,snapshot_id,fact_id) DO NOTHING`.execute(tx);
      for (const part of projectFactValue(fact.value)) {
        const value = part.value;
        await sql`INSERT INTO rule_fact_values(organization_id,guild_id,snapshot_id,fact_id,id,component_key,value_kind,integer_value,decimal_value,boolean_value,enum_value,timestamp_value)
          VALUES(${s.organizationId}::uuid,${s.guildId},${snapshotId}::uuid,${fact.factId}::uuid,${randomUUID()}::uuid,${part.componentKey},${part.valueKind},${part.valueKind === 'INTEGER' ? value : null}::bigint,${part.valueKind === 'DECIMAL' ? value : null}::numeric,${part.valueKind === 'BOOLEAN' ? value : null}::boolean,${part.valueKind === 'ENUM' ? value : null},${part.valueKind === 'TIMESTAMP' ? value : null}::timestamptz) ON CONFLICT(organization_id,guild_id,snapshot_id,fact_id,component_key) DO NOTHING`.execute(tx);
      }
      for (const ref of fact.sourceHealthRefs) {
        uuid(ref.observationId);
        const h = (await sql<{revision:string;expires_at:Date}>`SELECT revision,expires_at FROM rule_source_health WHERE ${tenant(s)} AND id=${ref.observationId}::uuid`.execute(tx)).rows[0];
        assert(h?.revision === ref.revision && h.expires_at > capturedAt, 'RULE_HEALTH_REF_MISSING');
        await sql`INSERT INTO rule_fact_health_refs(organization_id,guild_id,snapshot_id,fact_id,health_id,health_revision) VALUES(${s.organizationId}::uuid,${s.guildId},${snapshotId}::uuid,${fact.factId}::uuid,${ref.observationId}::uuid,${ref.revision}) ON CONFLICT DO NOTHING`.execute(tx);
      }
    }
  }
}

interface GroupRow {
  fact_id:string;snapshot_id:string;metric_id:string;definition_version:string;dimension:Record<string,string>;period_role:FactSnapshot['periodRole'];
  window_start:string;window_end:string;source_id:string;source_revision:string;observed_at:string;source_expires_at:string;unit:string;
  target_type:string;target_id:string;live_version:string;composite_kind:FactValue['kind']|null;quality:FactSnapshot['quality'];coverage:string|null;sample_size:string|null;
  cohort_definition_version:string|null;campaign_class:string|null;maturity_offset:string|null;window_kind:'ELAPSED'|'CALENDAR'|null;time_zone:string|null;cohort_id:string|null;content_hash:string;
}
/** Reads immutable original identities and rejects missing, expired, changed, or invalidated references. */
export async function loadRuleFacts(tx: Tx, s: Scope, refs: RuleFactStorageRefs): Promise<{facts:FactSnapshot[];sourceHealth:SourceHealthObservation[]}> {
  assert(tx.isTransaction, 'RULE_TRANSACTION_REQUIRED', 500);
  assert(refs.facts.length <= 2000 && refs.sourceHealth.length <= 2000, 'RULE_INPUT_HARD_LIMIT');
  const facts: FactSnapshot[] = [], sourceHealth: SourceHealthObservation[] = [];
  for (const ref of refs.facts) {
    uuid(ref.snapshotId); uuid(ref.factId);
    const row = (await sql<GroupRow>`SELECT g.*,${pgTime('g.window_start')} AS window_start,${pgTime('g.window_end')} AS window_end,${pgTime('g.observed_at')} AS observed_at,${pgTime('g.source_expires_at')} AS source_expires_at
      FROM rule_fact_groups g JOIN rule_fact_snapshots p ON p.organization_id=g.organization_id AND p.guild_id=g.guild_id AND p.id=g.snapshot_id
      WHERE g.organization_id=${s.organizationId}::uuid AND g.guild_id=${s.guildId} AND g.snapshot_id=${ref.snapshotId}::uuid AND g.fact_id=${ref.factId}::uuid AND g.source_revision=${ref.sourceRevision} AND p.state='SEALED' AND p.expires_at>clock_timestamp() AND g.expires_at>clock_timestamp()`.execute(tx)).rows[0];
    assert(row, 'RULE_FACT_REF_UNAVAILABLE', 409);
    const parts = (await sql<{component_key:string;value_kind:ScalarKind;integer_value:string|null;decimal_value:string|null;boolean_value:boolean|null;enum_value:string|null;timestamp_value:string|null}>`SELECT component_key,value_kind,integer_value,decimal_value,boolean_value,enum_value,${pgTime('timestamp_value')} AS timestamp_value FROM rule_fact_values WHERE ${tenant(s)} AND snapshot_id=${ref.snapshotId}::uuid AND fact_id=${ref.factId}::uuid ORDER BY component_key`.execute(tx)).rows;
    const components: FactScalarComponent[] = parts.map((part) => ({ componentKey: part.component_key, valueKind: part.value_kind, value: part.value_kind === 'INTEGER' ? part.integer_value : part.value_kind === 'DECIMAL' ? (part.decimal_value === null ? null : canonicalDecimal(part.decimal_value)) : part.value_kind === 'BOOLEAN' ? part.boolean_value : part.value_kind === 'ENUM' ? part.enum_value : part.timestamp_value }));
    const healthRefs = (await sql<{health_id:string;health_revision:string}>`SELECT health_id,health_revision FROM rule_fact_health_refs WHERE ${tenant(s)} AND snapshot_id=${ref.snapshotId}::uuid AND fact_id=${ref.factId}::uuid ORDER BY health_id`.execute(tx)).rows.map((health) => ({ observationId: health.health_id, revision: health.health_revision }));
    const fact = normalizeFact({ factId:row.fact_id,snapshotId:row.snapshot_id,metricId:row.metric_id,metricDefinitionVersion:row.definition_version,dimension:row.dimension,periodRole:row.period_role,windowStart:row.window_start,windowEnd:row.window_end,sourceType:row.source_id,sourceRevision:row.source_revision,observedAt:row.observed_at,expiresAt:row.source_expires_at,sourceHealthRefs:healthRefs,quality:row.quality,value:restoreFactValue(row.composite_kind,components),unit:row.unit,target:{targetType:row.target_type,targetId:row.target_id,liveVersion:row.live_version},coverage:row.coverage === null ? null : canonicalDecimal(row.coverage),sampleSize:row.sample_size,...(row.cohort_definition_version ? {comparison:{cohortDefinitionVersion:row.cohort_definition_version,campaignClass:row.campaign_class!,maturityOffset:row.maturity_offset!,windowKind:row.window_kind!,timeZone:row.time_zone!,cohortId:row.cohort_id!}} : {}) });
    assertRegisteredFact(fact); assert(hashRuleValue(fact) === row.content_hash, 'RULE_FACT_HASH_MISMATCH', 409); facts.push(fact);
  }
  for (const ref of refs.sourceHealth) {
    uuid(ref.observationId);
    const row = (await sql<{id:string;revision:string;source_id:string;observed_at:string;source_expires_at:string;quality:SourceHealthObservation['quality'];health_state:SourceHealthObservation['state'];last_success_at:string|null;never_succeeded:boolean|null;coverage:string|null;target_type:string;target_id:string;live_version:string;content_hash:string}>`SELECT *,${pgTime('observed_at')} AS observed_at,${pgTime('source_expires_at')} AS source_expires_at,${pgTime('last_success_at')} AS last_success_at FROM rule_source_health WHERE ${tenant(s)} AND id=${ref.observationId}::uuid AND revision=${ref.revision} AND expires_at>clock_timestamp()`.execute(tx)).rows[0];
    assert(row, 'RULE_HEALTH_REF_UNAVAILABLE', 409);
    const item = normalizeSourceHealth({ observationId:row.id,revision:row.revision,sourceType:row.source_id,observedAt:iso(row.observed_at),expiresAt:iso(row.source_expires_at),quality:row.quality,state:row.health_state,lastSuccessfulIngestAt:row.last_success_at === null ? null : iso(row.last_success_at),neverSucceeded:row.never_succeeded,coverage:row.coverage === null ? null : canonicalDecimal(row.coverage),target:{targetType:row.target_type,targetId:row.target_id,liveVersion:row.live_version} });
    assert(hashRuleValue(item) === row.content_hash, 'RULE_HEALTH_HASH_MISMATCH', 409); sourceHealth.push(item);
  }
  return { facts, sourceHealth };
}
