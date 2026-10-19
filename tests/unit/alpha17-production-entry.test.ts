import { describe, expect, it } from 'vitest';
import { readFile, access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { productionPaths } from '../../scripts/production/paths';
import { osEnvironment } from '../../scripts/production/config';
import { productionDiagnostics, diagnosticExplanation } from '../../scripts/production/diagnostics';
import { classifyAclVerifierFailure } from '../../scripts/production/private-path';

const entry = resolve('起動用');
describe('alpha17 production entry and policy-independent diagnosis', () => {
  it('keeps every production entry on the fixed portable Node bootstrap without PowerShell or a Node fallback', async () => {
    const main = await readFile(join(entry, '_runtime.cmd'), 'utf8');
    expect(main).not.toMatch(/powershell|pwsh|ExecutionPolicy|Bypass/i);
    expect(main).toContain('%USERPROFILE%\\NEXUS-RUNTIME\\tools\\node-v24.22.0-win-x64\\node.exe');
    expect(main).not.toContain('set "nexusNode=node.exe"');
    expect(main).not.toContain('%LOCALAPPDATA%');
    expect(main).toContain('pushd "%~dp0.."');
    expect(main).toContain('if errorlevel 1 exit /b 1');
    expect(main).toContain('"%nexusNode%" "%CD%\\scripts\\production\\bootstrap.mjs" "%~1" "%~2"');
    expect(main).toContain('set "NODE_OPTIONS="');
    for (const [name, action, group] of [
      ['開始','start','app'], ['停止','stop','app'], ['再起動','restart','app'],
      ['状態確認','status','app'], ['事前確認','diagnose','app'],
      ['運営者開始','start','operator'], ['運営者停止','stop','operator'],
      ['運営者状態確認','status','operator'], ['運営者事前確認','diagnose','operator'],
    ]) {
      const source = await readFile(join(entry, name + '.cmd'), 'utf8');
      expect(source).not.toMatch(/powershell|pwsh|ExecutionPolicy|Bypass/i);
      expect(source).toContain('call "%~dp0_runtime.cmd" ' + action + ' ' + group);
    }
    await access(resolve(entry, '..', 'scripts/production/bootstrap.mjs'));
    await access(resolve(entry, '..', 'scripts/production/cli.ts'));
  });
  it('pins bootstrap version and source cwd, and excludes secret environment inheritance', async () => {
    const bootstrap = await readFile(resolve('scripts/production/bootstrap.mjs'), 'utf8');
    expect(bootstrap).not.toMatch(/powershell|pwsh|ExecutionPolicy|Bypass/i);
    expect(bootstrap).toContain("process.versions.node !== '24.22.0'");
    expect(bootstrap).toContain("resolve(home, 'NEXUS-RUNTIME/tools/node-v24.22.0-win-x64/node.exe')");
    expect(bootstrap).not.toContain('process.env.LOCALAPPDATA');
    expect(bootstrap).toContain("resolve(dirname(fileURLToPath(import.meta.url)), '../..')");
    expect(bootstrap).toContain('cwd: root');
    expect(bootstrap).toContain("['--import', pathToFileURL(loader).href, cli, action, group]");
    expect(bootstrap).toContain("fail('OFFICIAL_NODE_24_22_REQUIRED')");
  });
  it('refuses another Node location before loading CLI, config, or applications', () => {
    const result = spawnSync(process.execPath, [resolve('scripts/production/bootstrap.mjs'), 'status', 'app'], {
      env: { ...osEnvironment(), NODE_ENV: 'test', USERPROFILE: resolve('tests/fixtures/nonexistent-private-home') },
      encoding: 'utf8', windowsHide: true,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OFFICIAL_NODE_24_22_REQUIRED');
    expect(result.stdout).toBe('');
  });
  it('diagnoses missing prerequisites and blocked ACL verifier without reading secret file contents', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nexus-alpha17-entry-'));
    try {
      const paths = productionPaths(resolve('.'), folder);
      await mkdir(paths.config, { recursive: true });
      await writeFile(paths.env, 'SYNTHETIC_PRIVATE_CONFIG_MUST_NOT_BE_READ');
      const findings = await productionDiagnostics(paths, 'app', async () => 'ACL_VERIFIER_EXECUTION_POLICY_BLOCKED');
      expect(findings).toContainEqual({ check: 'Runtime directory', code: 'MISSING' });
      expect(findings).toContainEqual({ check: 'Production env file', code: 'PRESENT_UNVERIFIED' });
      expect(findings).toContainEqual({ check: 'ACL verifier execution policy', code: 'ACL_VERIFIER_EXECUTION_POLICY_BLOCKED' });
      expect(JSON.stringify(findings)).not.toContain('SYNTHETIC_PRIVATE_CONFIG');
      const explanation = diagnosticExplanation('ACL_VERIFIER_EXECUTION_POLICY_BLOCKED');
      expect(explanation).toContain('scripts/operator-acl.ps1 -Verify');
      expect(explanation).toContain('no policy or ACL was changed');
    } finally {
      const part = relative(tmpdir(), folder);
      if (part.startsWith('nexus-alpha17-entry-') && !part.includes('..')) await rm(folder, { recursive: true, force: true });
    }
  });
  it.skipIf(process.platform !== 'win32' || process.versions.node !== '24.22.0')(
    'loads file-URL TS loader and source cwd in a synthetic path containing spaces', async () => {
      const folder = await mkdtemp(join(tmpdir(), 'nexus-alpha17-bootstrap spaces-'));
      try {
        const scripts = join(folder, 'scripts/production');
        const loader = join(folder, 'node_modules/tsx/dist');
        await Promise.all([mkdir(scripts, { recursive: true }), mkdir(loader, { recursive: true })]);
        await writeFile(join(scripts, 'bootstrap.mjs'), await readFile(resolve('scripts/production/bootstrap.mjs'), 'utf8'));
        await writeFile(join(loader, 'loader.mjs'), "import process from 'node:process'; process.env.NEXUS_SYNTHETIC_LOADER = 'ready';");
        await writeFile(join(folder, 'package.json'), '{"type":"module"}');
        await writeFile(join(scripts, 'cli.ts'),
          "import process from 'node:process'; process.stdout.write(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),loader:process.env.NEXUS_SYNTHETIC_LOADER,privateInherited:Object.hasOwn(process.env,'DISCORD_TOKEN')}));");
        const result = spawnSync(process.execPath, [join(scripts, 'bootstrap.mjs'), 'diagnose', 'app'], {
          cwd: tmpdir(), env: { ...osEnvironment(), NODE_ENV: 'test', DISCORD_TOKEN: 'synthetic-not-for-child' },
          encoding: 'utf8', windowsHide: true,
        });
        expect(result.status).toBe(0);
        expect(result.stderr).not.toContain('ERR_UNSUPPORTED_ESM_URL_SCHEME');
        expect(JSON.parse(result.stdout)).toEqual({ cwd: folder, args: ['diagnose','app'], loader: 'ready', privateInherited: false });
      } finally {
        const part = relative(tmpdir(), folder);
        if (part.startsWith('nexus-alpha17-bootstrap spaces-') && !part.includes('..'))
          await rm(folder, { recursive: true, force: true });
      }
    });
  it('keeps public diagnose separate from strict startup preflight', async () => {
    const source = await readFile(resolve('scripts/production/cli.ts'), 'utf8');
    const diagnosticBranch = source.split("if (action === 'diagnose') {")[1]?.split("if (action === 'supervise')")[0];
    expect(diagnosticBranch).toBeDefined();
    expect(diagnosticBranch).not.toContain('productionPreflight');
    expect(diagnosticBranch).not.toContain('readProductionEnvironment');
    expect(diagnosticBranch).toContain('DIAGNOSTICS_ONLY');
    const bootstrap = await readFile(resolve('scripts/production/bootstrap.mjs'), 'utf8');
    expect(bootstrap).not.toContain("'preflight'");
  });
  it('classifies a script policy denial without echoing untrusted stderr', () => {
    expect(classifyAclVerifierFailure({ stderr: 'PSSecurityException synthetic-private-error' }))
      .toBe('ACL_VERIFIER_EXECUTION_POLICY_BLOCKED');
    expect(classifyAclVerifierFailure({ stderr: 'about_Execution_Policies synthetic-private-error' }))
      .toBe('ACL_VERIFIER_EXECUTION_POLICY_BLOCKED');
    expect(classifyAclVerifierFailure({ stderr: 'synthetic-private-file-details' })).toBe('PRIVATE_ACL_REQUIRED');
    expect(diagnosticExplanation('PRIVATE_ACL_REQUIRED')).toBeUndefined();
  });
});