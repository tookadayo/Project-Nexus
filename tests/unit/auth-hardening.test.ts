vi.mock('../../apps/web/app/auth/public-session-store',async()=>{const {memoryPublicSessions}=await import('../fixtures/public-sessions');return {publicSessions:()=>memoryPublicSessions};});
import {afterEach,expect,it,vi} from 'vitest';
import {webAuthMode} from '../../packages/config/src/web-auth';
const manageable=vi.hoisted(()=>vi.fn());
vi.mock('../../apps/web/app/auth/server-access',()=>({manageableConnection:manageable}));
import {authorizedGuilds,dashboardContext,sealSession} from '../../apps/web/app/auth/session';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetAllMocks();});
it('rejects development auth in production and accepts only explicit nonproduction Basic auth',()=>{
 expect(()=>webAuthMode({NODE_ENV:'production',NEXUS_WEB_AUTH_MODE:'development',NEXUS_WEB_PASSWORD:'a'.repeat(16)})).toThrow(/forbidden/);
 expect(webAuthMode({NODE_ENV:'development',NEXUS_WEB_AUTH_MODE:'development',NEXUS_WEB_PASSWORD:'a'.repeat(16)})).toBe('development');
 expect(webAuthMode({NODE_ENV:'production'})).toBe('oauth');
 expect(()=>webAuthMode({NODE_ENV:'test',NEXUS_WEB_AUTH_MODE:'unknown'})).toThrow();
});
it('checks only the selected guild, without an OAuth or Bot guild-list fetch',async()=>{
 vi.stubEnv('NEXUS_WEB_AUTH_MODE','oauth');vi.stubEnv('NEXUS_SESSION_SECRET','s'.repeat(64));vi.stubEnv('API_KEY','a'.repeat(64));
 const fetcher=vi.fn(async(url:string)=>{expect(url).toBe('https://discord.com/api/v10/users/@me');return {ok:true,json:async()=>({id:'811111111111111111'})};});vi.stubGlobal('fetch',fetcher);
 const cookie=await sealSession({accessToken:'test',userId:'811111111111111111',expiresAt:Date.now()+60000});
 manageable.mockResolvedValue({state:'VERIFIED',name:'A'});
 expect((await dashboardContext(cookie,'821111111111111111'))?.guildId).toBe('821111111111111111');expect(fetcher).toHaveBeenCalledTimes(1);expect(manageable).toHaveBeenCalledTimes(1);
 manageable.mockResolvedValue(null);expect(await dashboardContext(cookie,'821111111111111111')).toBeNull();
 manageable.mockRejectedValue(new Error('Timeout'));await expect(dashboardContext(cookie,'821111111111111111')).rejects.toThrow();
});
it('isolates an installed guild failure from other server cards',async()=>{
 vi.stubEnv('DISCORD_TOKEN','test');const ids=['821111111111111111','831111111111111111'];
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>ids.map(id=>({id,name:id,permissions:'32'}))})));
 manageable.mockImplementation(async(id:string)=>{if(id===ids[1])throw new Error('Timeout');return {state:'VERIFIED'};});
 const rows=await authorizedGuilds('test','811111111111111111');expect(rows[0]?.state).toBe('VERIFIED');expect(rows[1]?.availability).toBe('UNAVAILABLE');
});
it('rejects a revoked OAuth grant before accessing the selected guild',async()=>{
 vi.stubEnv('NEXUS_WEB_AUTH_MODE','oauth');vi.stubEnv('NEXUS_SESSION_SECRET','s'.repeat(64));
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:401})));
 const cookie=await sealSession({accessToken:'revoked',userId:'811111111111111111',expiresAt:Date.now()+60000});
 await expect(dashboardContext(cookie,'821111111111111111')).rejects.toThrow('SESSION_EXPIRED');expect(manageable).not.toHaveBeenCalled();
});
