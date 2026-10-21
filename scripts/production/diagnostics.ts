import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type ProductionGroup, type ProductionPaths } from './paths.js';
import { inspectAclVerifierPolicy } from './private-path.js';

export type Diagnostic = { check: string; code: string };
export async function productionDiagnostics(
  paths: ProductionPaths, group: ProductionGroup,
  probePolicy: () => Promise<string> = inspectAclVerifierPolicy,
): Promise<Diagnostic[]> {
  const result: Diagnostic[] = [{ check: 'Node', code: process.versions.node === '24.22.0' ? 'NODE_24_22_READY' : 'OFFICIAL_NODE_24_22_REQUIRED' }];
  for (const [check, path] of [
    ['Dependencies', resolve(paths.root, 'node_modules/tsx/dist/loader.mjs')],
    ['Runtime directory', paths.runtime], ['Log directory', paths.logs],
    ['Config directory', paths.config], ['Production env file', paths.env],
    ...(group === 'app' ? [['Production Web build', resolve(paths.root, 'apps/web/.next/BUILD_ID')]] : []),
  ]) {
    try { await access(path!); result.push({ check: check!, code: 'PRESENT_UNVERIFIED' }); }
    catch { result.push({ check: check!, code: 'MISSING' }); }
  }
  // Get-ExecutionPolicy is a read-only command, not an inline replacement for the ACL verifier.
  result.push({ check: 'ACL verifier execution policy', code: await probePolicy() });
  return result;
}
export function diagnosticExplanation(code: string) {
  if (code === 'ACL_VERIFIER_EXECUTION_POLICY_BLOCKED')
    return 'Windows PowerShell script execution policy blocks scripts/operator-acl.ps1 -Verify. ACL verification and startup remain blocked; no policy or ACL was changed.';
  if (code === 'ACL_VERIFIER_SIGNATURE_REQUIRED')
    return 'Windows PowerShell requires a signed ACL verifier. Startup remains blocked; no policy, signature or ACL was changed.';
  if (code === 'ACL_VERIFIER_POLICY_UNAVAILABLE')
    return 'The effective Windows PowerShell script policy could not be verified. No policy or ACL was changed.';
  return undefined;
}