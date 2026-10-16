import {sql,type Tx} from '../../db/src/index';
import type {Scope} from '../../shared/src/index';

/** Only a worker that actually holds the Run lock/checkpoint may call this.
 * UPDATE cannot recreate an observation after privacy/parent deletion. The
 * status trigger supplies due/deadline; updated_at is never a heartbeat. */
export async function recordAutomationExecutionHeartbeat(tx:Tx,s:Scope,runId:string,at:Date):Promise<void>{
 await sql`UPDATE automation_execution_observations o SET heartbeat_at=GREATEST(o.heartbeat_at,${at}),observed_at=GREATEST(o.observed_at,${at}),checkpoint_revision=o.checkpoint_revision+1
 WHERE o.organization_id=${s.organizationId}::uuid AND o.guild_id=${s.guildId} AND o.run_id=${runId}::uuid AND o.terminal_at IS NULL AND o.retention_expires_at>${at}
 AND EXISTS(SELECT 1 FROM automation_runs r WHERE r.organization_id=o.organization_id AND r.guild_id=o.guild_id AND r.id=o.run_id AND r.ended_at IS NULL AND r.revision=o.revision)
 AND ${at}>=COALESCE(o.heartbeat_at,'-infinity'::timestamptz)`.execute(tx);
}
