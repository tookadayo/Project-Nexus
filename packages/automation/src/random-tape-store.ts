import { sql, json, tenant, type Database } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { automationLock } from "./quota";
import { fingerprint, type ResumeState, type RunRecord } from "./store";
import type { EvaluatedValue } from "./types";
import type { RandomTapeMaterial, RandomTapeOutcome } from "./scratch-random";

export interface StoredRandomTapeInput {
  version: 1;
  material: RandomTapeMaterial;
  type: EvaluatedValue["type"];
  provenance: EvaluatedValue["provenance"];
}
export interface StoredRandomTape extends StoredRandomTapeInput {
  preparedCheckpointFingerprint: string;
}
export type StoredRandomOutcome = { state: "PREPARED"; evaluationReservations: number; checkpointFingerprint: string } | RandomTapeOutcome;
export interface RandomTapeRecord { fingerprint: string; input: StoredRandomTape; result: StoredRandomOutcome }
function nextCheckpointVersion(current: ResumeState, expected: ResumeState): number {
  const actualVersion = current.checkpointVersion ?? 0, expectedVersion = expected.checkpointVersion ?? 0;
  assert(Number.isSafeInteger(actualVersion) && actualVersion >= 0 && actualVersion < Number.MAX_SAFE_INTEGER && Number.isSafeInteger(expectedVersion) && expectedVersion >= 0 && actualVersion === expectedVersion, "AUTOMATION_CHECKPOINT_CONFLICT");
  return actualVersion + 1;
}

/** The existing run-scoped table already shares the Run's deletion lifecycle.
 * New rows are explicitly versioned; legacy result rows keep their wire format. */
