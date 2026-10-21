import { fork, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { osEnvironment } from './config.js';
import { ProductionError, safeCode } from './errors.js';
import { productionPaths, groupPaths, type ProductionGroup } from './paths.js';
import { productionPreflight } from './preflight.js';
import { requireAclVerifierPolicy, verifyPrivatePath } from './private-path.js';
import { productionDiagnostics, diagnosticExplanation } from './diagnostics.js';
import { ProductionSupervisor, readRuntimeState, requestStop, stateIsFresh } from './supervisor.js';

const pause = (ms: number) => new Promise<void>(yes => setTimeout(yes, ms));
const paths = productionPaths();
async function showDiagnostics(group: ProductionGroup) {
  const findings = await productionDiagnostics(paths, group);
  for (const item of findings) process.stdout.write(item.check + ': ' + item.code + '\n');
  return findings;
}
async function status(group: ProductionGroup) {
  const findings = await showDiagnostics(group);
  const blocked = findings.find(item => diagnosticExplanation(item.code));
  if (blocked) {
    process.stdout.write(group + ': UNVERIFIED (no runtime state or secrets read)\n');
    process.stdout.write(diagnosticExplanation(blocked.code) + '\n'); process.exitCode = 1; return;
  }
  try { await verifyPrivatePath(paths.runtime, paths.root, true); }
  catch (error) {
    process.stdout.write(group + ': NO_VERIFIED_RUNTIME | ' + safeCode(error) + '\n');
    process.exitCode = 1; return;
  }
  const state = await readRuntimeState(paths, group);
  if (!state) { process.stdout.write(group + ': NO_VERIFIED_RUNTIME\n'); return; }
  const fresh = stateIsFresh(state) && !['stopped','failed'].includes(state.phase);
  let lock = '';
  try { lock = await readFile(groupPaths(paths, group).lock, 'utf8'); } catch { /* Unverified is never healthy. */ }
  const verified = fresh && lock === state.instance;
  process.stdout.write(group + ': ' + (verified ? state.phase.toUpperCase() : state.phase === 'stopped' ? 'STOPPED' : 'UNVERIFIED') +
    ' | retries=' + state.retries + (state.code ? ' | ' + state.code : '') + '\n');
  for (const child of state.children) process.stdout.write('  ' + child.role + ': PID ' + child.pid + ' (display only)\n');
  if (verified && state.phase === 'running' && group === 'app') {
    let health = 'DEGRADED';
    try {
      const response = await fetch('http://127.0.0.1:3001/health', { signal: AbortSignal.timeout(2000) });
      const data: unknown = await response.json();
      const item = data as { discordConnected?: unknown; redisConnected?: unknown };
      if (response.ok && item.discordConnected === true && item.redisConnected === true) {
        const web = await fetch('http://127.0.0.1:3100/', { redirect: 'manual', signal: AbortSignal.timeout(2000) });
        if ([200,301,302,307,308,401,403].includes(web.status)) health = 'READY';
      }
    } catch { /* Never print remote data or library errors. */ }
    process.stdout.write('  API / Discord / Redis / Web: ' + health + '\n');
  }
  process.stdout.write('Infrastructure must already be running. OS startup/service recovery is not registered.\n');
  if (!verified && state.phase !== 'stopped') process.exitCode = 1;
}
async function start(group: ProductionGroup) {
  await requireAclVerifierPolicy();
  await verifyPrivatePath(paths.runtime, paths.root, true);
  try {
    const lock = await readFile(groupPaths(paths, group).lock, 'utf8');
    const state = await readRuntimeState(paths, group);
    if (state && state.instance === lock && stateIsFresh(state) && state.phase === 'running') {
      process.stdout.write(group + ': ALREADY_RUNNING\n'); return;
    }
    throw new ProductionError('RUNTIME_ALREADY_LOCKED');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await productionPreflight(paths, group);
  const supervisorEnvironment: NodeJS.ProcessEnv = { ...osEnvironment(), NODE_ENV: 'production' };
  const child = spawn(process.execPath, ['--import', pathToFileURL(resolve(paths.root, 'node_modules/tsx/dist/loader.mjs')).href,
    fileURLToPath(import.meta.url), 'supervise', group],
  { cwd: paths.root, env: supervisorEnvironment, detached: true, windowsHide: true, stdio: 'ignore' });
  let spawnFailed = false;
  child.on('error', () => { spawnFailed = true; });
  child.unref();
  const deadline = Date.now() + 95_000;
  while (Date.now() < deadline) {
    if (spawnFailed) throw new ProductionError('SUPERVISOR_START_FAILED');
    const state = await readRuntimeState(paths, group);
    if (state && state.supervisorPid === child.pid && stateIsFresh(state)) {
      if (state.phase === 'running') { process.stdout.write(group + ': RUNNING\n'); return; }
      if (['failed','stopped'].includes(state.phase)) throw new ProductionError(state.code ?? 'START_FAILED');
    }
    await pause(250);
  }
  throw new ProductionError('START_NOT_CONFIRMED');
}
async function supervise(group: ProductionGroup) {
  let fingerprint: string | undefined;
  let environment: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
  const runner = new ProductionSupervisor({
    paths, group,
    preflight: async () => {
      const current = await productionPreflight(paths, group, fingerprint);
      fingerprint ??= current.fingerprint; environment = current.env;
    },
    launch: role => fork(resolve(paths.root, 'scripts/production/child.ts'), [role], {
      cwd: paths.root, env: { ...environment, NEXUS_PRODUCTION_CONFIG_FINGERPRINT: fingerprint }, windowsHide: true,
      execArgv: ['--import', pathToFileURL(resolve(paths.root, 'node_modules/tsx/dist/loader.mjs')).href],
      stdio: ['ignore','ignore','ignore','ipc'],
    }),
  });
  process.on('SIGINT', () => void runner.stop());
  process.on('SIGTERM', () => void runner.stop());
  await runner.run();
}
async function main() {
  const action = process.argv[2], group = process.argv[3] ?? 'app';
  if (!['app','operator'].includes(group)) throw new ProductionError('INVALID_RUNTIME_GROUP');
  const selected = group as ProductionGroup;
  if (action === 'status') return status(selected);
  if (action === 'diagnose') {
    const findings = await showDiagnostics(selected);
    process.stdout.write(selected + ': DIAGNOSTICS_ONLY (no secret/config contents read, no DB connection, no application startup)\n');
    process.stdout.write('Configuration, private ACL, schema, infrastructure and service readiness remain unverified until approved startup checks.\n');
    const blocked = findings.find(item => diagnosticExplanation(item.code));
    if (blocked) process.stdout.write(diagnosticExplanation(blocked.code) + '\n');
    if (blocked || findings.some(item => item.code === 'MISSING' || item.code === 'OFFICIAL_NODE_24_22_REQUIRED')) process.exitCode = 1;
    return;
  }
  if (action === 'supervise') return supervise(selected);
  if (action === 'start') return start(selected);
  if (action === 'stop' || action === 'restart') {
    await requireAclVerifierPolicy();
    await verifyPrivatePath(paths.runtime, paths.root, true);
    await requestStop(paths, selected);
    process.stdout.write(selected + ': STOP_CONFIRMED\n');
    if (action === 'restart') return start(selected);
    return;
  }
  throw new ProductionError('INVALID_RUNTIME_ACTION');
}
try { await main(); }
catch (error) {
  const code = safeCode(error);
  process.stderr.write('NEXUS ' + code + '\n');
  const explanation = diagnosticExplanation(code);
  if (explanation) process.stderr.write(explanation + '\n');
  process.exitCode = 1;
}