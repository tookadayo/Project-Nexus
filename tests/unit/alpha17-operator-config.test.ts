import { mkdtemp, writeFile, rm, link, mkdir, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alpha17OperatorConfigSchema, loadAlpha17OperatorConfiguration,
  readAlpha17OperatorConfig, verifyAlpha17OperatorConfigPath,
} from "../../packages/security/src/alpha17-operator-config";
import { operatorMutationBlockers } from "../../packages/security/src/alpha16-operator";

// This suite verifies the ACL *decision*, not the host ACL configuration. No
// actual ACL change, credential generation or production configuration occurs.
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_command, _args, _options, callback) => callback(null, "", "")),
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});
const roots: string[] = [];
const now = new Date("2026-10-18T12:00:00.000Z");
function config() {
  return {
    schemaVersion: 1, revision: "fixture-only-1",
    approval: { reference: "fixture-approval", approvedAt: "2026-10-18T11:00:00.000Z", validUntil: "2026-10-18T13:00:00.000Z" },
    scope: { guildIds: ["123456789012345678"], global: false },
    readGrant: { permissions: ["OPERATOR_STATUS_READ", "OPERATOR_ADMISSION_READ"] },
    mutationGrant: { permissions: ["OPERATOR_ADMISSION_MANAGE"] },
    retention: ["OPERATOR_PREVIEW", "OPERATOR_STEP_UP", "AUDIT", "OPERATOR_CONTROL"].map((kind) => ({
      class: kind, revision: "fixture-only-ttl", approvalReference: "fixture-ttl-approval", durationMs: 60000,
    })),
    stepUp: { previewMs: 30000, stepUpMs: 10000, challengeMs: 10000 },
    maintenance: { batchSize: 10, intervalMs: 1000, leaseMs: 2000 },
  };
}
async function fixture(input: unknown = config()) {
  const root = await mkdtemp(join(tmpdir(), "nexus-operator-fixture-"));
  roots.push(root);
  const directory = join(root, "private");
  await mkdir(directory, { mode: 0o700 });
  const path = join(directory, "policy.json");
  await writeFile(path, JSON.stringify(input), { mode: 0o600 });
  return path;
}
afterEach(async () => {
  vi.mocked(execFile).mockClear();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
describe("alpha17 explicit Operator configuration", () => {
  it("has no implicit grants, retention, approval or durations", () => {
    expect(alpha17OperatorConfigSchema.safeParse({ schemaVersion: 1 }).success).toBe(false);
    const readonly = { ...config(), mutationGrant: { permissions: [] }, retention: [], stepUp: null, maintenance: null };
    expect(alpha17OperatorConfigSchema.safeParse(readonly).success).toBe(true);
  });
  it("separates read permissions and mutations without scope cross products", () => {
    expect(alpha17OperatorConfigSchema.safeParse({ ...config(), readGrant: { permissions: ["OPERATOR_ADMISSION_MANAGE"] } }).success).toBe(false);
    expect(alpha17OperatorConfigSchema.safeParse({ ...config(), mutationGrant: { permissions: ["OPERATOR_STATUS_READ"] } }).success).toBe(false);
    expect(alpha17OperatorConfigSchema.safeParse({ ...config(), scope: { guildIds: ["123456789012345678", "123456789012345678"], global: false } }).success).toBe(false);
  });
  it("rejects arbitrary capability booleans and unsupported retention classes", () => {
    for (const key of ["guildDeletionWriterCoverageVerified", "betaLifecycleScopeVerified", "guildErasureScopeVerified", "publisherReady", "recoveryReady"])
      expect(alpha17OperatorConfigSchema.safeParse({ ...config(), [key]: true }).success).toBe(false);
    const entry = config().retention[0];
    expect(alpha17OperatorConfigSchema.safeParse({ ...config(), retention: [{ ...entry, enforcementVerified: true }] }).success).toBe(false);
    expect(alpha17OperatorConfigSchema.safeParse({ ...config(), retention: [{ ...entry, class: "TOMBSTONE" }] }).success).toBe(false);
    expect(alpha17OperatorConfigSchema.safeParse({ ...config(), retention: [{ ...entry, class: "AUDIT", durationMs: Number.MAX_SAFE_INTEGER }] }).success).toBe(false);
  });
  it("bounds factor lifetime to preview and approved retention", () => {
    expect(alpha17OperatorConfigSchema.safeParse({ ...config(), stepUp: { previewMs: 60001, stepUpMs: 10000, challengeMs: 10000 } }).success).toBe(false);
    expect(alpha17OperatorConfigSchema.safeParse({ ...config(), stepUp: { previewMs: 1000, stepUpMs: 1001, challengeMs: 1000 } }).success).toBe(false);
    expect(alpha17OperatorConfigSchema.safeParse({ ...config(), maintenance: { batchSize: 1001, intervalMs: 1000, leaseMs: 2000 } }).success).toBe(false);
    expect(alpha17OperatorConfigSchema.safeParse({ ...config(), maintenance: { batchSize: 10, intervalMs: 1000, leaseMs: 2001 } }).success).toBe(false);
  });
  it("keeps authenticated read grants usable while mutation evidence is absent", async () => {
    const path = await fixture();
    const loaded = await loadAlpha17OperatorConfiguration(path, { now: () => now });
    expect(await loaded.alpha16.grant!("a".repeat(64), {} as never)).toEqual({
      permissions: ["OPERATOR_STATUS_READ", "OPERATOR_ADMISSION_READ", "OPERATOR_ADMISSION_MANAGE"],
      guildIds: ["123456789012345678"], global: false,
    });
    const policy = await loaded.alpha16.policy!();
    expect(policy.retention).toEqual([]);
    expect(operatorMutationBlockers(policy)).toContain("RETENTION_AUDIT_UNAPPROVED");
    expect(policy.guildDeletionWriterCoverageVerified).toBeUndefined();
    expect(loaded.alpha16.recovery).toBeUndefined();
    expect(loaded.alpha16.privacy).toBeUndefined();
    await expect(loaded.alpha16.grant!("browser-made-value", {} as never)).rejects.toThrow("OPERATOR_LOGIN_REQUIRED");
  });
  it("uses a current local purge lease without authorizing independent capabilities", async () => {
    let clock = now;
    const path = await fixture();
    const loaded = await loadAlpha17OperatorConfiguration(path, { now: () => clock });
    loaded.maintenance.recordPass({ ready: true }, now);
    const policy = await loaded.alpha16.policy!();
    expect(operatorMutationBlockers(policy)).toEqual([]);
    expect(operatorMutationBlockers(policy, true)).toContain("DELETION_WRITER_COVERAGE_UNVERIFIED");
    clock = new Date(now.getTime() + 2000);
    expect((await loaded.alpha16.policy!()).retention).toEqual([]);
    loaded.maintenance.recordPass({ ready: true }, clock);
    loaded.maintenance.invalidate();
    expect((await loaded.alpha16.policy!()).retention).toEqual([]);
  });
  it("measures leases from pass start and never extends the shortest original expiry", async () => {
    let clock = now;
    const input = config();
    input.retention[0]!.durationMs = 1500;
    input.stepUp = { previewMs: 1500, stepUpMs: 1000, challengeMs: 1000 };
    const loaded = await loadAlpha17OperatorConfiguration(await fixture(input), { now: () => clock });
    clock = new Date(now.getTime() + 1500);
    loaded.maintenance.recordPass({ ready: true }, now);
    expect((await loaded.alpha16.policy!()).retention).toEqual([]);
    loaded.maintenance.recordPass({ ready: false }, clock);
    expect((await loaded.alpha16.policy!()).retention).toEqual([]);
  });
  it("rejects expired, future or missing approval instead of adopting a fallback", async () => {
    const path = await fixture();
    await expect(readAlpha17OperatorConfig(path, new Date("2026-10-18T13:00:00.000Z"))).rejects.toThrow("OPERATOR_POLICY_APPROVAL_REQUIRED");
    await expect(readAlpha17OperatorConfig(path, new Date("2026-10-18T10:00:00.000Z"))).rejects.toThrow("OPERATOR_POLICY_APPROVAL_REQUIRED");
    await expect(readAlpha17OperatorConfig(path + ".missing", now)).rejects.toThrow("OPERATOR_POLICY_FILE_UNSAFE");
  });
  it("pins the entire source file and fails closed on change, malformed JSON and removal", async () => {
    const path = await fixture();
    const loaded = await loadAlpha17OperatorConfiguration(path, { now: () => now });
    await writeFile(path, JSON.stringify({ ...config(), revision: "changed" }));
    await expect(loaded.alpha16.policy!()).rejects.toThrow("OPERATOR_POLICY_CHANGED_RESTART_REQUIRED");
    await expect(loaded.alpha16.grant!("a".repeat(64), {} as never)).rejects.toThrow("OPERATOR_POLICY_CHANGED_RESTART_REQUIRED");
    await writeFile(path, JSON.stringify(config()));
    await expect(loaded.alpha16.policy!()).rejects.toThrow("OPERATOR_POLICY_CHANGED_RESTART_REQUIRED");
    const restarted = await loadAlpha17OperatorConfiguration(path, { now: () => now });
    await writeFile(path, "{this is not JSON}");
    await expect(restarted.alpha16.policy!()).rejects.toThrow("OPERATOR_POLICY_FILE_UNSAFE");
    await writeFile(path, JSON.stringify(config()));
    const thirdProcess = await loadAlpha17OperatorConfiguration(path, { now: () => now });
    await rm(path);
    await expect(thirdProcess.alpha16.policy!()).rejects.toThrow("OPERATOR_POLICY_FILE_UNSAFE");
  });
  it("rejects oversized and hard-linked files and non-local paths", async () => {
    const path = await fixture();
    await writeFile(path, "x".repeat(65537));
    await expect(readAlpha17OperatorConfig(path, now)).rejects.toThrow("OPERATOR_POLICY_FILE_UNSAFE");
    await writeFile(path, JSON.stringify(config()));
    await link(path, join(join(path, ".."), "hard-link.json"));
    await expect(readAlpha17OperatorConfig(path, now)).rejects.toThrow("OPERATOR_POLICY_FILE_UNSAFE");
    await expect(verifyAlpha17OperatorConfigPath("relative.json")).rejects.toThrow("OPERATOR_POLICY_FILE_UNSAFE");
    await expect(verifyAlpha17OperatorConfigPath("//server/policy.json")).rejects.toThrow("OPERATOR_POLICY_FILE_UNSAFE");
  });
  it("rejects a symlink ancestor before reading configuration", async () => {
    const path = await fixture();
    vi.mocked(lstat).mockResolvedValueOnce({
      isDirectory: () => true, isSymbolicLink: () => true,
    } as Awaited<ReturnType<typeof lstat>>);
    await expect(readAlpha17OperatorConfig(path, now)).rejects.toThrow("OPERATOR_POLICY_FILE_UNSAFE");
  });
  it.skipIf(process.platform !== "win32")("rejects a failed read-only Windows ACL check without repair", async () => {
    const path = await fixture();
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      (args[3] as (error: Error) => void)(new Error("arbitrary ACL output"));
      return {} as ReturnType<typeof execFile>;
    });
    await expect(readAlpha17OperatorConfig(path, now)).rejects.toThrow("OPERATOR_POLICY_FILE_UNSAFE");
    const invocation = vi.mocked(execFile).mock.calls.at(-1)!;
    expect(invocation[1]).toContain("-Verify");
  });
});
