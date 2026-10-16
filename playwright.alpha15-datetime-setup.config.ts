import {defineConfig} from "@playwright/test";
export default defineConfig({testDir: "tests/e2e", testMatch: "alpha15-datetime-setup.spec.ts", workers: 1, use: {baseURL: "http://127.0.0.1:4190", timezoneId: "America/New_York", screenshot: "only-on-failure"}});
