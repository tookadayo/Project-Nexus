import {resolve} from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({resolve:{alias:{'server-only':resolve('tests/fixtures/server-only.ts')}},test:{include:['tests/unit/**/*.test.ts'],testTimeout:10000}});
