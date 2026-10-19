import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assert } from "../../shared/src/index";
import {
  OPERATOR_PERMISSIONS,
  type Alpha16OperatorOptions,
  type Alpha16OperatorPolicy,
} from "./alpha16-operator";
import { approvedRetention, type Alpha16RetentionPolicy } from "./alpha16-retention";

export const ALPHA17_OPERATOR_READ_PERMISSIONS = [
  "OPERATOR_STATUS_READ", "OPERATOR_ADMISSION_READ", "OPERATOR_RECOVERY_READ",
  "OPERATOR_AUDIT_READ", "OPERATOR_CONFIG_READ", "OPERATOR_PUBLICATION_READ", "OPERATOR_LEGAL_READ",
] as const;
export const ALPHA17_OPERATOR_MUTATION_PERMISSIONS = [
  "OPERATOR_ADMISSION_MANAGE", "OPERATOR_BETA_LIFECYCLE_MANAGE", "OPERATOR_PRIVACY_ERASE_GUILD",
  "OPERATOR_AUTOMATION_CONTROL", "OPERATOR_PRIVACY_DELETE_GUILD", "OPERATOR_PRIVACY_DELETE_GLOBAL",
  "OPERATOR_ANNOUNCEMENT_PUBLISH", "OPERATOR_LEGAL_MANAGE",
] as const;
const configuredRetentionClasses = ["OPERATOR_PREVIEW", "OPERATOR_STEP_UP", "AUDIT", "OPERATOR_CONTROL"] as const;
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const duration = z.number().safe().int().positive();
const retentionEntry = z.object({
  class: z.enum(configuredRetentionClasses),
  revision: identifier,
  approvalReference: identifier,
  durationMs: duration,
}).strict();
export const alpha17OperatorConfigSchema = z.object({
  schemaVersion: z.literal(1),
  revision: identifier,
  approval: z.object({
    reference: identifier,
    approvedAt: z.iso.datetime(),
    validUntil: z.iso.datetime(),
  }).strict(),
  // Both permission groups share one explicitly approved scope. Combining two
  // different scopes would silently broaden mutation permissions.
  scope: z.object({
    guildIds: z.array(z.string().regex(/^\d{17,20}$/)).max(1000).refine(unique),
    global: z.boolean(),
  }).strict(),
  readGrant: z.object({
    permissions: z.array(z.enum(ALPHA17_OPERATOR_READ_PERMISSIONS)).refine(unique),
  }).strict(),
  mutationGrant: z.object({
    permissions: z.array(z.enum(ALPHA17_OPERATOR_MUTATION_PERMISSIONS)).refine(unique),
  }).strict(),
  retention: z.array(retentionEntry).max(configuredRetentionClasses.length)
    .refine((entries) => unique(entries.map((entry) => entry.class))),
  stepUp: z.object({
    previewMs: duration, stepUpMs: duration, challengeMs: duration,
  }).strict().nullable(),
  maintenance: z.object({
    batchSize: z.number().safe().int().positive().max(1000),
    intervalMs: z.number().safe().int().min(1000).max(60000),
    leaseMs: z.number().safe().int().min(1000).max(120000),
  }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (Date.parse(value.approval.validUntil) <= Date.parse(value.approval.approvedAt)) issue("APPROVAL_WINDOW_INVALID");
  if (value.maintenance && (value.maintenance.leaseMs <= value.maintenance.intervalMs
      || value.maintenance.leaseMs > value.maintenance.intervalMs * 2)) issue("MAINTENANCE_LEASE_INVALID");
  // Reuse existing approved caps. These literals describe source-reviewed local
  // enforcement only; no JSON enforcementVerified/coverage boolean is accepted.
  for (const entry of value.retention)
    if (!approvedRetention([{ class: entry.class, revision: entry.revision, durationMs: entry.durationMs, approved: true, enforcementVerified: true }], entry.class)) issue("RETENTION_LIMIT");
  if (value.stepUp) {
    const preview = value.retention.find((entry) => entry.class === "OPERATOR_PREVIEW");
    const stepUp = value.retention.find((entry) => entry.class === "OPERATOR_STEP_UP");
    if (preview && value.stepUp.previewMs > preview.durationMs) issue("PREVIEW_RETENTION_LIMIT");
    if (stepUp && (value.stepUp.stepUpMs > stepUp.durationMs || value.stepUp.challengeMs > stepUp.durationMs)) issue("STEP_UP_RETENTION_LIMIT");
    if (value.stepUp.stepUpMs > value.stepUp.previewMs || value.stepUp.challengeMs > value.stepUp.previewMs) issue("STEP_UP_PREVIEW_LIMIT");
  }
});
export type Alpha17OperatorConfig = z.infer<typeof alpha17OperatorConfigSchema>;
const MAX_CONFIG_BYTES = 65536;
const unsafe = () => { throw new Error("OPERATOR_POLICY_FILE_UNSAFE"); };

async function verifyPrivatePath(path: string, directory: boolean) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) || (!directory && info.nlink !== 1)) unsafe();
  if (process.platform === "win32") {
    await new Promise<void>((accept, reject) => execFile("powershell.exe", [
      "-NoLogo", "-NoProfile", "-File",
      fileURLToPath(new URL("../../../scripts/operator-acl.ps1", import.meta.url)),
      "-Path", path, "-Verify",
    ], { timeout: 10000 }, (error) => error ? reject(new Error("OPERATOR_POLICY_FILE_UNSAFE")) : accept()));
  } else if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) unsafe();
  return info;
}

