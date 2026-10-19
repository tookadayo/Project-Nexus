import { lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, isAbsolute, parse, resolve } from 'node:path';
import { ProductionError } from './errors.js';
const execute = promisify(execFile);

export function classifyAclVerifierFailure(error: unknown) {
  const detail = error && typeof error === 'object' ? error as { stderr?: unknown; stdout?: unknown } : {};
  const text = [detail.stderr, detail.stdout].filter(value => typeof value === 'string').join(' ');
  return /about_Execution_Policies|PSSecurityException/i.test(text)
    ? 'ACL_VERIFIER_EXECUTION_POLICY_BLOCKED' : 'PRIVATE_ACL_REQUIRED';
}
export async function inspectAclVerifierPolicy(): Promise<string> {
  if (process.platform !== 'win32') return 'NATIVE_FILE_PERMISSIONS_REQUIRED';
  try {
    const result = await execute('powershell.exe', ['-NoLogo','-NoProfile','-Command','Get-ExecutionPolicy'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 4096 });
    const policy = result.stdout.trim();
    if (policy === 'Restricted') return 'ACL_VERIFIER_EXECUTION_POLICY_BLOCKED';
    if (policy === 'AllSigned') return 'ACL_VERIFIER_SIGNATURE_REQUIRED';
    if (['RemoteSigned','Unrestricted','Bypass'].includes(policy)) return 'POLICY_ALLOWS_VERIFIER_ATTEMPT';
    return 'ACL_VERIFIER_POLICY_UNAVAILABLE';
  } catch { return 'ACL_VERIFIER_POLICY_UNAVAILABLE'; }
}
export async function requireAclVerifierPolicy() {
  const code = await inspectAclVerifierPolicy();
  if (!['NATIVE_FILE_PERMISSIONS_REQUIRED','POLICY_ALLOWS_VERIFIER_ATTEMPT'].includes(code))
    throw new ProductionError(code);
}

/** Read-only verification. This never applies ACLs or creates directories. */
export async function verifyPrivatePath(path: string, root: string, directory = false) {
  if (!isAbsolute(path)) throw new ProductionError('PRIVATE_PATH_INVALID');
  const target = resolve(path);
  let ancestor = target;
  while (ancestor !== parse(ancestor).root) {
    const info = await lstat(ancestor).catch(() => { throw new ProductionError('PRIVATE_PATH_MISSING'); });
    if (info.isSymbolicLink()) throw new ProductionError('PRIVATE_PATH_LINK');
    if (ancestor === target && (directory ? !info.isDirectory() : !info.isFile()))
      throw new ProductionError('PRIVATE_PATH_INVALID');
    ancestor = dirname(ancestor);
  }
  if (process.platform === 'win32') {
    try {
      await execute('powershell.exe', ['-NoLogo', '-NoProfile', '-File',
        resolve(root, 'scripts/operator-acl.ps1'), '-Path', target, '-Verify'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 4096 });
    } catch (error) { throw new ProductionError(classifyAclVerifierFailure(error)); }
  } else {
    const info = await lstat(target);
    if ((info.mode & 0o077) !== 0 || typeof process.getuid !== 'function' || info.uid !== process.getuid())
      throw new ProductionError('PRIVATE_ACL_REQUIRED');
  }
}