import {sql,tenant,type Tx} from '../../db/src/index.js';
import type {Scope} from '../../shared/src/index.js';
export const features=['fallback_onboarding','hybrid_onboarding','custom_activation','connection_metrics','advanced_cohorts','diagnosis','interventions','automation_auto','experiments','ai_explanation','webhooks','api','multi_guild','rbac','audit_export'] as const;
export type Feature=typeof features[number];
export type Plan='FREE'|'STARTER'|'GROWTH'|'SCALE'|'ENTERPRISE';
const free:Feature[]=['fallback_onboarding','hybrid_onboarding'];
const starter:Feature[]=[...free,'custom_activation','connection_metrics','diagnosis'];
const growth:Feature[]=[...starter,'advanced_cohorts','interventions','automation_auto','experiments','ai_explanation','webhooks'];
export const planRegistry:Record<Plan,{price:number|null,included:number|null,guilds:number,features:readonly Feature[]}>={FREE:{price:0,included:250,guilds:1,features:free},STARTER:{price:15,included:1000,guilds:1,features:starter},GROWTH:{price:49,included:5000,guilds:1,features:growth},SCALE:{price:149,included:25000,guilds:5,features},ENTERPRISE:{price:null,included:null,guilds:100,features}};
export class EntitlementService {
 constructor(private readonly db:Tx){}
 async plan(s:Scope):Promise<Plan>{return (await sql<{plan_key:Plan}>`SELECT plan_key FROM guild_subscriptions WHERE ${tenant(s)} AND status='active' AND (valid_until IS NULL OR valid_until>now())`.execute(this.db)).rows[0]?.plan_key??'FREE';}
 async can(s:Scope,feature:Feature){return planRegistry[await this.plan(s)].features.includes(feature);}
 async canDefineActivation(s:Scope,definition:unknown){
  if(await this.can(s,'custom_activation'))return true;
  const d=definition as {windowSeconds?:unknown,rule?:{op?:unknown,event?:unknown,withinSeconds?:unknown}};
  if(d?.windowSeconds!==604800||d.rule?.op!=='event'||d.rule.event!=='message.sent'||d.rule.withinSeconds!==604800)return false;
  return !(await sql`SELECT id FROM guild_config_revisions WHERE ${tenant(s)} AND domain='activation' AND state='published'`.execute(this.db)).rows.length;
 }
 async usage(s:Scope,now=new Date()){
  const month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)),end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
  const used=(await sql<{n:number}>`SELECT count(*)::integer AS n FROM usage_counters WHERE ${tenant(s)} AND month=${month.toISOString().slice(0,10)}::date`.execute(this.db)).rows[0]!.n;
  const plan=await this.plan(s),included=planRegistry[plan].included;
  return {plan,used,included,softLimit:included===null?null:Math.ceil(included*1.2),projected:Math.ceil(used*(end.getTime()-month.getTime())/Math.max(86400000,now.getTime()-month.getTime())),automaticOverageCharge:false};
 }
}
export async function recordUsage(tx:Tx,s:Scope,memberHash:string,at:Date){
 const month=new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),1)).toISOString().slice(0,10);
 await sql`INSERT INTO usage_counters VALUES(${s.organizationId}::uuid,${s.guildId},${month}::date,${memberHash},${at}) ON CONFLICT DO NOTHING`.execute(tx);
}
export type Subscription={plan:Plan,status:'active'|'canceled'|'past_due',validUntil:string|null};
export interface BillingProvider {readonly name:string;createCheckout(s:Scope,plan:Plan):Promise<{url:string}>;getSubscription(s:Scope):Promise<Subscription|null>;cancelSubscription(s:Scope):Promise<void>;verifyEntitlement(s:Scope):Promise<Subscription|null>}
// Checkout is P1. An unconfigured adapter fails closed rather than inventing payment success.
export class UnconfiguredBillingProvider implements BillingProvider {
 constructor(readonly name:'stripe'|'discord-premium-apps'){}
 async createCheckout(_s:Scope,_plan:Plan):Promise<{url:string}>{throw new Error('BILLING_PROVIDER_NOT_CONFIGURED');}
 async getSubscription(_s:Scope):Promise<Subscription|null>{throw new Error('BILLING_PROVIDER_NOT_CONFIGURED');}
 async cancelSubscription(_s:Scope):Promise<void>{throw new Error('BILLING_PROVIDER_NOT_CONFIGURED');}
 async verifyEntitlement(_s:Scope):Promise<Subscription|null>{throw new Error('BILLING_PROVIDER_NOT_CONFIGURED');}
}
