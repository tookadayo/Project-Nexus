import {afterEach,expect,it,vi} from 'vitest';
import {NextRequest} from '../../apps/web/node_modules/next/server.js';
import {authorizedGuilds,dashboardContext,openSession,sealSession,validOAuthState} from '../../apps/web/app/auth/session';
import {GET as selectGuild} from '../../apps/web/app/auth/select/route';
import {GET as oauthCallback} from '../../apps/web/app/auth/callback/route';
import {previousCompleteWeek} from '../../apps/worker/src/weekly.js';
import {settingsSchema} from '../../packages/settings/src/index.js';
import {actionTemplates} from '../../packages/presentation/src/templates.js';
import {planRegistry} from '../../packages/settings/src/entitlements.js';
import {toOpportunity} from '../../packages/presentation/src/adapters.js';
import {en} from '../../packages/discord-panels/src/i18n/en.js';
import {ja} from '../../packages/discord-panels/src/i18n/ja.js';

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('starts measurement by default while leaving improvements and weekly messages off',()=>{
 const settings=settingsSchema.parse({});
 expect(settings.enabled).toBe(true);
 expect(settings.flags.activation_dsl_v2).toBe(true);
 expect(settings.flags.interventions_v2).toBe(true);
 expect(settings.onboardingEnabled).toBe(false);
 expect(settings.weeklySummaryEnabled).toBe(false);
 expect(settings.dmEnabled).toBe(false);
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
 expect(openSession(value.slice(0,-2)+'xx')).toBeNull();
});
it('authorizes only guilds with administrative permissions on each request',async()=>{
 vi.stubEnv('NEXUS_WEB_AUTH_MODE','oauth');vi.stubEnv('NEXUS_SESSION_SECRET','a'.repeat(64));vi.stubEnv('API_KEY','b'.repeat(64));
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>[
  {id:'111111111111111111',name:'Admin',permissions:'32'},
  {id:'222222222222222222',name:'Owner',permissions:'0',owner:true},
  {id:'333333333333333333',name:'Member',permissions:'0'}
 ]}));
 const guilds=await authorizedGuilds('access');expect(guilds.map(guild=>guild.id)).toEqual(['111111111111111111','222222222222222222']);
 const session=sealSession({accessToken:'access',userId:'444444444444444444',expiresAt:Date.now()+10000});
 const selected=await dashboardContext(session,'222222222222222222');expect(selected?.guildId).toBe('222222222222222222');
 const unauthorized=await dashboardContext(session,'333333333333333333');expect(unauthorized?.guildId).toBe('111111111111111111');
 const response=await selectGuild(new NextRequest('http://localhost:3100/auth/select?guild=333333333333333333',{headers:{cookie:`nexus_session=${session}`}}));expect(response.status).toBe(403);
});
it('accepts a matching OAuth code exchange with identify and guilds scopes',async()=>{
 vi.stubEnv('NEXUS_WEB_URL','http://localhost:3100');vi.stubEnv('DISCORD_APPLICATION_ID','123456789012345678');vi.stubEnv('DISCORD_CLIENT_SECRET','secret');vi.stubEnv('NEXUS_SESSION_SECRET','a'.repeat(64));
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({access_token:'access',expires_in:3600,scope:'identify guilds'})}).mockResolvedValueOnce({ok:true,json:async()=>({id:'444444444444444444'})});vi.stubGlobal('fetch',fetcher);
 const response=await oauthCallback(new NextRequest('http://localhost:3100/auth/callback?state=matching&code=grant',{headers:{cookie:'nexus_oauth_state=matching'}}));
 expect(response.status).toBe(307);expect(openSession(response.cookies.get('nexus_session')?.value)?.userId).toBe('444444444444444444');expect(response.cookies.get('nexus_session')?.httpOnly).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2);
 const rejected=await oauthCallback(new NextRequest('http://localhost:3100/auth/callback?state=other&code=grant',{headers:{cookie:'nexus_oauth_state=matching'}}));expect(rejected.status).toBe(403);expect(fetcher).toHaveBeenCalledTimes(2);
});
it('uses the last complete UTC week for the optional summary',()=>{
 const week=previousCompleteWeek(new Date('2026-09-24T09:00:00.000Z'));
 expect(week.from.toISOString()).toBe('2026-09-14T00:00:00.000Z');
 expect(week.to.toISOString()).toBe('2026-09-21T00:00:00.000Z');
});
it('keeps forbidden product jargon out of Discord panel translations',()=>{
 const forbidden=/\b(?:Activation|Cohorts?|Interventions?|Experiments?|ITT|DSL|Randomization|Guardrails?|Revisions?|Membership Episodes?|Maturity|Eligibility|Posterior|Credible Interval|Deterministic threshold)\b|アクティベーション|コホート|ランダム化|ガードレール|割付|リビジョン|成熟|実験|施策/i;
 for(const dictionary of [en,ja])for(const value of Object.values(dictionary))expect(value.replace(/\{[^}]+\}/g,'')).not.toMatch(forbidden);
});
