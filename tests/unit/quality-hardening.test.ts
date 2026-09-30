import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {DomainError} from '../../packages/shared/src/index';
import {DiscordFailure} from '../../packages/discord/src/rest';
import {errorCategory,userFailure} from '../../packages/shared/src/errors';
import {redactSecrets} from '../../packages/shared/src/diagnostics';
import {errorPanel} from '../../packages/discord-panels/src/views/errors';
import {ja,en} from '../../packages/discord-panels/src/i18n/index';
import {weeklyMeasurements} from '../../packages/presentation/src/measurement';
it('classifies known facts and gives opaque failures a safe reference',()=>{
 const cases:[unknown,string][]=[
  [new DomainError('ADMIN_REQUIRED'),'PERMISSION'],[new DomainError('CHANNEL_PERMISSION_MISSING'),'CHANNEL_PERMISSION'],[new DomainError('REVISION_CONFLICT'),'REVISION_CONFLICT'],[new DomainError('COMPONENT_EXPIRED'),'COMPONENT_EXPIRED'],
  [new DiscordFailure(0,0,{kind:'timeout'}),'DISCORD_TIMEOUT'],[new DiscordFailure(429),'DISCORD_RATE_LIMIT'],[new DiscordFailure(503),'DISCORD_UNAVAILABLE'],[Object.assign(new Error('read failed'),{code:'57P01'}),'DATABASE_FAILURE'],
  [new SyntaxError('invalid'),'VALIDATION'],[new DomainError('ENTITLEMENT_REQUIRED'),'ENTITLEMENT'],[new DomainError('WEB_CONNECTION_UNAVAILABLE'),'WEB_CONNECTION'],[new DomainError('SESSION_EXPIRED'),'AUTH_SESSION'],[new DomainError('VERIFICATION_INVALID'),'VERIFICATION'],[new DomainError('UNKNOWN_ACTION'),'INTERNAL'],
 ];for(const [error,category] of cases)expect(errorCategory(error)).toBe(category);
 const log=vi.spyOn(process.stderr,'write').mockReturnValue(true);try{expect(userFailure(new DomainError('UNKNOWN_ACTION'))).toMatchObject({category:'INTERNAL',reference:expect.stringMatching(/^NXS-[A-F0-9]{12}$/),effect:'UNKNOWN'});}finally{log.mockRestore();}
});
it('returns to the originating page and never repeats an uncertain save',async()=>{
 const intents:Record<string,unknown>[]=[];
 const panel=await errorPanel(async intent=>{intents.push(intent);return 'opaque';},{category:'DATABASE_FAILURE',effect:'UNKNOWN',reference:'NXS-123456ABCDEF'},'ja',undefined,undefined,{page:'analysis'});
 const text=JSON.stringify(panel);expect(text).toContain('分析に戻る');expect(text).not.toContain('再試行');expect(text).not.toContain('変更は行われていません');expect(text).not.toContain('考えられる原因');expect(intents).toContainEqual({action:'controlNavigate',page:'analysis'});
 const expired:Record<string,unknown>[]=[];await errorPanel(async intent=>{expired.push(intent);return 'opaque';},{category:'COMPONENT_EXPIRED',effect:'NOT_STARTED'},'en',undefined,undefined,{page:'settings'});expect(expired.filter(intent=>intent.action==='panel')).toHaveLength(2);
});
it('keeps copy ordinary in both dictionaries and legacy panels',()=>{
 const banned=/普段から参加|最近の活動なし|イベントに参加する|誰かから直接返信を受ける|最初の成功|\b(?:Signal|Cohort|Eligibility|Maturity|Intervention|Retention|Experiment|Activation)\b/i;
 for(const [key,value] of Object.entries(ja))expect(value,key).not.toMatch(banned);
 for(const [key,value] of Object.entries(en))expect(value,key).not.toMatch(/\b(?:Signal|Cohort|Eligibility|Maturity|Intervention|Retention|Experiment|Activation)\b/i);
 for(const file of ['root','setup','activation','control'])expect(readFileSync(`packages/discord-panels/src/views/${file}.ts`,'utf8')).not.toMatch(/普段から参加|最近の活動なし|イベントに参加する|誰かから直接返信を受ける|最初の成功/);
});
it('reports reply responders and all completed eligible members independently',()=>{
 const now=new Date('2026-09-30T00:00:00Z'),members=Array.from({length:8},(_,index)=>({joinedAt:new Date('2026-09-25T00:00:00Z'),firstReplyMinutes:index<5?18:null,connected:index<5,retained:false}));
 const measured=weeklyMeasurements(members,now,14,30,()=>true).reply;expect(measured).toMatchObject({value:18,sample:5,eligible:8,responded:5});
 const zero=weeklyMeasurements(members.map(member=>({...member,firstReplyMinutes:0})),now,14,30,()=>true).reply;expect(zero).toMatchObject({state:'ZERO',value:0,eligible:8,responded:8});
 expect(weeklyMeasurements(members,now,14,30,()=>false).reply.state).toBe('UNAVAILABLE');
 expect(weeklyMeasurements([],now,14,30,()=>true).reply.state).toBe('NO_ELIGIBLE_MEMBERS');
 expect(weeklyMeasurements(members.map(member=>({...member,joinedAt:now})),now,14,30,()=>true).reply.state).toBe('COLLECTING');
 expect(weeklyMeasurements(members.slice(0,3),now,14,30,()=>true).reply).toMatchObject({state:'INSUFFICIENT_SAMPLE',needed:2});
 expect(redactSecrets('code NX-2222-3333-4444')).toBe('code [REDACTED]');
});
