import { loadEnvFile } from 'node:process';
import { migrate } from '../packages/db/src/index.js';
import { runNexusRuntime } from './runtime.js';
try { loadEnvFile(); } catch { /* Existing development environment validation follows. */ }
const runtime = await runNexusRuntime(db => migrate(db));
process.on('SIGINT', () => { void runtime.stop(); });
process.on('SIGTERM', () => { void runtime.stop(); });