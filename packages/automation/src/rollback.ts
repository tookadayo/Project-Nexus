import { sql,tenant,type Tx } from '../../db/src/index';
import { assert,type Scope } from '../../shared/src/index';
import { ALPHA16_RETENTION_CONTRACT } from '../../rules/src/retention-contract';

export interface RollbackDraftInput { sourceRevision:number;expectedRevision:number;expectedActiveRevision:number|null;expectedGeneration:number;requestId:string }
export interface RollbackCommitInput { rollbackId:string;revision:number;semanticHash:string;expectedActiveRevision:number|null;expectedGeneration:number;requestId:string }
export interface RollbackOrigin {
 id:string;flow_id:string;source_revision:number;prepared_revision:number;base_draft_revision:number;
 base_active_revision:number|null;base_generation:number;state:'PREPARED'|'APPLIED';created_at:Date;applied_at:Date|null;expires_at:Date;
}
export function assertRollbackBase(current:{draft_revision:number;active_revision:number|null;generation:number},expected:{expectedRevision:number;expectedActiveRevision:number|null;expectedGeneration:number}):void{
 assert(current.draft_revision===expected.expectedRevision&&current.active_revision===expected.expectedActiveRevision&&current.generation===expected.expectedGeneration,'AUTOMATION_ROLLBACK_CONFLICT',409);
}
export function rollbackAuditExpiry(createdAt:Date):Date{return new Date(createdAt.getTime()+ALPHA16_RETENTION_CONTRACT.minimalOperationAudit.maximumSeconds*1000);}
export async function recordRollbackDraft(tx:Tx,s:Scope,id:string,input:RollbackDraftInput,preparedRevision:number,now:Date):Promise<void>{
 assert(tx.isTransaction,'AUTOMATION_TRANSACTION_REQUIRED',500);
 await sql`INSERT INTO automation_rollbacks(organization_id,guild_id,id,flow_id,source_revision,prepared_revision,base_draft_revision,base_active_revision,base_generation,state,created_at,expires_at)
 VALUES(${s.organizationId}::uuid,${s.guildId},${input.requestId}::uuid,${id},${input.sourceRevision},${preparedRevision},${input.expectedRevision},${input.expectedActiveRevision},${input.expectedGeneration},'PREPARED',${now},${rollbackAuditExpiry(now)})`.execute(tx);
}
export async function lockRollbackOrigin(tx:Tx,s:Scope,id:string,request:RollbackCommitInput,now:Date):Promise<RollbackOrigin>{
 const row=(await sql<RollbackOrigin>`SELECT * FROM automation_rollbacks WHERE ${tenant(s)} AND id=${request.rollbackId}::uuid AND flow_id=${id} AND prepared_revision=${request.revision} AND expires_at>${now} FOR UPDATE`.execute(tx)).rows[0];
 assert(row&&row.state==='PREPARED','AUTOMATION_ROLLBACK_NOT_PREPARED',409);
 assert(row.base_active_revision===request.expectedActiveRevision&&row.base_generation===request.expectedGeneration,'AUTOMATION_ROLLBACK_CONFLICT',409);
 return row;
}
