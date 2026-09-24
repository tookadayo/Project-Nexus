import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {sql,tenant,json,type Database,type Tx} from '../../db/src/index.js';
import {canAdmin} from '../../security/src/index.js';
import {assert,type Scope} from '../../shared/src/index.js';
export const templates=['Gaming','Creator','Developer / OSS','Product / SaaS','Education','General Community'] as const;
const id=z.string().regex(/^\d{17,20}$/);
export const settingsSchema=z.object({enabled:z.boolean().default(false),onboardingEnabled:z.boolean().default(false),template:z.enum(templates).default('General Community'),
 uiLanguage:z.enum(['auto','ja','en','bilingual']).default('auto'),
 startChannelId:id.nullable().default(null),adminNotificationChannelId:id.nullable().default(null),adminRoleId:id.nullable().default(null),flowVersionId:z.uuid().nullable().default(null),
 mode:z.literal('SUGGEST').default('SUGGEST'),activationWindowHours:z.number().int().min(1).max(720).default(168),
 firstResponseMinutes:z.number().int().min(1).max(1440).default(60),helperEnabled:z.literal(false).default(false),reportEnabled:z.literal(false).default(false),
 onboardingMode:z.enum(['auto','native','fallback','hybrid']).default('auto'),
 hybrid:z.object({enabled:z.boolean(),flowVersionId:z.uuid().nullable(),trigger:z.enum(['after_join','after_native_onboarding_observed','manual']),nativePromptMappings:z.record(z.string(),z.string())}).strict().default({enabled:false,flowVersionId:null,trigger:'manual',nativePromptMappings:{}}),
 detailedRetentionDays:z.union([z.literal(7),z.literal(14),z.literal(30)]).default(30),aggregateRetentionMonths:z.union([z.literal(3),z.literal(12),z.literal(24)]).default(24),
 dmEnabled:z.boolean().default(false),
 flags:z.object({native_capability_v2:z.boolean().default(false),native_snapshot_v2:z.boolean().default(false),activation_dsl_v2:z.boolean().default(false),interventions_v2:z.boolean().default(false),experiments_v2:z.boolean().default(false),billing_v1:z.boolean().default(false)}).strict().default({native_capability_v2:false,native_snapshot_v2:false,activation_dsl_v2:false,interventions_v2:false,experiments_v2:false,billing_v1:false})}).strict();
export type Settings=z.infer<typeof settingsSchema>;
export type SettingsView=Settings&{revision:number};
export type Actor={key:string,permissions:string,roles:string[],source:'DISCORD_PANEL'|'WEB_DASHBOARD'|'SYSTEM',requestId:string};
export async function audit(tx:Tx,s:Scope,actor:Actor,action:string,before:unknown,after:unknown){
 await sql`INSERT INTO audit_logs(organization_id,guild_id,id,actor,action,source,before_value,after_value,request_id)
 VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${actor.key},${action},${actor.source},${json(before)},${json(after)},${actor.requestId})`.execute(tx);
}
export class SettingsService {
 constructor(private readonly db:Database){}
 async get(s:Scope,tx:Tx=this.db):Promise<SettingsView>{
  const {rows}=await sql<{settings:Settings,revision:number}>`SELECT settings,revision FROM guild_settings WHERE ${tenant(s)}`.execute(tx);
  return {...settingsSchema.parse(rows[0]?.settings??{}),revision:rows[0]?.revision??0};
 }
 async mutate(s:Scope,actor:Actor,revision:number,change:(current:Settings,tx:Tx)=>Promise<Settings>,redactAudit=false):Promise<SettingsView>{
  return this.db.transaction().execute(async tx=>{
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.organizationId+':'+s.guildId},0))`.execute(tx);
   const current=await this.get(s,tx);
   assert(canAdmin(actor.permissions,actor.roles,current.adminRoleId),'ADMIN_REQUIRED',403);
   assert(current.revision===revision,'REVISION_CONFLICT',409);
   const {revision:_revision,...before}=current;void _revision;
   const next=settingsSchema.parse(await change(before,tx));
   if(next.enabled&&!before.enabled)await sql`DELETE FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL`.execute(tx);
   assert(!next.onboardingEnabled||next.startChannelId&&next.flowVersionId,'ONBOARDING_NOT_CONFIGURED');
   await sql`INSERT INTO guild_settings(organization_id,guild_id,revision,settings) VALUES(${s.organizationId}::uuid,${s.guildId},${revision+1},${json(next)})
    ON CONFLICT(organization_id,guild_id) DO UPDATE SET revision=EXCLUDED.revision,settings=EXCLUDED.settings`.execute(tx);
   await audit(tx,s,redactAudit?{...actor,key:'deleted-admin'}:actor,'settings.updated',redactAudit?null:before,redactAudit?{enabled:false}:next);
   return {...next,revision:revision+1};
  });
 }
 async update(s:Scope,actor:Actor,revision:number,patch:Partial<Settings>){
  return this.mutate(s,actor,revision,async current=>settingsSchema.parse({...current,...patch}));
 }
}
