import {afterEach,expect,it,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {NextRequest} from '../../apps/web/node_modules/next/server.js';
vi.mock('../../apps/web/app/auth/server-access',()=>({manageableConnection:vi.fn()}));
import {GET as logout} from '../../apps/web/app/auth/logout/route';
import {sealSession} from '../../apps/web/app/auth/session';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('fails at the launcher before starting a production server with development auth',()=>{
 const child=spawnSync(process.execPath,['--import','tsx','scripts/web.ts'],{env:{...process.env,NODE_ENV:'production',NEXUS_WEB_AUTH_MODE:'development',NEXUS_WEB_PASSWORD:'p'.repeat(16)},encoding:'utf8',timeout:10000});
 expect(child.status).not.toBe(0);expect(child.stderr).toContain('forbidden in production');expect(child.stdout).not.toContain('Ready');
});
it('clears every local authorization cookie even when provider revocation fails',async()=>{
 vi.stubEnv('NEXUS_SESSION_SECRET','s'.repeat(64));vi.stubEnv('NEXUS_WEB_URL','https://nexus.example');vi.stubEnv('DISCORD_APPLICATION_ID','811111111111111111');vi.stubEnv('DISCORD_CLIENT_SECRET','client-secret-test');
 const cookie=sealSession({accessToken:'revocation-token-test',userId:'821111111111111111',expiresAt:Date.now()+60000});
 const fetcher=vi.fn().mockRejectedValue(new Error('Network unavailable'));vi.stubGlobal('fetch',fetcher);
 const response=await logout(new NextRequest('https://nexus.example/auth/logout',{headers:{cookie:`nexus_session=${cookie}`}}));for(const name of ['nexus_session','nexus_guild','nexus_oauth_state','nexus_oauth_next'])expect(response.cookies.get(name)?.value).toBe('');
 expect(response.headers.get('location')).toBe('https://nexus.example/auth/login');expect(fetcher).toHaveBeenCalledTimes(1);
 expect(fetcher.mock.calls[0]?.[0]).toBe('https://discord.com/api/v10/oauth2/token/revoke');expect(response.headers.get('set-cookie')).not.toContain('revocation-token-test');
});