/** Read-only: no mkdir, chmod, ACL repair or credential generation. */
export async function verifyAlpha17OperatorConfigPath(path: string) {
  // Network shares/device namespaces are not an OS-local configuration source.
  if (!isAbsolute(path) || /^(?:\\\\|\/\/)/.test(path) || path.includes("\0")) unsafe();
  const absolute = resolve(path), root = parse(absolute).root;
  if (process.platform === "win32" && absolute.slice(root.length).includes(":")) unsafe();
  for (let current = dirname(absolute); current !== root; current = dirname(current)) {
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) unsafe();
  }
  await verifyPrivatePath(dirname(absolute), true);
  return verifyPrivatePath(absolute, false);
}
function checkApproval(config: Alpha17OperatorConfig, now: Date) {
  const clock = now.getTime();
  assert(Number.isFinite(clock) && Date.parse(config.approval.approvedAt) <= clock
    && clock < Date.parse(config.approval.validUntil), "OPERATOR_POLICY_APPROVAL_REQUIRED", 503);
}
async function snapshot(path: string, now: Date) {
  try {
    const before = await verifyAlpha17OperatorConfigPath(path);
    if (before.size < 2 || before.size > MAX_CONFIG_BYTES) unsafe();
    const file = await open(path, "r");
    try {
      const opened = await file.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino
        || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs) unsafe();
      // One bounded read, including an overflow byte, never an unbounded readFile.
      const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const after = await file.stat(), current = await lstat(path);
      if (bytesRead !== opened.size || bytesRead > MAX_CONFIG_BYTES || after.size !== opened.size
        || after.mtimeMs !== opened.mtimeMs || current.ino !== opened.ino || current.dev !== opened.dev
        || current.isSymbolicLink() || current.nlink !== 1) unsafe();
      const raw = buffer.subarray(0, bytesRead);
      const parsed = alpha17OperatorConfigSchema.safeParse(JSON.parse(raw.toString("utf8")));
      assert(parsed.success, "OPERATOR_POLICY_INVALID", 503);
      checkApproval(parsed.data, now);
      return { config: parsed.data, digest: createHash("sha256").update(raw).digest("hex") };
    } finally {
      await file.close();
    }
  } catch (error) {
    // Never expose a path, JSON value, PowerShell output or arbitrary exception.
    const code = error instanceof Error && ["OPERATOR_POLICY_INVALID", "OPERATOR_POLICY_APPROVAL_REQUIRED"].includes(error.message)
      ? error.message : "OPERATOR_POLICY_FILE_UNSAFE";
    assert(false, code, 503);
  }
}
export async function readAlpha17OperatorConfig(path: string, now = new Date()): Promise<Alpha17OperatorConfig> {
  return (await snapshot(path, now))!.config;
}
export type Alpha17OperatorMaintenance = {
  schedule(): Promise<NonNullable<Alpha17OperatorConfig["maintenance"]> | null>;
  recordPass(result: { ready: boolean }, startedAt: Date): void;
  invalidate(): void;
};

