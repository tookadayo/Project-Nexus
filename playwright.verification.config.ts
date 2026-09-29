import {defineConfig} from '@playwright/test';
const web=Number(process.env.NEXUS_VERIFICATION_WEB_PORT??3150),api=Number(process.env.NEXUS_VERIFICATION_API_PORT??3151);
export default defineConfig({testDir:'tests/e2e',testMatch:'verification.spec.ts',workers:1,fullyParallel:false,use:{baseURL:`http://127.0.0.1:${web}`,screenshot:'off',trace:'off'},webServer:[
 {command:'corepack pnpm exec tsx tests/e2e/verification-server.ts',url:`http://127.0.0.1:${api}/health`,timeout:60000,reuseExistingServer:false},
 {command:'corepack pnpm exec tsx tests/e2e/verification-web.ts',url:`http://127.0.0.1:${web}`,timeout:60000,reuseExistingServer:false}
]});
