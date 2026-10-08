vi.mock('../../apps/web/app/auth/public-session-store',async()=>{const {memoryPublicSessions}=await import('../fixtures/public-sessions');return {publicSessions:()=>memoryPublicSessions};});
import {afterEach,expect,it,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {NextRequest} from '../../apps/web/node_modules/next/server.js';
vi.mock('../../apps/web/app/auth/server-access',()=>({manageableConnection:vi.fn()}));
import {GET as confirmLogout,POST as logout} from '../../apps/web/app/auth/logout/route';
import {sealSession,openSession} from '../../apps/web/app/auth/session';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('fails at the launcher before starting a production server with development auth',()=>{
 const child=spawnSync(process.execPath,['--import','tsx','scripts/web.ts'],{env:{...process.env,NODE_ENV:'production',NEXUS_WEB_AUTH_MODE:'development',NEXUS_WEB_PASSWORD:'p'.repeat(16)},encoding:'utf8',timeout:10000});
 expect(child.status).not.toBe(0);expect(child.stderr).toContain('forbidden in production');expect(child.stdout).not.toContain('Ready');
});
it('requires POST and same-origin for logout, durably rejects a copied cookie, and leaves other sessions alone',async()=>{
 vi.stubEnv('NEXUS_SESSION_SECRET','s'.repeat(64));vi.stubEnv('NEXUS_WEB_URL','https://nexus.example');
 const cookie=await sealSession({accessToken:'synthetic-revocation-token',userId:'821111111111111111',expiresAt:Date.now()+60000});
 const other=await sealSession({accessToken:'synthetic-other-token',userId:'831111111111111111',expiresAt:Date.now()+60000});
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 expect((await confirmLogout()).status).toBe(200);expect(await openSession(cookie)).not.toBeNull();
 const request=(origin:string)=>new NextRequest('https://nexus.example/auth/logout',{method:'POST',headers:{origin,host:'nexus.example','sec-fetch-site':'same-origin',cookie:`nexus_session=${cookie}`}});
 expect((await logout(request('https://evil.example'))).status).toBe(403);expect(await openSession(cookie)).not.toBeNull();
 const response=await logout(request('https://nexus.example'));
 for(const name of ['nexus_session','nexus_guild','nexus_oauth_state','nexus_oauth_next'])expect(response.cookies.get(name)?.value).toBe('');
 expect(response.status).toBe(303);expect(response.headers.get('location')).toBe('https://nexus.example/auth/login');expect(fetcher).not.toHaveBeenCalled();
 expect(await openSession(cookie)).toBeNull();expect(await openSession(other)).not.toBeNull();expect(response.headers.get('set-cookie')).not.toContain('synthetic-revocation-token');
});
it('disconnects only the authenticated person even when provider revocation is uncertain',async()=>{
 vi.stubEnv('NEXUS_WEB_URL','https://nexus.example');vi.stubEnv('DISCORD_APPLICATION_ID','811111111111111111');vi.stubEnv('DISCORD_CLIENT_SECRET','synthetic-provider-secret');
 const {POST:disconnect,GET:confirm}=await import('../../apps/web/app/auth/disconnect/route');
 const own=await sealSession({userId:'821111111111111111',accessToken:'synthetic-own-token',expiresAt:Date.now()+60000}),copy=await sealSession({userId:'821111111111111111',accessToken:'synthetic-own-second',expiresAt:Date.now()+60000}),other=await sealSession({userId:'831111111111111111',accessToken:'synthetic-other',expiresAt:Date.now()+60000});
 expect((await confirm()).status).toBe(200);expect(await openSession(own)).not.toBeNull();
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({id:'821111111111111111'})}).mockRejectedValueOnce(new Error('synthetic-provider-unavailable'));vi.stubGlobal('fetch',fetcher);
 const request=(origin:string)=>new NextRequest('https://nexus.example/auth/disconnect',{method:'POST',headers:{origin,host:'nexus.example','sec-fetch-site':'same-origin',cookie:`nexus_session=${own}`,'content-type':'application/x-www-form-urlencoded'},body:'confirmation=disconnect-personal&userId=831111111111111111'});
 expect((await disconnect(request('https://evil.example'))).status).toBe(403);expect(fetcher).not.toHaveBeenCalled();
 const response=await disconnect(request('https://nexus.example'));expect(await response.text()).toContain('Authorized Apps');expect(response.cookies.get('nexus_session')?.value).toBe('');
 expect(await openSession(own)).toBeNull();expect(await openSession(copy)).toBeNull();expect(await openSession(other)).not.toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
});
it('persists rejection of a revoked provider session without revoking another person',async()=>{
 const {validateOAuthSession}=await import('../../apps/web/app/auth/session');const value=await sealSession({userId:'841111111111111111',accessToken:'synthetic-revoked-token',expiresAt:Date.now()+60000}),other=await sealSession({userId:'851111111111111111',accessToken:'synthetic-independent-token',expiresAt:Date.now()+60000});
 vi.stubGlobal('fetch',vi.fn(async()=>({status:401,ok:false})));await expect(validateOAuthSession((await openSession(value))!)).rejects.toThrow('SESSION_EXPIRED');expect(await openSession(value)).toBeNull();expect(await openSession(other)).not.toBeNull();
});
