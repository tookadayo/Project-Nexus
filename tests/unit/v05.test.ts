vi.mock("server-only",()=>({}));
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../../apps/web/app/auth/server-access',()=>({manageableConnection:vi.fn(async(id:string)=>['111111111111111111','222222222222222222'].includes(id)?{state:'VERIFIED',version:'2026-09-30T00:00:00.000Z',name:'Server'}:null)}));
import {readFileSync} from 'node:fs';
import {NextRequest} from '../../apps/web/node_modules/next/server.js';
import {authorizedGuilds,dashboardContext,openSession,sealSession,validOAuthState} from '../../apps/web/app/auth/session';
import {GET as selectGuild} from '../../apps/web/app/auth/select/route';
import {GET as oauthLogin} from '../../apps/web/app/auth/login/route';
import {GET as oauthCallback} from '../../apps/web/app/auth/callback/route';
import {POST as webControl} from '../../apps/web/app/control/route';
import {previousCompleteWeek} from '../../apps/worker/src/weekly.js';
import {settingsSchema} from '../../packages/settings/src/index.js';
import {actionTemplates} from '../../packages/presentation/src/templates.js';
import {planRegistry} from '../../packages/settings/src/billing/index.js';
import {toOpportunity} from '../../packages/presentation/src/adapters.js';
import {en} from '../../packages/discord-panels/src/i18n/en.js';
import {ja} from '../../packages/discord-panels/src/i18n/ja.js';
import {webEn,webJa,messages,opportunityNames,evidenceNames} from '../../packages/discord-panels/src/i18n/web.js';

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('starts measurement by default while leaving improvements and weekly messages off',()=>{
 const settings=settingsSchema.parse({});
 expect(settings.enabled).toBe(true);
 expect(settings.flags.activation_dsl_v2).toBe(true);
 expect(settings.flags.interventions_v2).toBe(true);
 expect(settings.onboardingEnabled).toBe(false);
 expect(settings.weeklySummaryEnabled).toBe(false);
 expect(settings.dmEnabled).toBe(false);
 expect(settings.analysisScope).toEqual({mode:'all',channelIds:[]});
 expect(settings.memberStages).toMatchObject({newDays:14,startingDays:30,recentDays:30,activeDays:2,repeatDays:2,retainedFromDay:7,retainedThroughDay:14});
 expect(planRegistry.FREE.features).toContain('interventions');
 expect(planRegistry.FREE.features).not.toContain('automation_auto');
});
it('keeps DM follow-up out of the normal improvement menu',()=>{
 const normal=actionTemplates.filter(template=>template.key!=='inactive_follow_up').map(template=>template.key);
 expect(normal).toEqual(['reply_rescue','welcome_helper','channel_recommendation','event_recommendation']);
 expect(toOpportunity({type:'RETENTION_DROP',severity:'warning',cohort:'New members',facts:{metric:'d7_active_retention'},comparison:{current:.2,baseline:.4},sampleSize:40,confidenceLabel:'observational',causality:'not_established'},0,{}).suggestedAction).toBe('channel_recommendation');
});
it('checks OAuth state, authenticates encrypted sessions, and rejects tampering',()=>{
 vi.stubEnv('NEXUS_SESSION_SECRET','a'.repeat(64));
 expect(validOAuthState('state123','state123')).toBe(true);
 expect(validOAuthState('state123','state124')).toBe(false);
 const value=sealSession({accessToken:'access',userId:'12345678901234567',expiresAt:Date.now()+10000});
 expect(openSession(value)?.userId).toBe('12345678901234567');
 const tampered=Buffer.from(value,'base64url');tampered[12]=tampered[12]!^1;
 expect(openSession(tampered.toString('base64url'))).toBeNull();
});
it('authorizes only guilds with administrative permissions on each request',async()=>{
 vi.stubEnv('NEXUS_WEB_AUTH_MODE','oauth');vi.stubEnv('NEXUS_SESSION_SECRET','a'.repeat(64));vi.stubEnv('API_KEY','b'.repeat(64));vi.stubEnv('DISCORD_TOKEN','bot-test');vi.stubEnv('DISCORD_APPLICATION_ID','123456789012345678');
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>({ok:true,json:async()=>String(_url).endsWith('/users/@me')?{id:'444444444444444444'}:init?.headers&&JSON.stringify(init.headers).includes('Bot ')?[
  {id:'111111111111111111'},{id:'222222222222222222'}]:[
  {id:'111111111111111111',name:'Admin',permissions:'32'},
  {id:'222222222222222222',name:'Owner',permissions:'0',owner:true},
  {id:'555555555555555555',name:'Uninstalled',permissions:'32'},
  {id:'333333333333333333',name:'Member',permissions:'0'}
 ]})));
 const guilds=await authorizedGuilds('access','444444444444444444');expect(guilds.map(guild=>guild.id)).toEqual(['111111111111111111','222222222222222222','555555555555555555']);expect(guilds[2]?.installed).toBe(false);expect(guilds[2]?.installUrl).toContain('guild_id=555555555555555555');
 const session=sealSession({accessToken:'access',userId:'444444444444444444',expiresAt:Date.now()+10000});
 const selected=await dashboardContext(session,'222222222222222222');expect(selected?.guildId).toBe('222222222222222222');
 const allowed=await selectGuild(new NextRequest('http://localhost:3100/auth/select?guild=222222222222222222',{headers:{cookie:`nexus_session=${session}`}}));expect(allowed.headers.get('location')).toContain('/dashboard/222222222222222222');
 const unauthorized=await dashboardContext(session,'333333333333333333');expect(unauthorized).toBeNull();
 const response=await selectGuild(new NextRequest('http://localhost:3100/auth/select?guild=333333333333333333',{headers:{cookie:`nexus_session=${session}`}}));expect(response.status).toBe(307);expect(response.headers.get('location')).toContain('/servers');
 const uninstalled=await selectGuild(new NextRequest('http://localhost:3100/auth/select?guild=555555555555555555',{headers:{cookie:`nexus_session=${session}`}}));expect(uninstalled.status).toBe(307);expect(uninstalled.headers.get('location')).toContain('/servers');
});
it('keeps OAuth return paths inside a validated guild dashboard route',async()=>{
 vi.stubEnv('NEXUS_WEB_AUTH_MODE','oauth');vi.stubEnv('NEXUS_WEB_URL','https://nexus.example');vi.stubEnv('NEXUS_SESSION_SECRET','a'.repeat(64));vi.stubEnv('DISCORD_APPLICATION_ID','123456789012345678');vi.stubEnv('DISCORD_CLIENT_SECRET','test-secret');
 const valid=await oauthLogin(new NextRequest('https://nexus.example/auth/login?next=/dashboard/222222222222222222'));
 expect(valid.cookies.get('nexus_oauth_next')?.value).toBe('/dashboard/222222222222222222');
 const invalid=await oauthLogin(new NextRequest('https://nexus.example/auth/login?next=https://outside.example'));
 expect(invalid.cookies.get('nexus_oauth_next')?.value).not.toBe('https://outside.example');
});
it('returns a clear re-login response for an expired OAuth session',async()=>{
 vi.stubEnv('NEXUS_WEB_AUTH_MODE','oauth');vi.stubEnv('NEXUS_SESSION_SECRET','a'.repeat(64));vi.stubEnv('NEXUS_WEB_URL','http://localhost:3100');
 const expired=sealSession({accessToken:'access',userId:'111111111111111111',expiresAt:Date.now()-1000});
 const response=await webControl(new NextRequest('http://localhost:3100/control',{method:'POST',headers:{origin:'http://localhost:3100',host:'localhost:3100','sec-fetch-site':'same-origin',cookie:`nexus_session=${expired}`},body:'{}'}));
 expect(response.status).toBe(401);expect((await response.json()).error).toBe('SESSION_EXPIRED');
});
it('accepts a matching OAuth code exchange with identify and guilds scopes',async()=>{
 vi.stubEnv('NEXUS_WEB_URL','http://localhost:3100');vi.stubEnv('DISCORD_APPLICATION_ID','123456789012345678');vi.stubEnv('DISCORD_CLIENT_SECRET','secret');vi.stubEnv('NEXUS_SESSION_SECRET','a'.repeat(64));
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({access_token:'access',expires_in:3600,scope:'identify guilds'})}).mockResolvedValueOnce({ok:true,json:async()=>({id:'444444444444444444'})});vi.stubGlobal('fetch',fetcher);
 const response=await oauthCallback(new NextRequest('http://localhost:3100/auth/callback?state=matching&code=grant',{headers:{cookie:'nexus_oauth_state=matching'}}));
 expect(response.status).toBe(307);expect(openSession(response.cookies.get('nexus_session')?.value)?.userId).toBe('444444444444444444');expect(response.cookies.get('nexus_session')?.httpOnly).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2);
 const rejected=await oauthCallback(new NextRequest('http://localhost:3100/auth/callback?state=other&code=grant',{headers:{cookie:'nexus_oauth_state=matching'}}));expect(rejected.status).toBe(307);expect(rejected.headers.get('location')).toContain('/auth/problem');expect(fetcher).toHaveBeenCalledTimes(2);
});
it('uses the last complete UTC week for the optional summary',()=>{
 const week=previousCompleteWeek(new Date('2026-09-24T09:00:00.000Z'));
 expect(week.from.toISOString()).toBe('2026-09-14T00:00:00.000Z');
 expect(week.to.toISOString()).toBe('2026-09-21T00:00:00.000Z');
});
it('uses server local week boundaries across a time-zone offset',()=>{
 const week=previousCompleteWeek(new Date('2026-09-24T09:00:00.000Z'),'Asia/Tokyo');
 expect(week.from.toISOString()).toBe('2026-09-13T15:00:00.000Z');
 expect(week.to.toISOString()).toBe('2026-09-20T15:00:00.000Z');
});
it('keeps local week boundaries across daylight saving changes',()=>{
 const week=previousCompleteWeek(new Date('2026-03-16T15:00:00.000Z'),'America/New_York');
 expect(week.from.toISOString()).toBe('2026-03-09T04:00:00.000Z');
 expect(week.to.toISOString()).toBe('2026-03-16T04:00:00.000Z');
 const prior=previousCompleteWeek(week.from,'America/New_York');
 expect(prior.from.toISOString()).toBe('2026-03-02T05:00:00.000Z');
});
it('keeps forbidden product jargon out of Discord panel translations',()=>{
 const forbidden=/\b(?:Activation|Retention|Cohorts?|Baseline|Lifecycle|Journey|Interventions?|Treatment|Signals?|Native|Fallback|Hybrid|D1|D7|D30|Experiments?|ITT|DSL|Randomization|Guardrails?|Revisions?|Membership Episodes?|Maturity|Eligibility|Posterior|Credible Interval|Deterministic threshold)\b|アクティベーション|コホート|ランダム化|ガードレール|割付|リビジョン|成熟|実験|施策/i;
 for(const dictionary of [en,ja,messages.en,messages.ja,opportunityNames.en,opportunityNames.ja,evidenceNames.en,evidenceNames.ja])for(const value of Object.values(dictionary))expect(value.replace(/\{[^}]+\}/g,'')).not.toMatch(forbidden);
});
it('provides explicit Japanese text for every shared UI key',()=>{
 const source=readFileSync('packages/discord-panels/src/i18n/ja.ts','utf8');
 const explicit=new Set([...source.matchAll(/["']([^"']+)["']:/g)].map(match=>match[1]));
 expect(Object.keys(en).filter(key=>!explicit.has(key)&&!Object.hasOwn(webJa,key))).toEqual([]);
 expect(Object.keys(webEn).sort()).toEqual(Object.keys(webJa).sort());
 for(const key of Object.keys(webEn) as Array<keyof typeof webEn>){
  const placeholders=(value:string)=>[...value.matchAll(/\{([a-zA-Z]+)\}/g)].map(match=>match[1]).sort();
  expect(placeholders(webJa[key]),key).toEqual(placeholders(webEn[key]));
 }
 expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.ja).sort());
 expect(Object.keys(opportunityNames.en).sort()).toEqual(Object.keys(opportunityNames.ja).sort());
});
