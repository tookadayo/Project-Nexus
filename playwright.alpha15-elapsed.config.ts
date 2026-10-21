import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',testMatch:'alpha15-elapsed-schedule.spec.ts',outputDir:'.local/alpha15-elapsed-results',workers:1,use:{baseURL:'http://127.0.0.1:4192',screenshot:'only-on-failure'}});
