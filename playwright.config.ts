import {defineConfig} from '@playwright/test';
import {apiToken,scopeForGuild} from './packages/security/src/index.js';
const scope=scopeForGuild('321111111111111111');
export default defineConfig({testDir:'tests/e2e',testMatch:'*.spec.ts',fullyParallel:false,workers:1,use:{baseURL:'http://127.0.0.1:3100',httpCredentials:{username:'nexus',password:'nexus-e2e-password-only'},screenshot:'only-on-failure'},
 webServer:[
  {command:'pnpm exec tsx tests/e2e/server.ts',url:'http://127.0.0.1:3101/health',timeout:60000,reuseExistingServer:false},
  {command:'pnpm --filter @nexus/web exec next start --port 3100 --hostname 127.0.0.1',url:'http://127.0.0.1:3100',timeout:60000,reuseExistingServer:false,
   env:{NEXUS_API_URL:'http://127.0.0.1:3101',NEXUS_ORGANIZATION_ID:scope.organizationId,NEXUS_GUILD_ID:scope.guildId,NEXUS_API_TOKEN:apiToken('test-api-key',scope),NEXUS_WEB_PASSWORD:'nexus-e2e-password-only',NEXT_TELEMETRY_DISABLED:'1'}}
 ]});
