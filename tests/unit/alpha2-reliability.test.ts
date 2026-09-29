import {expect,it,vi} from 'vitest';
import {errorReference,logFailure,redactSecrets} from '../../packages/shared/src/diagnostics.js';
import {nextZonedDayStart,zonedDayStart,zonedDateKey} from '../../packages/shared/src/timezones.js';
import {controlPanel,type ControlData} from '../../packages/discord-panels/src/index.js';
import {advanceSetup,setupOrder} from '../../packages/shared/src/setup-flow.js';
import {discordDashboardLink} from '../../packages/shared/src/web-link.js';

it('logs an actionable NXS reference while redacting credentials and stack secrets',()=>{
 const reference=errorReference();expect(reference).toMatch(/^NXS-[A-F0-9]{12}$/);
 const token='bot-private-123456',oauth='oauth-private-123456',cookie='cookie-private-123456',api='api-private-123456';
 const writer=vi.spyOn(process.stderr,'write').mockImplementation(()=>true);
 const error=new Error(`Authorization: Bot ${token} OAuth token=${oauth} Cookie: ${cookie} API_KEY=${api}`);
 logFailure({reference,action:'panel',command:'panel',stage:'panel_visibility',error,secrets:[token,oauth,cookie,api]});
 const line=String(writer.mock.calls[0]?.[0]);writer.mockRestore();
 expect(line).toContain(reference);expect(line).toContain('panel_visibility');expect(line).toContain('"stack"');
 for(const secret of [token,oauth,cookie,api])expect(line).not.toContain(secret);
 expect(redactSecrets(`Authorization: Bearer ${oauth}\nCookie: ${cookie}`)).not.toContain(oauth);
});

it.each([
 ['UTC','2026-09-29T00:00:00.000Z'],
 ['Asia/Tokyo','2026-09-28T15:00:00.000Z'],
 ['America/New_York','2026-09-29T04:00:00.000Z']
])('uses %s calendar midnight for Today', (zone,expected)=>{
 const now=new Date('2026-09-29T12:00:00.000Z');expect(zonedDayStart(now,zone).toISOString()).toBe(expected);
 expect(zonedDateKey(now,zone)).toBe('2026-09-29');
});
it('handles New York daylight saving transition and invalid timezone fallback',()=>{
 expect(nextZonedDayStart(new Date('2026-03-08T06:30:00Z'),'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
 expect(zonedDayStart(new Date('2026-09-29T12:00:00Z'),'Invalid/Zone').toISOString()).toBe('2026-09-29T00:00:00.000Z');
});

it('shows one Attention item and binds actions to the displayed item',async()=>{
 const intents:Record<string,unknown>[]=[];const issue=async(data:Record<string,unknown>)=>{intents.push(data);return `opaque-${intents.length}`;};
 const attention=[1,2,3].map(i=>({channelId:`11111111111111111${i}`,messageId:`22222222222222222${i}`,status:i===2?'ACKNOWLEDGED':'OPEN',waitingMinutes:i*10,url:`https://discord.com/channels/g/${i}`}));
 const community={daily:{ready:true,attentionCount:3},attention} as unknown as ControlData['community'];
 const panel=await controlPanel(issue,'attention',{community},'en','scope',0,'none','none','overall',1);
 const displayed=JSON.stringify(panel);expect(displayed).toContain('2 / 3');expect(displayed).toContain(attention[1]!.url);expect(displayed).not.toContain(attention[0]!.url);
 for(const action of ['controlResolve','controlSnoozeMenu','controlAcknowledge'])expect(intents.find(intent=>intent.action===action)).toMatchObject({messageId:attention[1]!.messageId});
 expect(intents.filter(intent=>intent.action==='controlAttentionPage').map(intent=>intent.index)).toEqual([0,2]);
 expect(panel.components?.length).toBeLessThanOrEqual(5);
});

it('advances all four setup steps and upgrades a reviewed existing guild',()=>{
 let state={setupVersion:2,setupSteps:{scope:false,team:false,notifications:false,goals:false}};
 for(const step of setupOrder){const progress=advanceSetup(state,step);state={setupVersion:progress.setupVersion,setupSteps:progress.setupSteps};}
 expect(Object.values(state.setupSteps)).toEqual([true,true,true,true]);expect(state.setupVersion).toBe(2);
 expect(()=>advanceSetup({setupVersion:2,setupSteps:{scope:false,team:false,notifications:false,goals:false}},'goals')).toThrow('SETUP_STEP_OUT_OF_ORDER');
 const existing={setupVersion:1,setupSteps:{scope:true,team:true,notifications:true,goals:true}};
 expect(advanceSetup(existing,'goals')).toMatchObject({setupVersion:2,next:null,setupSteps:existing.setupSteps});
 expect(existing.setupVersion).toBe(1);
});
it('builds a guild-specific dashboard link without exposing local or credential URLs',()=>{
 const id='123456789012345678';
 expect(discordDashboardLink('https://nexus.example',id)).toBe(`https://nexus.example/dashboard/${id}`);
 for(const unsafe of ['http://localhost:3100','https://127.0.0.1:3100','https://user:secret@nexus.example','https://nexus.example/?token=secret','javascript:alert(1)'])expect(discordDashboardLink(unsafe,id)).toBeUndefined();
 expect(discordDashboardLink('http://localhost:3100',id,true)).toBe(`http://localhost:3100/dashboard/${id}`);
});
