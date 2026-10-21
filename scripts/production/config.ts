import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readConfig } from '../../packages/config/src/index.js';
import { webOrigin } from '../../packages/config/src/web-origin.js';
import { ProductionError } from './errors.js';
import { isWithin, type ProductionPaths } from './paths.js';
import { verifyPrivatePath } from './private-path.js';

export function osEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const allowed = new Set(['path','systemroot','windir','comspec','pathext','temp','tmp',
    'localappdata','appdata','userprofile','homedrive','homepath','systemdrive','programdata']);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase())));
}
export function assertLocalUrl(value: string, protocol: 'postgres' | 'redis', port: number) {
  try {
    const url = new URL(value);
    if (!['127.0.0.1', '[::1]'].includes(url.hostname) ||
      !(protocol === 'postgres' ? ['postgres:', 'postgresql:'] : ['redis:', 'rediss:']).includes(url.protocol) ||
      Number(url.port || (protocol === 'postgres' ? 5432 : 6379)) !== port ||
      !url.username && protocol === 'postgres' || decodeURIComponent(url.password).length < 16 ||
      url.search || url.hash) throw new Error();
  } catch { throw new ProductionError(protocol === 'postgres' ? 'DATABASE_LOOPBACK_AUTH_REQUIRED' : 'REDIS_LOOPBACK_AUTH_REQUIRED'); }
}
export function validateProductionEnvironment(values: Record<string, string | undefined>, paths: ProductionPaths) {
  // Windows environment names are case-insensitive. Validate the same canonical
  // keys that a spawned process will receive, and reject ambiguous case duplicates.
  const normalized: Record<string, string | undefined> = Object.create(null) as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(values)) {
    const canonical = key.toUpperCase();
    if (Object.hasOwn(normalized, canonical)) throw new ProductionError('AMBIGUOUS_ENVIRONMENT_KEYS');
    normalized[canonical] = value;
  }
  if (normalized.NODE_ENV && normalized.NODE_ENV !== 'production') throw new ProductionError('PRODUCTION_MODE_REQUIRED');
  const forbidden = ['NODE_OPTIONS','NODE_PATH','TSX_TSCONFIG_PATH','NODE_EXTRA_CA_CERTS',
    'OPENSSL_CONF','OPENSSL_MODULES','SSLKEYLOGFILE','SSL_CERT_FILE','SSL_CERT_DIR',
    'NODE_USE_SYSTEM_CA','NODE_USE_ENV_PROXY','PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT',
    'USERPROFILE','HOMEDRIVE','HOMEPATH'];
  if (forbidden.some(key => normalized[key] !== undefined) ||
    normalized.NODE_TLS_REJECT_UNAUTHORIZED !== undefined && normalized.NODE_TLS_REJECT_UNAUTHORIZED !== '1')
    throw new ProductionError('UNSAFE_RUNTIME_OVERRIDE');
  const env: NodeJS.ProcessEnv = { ...osEnvironment(), ...normalized, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
  try {
    const cfg = readConfig(env);
    if (cfg.NEXUS_INTERACTION_TRANSPORT !== 'gateway' || cfg.API_PORT !== 3001 ||
      Number(env.NEXUS_WEB_PORT ?? 3100) !== 3100 || Number(env.NEXUS_OPERATOR_PORT ?? 3210) !== 3210)
      throw new ProductionError('PRODUCTION_PORT_OR_TRANSPORT_INVALID');
    if (!env.DISCORD_CLIENT_SECRET || (env.NEXUS_SESSION_SECRET?.length ?? 0) < 32 ||
      env.NEXUS_WEB_AUTH_MODE && env.NEXUS_WEB_AUTH_MODE !== 'oauth')
      throw new ProductionError('OAUTH_CONFIGURATION_REQUIRED');
    if (!webOrigin(undefined, env).startsWith('https://')) throw new ProductionError('HTTPS_ORIGIN_REQUIRED');
    assertLocalUrl(cfg.DATABASE_URL, 'postgres', 55432);
    assertLocalUrl(cfg.REDIS_URL, 'redis', 56379);
    for (const [key, fallback] of [['NEXUS_OPERATOR_POLICY_FILE', paths.policy],
      ['NEXUS_OPERATOR_CREDENTIALS', paths.credentials]] as const) {
      const path = resolve(env[key] ?? fallback);
      if (!isWithin(paths.config, path)) throw new ProductionError('OPERATOR_CONFIG_OUTSIDE_PRIVATE_DIRECTORY');
      env[key] = path;
    }
    env.NEXUS_ENV_FILE = paths.env;
    env.NEXUS_API_URL = 'http://127.0.0.1:3001';
    env.NEXUS_WEB_PORT = '3100'; env.NEXUS_OPERATOR_PORT = '3210';
    return env;
  } catch (error) {
    if (error instanceof ProductionError) throw error;
    throw new ProductionError('PRODUCTION_CONFIG_INVALID');
  }
}
export async function readProductionEnvironment(paths: ProductionPaths) {
  await verifyPrivatePath(paths.config, paths.root, true);
  await verifyPrivatePath(paths.env, paths.root);
  const source = await readFile(paths.env, 'utf8');
  if (source.length > 64 * 1024) throw new ProductionError('PRODUCTION_CONFIG_TOO_LARGE');
  let values: Record<string, string | undefined>;
  try { values = parseEnv(source); } catch { throw new ProductionError('PRODUCTION_CONFIG_INVALID'); }
  return { env: validateProductionEnvironment(values, paths),
    fingerprint: createHash('sha256').update(source).digest('hex') };
}