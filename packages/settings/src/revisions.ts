import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sql,tenant,json,type Database,type Tx} from '../../db/src/index.js';
import {assert,type Scope} from '../../shared/src/index.js';
import {canAdmin} from '../../security/src/index.js';
import {audit,SettingsService,settingsSchema,type Actor} from './index.js';
import {EntitlementService} from './entitlements.js';

export type ConfigDomain='onboarding'|'activation'|'cohort'|'intervention'|'experiment'|'privacy';
export type Revision={id:string,domain:ConfigDomain,version:number,definition:unknown,hash:string,author:string,state:'draft'|'published',published_at:Date|null};
function canonical(value:unknown):string {
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
 return JSON.stringify(value);
}
export function configHash(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex');}
export class RevisionService {
 constructor(private readonly db:Database,private readonly schemas:Partial<Record<ConfigDomain,z.ZodType>>){ }
 private validate(domain:ConfigDomain,value:unknown){const schema=this.schemas[domain];assert(schema,'UNSUPPORTED_CONFIG_DOMAIN');return schema.parse(value);}
 private async authorize(tx:Tx,s:Scope,actor:Actor){const cfg=await new SettingsService(this.db).get(s,tx);assert(canAdmin(actor.permissions,actor.roles,cfg.adminRoleId),'ADMIN_REQUIRED',403);}
 async draft(s:Scope,actor:Actor,domain:ConfigDomain,value:unknown){
  const definition=this.validate(domain,value);
  return this.db.transaction().execute(async tx=>{
   await this.authorize(tx,s,actor);await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.guildId+':config:'+domain},0))`.execute(tx);
   const version=(await sql<{n:number}>`SELECT COALESCE(MAX(version),0)::integer+1 AS n FROM guild_config_revisions WHERE ${tenant(s)} AND domain=${domain}`.execute(tx)).rows[0]!.n;
   const id=randomUUID();await sql`INSERT INTO guild_config_revisions(organization_id,guild_id,id,domain,version,definition,hash,author,state) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${domain},${version},${json(definition)},${configHash(definition)},${actor.key},'draft')`.execute(tx);
   await audit(tx,s,actor,'config.drafted',null,{id,domain,version});return id;
  });
 }
 async get(s:Scope,id:string,tx:Tx=this.db){const row=(await sql<Revision>`SELECT * FROM guild_config_revisions WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx)).rows[0];assert(row,'REVISION_NOT_FOUND',404);return row;}
 async current(s:Scope,domain:ConfigDomain,tx:Tx=this.db){return (await sql<Revision>`SELECT r.* FROM guild_config_revisions r JOIN guild_config_heads h USING(organization_id,guild_id) WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND h.domain=${domain} AND r.id=h.revision_id`.execute(tx)).rows[0]??null;}
 async preview(s:Scope,id:string){const next=await this.get(s,id);this.validate(next.domain,next.definition);return {before:await this.current(s,next.domain),after:next,confirmationHash:next.hash};}
 async publish(s:Scope,actor:Actor,id:string,expectedHead:string|null,confirmationHash:string){
  return this.db.transaction().execute(async tx=>{
   await this.authorize(tx,s,actor);const next=await this.get(s,id,tx);
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.guildId+':config:'+next.domain},0))`.execute(tx);
   assert(next.state==='draft','REVISION_ALREADY_PUBLISHED');assert(next.hash===confirmationHash,'PREVIEW_REQUIRED');this.validate(next.domain,next.definition);
   const old=await this.current(s,next.domain,tx);assert((old?.id??null)===expectedHead,'REVISION_CONFLICT',409);
   const entitlements=new EntitlementService(tx);
   if(next.domain==='activation')assert(await entitlements.canDefineActivation(s,next.definition),'ENTITLEMENT_REQUIRED',403);
   if(next.domain==='intervention')assert(await entitlements.can(s,'interventions'),'ENTITLEMENT_REQUIRED',403);
   if(next.domain==='experiment')assert(await entitlements.can(s,'experiments'),'ENTITLEMENT_REQUIRED',403);
   await sql`UPDATE guild_config_revisions SET state='published',published_at=now() WHERE ${tenant(s)} AND id=${id}::uuid AND state='draft'`.execute(tx);
   await sql`INSERT INTO guild_config_heads VALUES(${s.organizationId}::uuid,${s.guildId},${next.domain},${id}::uuid) ON CONFLICT(organization_id,guild_id,domain) DO UPDATE SET revision_id=EXCLUDED.revision_id`.execute(tx);
   if(next.domain==='onboarding'||next.domain==='privacy'){
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.organizationId+':'+s.guildId},0))`.execute(tx);
    const current=await new SettingsService(this.db).get(s,tx);const {revision,...settings}=current;
    const updated=settingsSchema.parse({...settings,...next.definition as object});
    await sql`INSERT INTO guild_settings VALUES(${s.organizationId}::uuid,${s.guildId},${revision+1},${json(updated)}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET revision=EXCLUDED.revision,settings=EXCLUDED.settings`.execute(tx);
   }
   await audit(tx,s,actor,'config.published',{id:old?.id??null},{id,domain:next.domain,hash:next.hash});return {...next,state:'published' as const};
  });
 }
 async rollback(s:Scope,actor:Actor,id:string){const previous=await this.get(s,id);assert(previous.state==='published','PUBLISHED_REVISION_REQUIRED');return this.draft(s,actor,previous.domain,previous.definition);}
}
