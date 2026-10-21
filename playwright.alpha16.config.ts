import {defineConfig} from "@playwright/test";

/** Offline component-browser checks. No Next/API/database server is started.
 * Every spec bundles local React into HTML and mocks its declared wire calls. */
export default defineConfig({
  testDir:"tests/e2e",
  testMatch:["alpha16-health-ui.spec.ts","alpha16-lifecycle-web.spec.ts","alpha16-maintenance.spec.ts","alpha16-onboarding-flow.spec.ts","alpha16-operational-context.spec.ts","alpha16-personalization.spec.ts","alpha16-rollback-ui.spec.ts","alpha16-rules.spec.ts"],
  fullyParallel:false,workers:1,retries:0,maxFailures:10,
  outputDir:".local/alpha16-browser-results",
  timeout:20000,globalTimeout:15*60000,expect:{timeout:5000},
  reporter:[["line"],["json",{outputFile:".local/alpha16-browser-report.json"}]],
  use:{browserName:"chromium",baseURL:"http://127.0.0.1:3199",serviceWorkers:"block",screenshot:"only-on-failure",trace:"retain-on-failure"},
});
