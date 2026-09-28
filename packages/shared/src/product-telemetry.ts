import {createHmac,randomUUID} from 'node:crypto';
import {sql,type Database} from '../../db/src/index.js';
import type {Scope} from './index.js';

export const productEvents=['guild_installed','setup_started','setup_scope_completed','setup_team_completed','setup_notification_completed','setup_goal_completed','setup_completed','panel_opened','attention_opened','analysis_opened','settings_opened','setting_saved','test_notification_sent','interaction_failed','interaction_latency','page_render_latency'] as const;
export type ProductEvent=typeof productEvents[number];
export function productGuildHash(guildId:string,key:string){return createHmac('sha256',key).update(guildId).digest('hex').slice(0,24);}
export async function recordProductEvent(db:Database,s:Scope,event:ProductEvent,durationMs?:number){
 const key=process.env.LOOKUP_KEY;if(!key)return;
 const guildHash=productGuildHash(s.guildId,key),duration=durationMs===undefined?null:Math.max(0,Math.min(600000,Math.round(durationMs)));
 await sql`INSERT INTO product_telemetry(id,guild_hash,event,duration_ms) VALUES(${randomUUID()}::uuid,${guildHash},${event},${duration})`.execute(db);
}
