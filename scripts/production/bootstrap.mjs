import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Runs before the TypeScript loader. Never resolves a system/Codex Node fallback.
const fail = code => { process.stderr.write('NEXUS ' + code + '\n'); process.exitCode = 1; };
try {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const home = homedir();
  const expectedNode = home && isAbsolute(home)
    ? resolve(home, 'NEXUS-RUNTIME/tools/node-v24.22.0-win-x64/node.exe') : undefined;
  const canonical = value => resolve(value).toLowerCase();
  const [action, group, extra] = process.argv.slice(2);
  if (!expectedNode || canonical(process.execPath) !== canonical(expectedNode) ||
    process.versions.node !== '24.22.0') fail('OFFICIAL_NODE_24_22_REQUIRED');
  else if (!['start','stop','restart','status','diagnose'].includes(action) ||
    !['app','operator'].includes(group) || extra !== undefined) fail('INVALID_RUNTIME_ACTION');
  else {
    const loader = resolve(root, 'node_modules/tsx/dist/loader.mjs');
    const cli = resolve(root, 'scripts/production/cli.ts');
    if (!existsSync(loader) || !existsSync(cli)) fail('DEPENDENCIES_REQUIRED');
    else {
      const allowed = new Set(['path','systemroot','windir','comspec','pathext','temp','tmp',
        'localappdata','appdata','userprofile','homedrive','homepath','systemdrive','programdata']);
      const environment = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => allowed.has(key.toLowerCase())));
      const child = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href, cli, action, group],
        { cwd: root, env: { ...environment, NODE_ENV: 'production' }, stdio: 'inherit', windowsHide: true });
      if (child.error) fail('BOOTSTRAP_CHILD_FAILED');
      else process.exitCode = child.status ?? 1;
    }
  }
} catch { fail('BOOTSTRAP_FAILED'); }