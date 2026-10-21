import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { ProductionError } from './errors.js';

export const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
export type ProductionGroup = 'app' | 'operator';
export function productionPaths(root = projectRoot, home = homedir()) {
  if (!home || !isAbsolute(home)) throw new ProductionError('USER_HOME_REQUIRED');
  const base = resolve(home, 'NEXUS-RUNTIME');
  const config = join(base, 'config');
  return {
    root: resolve(root), base, config, runtime: join(base, 'runtime'), logs: join(base, 'logs'),
    env: join(config, 'production.env'), policy: join(config, 'operator-policy.json'),
    credentials: join(config, 'operator-credentials.json'),
  };
}
export type ProductionPaths = ReturnType<typeof productionPaths>;
export function isWithin(parent: string, target: string) {
  const part = relative(resolve(parent), resolve(target));
  return part !== '' && !part.startsWith('..') && !isAbsolute(part);
}
export function groupPaths(paths: ProductionPaths, group: ProductionGroup) {
  return {
    lock: join(paths.runtime, group + '.lock'),
    state: join(paths.runtime, group + '.json'),
    log: join(paths.logs, group + '.jsonl'),
  };
}