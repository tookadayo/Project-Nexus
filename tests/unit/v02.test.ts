import {expect,it} from 'vitest';
import fc from 'fast-check';
import {chooseMode,capabilityProfile} from '../../packages/lifecycle/src/capabilities.js';
import {observedFlags} from '../../packages/lifecycle/src/native.js';
import {normalize,eventSchema} from '../../packages/events/src/index.js';
import {validateSignal} from '../../packages/events/src/registry.js';
import {IdentityVault} from '../../packages/identity/src/index.js';
import {activationSchema,evaluateCondition,type Evidence} from '../../packages/lifecycle/src/activation.js';
import {canonicalMetrics,inputCoverage} from '../../packages/analytics/src/registry.js';
import {interventionSchema,interventionEligible} from '../../packages/lifecycle/src/interventions.js';
import {assignVariant,analyzeBinary,analyzeTimeBlocks} from '../../packages/lifecycle/src/experiments.js';
import {planRegistry,UnconfiguredBillingProvider} from '../../packages/settings/src/entitlements.js';
import {configHash} from '../../packages/settings/src/revisions.js';
import {validateFlow,initialFlowState,answerFlow,selectedOptions} from '../../packages/onboarding/src/flow.js';
import {gatewayIntents} from '../../apps/gateway/src/index.js';
import {GatewayIntentBits} from 'discord.js';
const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32));
const s={organizationId:'00000000-0000-4000-8000-000000000001',guildId:'111111111111111111'};
const evidence:Evidence={joinedAt:0,asOf:1000,facts:[],roles:[]};
it.each([['auto',true,'native'],['auto',false,'fallback'],['fallback',true,'fallback'],['hybrid',true,'hybrid'],['native',false,'native']] as const)('chooses %s against native=%s', (mode,available,expected)=>expect(chooseMode(mode,available)).toBe(expected));
it('does not infer Server Guide or granted intents from native configuration',()=>{
 const p=capabilityProfile(s.guildId,{features:['COMMUNITY'],onboarding:null,onboardingStatus:'unavailable',bot:{roles:[],permissions:'0',bot:true,joinedAt:new Date().toISOString()},roles:[]},'auto',{members:null,messages:null,reactions:null,voice:null,scheduledEvents:null});
 expect(p.recommendedMode).toBe('fallback');expect(p.serverGuideSignalsAvailable).toBeNull();expect(p.intents.members).toBeNull();expect(p.manageRoles).toBe(false);
});
it('projects only documented flags and does not use Gateway update flags',()=>{
 expect(observedFlags(2n|8n|32n|64n)).toHaveLength(4);
 const e=normalize({t:'GUILD_MEMBER_UPDATE',s:1,d:{guild_id:s.guildId,user:{id:'222222222222222222'},roles:[],flags:106}},0,'flags',vault);
 expect(e?.kind).toBe('member.roles_updated');expect(e).not.toHaveProperty('flags');
});
it.each(['content','attachments','embeds','stickers','poll'])('rejects %s at both durable envelope and signal boundary',field=>{
 const base={...s,shardId:0,gatewaySessionId:'privacy',sequence:1,kind:'message.sent',at:new Date().toISOString(),context:'PRODUCTION'};
 expect(eventSchema.safeParse({...base,[field]:'secret'}).success).toBe(false);
 expect(()=>validateSignal('message.sent',{messageId:'222222222222222222',channelId:'333333333333333333',messageType:0,[field]:'secret'})).toThrow();
});
it('excludes content and presence privileged intents',()=>{expect(gatewayIntents).not.toContain(GatewayIntentBits.MessageContent);expect(gatewayIntents).not.toContain(GatewayIntentBits.GuildPresences);});
it('normalizes scheduled subscriptions without content or raw user ids',()=>{
 const e=normalize({t:'GUILD_SCHEDULED_EVENT_USER_ADD',s:1,d:{guild_id:s.guildId,user_id:'222222222222222222',guild_scheduled_event_id:'333333333333333333',content:'secret'}},0,'event',vault)!;
 expect(e.kind).toBe('scheduled_event.subscribed');expect(JSON.stringify(e)).not.toContain('secret');expect(JSON.stringify(e)).not.toContain('222222222222222222');
});
it('does not treat immature absence or unavailable signals as false',()=>{
 expect(activationSchema.safeParse({name:'Circular',windowSeconds:60,rule:{op:'activation_state',activated:false}}).success).toBe(false);
 expect(evaluateCondition({op:'not',rule:{op:'role_present',roleId:'333333333333333333'}},evidence)).toBe('unknown');
 const rule={op:'event',event:'reply.received',withinSeconds:60} as const;
 expect(evaluateCondition(rule,evidence)).toBe('unknown');expect(evaluateCondition({op:'not',rule},evidence)).toBe('unknown');
 expect(evaluateCondition({op:'not',rule},{...evidence,asOf:61000})).toBe(true);
 expect(evaluateCondition(rule,{...evidence,asOf:61000,unavailable:['reply.received']})).toBe('unknown');
});
it('evaluates typed all/any/count/duration/role/channel/answer conditions',()=>{
 const e:Evidence={...evidence,roles:['333333333333333333'],facts:[{kind:'message.sent',at:500,data:{channelId:'333333333333333333'}},{kind:'voice.duration',at:600,data:{seconds:300}},{kind:'fallback.answer',at:700,data:{nodeId:'goal',optionId:'play'}}]};
 expect(evaluateCondition({op:'all',rules:[{op:'duration',event:'voice.duration',gteSeconds:300,withinSeconds:60},{op:'role_present',roleId:'333333333333333333'},{op:'flow_answer',nodeId:'goal',optionId:'play',withinSeconds:60},{op:'channel_activity',channelId:'333333333333333333',gte:1,withinSeconds:60}]},e)).toBe(true);
 expect(activationSchema.safeParse({name:'Unsafe',windowSeconds:60,rule:{op:'sql',query:'DROP'}}).success).toBe(false);
});
it('versioned metrics censor immature members and keep unavailable separate from zero',()=>{
 const members=[{id:'old',joinedAt:0,context:'PRODUCTION'},{id:'new',joinedAt:10*86400000,context:'PRODUCTION'}];
 const inputs=Object.fromEntries(['members','messages','activity','activation','native'].map(k=>[k,inputCoverage(k,100,100)]));
 const metrics=canonicalMetrics(members,[{episodeId:'old',kind:'activation.completed',at:60000,context:'PRODUCTION',data:{}}],0,11*86400000,11*86400000,inputs);
 expect(metrics.d7_active_retention).toMatchObject({sampleSize:1,denominator:1,value:0,provisional:true});expect(metrics.ttfv_p90.value).toBe(60);
 expect(canonicalMetrics(members,[],0,11*86400000,11*86400000,{}).new_members.value).toBeNull();
});
const intervention={name:'Helper',trigger:'member.joined',delaySeconds:0,conditions:[],actions:[{type:'staff_alert',channelId:'333333333333333333',text:'A newcomer may need help.'}],cooldownSeconds:86400,safetyMode:'suggest',frequencyCaps:{dmPerDay:1,contactsPerWeek:3}};
it('validates hard caps independently of admin configuration',()=>{
 expect(interventionSchema.parse(intervention).safetyMode).toBe('suggest');
 expect(interventionSchema.safeParse({...intervention,frequencyCaps:{dmPerDay:100,contactsPerWeek:100}}).success).toBe(false);
 expect(interventionSchema.safeParse({...intervention,actions:[{type:'staff_alert',channelId:'333333333333333333',text:'@everyone ping'}]}).success).toBe(false);
 const e={...evidence,facts:[{kind:'member.joined',at:0,data:{}}]};
 expect(interventionEligible(interventionSchema.parse(intervention),e,'bot')).toBe(false);expect(interventionEligible(interventionSchema.parse(intervention),e,'nexus')).toBe(false);
});
it('assignments are deterministic under arbitrary replay ordering',()=>{
 const variants=[{key:'control',weight:50,interventionRevisionId:null},{key:'treatment',weight:50,interventionRevisionId:null}] as const;
 fc.assert(fc.property(fc.string(),unit=>{expect(assignVariant('experiment',unit,[...variants])).toBe(assignVariant('experiment',unit,[...variants]));}));
});
it('withholds unsupported evidence and prioritizes guardrails',()=>{
 expect(analyzeBinary({n:10,success:0},{n:10,success:10}).evidenceStatus).toBe('INSUFFICIENT_DATA');
 expect(analyzeBinary({n:100,success:10},{n:100,success:90}).evidenceStatus).toBe('SUPPORTED');
 expect(analyzeBinary({n:100,success:10},{n:100,success:90},20,true).evidenceStatus).toBe('GUARDRAIL_BREACH');
 expect(analyzeBinary({n:100,success:10},{n:100,success:90},20,false,false).credibleInterval).toBeNull();
});
it('uses block count rather than member count for shared-treatment evidence',()=>{
 expect(analyzeTimeBlocks([{n:1000,success:100}],[{n:1000,success:900}]).evidenceStatus).toBe('INSUFFICIENT_DATA');
 const result=analyzeTimeBlocks(Array.from({length:20},()=>({n:50,success:5})),Array.from({length:20},()=>({n:50,success:40})));
 expect(result.evidenceStatus).toBe('SUPPORTED');expect(result.controlBlocks).toBe(20);expect(result.note).toContain('spillover');
});
it('keeps pricing separate from entitlements and fails closed without payment configuration',async()=>{
 expect(planRegistry.FREE.features).toContain('fallback_onboarding');expect(planRegistry.FREE.features).not.toContain('experiments');expect(planRegistry.GROWTH.features).toContain('experiments');
 await expect(new UnconfiguredBillingProvider('stripe').createCheckout(s,'GROWTH')).rejects.toThrow('NOT_CONFIGURED');
});
it('hashes equivalent configuration independent of JSON property order',()=>{expect(configHash({a:1,b:2})).toBe(configHash({b:2,a:1}));});
it('reuses one flow engine for multiple choice, condition and automatic role action',()=>{
 const flow=validateFlow({start:'choose',nodes:[{id:'choose',type:'multi_choice',question:'Choose',options:[{id:'a',label:'A',next:'branch'},{id:'b',label:'B',next:'branch'}]},{id:'branch',type:'condition',question:'Branch',condition:{nodeId:'choose',optionId:'a'},options:[{id:'yes',label:'Yes',next:'role'},{id:'no',label:'No',next:null}]},{id:'role',type:'assign_role',question:'Grant',options:[{id:'grant',label:'Grant',roleId:'333333333333333333',next:null}]}]});
 const result=answerFlow(flow,initialFlowState(flow),'choose',['b','a']);expect(result.complete).toBe(true);expect(selectedOptions(flow,result).some(o=>o.roleId)).toBe(true);
});
