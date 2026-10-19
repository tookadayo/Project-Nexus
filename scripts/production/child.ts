import { resolve } from 'node:path';
import { productionPaths } from './paths.js';
import { readProductionEnvironment } from './config.js';
import { requireProductionSchema } from './schema.js';

let cleanup: (() => Promise<void>) | undefined;
let stopping = false;
let timer: NodeJS.Timeout | undefined;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  timer = setTimeout(() => process.exit(1), 14_000);
  try { await cleanup?.(); clearTimeout(timer); process.exit(exitCode); }
  catch { process.exit(1); }
}
process.on('message', message => {
  if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'stop') void stop();
});
process.on('disconnect', () => void stop());
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
try {
  if (!process.send || !process.connected) throw new Error();
  const role = process.argv[2];
  const paths = productionPaths();
  const config = await readProductionEnvironment(paths);
  if (process.env.NEXUS_PRODUCTION_CONFIG_FINGERPRINT !== config.fingerprint) throw new Error();
  Object.assign(process.env, config.env);
  process.chdir(paths.root);
  if (role === 'runtime') {
    const { runNexusRuntime } = await import('../runtime.js');
    const runtime = await runNexusRuntime(requireProductionSchema);
    cleanup = runtime.stop;
  } else if (role === 'web') {
    const { createServer } = await import('node:http');
    const { createRequire } = await import('node:module');
    const require = createRequire(resolve(paths.root, 'apps/web/package.json'));
    const imported = require('next') as { default?: unknown } | ((options: object) => unknown);
    type NextApp = { prepare(): Promise<void>; close(): Promise<void>;
      getRequestHandler(): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void;
      getUpgradeHandler(): (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void };
    const next = (typeof imported === 'function' ? imported : imported.default) as (options: object) => NextApp;
    // Public custom-server API: production build, explicit loopback host, no next dev subprocess.
    const app = next({ dev: false, dir: resolve(paths.root, 'apps/web'), hostname: '127.0.0.1', port: 3100 });
    await app.prepare();
    const server = createServer(app.getRequestHandler());
    server.on('upgrade', app.getUpgradeHandler());
    cleanup = async () => {
      await new Promise<void>((yes, no) => server.close(error => error ? no(error) : yes()));
      await app.close();
    };
    await new Promise<void>((yes, no) => {
      server.once('error', no); server.listen(3100, '127.0.0.1', yes);
    });
  } else if (role === 'operator') {
    // Explicit approved configuration; operator.ts never falls back to the checkout .env in production.
    const { startOperator } = await import('../operator.js');
    const operator = await startOperator({ environmentAlreadyLoaded: true });
    cleanup = operator.stop;
  } else throw new Error();
  if (stopping || !process.connected) await stop();
  else process.send({ type: 'ready' });
} catch {
  if (process.connected) process.send?.({ type: 'failed' });
  await stop(1);
}