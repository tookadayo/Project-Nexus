import { readFile, writeFile, rename, unlink, stat, appendFile } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { ProductionError, safeCode } from './errors.js';
import { groupPaths, type ProductionGroup, type ProductionPaths } from './paths.js';

export type ChildRole = 'runtime' | 'web' | 'operator';
export type RuntimePhase = 'starting' | 'running' | 'retrying' | 'stopping' | 'stopped' | 'failed';
export type RuntimeState = {
  format: 1; group: ProductionGroup; projectRoot: string; instance: string; supervisorPid: number;
  startedAt: string; updatedAt: string; phase: RuntimePhase; retries: number;
  children: { role: ChildRole; pid: number }[]; code?: string;
};
type Options = {
  paths: ProductionPaths; group: ProductionGroup;
  preflight: () => Promise<void>; launch: (role: ChildRole) => ChildProcess;
  retryDelays?: readonly number[]; readyTimeoutMs?: number; stopTimeoutMs?: number; pollMs?: number;
};
const pause = (ms: number) => new Promise<void>(yes => setTimeout(yes, ms));
function record(value: unknown): value is RuntimeState {
  if (!value || typeof value !== 'object') return false;
  const item = value as RuntimeState;
  return item.format === 1 && ['app','operator'].includes(item.group) &&
    typeof item.projectRoot === 'string' && /^\d+-\d+$/.test(item.instance) &&
    Number.isInteger(item.supervisorPid) && typeof item.updatedAt === 'string' &&
    typeof item.startedAt === 'string' &&
    ['starting','running','retrying','stopping','stopped','failed'].includes(item.phase) &&
    Number.isInteger(item.retries) && Array.isArray(item.children) && item.children.length <= 3 &&
    item.children.every(child => child && ['runtime','web','operator'].includes(child.role) &&
      Number.isInteger(child.pid) && child.pid > 0) &&
    (item.code === undefined || /^[A-Z0-9_]{1,80}$/.test(item.code));
}
export async function readRuntimeState(paths: ProductionPaths, group: ProductionGroup) {
  try {
    const source = await readFile(groupPaths(paths, group).state, 'utf8');
    if (source.length > 8192) throw new Error();
    const state: unknown = JSON.parse(source);
    if (!record(state) || state.projectRoot !== paths.root || state.group !== group) throw new Error();
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ProductionError('RUNTIME_STATE_UNVERIFIED');
  }
}
export function stateIsFresh(state: RuntimeState, now = Date.now()) {
  const age = now - Date.parse(state.updatedAt);
  return Number.isFinite(age) && age >= -2000 && age <= 5000;
}
export async function requestStop(paths: ProductionPaths, group: ProductionGroup, timeoutMs = 30_000) {
  const files = groupPaths(paths, group);
  let lock: string;
  try { lock = await readFile(files.lock, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new ProductionError('RUNTIME_LOCK_UNVERIFIED');
  }
  const state = await readRuntimeState(paths, group);
  if (!state || state.instance !== lock || !stateIsFresh(state))
    throw new ProductionError('STALE_RUNTIME_REQUIRES_REVIEW');
  await writeFile(files.lock + '.stop', state.instance, { mode: 0o600 });
  const until = Date.now() + timeoutMs;
  do {
    try {
      const current = await readFile(files.lock, 'utf8');
      if (current !== state.instance) throw new ProductionError('RUNTIME_INSTANCE_CHANGED');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await pause(100);
  } while (Date.now() < until);
  throw new ProductionError('STOP_NOT_CONFIRMED');
}

/** Owns ChildProcess handles, never discovers or kills processes by PID/port. */
export class ProductionSupervisor {
  private readonly files;
  private readonly state: RuntimeState;
  private readonly children = new Map<ChildRole, ChildProcess>();
  private stopping = false;
  private finished = false;
  private wake?: () => void;
  private writing = Promise.resolve();
  private stoppingChildren: Promise<void> | undefined;
  constructor(private readonly options: Options) {
    this.files = groupPaths(options.paths, options.group);
    const now = new Date().toISOString();
    this.state = { format: 1, group: options.group, projectRoot: options.paths.root,
      instance: process.pid + '-' + Date.now(), supervisorPid: process.pid,
      startedAt: now, updatedAt: now, phase: 'starting', retries: 0, children: [] };
  }
  async stop() { this.stopping = true; this.state.phase = 'stopping'; this.wake?.(); await this.stopChildren(); }
  private publish(event?: string, code?: string) {
    this.state.updatedAt = new Date().toISOString();
    this.state.children = [...this.children].flatMap(([role, child]) =>
      child.pid && child.exitCode === null && child.signalCode === null ? [{ role, pid: child.pid }] : []);
    const source = JSON.stringify(this.state);
    const line = event ? JSON.stringify({ at: this.state.updatedAt, group: this.state.group,
      event, ...(code ? { code } : {}) }) + '\n' : undefined;
    this.writing = this.writing.then(async () => {
      const temp = this.files.state + '.' + this.state.instance + '.tmp';
      await writeFile(temp, source, { mode: 0o600 });
      let renamed = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        try { await rename(temp, this.files.state); renamed = true; break; }
        catch (error) {
          if (!['EPERM','EBUSY','EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          await pause(25);
        }
      }
      if (!renamed) throw new ProductionError('STATE_ATOMIC_REPLACE_FAILED');
      if (line) {
        const info = await stat(this.files.log).catch(() => null);
        if (info && info.size > 2 * 1024 * 1024) {
          await unlink(this.files.log + '.previous').catch(error => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          });
          await rename(this.files.log, this.files.log + '.previous');
        }
        await appendFile(this.files.log, line, { mode: 0o600 });
      }
    });
    return this.writing;
  }
  private async stopChildren() {
    if (this.stoppingChildren) return this.stoppingChildren;
    this.stoppingChildren = this.stopOwnedChildren();
    try { await this.stoppingChildren; } finally { this.stoppingChildren = undefined; }
  }
  private async stopOwnedChildren() {
    const owned = [...this.children.values()];
    await Promise.all(owned.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((yes, no) => {
        let ended = false;
        let forceTimer: NodeJS.Timeout | undefined;
        const done = () => {
          if (ended) return; ended = true;
          clearTimeout(timer); clearTimeout(forceTimer); yes();
        };
        const timer = setTimeout(() => {
          // This retained handle refers only to our own child. No PID lookup or tree-kill.
          if (child.exitCode === null && child.signalCode === null) child.kill();
          forceTimer = setTimeout(() => {
            if (!ended) { ended = true; no(new ProductionError('OWNED_CHILD_STOP_UNCONFIRMED')); }
          }, 5000);
        }, this.options.stopTimeoutMs ?? 15_000);
        child.once('exit', done);
        if (child.connected) child.send({ type: 'stop' }, () => {});
        else { child.kill(); }
      });
    }));
    this.children.clear();
  }
  private async generation() {
    await this.options.preflight();
    if (this.stopping) return;
    let failure: string | undefined;
    const roles: ChildRole[] = this.options.group === 'app' ? ['runtime','web'] : ['operator'];
    const started = roles.map(role => {
      const child = this.options.launch(role);
      this.children.set(role, child);
      return new Promise<void>((yes, no) => {
        let ready = false;
        const timer = setTimeout(() => no(new ProductionError('CHILD_READY_TIMEOUT')),
          this.options.readyTimeoutMs ?? 90_000);
        const fail = (code: string) => {
          failure ??= code; this.wake?.();
          if (!ready) { clearTimeout(timer); no(new ProductionError(code)); }
        };
        child.on('error', () => fail('CHILD_PROCESS_ERROR'));
        child.on('exit', () => fail('CHILD_EXITED'));
        child.on('message', message => {
          if (!message || typeof message !== 'object') return;
          const item = message as { type?: unknown };
          if (item.type === 'ready' && !ready) { ready = true; clearTimeout(timer); yes(); }
          if (item.type === 'failed') fail('CHILD_START_FAILED');
        });
      });
    });
    // Always observe every start result. A single failed role stops the complete generation.
    await Promise.all(started);
    if (failure) throw new ProductionError(failure);
    this.state.phase = 'running';
    delete this.state.code;
    await this.publish('RUNNING');
    while (!this.stopping && !failure) {
      await new Promise<void>(yes => {
        const timer = setTimeout(() => { this.wake = undefined; yes(); }, this.options.pollMs ?? 250);
        this.wake = () => { clearTimeout(timer); this.wake = undefined; yes(); };
      });
    }
    if (!this.stopping && failure) throw new ProductionError(failure);
  }
  async run() {
    try { await writeFile(this.files.lock, this.state.instance, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ProductionError('RUNTIME_ALREADY_LOCKED');
      throw new ProductionError('RUNTIME_LOCK_FAILED');
    }
    let polling = false;
    const poll = setInterval(() => {
      if (polling || this.finished) return;
      polling = true;
      void (async () => {
        const request = await readFile(this.files.lock + '.stop', 'utf8').catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
          throw error;
        });
        if (request === this.state.instance) await this.stop();
        if (!this.finished) await this.publish();
      })().catch(() => { this.state.code = 'STATE_WRITE_FAILED'; void this.stop(); })
        .finally(() => { polling = false; });
    }, this.options.pollMs ?? 250);
    const delays = this.options.retryDelays ?? [1000, 5000, 15000];
    let failed = false;
    let cleanupError: unknown;
    try {
      await this.publish('STARTING');
      while (!this.stopping) {
        try { await this.generation(); break; }
        catch (error) {
          const code = safeCode(error);
          this.state.code = code;
          await this.stopChildren();
          if (this.stopping) break;
          // Configuration, dependency and schema failures require explicit correction.
          const retryable = code.startsWith('CHILD_');
          const delay = delays[this.state.retries];
          if (!retryable || delay === undefined) { failed = true; break; }
          this.state.retries++;
          this.state.phase = 'retrying';
          await this.publish('RETRY_SCHEDULED', code);
          const until = Date.now() + delay;
          while (!this.stopping && Date.now() < until) await pause(Math.min(100, until - Date.now()));
        }
      }
      this.state.phase = failed ? 'failed' : 'stopping';
      await this.publish(failed ? 'RETRY_LIMIT_OR_PREFLIGHT_FAILED' : 'STOPPING', this.state.code);
    } finally {
      this.finished = true;
      clearInterval(poll);
      try {
        await this.stopChildren();
        this.state.phase = failed || this.state.code === 'STATE_WRITE_FAILED' ? 'failed' : 'stopped';
        await this.publish(this.state.phase === 'failed' ? 'FAILED' : 'STOPPED', this.state.code);
        if (await readFile(this.files.lock, 'utf8') === this.state.instance) await unlink(this.files.lock);
        if (await readFile(this.files.lock + '.stop', 'utf8').catch(() => '') === this.state.instance)
          await unlink(this.files.lock + '.stop');
      } catch (error) { cleanupError = error; }
    }
    // A body exception propagates unchanged through finally. Cleanup failure is
    // reported here only when there was no earlier exception to preserve.
    if (cleanupError) throw new ProductionError('RUNTIME_CLEANUP_UNCONFIRMED');
    if (failed || this.state.phase === 'failed') throw new ProductionError(this.state.code ?? 'RUNTIME_FAILED');
  }
}