import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { Redis } from 'ioredis';
import { connect } from '../../packages/db/src/index.js';
import { readOperatorCredentials } from '../../packages/security/src/operator-auth.js';
import { readAlpha17OperatorConfig } from '../../packages/security/src/alpha17-operator-config.js';
import { readProductionEnvironment } from './config.js';
import { ProductionError } from './errors.js';
import { type ProductionGroup, type ProductionPaths } from './paths.js';
import { requireAclVerifierPolicy, verifyPrivatePath } from './private-path.js';
import { requireProductionSchema } from './schema.js';

export async function assertPortFree(port: number) {
  await new Promise<void>((yes, no) => {
    const server = createServer();
    server.once('error', () => no(new ProductionError('PORT_' + port + '_OCCUPIED')));
    server.listen(port, '127.0.0.1', () => server.close(error => error ? no(new ProductionError('PORT_CHECK_FAILED')) : yes()));
  });
}
export async function productionPreflight(paths: ProductionPaths, group: ProductionGroup, expectedFingerprint?: string) {
  await requireAclVerifierPolicy();
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new ProductionError('NODE_24_REQUIRED');
  await verifyPrivatePath(paths.runtime, paths.root, true);
  await verifyPrivatePath(paths.logs, paths.root, true);
  const config = await readProductionEnvironment(paths);
  if (expectedFingerprint && expectedFingerprint !== config.fingerprint) throw new ProductionError('CONFIG_CHANGED');
  try {
    const manifest = JSON.parse(await readFile(resolve(paths.root, 'package.json'), 'utf8')) as { packageManager?: string };
    if (manifest.packageManager !== 'pnpm@11.19.0') throw new Error();
    await access(resolve(paths.root, 'node_modules/tsx/dist/loader.mjs'));
  } catch { throw new ProductionError('DEPENDENCIES_OR_LOCK_VERSION_REQUIRED'); }
  if (group === 'app') {
    try {
      const buildId = (await readFile(resolve(paths.root, 'apps/web/.next/BUILD_ID'), 'utf8')).trim();
      if (!/^[A-Za-z0-9_-]+$/.test(buildId)) throw new Error();
      await access(resolve(paths.root, 'apps/web/.next/required-server-files.json'));
    } catch { throw new ProductionError('PRODUCTION_WEB_BUILD_REQUIRED'); }
    for (const name of ['.env','.env.local','.env.production','.env.production.local']) {
      try { await access(resolve(paths.root, 'apps/web', name)); }
      catch { continue; }
      throw new ProductionError('WEB_LOCAL_ENV_OVERRIDE_FORBIDDEN');
    }
  } else {
    try { await readAlpha17OperatorConfig(config.env.NEXUS_OPERATOR_POLICY_FILE!); }
    catch { throw new ProductionError('OPERATOR_POLICY_NOT_READY'); }
    await verifyPrivatePath(config.env.NEXUS_OPERATOR_CREDENTIALS!, paths.root);
    try { await readOperatorCredentials(config.env.NEXUS_OPERATOR_CREDENTIALS!); }
    catch { throw new ProductionError('OPERATOR_CREDENTIALS_NOT_READY'); }
  }
  const db = connect(config.env.DATABASE_URL!);
  try { await requireProductionSchema(db); } finally { await db.destroy(); }
  if (group === 'app') {
    const redis = new Redis(config.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 0,
      enableOfflineQueue: false, connectTimeout: 3000, retryStrategy: () => null });
    redis.on('error', () => { /* Never log connection strings or library errors. */ });
    try {
      await redis.connect();
      if (await redis.ping() !== 'PONG') throw new Error();
    } catch { throw new ProductionError('REDIS_UNAVAILABLE'); }
    finally { redis.disconnect(); }
  }
  for (const port of group === 'app' ? [3001, 3100] : [3210]) await assertPortFree(port);
  return config;
}