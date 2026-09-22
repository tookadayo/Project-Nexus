import {randomUUID} from 'node:crypto';
import {sql,json,type Tx} from '../../db/src/index.js';
import type {Scope} from '../../shared/src/index.js';
export type ActionKind='ROLE_RECONCILE'|'ROLE_ADD'|'ROLE_REMOVE'|'PANEL_UPSERT'|'REPLY_EDIT'|'COMMANDS_REGISTER'|'INTERVENTION_DELIVER';
export async function enqueue(tx:Tx,s:Scope,key:string,kind:ActionKind,payload:Record<string,unknown>){
 const id=randomUUID();
 const {rows}=await sql<{id:string}>`INSERT INTO action_outbox(organization_id,guild_id,id,dedupe_key,kind,payload)
 VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${key},${kind},${json(payload)})
 ON CONFLICT(organization_id,guild_id,dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING id`.execute(tx);
 return rows[0]!.id;
}
