import { afterEach, describe, expect, it } from 'vitest';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createServer } from 'node:net';
import { productionPaths, groupPaths } from '../../scripts/production/paths';
import { osEnvironment, validateProductionEnvironment } from '../../scripts/production/config';
import { validateSchemaVersions } from '../../scripts/production/schema';
import { ProductionError, safeCode } from '../../scripts/production/errors';
import { assertPortFree } from '../../scripts/production/preflight';
import { ProductionSupervisor, readRuntimeState, requestStop, stateIsFresh } from '../../scripts/production/supervisor';

const temporary: string[] = [];
const active: { runner: ProductionSupervisor; work: Promise<void> }[] = [];
const owned: ChildProcess[] = [];
const sleep = (ms: number) => new Promise<void>(yes => setTimeout(yes, ms));
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'nexus-alpha17-runner-'));
  temporary.push(base);
  const paths = productionPaths(resolve('.'), base);
  await Promise.all([paths.runtime, paths.logs, paths.config].map(path => mkdir(path, { recursive: true })));
  return paths;
}
async function waitFor(check: () => Promise<boolean>, timeout = 4000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await sleep(10); }
  throw new Error('Synthetic lifecycle timed out');
}
function launch(mode = 'normal') {
  const child = fork(resolve('tests/fixtures/alpha17-production-child.mjs'), [mode],
    { stdio: ['ignore','ignore','ignore','ipc'], windowsHide: true, execArgv: [] });
  owned.push(child); return child;
}
afterEach(async () => {
  await Promise.all(active.map(async item => { await item.runner.stop(); await item.work.catch(() => {}); }));
  active.length = 0;
  for (const child of owned) if (child.exitCode === null && child.signalCode === null) child.kill();
  owned.length = 0;
  for (const path of temporary.splice(0)) {
    const part = relative(tmpdir(), path);
    if (part.startsWith('nexus-alpha17-runner-') && !part.includes('..')) await rm(path, { recursive: true, force: true });
  }
});
function environment(): NodeJS.ProcessEnv {
  return { NODE_ENV: 'production', DATABASE_URL: 'postgresql://nexus:synthetic-fixture-password-only@127.0.0.1:55432/nexus',
    REDIS_URL: 'redis://:synthetic-fixture-password-only@127.0.0.1:56379/0',
    IDENTITY_KEY: '1'.repeat(64), LOOKUP_KEY: '2'.repeat(64), COMPONENT_KEY: '3'.repeat(64),
    API_KEY: 'synthetic-api-fixture'.repeat(3), DISCORD_TOKEN: 'synthetic-discord-fixture',
    DISCORD_APPLICATION_ID: '123456789012345678', DISCORD_CLIENT_SECRET: 'synthetic-oauth-fixture',
    NEXUS_SESSION_SECRET: 'synthetic-session-fixture'.repeat(2), NEXUS_WEB_URL: 'https://nexus.example.invalid',
    NEXUS_WEB_AUTH_MODE: 'oauth', NEXUS_HOSTED_BETA: 'on' };
}
describe('alpha17 production configuration and SELECT-only schema gate', () => {
  it('defaults to a physical user-home runtime directory independent of LOCALAPPDATA', () => {
    const paths = productionPaths(resolve('.'));
    expect(paths.base).toBe(resolve(homedir(), 'NEXUS-RUNTIME'));
    expect(paths.config).toBe(join(paths.base, 'config'));
    expect(paths.runtime).toBe(join(paths.base, 'runtime'));
    expect(paths.logs).toBe(join(paths.base, 'logs'));
    expect(() => productionPaths(resolve('.'), 'relative-home')).toThrow('USER_HOME_REQUIRED');
  });

  it('separates config/state/log paths from source and user entries', async () => {
    const paths = await fixture();
    const env = validateProductionEnvironment(environment(), paths);
    expect(env.NEXUS_ENV_FILE).toBe(paths.env);
    expect(env.NEXUS_OPERATOR_POLICY_FILE).toBe(paths.policy);
    expect(env.NEXUS_API_URL).toBe('http://127.0.0.1:3001');
    expect(paths.runtime).not.toContain(join('起動用'));
    expect(paths.logs).not.toBe(paths.runtime);
  });
  it.each([
    { NODE_ENV: 'development' }, { NEXUS_WEB_AUTH_MODE: 'development' },
    { NEXUS_HOSTED_BETA: 'off' }, { NEXUS_INTERACTION_TRANSPORT: 'webhook' },
    { NEXUS_OPERATOR_PORT: '3100' }, { NEXUS_WEB_URL: 'http://nexus.example.invalid' },
    { DATABASE_URL: 'postgresql://nexus:synthetic-fixture-password-only@192.0.2.1:55432/nexus' },
    { DATABASE_URL: 'postgresql://nexus:nexus@127.0.0.1:55432/nexus' },
    { REDIS_URL: 'redis://127.0.0.1:56379' }, { NODE_OPTIONS: '--inspect=0.0.0.0' },
    { NEXUS_OPERATOR_CREDENTIALS: resolve('credentials.json') },
  ])('rejects unsafe production input %j without echoing values', async change => {
    const paths = await fixture();
    let error: unknown;
    try { validateProductionEnvironment({ ...environment(), ...change }, paths); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ProductionError);
    expect(safeCode(error)).toMatch(/^[A-Z0-9_]+$/);
    expect(safeCode(error)).not.toContain('synthetic');
  });
  it.each([
    { node_options: '--require synthetic-do-not-load.cjs' },
    { Node_Path: 'synthetic-module-path' }, { tsx_tsconfig_path: 'synthetic.json' },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { node_tls_reject_unauthorized: '0' },
    { NODE_EXTRA_CA_CERTS: 'synthetic-ca.pem' }, { node_extra_ca_certs: 'synthetic-ca.pem' },
    { OPENSSL_CONF: 'synthetic-openssl.cnf' }, { OpenSsl_Modules: 'synthetic-module-dir' },
    { SSLKEYLOGFILE: 'synthetic-tls-keys.log' }, { ssl_cert_file: 'synthetic-ca.pem' },
    { SSL_CERT_DIR: 'synthetic-ca-dir' }, { NODE_USE_ENV_PROXY: '1' },
    { Path: 'synthetic-tool-lookup' }, { systemroot: 'synthetic-system-root' },
    { userprofile: 'synthetic-other-runtime-home' }, { HomeDrive: 'X:' }, { HOMEPATH: '/synthetic-home' },
    { api_port: '5000' },
  ])('rejects case-insensitive runtime/trust override %j', async change => {
    const paths = await fixture();
    expect(() => validateProductionEnvironment({ ...environment(), ...change }, paths)).toThrow(ProductionError);
  });
  it('normalizes Windows env names, rejects case duplicates, and retains ordinary app keys', async () => {
    const paths = await fixture();
    const lower = Object.fromEntries(Object.entries(environment()).map(([key, value]) => [key.toLowerCase(), value]));
    expect(validateProductionEnvironment(lower, paths).DISCORD_TOKEN).toBe('synthetic-discord-fixture');
    expect(() => validateProductionEnvironment({ ...environment(), API_PORT: '3001', api_port: '3001' }, paths))
      .toThrow('AMBIGUOUS_ENVIRONMENT_KEYS');
    const env = validateProductionEnvironment({ ...environment(), NODE_TLS_REJECT_UNAUTHORIZED: '1', NEXUS_BUILD_SHA: '8d23cae' }, paths);
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('1');
    expect(env.NEXUS_BUILD_SHA).toBe('8d23cae');
  });
  it('does not inherit credentials or Node injection switches from the launcher', () => {
    const env = osEnvironment({ PATH: 'synthetic-path', DISCORD_TOKEN: 'synthetic-private', NODE_OPTIONS: '--inspect' });
    expect(env).toEqual({ PATH: 'synthetic-path' });
  });
  it('requires every version through 082 and rejects missing/duplicate/newer schema', () => {
    const complete = Array.from({ length: 82 }, (_, index) => index + 1);
    expect(() => validateSchemaVersions(complete)).not.toThrow();
    for (const values of [[], complete.slice(0, 81), [...complete, 83], [...complete.slice(1), 82]])
      expect(() => validateSchemaVersions(values)).toThrow('SCHEMA_082_REQUIRED');
  });
  it('refuses a foreign port holder without stopping it', async () => {
    const server = createServer();
    await new Promise<void>(yes => server.listen(0, '127.0.0.1', yes));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error();
      await expect(assertPortFree(address.port)).rejects.toThrow('OCCUPIED');
      expect(server.listening).toBe(true);
    } finally { await new Promise<void>(yes => server.close(() => yes())); }
  });
});
describe('alpha17 owned-child supervision (synthetic processes only)', () => {
  it('starts once, reports running, and confirms graceful stop without logging child output', async () => {
    const paths = await fixture();
    const runner = new ProductionSupervisor({ paths, group: 'app', preflight: async () => {},
      launch: () => launch(), pollMs: 20, stopTimeoutMs: 200 });
    const work = runner.run(); void work.catch(() => {}); active.push({ runner, work });
    await waitFor(async () => (await readRuntimeState(paths, 'app'))?.phase === 'running');
    const state = await readRuntimeState(paths, 'app');
    expect(state?.children).toHaveLength(2);
    expect(stateIsFresh(state!)).toBe(true);
    const second = new ProductionSupervisor({ paths, group: 'app', preflight: async () => {
      throw new Error('must not execute'); }, launch: () => launch() });
    await expect(second.run()).rejects.toThrow('RUNTIME_ALREADY_LOCKED');
    await requestStop(paths, 'app', 2000);
    await work;
    expect((await readRuntimeState(paths, 'app'))?.phase).toBe('stopped');
    await expect(access(groupPaths(paths, 'app').lock)).rejects.toThrow();
    const log = await readFile(groupPaths(paths, 'app').log, 'utf8');
    expect(log).toContain('RUNNING');
    expect(log).not.toContain('SYNTHETIC_SECRET');
    expect(owned.every(child => child.exitCode !== null || child.signalCode !== null)).toBe(true);
  });
  it.each(['before-ready','after-ready'])('bounds retries after %s failure and stops other owned roles', async mode => {
    const paths = await fixture();
    let count = 0;
    const runner = new ProductionSupervisor({ paths, group: 'app', preflight: async () => {},
      launch: role => { count++; return launch(role === 'runtime' ? mode : 'normal'); },
      retryDelays: [1,1], pollMs: 10, stopTimeoutMs: 200, readyTimeoutMs: 1000 });
    const work = runner.run(); void work.catch(() => {}); active.push({ runner, work });
    // Attach rejection immediately while observing lifecycle to avoid unhandled rejections.
    await expect(work).rejects.toThrow(/CHILD_/);
    expect(count).toBe(6);
    expect((await readRuntimeState(paths, 'app'))?.phase).toBe('failed');
    expect((await readRuntimeState(paths, 'app'))?.retries).toBe(2);
    expect(owned.every(child => child.exitCode !== null || child.signalCode !== null)).toBe(true);
  });
  it('does not retry configuration/schema failures and never launches a child', async () => {
    const paths = await fixture(); let count = 0;
    const runner = new ProductionSupervisor({ paths, group: 'app', preflight: async () => {
      throw new ProductionError('SCHEMA_082_REQUIRED'); }, launch: () => { count++; return launch(); }, pollMs: 10 });
    await expect(runner.run()).rejects.toThrow('SCHEMA_082_REQUIRED');
    expect(count).toBe(0);
    expect((await readRuntimeState(paths, 'app'))?.retries).toBe(0);
  });
  it('leaves a stale/reused-PID record and an unrelated process untouched', async () => {
    const paths = await fixture();
    const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},100)'], { stdio: 'ignore', windowsHide: true });
    owned.push(other);
    const files = groupPaths(paths, 'app'), instance = '1234-5678';
    await writeFile(files.lock, instance);
    await writeFile(files.state, JSON.stringify({ format: 1, group: 'app', projectRoot: paths.root,
      instance, supervisorPid: other.pid, startedAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z', phase: 'running', retries: 0,
      children: [{ role: 'runtime', pid: other.pid }] }));
    await expect(requestStop(paths, 'app', 100)).rejects.toThrow('STALE_RUNTIME_REQUIRES_REVIEW');
    expect(other.exitCode).toBeNull();
    expect(other.killed).toBe(false);
    expect(await readFile(files.lock, 'utf8')).toBe(instance);
  });
  it('stops during initial readiness without waiting for the startup timeout', async () => {
    const paths = await fixture();
    const runner = new ProductionSupervisor({ paths, group: 'operator', preflight: async () => {},
      launch: () => launch('pending'), pollMs: 20, readyTimeoutMs: 90_000, stopTimeoutMs: 200 });
    const work = runner.run(); void work.catch(() => {}); active.push({ runner, work });
    await waitFor(async () => (await readRuntimeState(paths, 'operator'))?.children.length === 1);
    await requestStop(paths, 'operator', 2000);
    await work;
    expect((await readRuntimeState(paths, 'operator'))?.phase).toBe('stopped');
  });
  it('confirms exit of its own unresponsive child after bounded graceful shutdown', async () => {
    const paths = await fixture();
    const runner = new ProductionSupervisor({ paths, group: 'operator', preflight: async () => {},
      launch: () => launch('ignore-stop'), pollMs: 20, stopTimeoutMs: 50 });
    const work = runner.run(); void work.catch(() => {}); active.push({ runner, work });
    await waitFor(async () => (await readRuntimeState(paths, 'operator'))?.phase === 'running');
    await requestStop(paths, 'operator', 2000); await work;
    expect(owned.every(child => child.exitCode !== null || child.signalCode !== null)).toBe(true);
    expect((await readRuntimeState(paths, 'operator'))?.phase).toBe('stopped');
  });
  it('keeps app and operator ownership independent', async () => {
    const paths = await fixture();
    const runners = (['app','operator'] as const).map(group => {
      const runner = new ProductionSupervisor({ paths, group, preflight: async () => {},
        launch: () => launch(), pollMs: 20, stopTimeoutMs: 200 });
      const work = runner.run(); void work.catch(() => {}); active.push({ runner, work }); return { runner, work, group };
    });
    await waitFor(async () => (await readRuntimeState(paths, 'app'))?.phase === 'running' &&
      (await readRuntimeState(paths, 'operator'))?.phase === 'running');
    await requestStop(paths, 'operator', 2000);
    expect((await readRuntimeState(paths, 'app'))?.phase).toBe('running');
    expect((await readRuntimeState(paths, 'operator'))?.phase).toBe('stopped');
    await runners[0]!.runner.stop(); await runners[0]!.work;
  });
});