/** A current, authenticated local Operator session receives only this file's
 * exact grant. Authentication/CSRF/current permission checks remain server-side.
 * Any file replacement, expiry or verification failure invalidates all grants.
 */
export async function loadAlpha17OperatorConfiguration(
  path: string, options: { now?: () => Date } = {},
): Promise<{ alpha16: Alpha16OperatorOptions; maintenance: Alpha17OperatorMaintenance }> {
  const now = options.now ?? (() => new Date()), initial = (await snapshot(path, now()))!;
  let successfulPassStartedAt: number | null = null, invalidated = false;
  const current = async () => {
    assert(!invalidated, "OPERATOR_POLICY_CHANGED_RESTART_REQUIRED", 503);
    try {
      const read = (await snapshot(path, now()))!;
      assert(read.digest === initial.digest, "OPERATOR_POLICY_CHANGED_RESTART_REQUIRED", 503);
      return read.config;
    } catch (error) {
      // Once an unsafe/changed source is observed, restoring old bytes cannot
      // revive an in-flight process or its old preview approvals.
      invalidated = true;
      successfulPassStartedAt = null;
      throw error;
    }
  };
  const activeRetention = (config: Alpha17OperatorConfig): Alpha16RetentionPolicy => {
    const clock = now().getTime(), schedule = config.maintenance;
    if (!schedule || successfulPassStartedAt === null || successfulPassStartedAt > clock) return [];
    const shortestRetention = Math.min(...config.retention.map((entry) => entry.durationMs));
    // Lease is measured from pass START, never completion, and cannot outlive
    // approval, the shortest original retention or the approved lease duration.
    const expires = Math.min(successfulPassStartedAt + schedule.leaseMs,
      successfulPassStartedAt + shortestRetention, Date.parse(config.approval.validUntil));
    if (clock >= expires) return [];
    return config.retention.map(({ class: kind, revision, durationMs }) => ({
      class: kind, revision, durationMs, approved: true, enforcementVerified: true,
    }));
  };
  return {
    alpha16: {
      policy: async (): Promise<Alpha16OperatorPolicy> => {
        const config = await current();
        return { revision: config.revision, retention: activeRetention(config),
          ...(config.stepUp ?? {}) };
      },
      grant: async (sessionDigest) => {
        assert(/^[a-f0-9]{64}$/.test(sessionDigest), "OPERATOR_LOGIN_REQUIRED", 401);
        const config = await current();
        return { permissions: [...config.readGrant.permissions, ...config.mutationGrant.permissions],
          guildIds: [...config.scope.guildIds], global: config.scope.global };
      },
      configHealth: async () => {
        const config = await current(), verified = activeRetention(config).length > 0;
        return [{ settingKey: "OPERATOR_POLICY", configured: true, valid: true, keyId: config.revision,
          rotationStatus: "CURRENT", blockingReason: null, lastCheckedAt: now().toISOString() },
        { settingKey: "OPERATOR_LOCAL_RETENTION", configured: config.retention.length > 0, valid: verified,
          keyId: null, rotationStatus: "UNKNOWN", blockingReason: verified ? null : "LOCAL_PURGE_UNVERIFIED",
          lastCheckedAt: now().toISOString() }];
      },
    },
    maintenance: {
      schedule: async () => (await current()).maintenance,
      recordPass: (result, startedAt) => {
        const stamp = startedAt.getTime();
        successfulPassStartedAt = result.ready && Number.isFinite(stamp) && stamp <= now().getTime() ? stamp : null;
      },
      invalidate: () => { successfulPassStartedAt = null; },
    },
  };
}

// Keep this assertion close to the schema so a new upstream permission cannot
// silently disappear from the intentional read/mutation split.
assert(OPERATOR_PERMISSIONS.every((permission) =>
  [...ALPHA17_OPERATOR_READ_PERMISSIONS, ...ALPHA17_OPERATOR_MUTATION_PERMISSIONS].includes(permission)),
"OPERATOR_PERMISSION_SCHEMA_INCOMPLETE", 503);