export class RandomTapeStore {
  constructor(readonly db: Database, private readonly clock?: () => Date) {}
  async prepare(s: Scope, runId: string, identity: string, state: ResumeState, expectedResumeFingerprint: string, maxBytes: number,
    make: (availableBytes: number) => StoredRandomTapeInput, now = new Date(), effectiveDeadline?: Date): Promise<RandomTapeRecord> {
    let committedVersion: number | undefined;
    const record = await this.db.transaction().execute(async (tx) => {
      await automationLock(tx, s);
      const run = (await sql<RunRecord>`SELECT * FROM automation_runs WHERE ${tenant(s)} AND id=${runId}::uuid FOR UPDATE`.execute(tx)).rows[0];
      const decisionAt = this.clock?.() ?? now;
      assert(run && !run.ended_at && !run.cancel_requested_at && run.deadline_at > decisionAt, "AUTOMATION_STOPPED");
      assert(!effectiveDeadline || effectiveDeadline > decisionAt, "AUTOMATION_LOCAL_DEADLINE");
      const old = (await sql<RandomTapeRecord>`SELECT fingerprint,input,result FROM automation_random_results WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(tx)).rows[0];
      if (old) {
        assert(old.input.version === 1 && old.input.material.reservationId === identity && old.fingerprint === fingerprint(old.input), "AUTOMATION_RANDOM_INPUT_MISMATCH");
        return old;
      }
      const nextVersion = nextCheckpointVersion(run.resume, state);
      assert(fingerprint(run.resume) === expectedResumeFingerprint, "AUTOMATION_RANDOM_CHECKPOINT_CONFLICT");
      const retained = (await sql<{ bytes: number }>`SELECT COALESCE(sum(octet_length(input::text)+octet_length(result::text)),0)::float8 AS bytes FROM automation_random_results WHERE ${tenant(s)} AND run_id=${runId}::uuid`.execute(tx)).rows[0]!.bytes;
      const available = maxBytes - retained - Buffer.byteLength(JSON.stringify(state));
      assert(Number.isSafeInteger(available) && available > 0, "AUTOMATION_STATE_LIMIT");
      const prepared = make(available), checkpoint: ResumeState = { ...state, checkpointVersion: nextVersion };
      const input: StoredRandomTape = { ...prepared, preparedCheckpointFingerprint: fingerprint(checkpoint) };
      const result = { state: "PREPARED" as const, evaluationReservations: 0, checkpointFingerprint: fingerprint(checkpoint) }, hash = fingerprint(input);
      assert(input.version === 1 && input.material.reservationId === identity, "AUTOMATION_RANDOM_INPUT_MISMATCH");
      assert(!input.provenance.some((source) => source.sensitive || source.resumable === false), "AUTOMATION_RANDOM_NOT_RESUMABLE");
      assert(retained + Buffer.byteLength(JSON.stringify(input)) + Buffer.byteLength(JSON.stringify(result)) + Buffer.byteLength(JSON.stringify(checkpoint)) <= maxBytes, "AUTOMATION_STATE_LIMIT");
      // No candidate has been interpreted. Materials and their logical budget
      // reservation become durable in the same transaction as the original PC.
      await sql`INSERT INTO automation_random_results(organization_id,guild_id,run_id,identity,fingerprint,input,result) VALUES(${s.organizationId}::uuid,${s.guildId},${runId}::uuid,${identity},${hash},${json(input)},${json(result)})`.execute(tx);
      await sql`UPDATE automation_runs SET resume=${json(checkpoint)},evaluations=${checkpoint.evaluations},steps=${checkpoint.steps},updated_at=${now} WHERE ${tenant(s)} AND id=${runId}::uuid`.execute(tx);
      committedVersion = nextVersion;
      return { fingerprint: hash, input, result };
    });
    if (committedVersion !== undefined) state.checkpointVersion = committedVersion;
    return record;
  }
  /** Reserve actual deterministic computation before each attempt, including a
   * replay after a crash. The first evaluation was covered by prepare's Q;
   * subsequent evaluations consume the same shared budget without changing Q. */
  async reserveEvaluation(s: Scope, runId: string, identity: string, hash: string,
    state: ResumeState, maxEvaluations: number, maxBytes: number, now = new Date(), effectiveDeadline?: Date): Promise<RandomTapeRecord> {
    let committed: Pick<ResumeState, "checkpointVersion" | "evaluations"> | undefined;
    const record = await this.db.transaction().execute(async tx => {
      await automationLock(tx, s);
      const run = (await sql<RunRecord>`SELECT * FROM automation_runs WHERE ${tenant(s)} AND id=${runId}::uuid FOR UPDATE`.execute(tx)).rows[0];
      const decisionAt = this.clock?.() ?? now;
      assert(run && !run.ended_at && !run.cancel_requested_at && run.deadline_at > decisionAt, "AUTOMATION_STOPPED");
      assert(!effectiveDeadline || effectiveDeadline > decisionAt, "AUTOMATION_LOCAL_DEADLINE");
      const old = (await sql<RandomTapeRecord>`SELECT fingerprint,input,result FROM automation_random_results WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(tx)).rows[0];
      assert(old && old.input.version === 1 && old.fingerprint === hash && fingerprint(old.input) === hash, "AUTOMATION_RANDOM_INPUT_MISMATCH");
      if (old.result.state !== "PREPARED") return old;
      const nextVersion = nextCheckpointVersion(run.resume, state);
      assert(fingerprint(run.resume) === old.result.checkpointFingerprint && fingerprint(state) === old.result.checkpointFingerprint, "AUTOMATION_RANDOM_CHECKPOINT_CONFLICT");
      assert(Number.isSafeInteger(old.result.evaluationReservations) && old.result.evaluationReservations >= 0, "AUTOMATION_RANDOM_INPUT_MISMATCH");
      const replayCost = old.result.evaluationReservations === 0 ? (old.input.material.reservedTrials === 0 ? 1 : 0) : Math.max(1, old.input.material.reservedTrials);
      assert(Number.isSafeInteger(state.evaluations + replayCost) && state.evaluations + replayCost <= maxEvaluations, "AUTOMATION_EVALUATION_LIMIT");
      const checkpoint: ResumeState = { ...state, evaluations: state.evaluations + replayCost, checkpointVersion: nextVersion };
      const result = { state: "PREPARED" as const, evaluationReservations: old.result.evaluationReservations + 1, checkpointFingerprint: fingerprint(checkpoint) };
      const retained = (await sql<{ bytes: number }>`SELECT COALESCE(sum(octet_length(input::text)+octet_length(result::text)),0)::float8 AS bytes FROM automation_random_results WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity<>${identity}`.execute(tx)).rows[0]!.bytes;
      assert(retained + Buffer.byteLength(JSON.stringify(old.input)) + Buffer.byteLength(JSON.stringify(result)) + Buffer.byteLength(JSON.stringify(checkpoint)) <= maxBytes, "AUTOMATION_STATE_LIMIT");
      await sql`UPDATE automation_random_results SET result=${json(result)} WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(tx);
      await sql`UPDATE automation_runs SET resume=${json(checkpoint)},evaluations=${checkpoint.evaluations},steps=${checkpoint.steps},updated_at=${now} WHERE ${tenant(s)} AND id=${runId}::uuid`.execute(tx);
      committed = { checkpointVersion: nextVersion, evaluations: checkpoint.evaluations };
      return { ...old, result };
    });
    if (committed) { state.checkpointVersion = committed.checkpointVersion; state.evaluations = committed.evaluations; }
    return record;
  }
  async complete(s: Scope, runId: string, identity: string, hash: string, outcome: RandomTapeOutcome,
    state: ResumeState, maxBytes: number, now = new Date(), effectiveDeadline?: Date): Promise<RandomTapeRecord> {
    let committedVersion: number | undefined;
    const record = await this.db.transaction().execute(async (tx) => {
      await automationLock(tx, s);
      const run = (await sql<RunRecord>`SELECT * FROM automation_runs WHERE ${tenant(s)} AND id=${runId}::uuid FOR UPDATE`.execute(tx)).rows[0];
      const decisionAt = this.clock?.() ?? now;
      assert(run && !run.ended_at && !run.cancel_requested_at && run.deadline_at > decisionAt, "AUTOMATION_STOPPED");
      assert(!effectiveDeadline || effectiveDeadline > decisionAt, "AUTOMATION_LOCAL_DEADLINE");
      const old = (await sql<RandomTapeRecord>`SELECT fingerprint,input,result FROM automation_random_results WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(tx)).rows[0];
      assert(old && old.input.version === 1 && old.fingerprint === hash && fingerprint(old.input) === hash, "AUTOMATION_RANDOM_INPUT_MISMATCH");
      if (old.result.state !== "PREPARED") return old;
      const nextVersion = nextCheckpointVersion(run.resume, state);
      assert(fingerprint(run.resume) === old.result.checkpointFingerprint, "AUTOMATION_RANDOM_CHECKPOINT_CONFLICT");
      assert(Number.isSafeInteger(old.result.evaluationReservations) && old.result.evaluationReservations > 0, "AUTOMATION_RANDOM_EVALUATION_REQUIRED");
      const checkpoint: ResumeState = { ...state, checkpointVersion: nextVersion };
      const retained = (await sql<{ bytes: number }>`SELECT COALESCE(sum(octet_length(input::text)+octet_length(result::text)),0)::float8 AS bytes FROM automation_random_results WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity<>${identity}`.execute(tx)).rows[0]!.bytes;
      assert(retained + Buffer.byteLength(JSON.stringify(old.input)) + Buffer.byteLength(JSON.stringify(outcome)) + Buffer.byteLength(JSON.stringify(checkpoint)) <= maxBytes, "AUTOMATION_STATE_LIMIT");
      // The final value/failure and its PC/budget are committed together. A
      // restart reads that record and cannot regenerate the tape or retry Q.
      await sql`UPDATE automation_random_results SET result=${json(outcome)} WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(tx);
      await sql`UPDATE automation_runs SET resume=${json(checkpoint)},evaluations=${checkpoint.evaluations},steps=${checkpoint.steps},updated_at=${now} WHERE ${tenant(s)} AND id=${runId}::uuid`.execute(tx);
      committedVersion = nextVersion;
      return { ...old, result: outcome };
    });
    if (committedVersion !== undefined) state.checkpointVersion = committedVersion;
    return record;
  }
  /** A lost write acknowledgement is resolved without generating fresh entropy.
   * Locks make the material and checkpoint a single observed database state. */
  async reconcile(s: Scope, runId: string, identity: string, expectedHash?: string): Promise<{ run: RunRecord; record: RandomTapeRecord } | null> {
    return this.db.transaction().execute(async tx => {
      await automationLock(tx, s);
      const run = (await sql<RunRecord>`SELECT * FROM automation_runs WHERE ${tenant(s)} AND id=${runId}::uuid FOR UPDATE`.execute(tx)).rows[0];
      if (!run) return null;
      const record = (await sql<RandomTapeRecord>`SELECT fingerprint,input,result FROM automation_random_results WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(tx)).rows[0];
      if (!record) return null;
      assert(record.input.version === 1 && record.input.material.reservationId === identity && record.fingerprint === fingerprint(record.input) && (!expectedHash || expectedHash === record.fingerprint), "AUTOMATION_RANDOM_INPUT_MISMATCH");
      if (!run.ended_at && record.result.state === "PREPARED") assert(fingerprint(run.resume) === record.result.checkpointFingerprint, "AUTOMATION_RANDOM_CHECKPOINT_CONFLICT");
      return { run, record };
    });
  }
}
