import {defineConfig} from '@playwright/test';
import {apiToken,scopeForGuild} from './packages/security/src/index.js';
const scope=scopeForGuild('321111111111111111');
const webPort=Number(process.env.NEXUS_E2E_WEB_PORT??3100);
const observeConnectionResets=process.env.CI==='true'&&process.env.NEXUS_E2E_CONNECTION_RESET_OBSERVE==='1';
export default defineConfig({reporter:observeConnectionResets?[['dot'],['./tests/e2e/connection-reset-reporter.ts']]:undefined,testDir:'tests/e2e',testMatch:'*.spec.ts',testIgnore:["verification.spec.ts","checkout.spec.ts","alpha15-scratch-acceptance.spec.ts","alpha15-datetime-setup.spec.ts","alpha15-datetime-v2.spec.ts","alpha17-core-setup.spec.ts","alpha17-operations-phases.spec.ts"],fullyParallel:false,workers:1,use:{baseURL:`http://127.0.0.1:${webPort}`,httpCredentials:{username:'nexus',password:'nexus-e2e-password-only'},screenshot:'only-on-failure'},
 webServer:[
  {command:'corepack pnpm exec tsx tests/e2e/server.ts',url:'http://127.0.0.1:3101/health',timeout:60000,reuseExistingServer:false},
  {command:`corepack pnpm --filter @nexus/web exec next dev --port ${webPort} --hostname 127.0.0.1`,url:`http://127.0.0.1:${webPort}`,timeout:60000,reuseExistingServer:false,
   env:{NODE_ENV:'development',NEXUS_E2E_ISOLATED:'1',NEXUS_WEB_URL:`http://127.0.0.1:${webPort}`,DISCORD_APPLICATION_ID:'321111111111111119',NEXUS_API_URL:'http://127.0.0.1:3101',NEXUS_ORGANIZATION_ID:scope.organizationId,NEXUS_GUILD_ID:scope.guildId,NEXUS_API_TOKEN:apiToken('test-api-key',scope),NEXUS_WEB_AUTH_MODE:'development',NEXUS_WEB_PASSWORD:'nexus-e2e-password-only',NEXT_TELEMETRY_DISABLED:'1'}},
  {command:'corepack pnpm exec tsx tests/e2e/server.ts',url:'http://127.0.0.1:3151/health',timeout:60000,reuseExistingServer:false,env:{NEXUS_E2E_SETTINGS_AUTH:'1'}},
  {command:'corepack pnpm exec tsx tests/e2e/alpha17-verification-web.ts',url:'http://127.0.0.1:3154',timeout:90000,reuseExistingServer:false}
 ]});
