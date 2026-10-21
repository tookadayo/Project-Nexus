import { randomUUID } from "node:crypto";
import { sql,type Tx } from "../../db/src/index";
import { assert,type Scope } from "../../shared/src/index";
import { ALPHA16_RETENTION_CONTRACT } from "../../rules/src/retention-contract";
/** New operation metadata only. Existing legal/security/audit purposes retain
 * their own contracts. No body, arbitrary reason text, value, or secret. */
export async function minimalOperationAudit(tx:Tx,s:Scope,actorHash:string,action:string,target:string,revision:number|null,now=new Date()){
 assert(tx.isTransaction,"TRANSACTION_REQUIRED",500);
 assert(/^[A-Z_.]{3,80}$/.test(action)&&target.length<=180&&actorHash.length<=180,"INVALID_AUDIT");
 const expires=new Date(now.getTime()+ALPHA16_RETENTION_CONTRACT.minimalOperationAudit.maximumSeconds*1000);
 await sql`INSERT INTO operations_audit_events(organization_id,guild_id,id,actor_hash,action,target,revision,result,occurred_at,retention_class,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${actorHash},${action},${target},${revision},'SUCCEEDED',${now},'ALPHA16_MINIMAL_OPERATION',${expires})`.execute(tx);
}
