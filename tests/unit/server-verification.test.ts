import {afterEach,it,expect,vi} from 'vitest';
import {NextRequest} from '../../apps/web/node_modules/next/server.js';
import {verificationCode,normalizeVerificationCode} from '../../packages/security/src/server-verification.js';
import {canOperatePanel} from '../../packages/security/src/index.js';
import {discordDashboardLink} from '../../packages/shared/src/web-link.js';
import {IdentityVault} from '../../packages/identity/src/index.js';
const mocks=vi.hoisted(()=>({redeem:vi.fn(),connection:vi.fn(),actor:vi.fn(),issue:vi.fn(),read:vi.fn(),disconnect:vi.fn(),manageable:vi.fn()}));
vi.mock('../../apps/web/app/auth/server-access',()=>({manageableConnection:mocks.manageable,serverServices:()=>({verification:{redeem:mocks.redeem,connection:mocks.connection,disconnect:mocks.disconnect},authority:{snapshot:mocks.actor,require:(snapshot:unknown)=>snapshot},tokens:{issue:mocks.issue,read:mocks.read},db:{}})}));
import {POST as redeem} from '../../apps/web/app/link/redeem/route';
import {POST as disconnect} from '../../apps/web/app/link/disconnect/route';
import {sealSession,dashboardContext,authorizedGuilds} from '../../apps/web/app/auth/session';
import {GET as login} from '../../apps/web/app/auth/login/route';
import {GET as callback} from '../../apps/web/app/auth/callback/route';
import {proxy} from '../../apps/web/proxy';
const user='811111111111111111',guild='821111111111111111';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetAllMocks();});
function session(){vi.stubEnv('NEXUS_WEB_AUTH_MODE','oauth');vi.stubEnv('NEXUS_WEB_URL','https://nexus.example');vi.stubEnv('NEXUS_SESSION_SECRET','s'.repeat(64));return sealSession({userId:user,accessToken:'oauth-identity',expiresAt:Date.now()+600000});}
function request(path:string,body:unknown,cookie?:string,origin='https://nexus.example'){return new NextRequest(`https://nexus.example${path}`,{method:'POST',headers:{origin,host:'nexus.example','sec-fetch-site':'same-origin',...(cookie?{cookie:`nexus_session=${cookie}`}:{})},body:JSON.stringify(body)});}
it('generates long random readable codes with unambiguous characters and strict normalization',()=>{
 const codes=Array.from({length:1000},verificationCode);expect(new Set(codes).size).toBe(1000);
 for(const code of codes){expect(code).toMatch(/^NX-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);expect(normalizeVerificationCode(` ${code.toLowerCase().replaceAll('-',' ')} `)).toBe(code.replaceAll('-',''));}
 for(const bad of ['NX-0000-OOOO-1111','NX-ABCD-EFGH-IJKL','code',null,{},'NX-2222-2222-2222-extra'])expect(normalizeVerificationCode(bad)).toBeNull();
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32));expect(vault.digest('verification-code:v1',codes[0]!)).not.toBe(vault.digest('verification-attempt:v1',codes[0]!));
});
it('shares owner/admin/Manage Guild/NEXUS role authority while denying helper-only roles',()=>{
 expect(canOperatePanel('8',[],[])).toBe(true);expect(canOperatePanel('32',[],[])).toBe(true);expect(canOperatePanel('0',['admin'],['admin',null])).toBe(true);expect(canOperatePanel('0',['manager'],[null,'manager'])).toBe(true);expect(canOperatePanel('0',['helper'],['manager'])).toBe(false);
});
it('requires valid OAuth sessions and rejects cross-origin writes before any redemption',async()=>{
 const cookie=session();for(const req of [request('/link/redeem',{code:'guess'}),request('/link/redeem',{code:'guess'},'tampered')])expect((await redeem(req)).status).toBe(401);
 expect((await redeem(request('/link/redeem',{code:'guess'},cookie,'https://attacker.example'))).status).toBe(403);
 const missingFetch=request('/link/redeem',{code:'guess'},cookie);missingFetch.headers.delete('sec-fetch-site');expect((await redeem(missingFetch)).status).toBe(403);
 expect(mocks.redeem).not.toHaveBeenCalled();
});
it('trusts only the encrypted session identity and returns no supplied code in its response',async()=>{
 const cookie=session(),code=verificationCode();mocks.redeem.mockResolvedValue({guildId:guild});
 const response=await redeem(request('/link/redeem',{code,userId:'forged-user',guildId:'forged-guild'},cookie));
 expect(mocks.redeem).toHaveBeenCalledExactlyOnceWith(user,code);expect(await response.text()).not.toContain(code);expect(response.headers.get('cache-control')).toBe('no-store');
});
it('keeps unknown, expired, used and revoked failures generic without echoing input',async()=>{
 const cookie=session(),code=verificationCode();mocks.redeem.mockRejectedValue(new Error(`untrusted ${code}`));
 const response=await redeem(request('/link/redeem',{code},cookie));expect(response.status).toBe(400);expect(await response.json()).toEqual({error:'VERIFICATION_INVALID'});
 const module=await import('../../apps/web/app/link/redeem/route');expect('GET' in module).toBe(false);
});
it('returns logged-out verification pages through OAuth without copying query code into the return URL',async()=>{
 session();vi.stubEnv('DISCORD_APPLICATION_ID',guild);vi.stubEnv('DISCORD_CLIENT_SECRET','test-client-secret');
 const unauth=proxy(new NextRequest('https://nexus.example/link?code=never-consumed'));expect(unauth.headers.get('location')).toBe('https://nexus.example/auth/login?next=%2Flink');
 const started=await login(new NextRequest('https://nexus.example/auth/login?next=/link'));expect(started.cookies.get('nexus_oauth_next')?.value).toBe('/link');
 const bad=await login(new NextRequest('https://nexus.example/auth/login?next=/link?code=never-consumed'));expect(bad.cookies.get('nexus_oauth_next')?.value).not.toBe('/link?code=never-consumed');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({access_token:'token',expires_in:3600,scope:'identify guilds'})}).mockResolvedValueOnce({ok:true,json:async()=>({id:user})}));
 const returned=await callback(new NextRequest('https://nexus.example/auth/callback?state=state&code=oauth-grant',{headers:{cookie:'nexus_oauth_state=state; nexus_oauth_next=/link'}}));expect(returned.headers.get('location')).toBe('https://nexus.example/link');
 const post=proxy(request('/link/redeem',{code:'secret'}));expect(post.headers.get('location')).toBeNull();
});
it('gates dashboard access on backend verification and current authority on every request',async()=>{
 const cookie=session();vi.stubEnv('API_KEY','a'.repeat(64));vi.stubEnv('DISCORD_TOKEN','bot');
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>({ok:true,json:async()=>JSON.stringify(init?.headers).includes('Bot ')?[{id:guild}]:[{id:guild,name:'Server',permissions:'0'}]})));
 mocks.manageable.mockResolvedValue({state:'INSTALLED_NOT_VERIFIED',version:null});expect(await dashboardContext(cookie,guild)).toBeNull();
 mocks.manageable.mockResolvedValue({state:'VERIFICATION_PENDING',version:null});expect(await dashboardContext(cookie,guild)).toBeNull();
 mocks.manageable.mockImplementation(async(id:string)=>id===guild?{state:'VERIFIED',version:'v1',name:'Server'}:null);expect((await dashboardContext(cookie,guild))?.guildId).toBe(guild);expect(await dashboardContext(cookie,'831111111111111111')).toBeNull();
 mocks.manageable.mockResolvedValue(null);expect(await dashboardContext(cookie,guild)).toBeNull();
 expect(mocks.manageable).toHaveBeenCalledWith(guild,user);
});
it('exposes the four real server states and includes configured managers without OAuth admin bits',async()=>{
 session();vi.stubEnv('DISCORD_TOKEN','bot');
 const ids=[guild,'841111111111111111','851111111111111111','861111111111111111'];
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>({ok:true,json:async()=>JSON.stringify(init?.headers).includes('Bot ')?ids.slice(0,3).map(id=>({id})):ids.map(id=>({id,name:id,permissions:id===ids[3]?'32':'0'}))})));
 mocks.manageable.mockImplementation(async(id:string)=>({state:id===ids[0]?'VERIFIED':id===ids[1]?'INSTALLED_NOT_VERIFIED':'VERIFICATION_PENDING',version:null}));
 // Installation cache is short-lived; this test adds guilds through its actual Bot fetch.
 vi.useFakeTimers();vi.setSystemTime(Date.now()+61000);
 try{const guilds=await authorizedGuilds('oauth',user);expect(guilds.map(g=>g.state)).toEqual(['VERIFIED','INSTALLED_NOT_VERIFIED','VERIFICATION_PENDING','NOT_INSTALLED']);}finally{vi.useRealTimers();}
});
it('requires signed actor-bound disconnect confirmation and rejects stale or lost-authority confirmation',async()=>{
 const cookie=session();mocks.actor.mockResolvedValue({key:'actor'});mocks.connection.mockResolvedValue({state:'VERIFIED',version:'v1'});mocks.issue.mockResolvedValue('signed-confirmation');
 const prepared=await disconnect(request('/link/disconnect',{guildId:guild},cookie));expect(await prepared.json()).toEqual({confirmation:'signed-confirmation'});expect(mocks.disconnect).not.toHaveBeenCalled();
 mocks.read.mockResolvedValue({action:'webDisconnect',version:'v1'});expect((await disconnect(request('/link/disconnect',{guildId:guild,confirmation:'signed-confirmation'},cookie))).status).toBe(200);expect(mocks.disconnect).toHaveBeenCalledWith(expect.objectContaining({guildId:guild}),user,'v1','WEB_DASHBOARD',{key:'actor'});
 mocks.actor.mockRejectedValue(new Error('permission lost'));expect((await disconnect(request('/link/disconnect',{guildId:guild,confirmation:'signed-confirmation'},cookie))).status).toBe(403);
 const module=await import('../../apps/web/app/link/disconnect/route');expect('GET' in module).toBe(false);
});
it('keeps production Discord links HTTPS and free of codes, tokens and unsafe base URLs',()=>{
 expect(discordDashboardLink('https://nexus.example',guild,false,false)).toBe('https://nexus.example/link');expect(discordDashboardLink('https://nexus.example',guild,false,true)).toBe(`https://nexus.example/dashboard/${guild}`);
 for(const base of ['http://localhost:3100','https://localhost','https://127.0.0.1','https://user:secret@nexus.example','https://nexus.example?code=secret','https://nexus.example#token','javascript:alert(1)'])expect(discordDashboardLink(base,guild,false,false)).toBeUndefined();
});
