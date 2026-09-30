import {defineConfig} from '@playwright/test';
import {apiToken,scopeForGuild} from './packages/security/src/index.js';
const scope=scopeForGuild('321111111111111111');
const webPort=Number(process.env.NEXUS_E2E_WEB_PORT??3100);
export default defineConfig({testDir:'tests/e2e',testMatch:'*.spec.ts',testIgnore:'verification.spec.ts',fullyParallel:false,workers:1,use:{baseURL:`http://127.0.0.1:${webPort}`,httpCredentials:{username:'nexus',password:'nexus-e2e-password-only'},screenshot:'only-on-failure'},
 webServer:[
  {command:'corepack pnpm exec tsx tests/e2e/server.ts',url:'http://127.0.0.1:3101/health',timeout:60000,reuseExistingServer:false},
  {command:`corepack pnpm --filter @nexus/web exec next dev --port ${webPort} --hostname 127.0.0.1`,url:`http://127.0.0.1:${webPort}`,timeout:60000,reuseExistingServer:false,
   env:{NODE_ENV:'development',DISCORD_APPLICATION_ID:'321111111111111119',NEXUS_API_URL:'http://127.0.0.1:3101',NEXUS_ORGANIZATION_ID:scope.organizationId,NEXUS_GUILD_ID:scope.guildId,NEXUS_API_TOKEN:apiToken('test-api-key',scope),NEXUS_WEB_AUTH_MODE:'development',NEXUS_WEB_PASSWORD:'nexus-e2e-password-only',NEXT_TELEMETRY_DISABLED:'1'}}
 ]});
