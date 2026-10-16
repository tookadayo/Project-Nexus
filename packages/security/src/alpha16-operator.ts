import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sql, tenant, json, type Database, type Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { IdentityVault } from "../../identity/src/index";
import type { PublicTokenCipher } from "./public-sessions";
import type { PrivacyService } from "./privacy";
import { operatorDigest, type OperatorAuth } from "./operator-auth";
import { betaChangeSchema, type BetaOperator } from "./beta-operator";
import { scopeForGuild } from "./scoping";
import { publicationChangeSchema, legalSettingsSchema, type OfficialPublications } from "../../operations/src/publication";
import { unconfiguredPublicationReadiness } from "../../presentation/src/alpha16-publication";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "../../rules/src/locks";
import {
  approvedRetention, retentionExpiry, alpha16RestoreReadiness, unknownRestoreEvidence, ALPHA16_MAX_BACKUP_RETENTION_MS,
  type Alpha16RetentionPolicy, type Alpha16RestoreEvidence,
} from "./alpha16-retention";

export const OPERATOR_PERMISSIONS = [
  "OPERATOR_STATUS_READ", "OPERATOR_ADMISSION_READ", "OPERATOR_ADMISSION_MANAGE", "OPERATOR_BETA_LIFECYCLE_MANAGE", "OPERATOR_PRIVACY_ERASE_GUILD",
  "OPERATOR_AUTOMATION_CONTROL", "OPERATOR_PRIVACY_DELETE_GUILD", "OPERATOR_PRIVACY_DELETE_GLOBAL",
  "OPERATOR_ANNOUNCEMENT_PUBLISH", "OPERATOR_LEGAL_MANAGE", "OPERATOR_RECOVERY_READ", "OPERATOR_AUDIT_READ", "OPERATOR_CONFIG_READ",
] as const;
export type OperatorPermission = typeof OPERATOR_PERMISSIONS[number];
export type OperatorGrant = { permissions: readonly OperatorPermission[]; guildIds: readonly string[]; global: boolean };
export const OPERATOR_COMPONENTS = ["PC_PROCESS", "DB", "QUEUE", "WORKER", "DISCORD_OUTBOUND", "TUNNEL_REACHABILITY"] as const;
export type OperatorComponent = typeof OPERATOR_COMPONENTS[number];
export type OperatorHealthObservation = { component: OperatorComponent; state: "UP" | "DEGRADED" | "DOWN" | "UNKNOWN"; lastObservedAt: string | null; validUntil: string | null; errorCode: string | null };
export function operatorHealth(observation: OperatorHealthObservation | undefined, component: OperatorComponent, now: Date): OperatorHealthObservation {
  if (!observation || observation.component !== component) return { component, state: "UNKNOWN", lastObservedAt: null, validUntil: null, errorCode: "OBSERVATION_UNAVAILABLE" };
  const observed = Date.parse(observation.lastObservedAt ?? ""), expires = Date.parse(observation.validUntil ?? "");
  if (!Number.isFinite(observed) || !Number.isFinite(expires) || observed > now.getTime() || expires <= now.getTime() || expires <= observed)
    return { component, state: "UNKNOWN", lastObservedAt: Number.isFinite(observed) ? observation.lastObservedAt : null, validUntil: Number.isFinite(expires) ? observation.validUntil : null, errorCode: "OBSERVATION_EXPIRED_OR_UNVERIFIED" };
  return { component, state: ["UP", "DEGRADED", "DOWN", "UNKNOWN"].includes(observation.state) ? observation.state : "UNKNOWN",
    lastObservedAt: observation.lastObservedAt, validUntil: observation.validUntil,
    errorCode: observation.errorCode && /^[A-Z0-9_]{1,80}$/.test(observation.errorCode) ? observation.errorCode : null };
}

const discordId = z.string().regex(/^\d{17,20}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z.object({ organizationId: z.uuid(), guildId: discordId }).strict();
const reasonSchema = z.enum(["MAINTENANCE", "INCIDENT_REVIEW", "CONFIG_REVIEW", "OPERATOR_REQUEST"]);
export const operatorDeletionInputSchema = z.discriminatedUnion("scopeKind", [
  z.object({ targetType: z.literal("DISCORD_USER"), targetDiscordId: discordId, scopeKind: z.literal("GUILD"), guildId: discordId }).strict(),
  z.object({ targetType: z.literal("DISCORD_USER"), targetDiscordId: discordId, scopeKind: z.literal("GLOBAL"), guildId: z.null() }).strict(),
]);
export const operatorControlInputSchema = z.object({
  scopeKind: z.enum(["GLOBAL", "GUILD", "FLOW", "RULE"]),
  scope: scopeSchema.nullable(), targetId: z.string().min(1).max(128).nullable(),
  action: z.enum(["STOP", "RESUME"]), ifMatch: z.number().safe().int().nonnegative(), reason: reasonSchema,
}).strict().refine((v) => v.scopeKind === "GLOBAL" ? v.scope === null && v.targetId === null
  : v.scope !== null && (v.scopeKind === "GUILD" ? v.targetId === null : v.targetId !== null), "SCOPE_MISMATCH");
export type OperatorControlInput = z.infer<typeof operatorControlInputSchema>;
const confirmSchema = z.object({ previewId: z.uuid(), previewHash: digestSchema, stepUpToken: z.string().min(1).max(256), confirmation: z.literal(true) }).strict();
const legalChangeSchema = z.object({ expectedRevision: z.number().int().nonnegative(), requestId: z.uuid(), settings: legalSettingsSchema }).strict();
const previewPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PRIVACY_DELETE"), input: operatorDeletionInputSchema, scope: scopeSchema, subjectHash: digestSchema,
    targetRevision: z.string().min(1).max(160), planRevision: z.literal("alpha16-privacy-v1"), dataClasses: z.array(z.string().max(80)).max(30) }).strict(),
  z.object({ kind: z.literal("CONTROL"), input: operatorControlInputSchema }).strict(),
  z.object({ kind: z.literal("ADMISSION"), input: betaChangeSchema }).strict(),
  z.object({ kind: z.literal("BETA_LIFECYCLE"), input: betaChangeSchema, deletionState: z.enum(["PENDING", "ERASED", "DONE"]).nullable(),
    targetType: z.literal("GUILD_SAVED_DATA") }).strict(),
  z.object({ kind: z.literal("ANNOUNCEMENT"), input: publicationChangeSchema, reason: reasonSchema }).strict(),
  z.object({ kind: z.literal("LEGAL_SETTINGS"), input: legalChangeSchema, reason: reasonSchema }).strict(),
]);
type PreviewPayload = z.infer<typeof previewPayloadSchema>;
type PreviewRow = { id: string; session_digest: string; command_kind: string; fingerprint: string; preview_hash: string; typed_payload: unknown; policy_revision: string; expires_at: Date; consumed_at: Date | null };
type JobRow = { id: string; organization_id: string; guild_id: string; tombstone_id: string; subject_hash: string; subject_ciphertext: string | null; state: string; state_version: string | number; attempt_count: number; live_completed_at: Date | null; backup_state: string; backup_expiry_at: Date | null; created_at: Date; updated_at: Date; expires_at: Date };
export type OperatorConfigHealth = { settingKey: string; configured: boolean; valid: boolean; keyId: string | null; rotationStatus: "CURRENT" | "REQUIRED" | "UNKNOWN"; blockingReason: string | null; lastCheckedAt: string };
export type Alpha16OperatorPolicy = {
  revision: string;
  retention: Alpha16RetentionPolicy;
  previewMs?: number; stepUpMs?: number; challengeMs?: number;
  receiptRateWindowMs?: number; receiptMaxUsesPerWindow?: number; receiptMaxTotalUses?: number;
  deletionLeaseMs?: number;
  /** Per-source review, not a user supplied boolean. Must cover existing writers,
   * derived stores and queue scrub before a new deletion can be accepted. */
  guildDeletionWriterCoverageVerified?: boolean;
  betaLifecycleScopeVerified?: boolean;
  guildErasureScopeVerified?: boolean;
};
export type Alpha16OperatorOptions = {
  policy?: () => Promise<Alpha16OperatorPolicy>;
  grant?: (sessionDigest: string, tx: Tx) => Promise<OperatorGrant>;
  vault?: IdentityVault;
  publicSessionCipher?: PublicTokenCipher;
  privacy?: PrivacyService;
  beta?: BetaOperator;
  publications?: OfficialPublications;
  health?: () => Promise<readonly OperatorHealthObservation[]>;
  recovery?: () => Promise<Alpha16RestoreEvidence>;
  configHealth?: () => Promise<readonly OperatorConfigHealth[]>;
};
const hash = (purpose: string, value: string) => createHash("sha256").update("nexus:alpha16:" + purpose + ":").update(value).digest("hex");
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
}
export const operatorPreviewHash = (payload: unknown, policyRevision: string) => hash("preview", canonical({ payload, policyRevision }));
const noGrant: OperatorGrant = { permissions: [], guildIds: [], global: false };
export function authorizeOperator(grant: OperatorGrant, permission: OperatorPermission, guildId?: string, global = false) {
  assert(grant.permissions.includes(permission), "PERMISSION_DENIED", 403);
  assert(!global || grant.global, "PERMISSION_DENIED", 403);
  assert(!guildId || grant.global || grant.guildIds.includes(guildId), "SCOPE_MISMATCH", 422);
}
function positive(value: number | undefined) { return value !== undefined && Number.isSafeInteger(value) && value > 0; }
export function operatorMutationBlockers(policy: Alpha16OperatorPolicy, privacy = false) {
  const required = ["OPERATOR_PREVIEW", "OPERATOR_STEP_UP", "AUDIT"] as const;
  const reasons: string[] = required.filter((kind) => !approvedRetention(policy.retention, kind)).map((kind) => "RETENTION_" + kind + "_UNAPPROVED");
  if (!policy.revision || !positive(policy.previewMs) || !positive(policy.stepUpMs) || !positive(policy.challengeMs)) reasons.push("STEP_UP_POLICY_REQUIRED");
  if (privacy) {
    for (const kind of ["DELETION_RECEIPT", "DELETION_JOB", "TOMBSTONE"] as const)
      if (!approvedRetention(policy.retention, kind)) reasons.push("RETENTION_" + kind + "_UNAPPROVED");
    if (!positive(policy.receiptRateWindowMs) || !positive(policy.receiptMaxUsesPerWindow) || !positive(policy.receiptMaxTotalUses) || !positive(policy.deletionLeaseMs)) reasons.push("DELETION_POLICY_REQUIRED");
    if (!policy.guildDeletionWriterCoverageVerified) reasons.push("DELETION_WRITER_COVERAGE_UNVERIFIED");
  }
  return reasons;
}
export const operatorControlKey = (input: Pick<OperatorControlInput, "scopeKind" | "scope" | "targetId">) =>
  input.scopeKind === "GLOBAL" ? "GLOBAL" : [input.scopeKind, input.scope!.organizationId, input.scope!.guildId, input.targetId ?? ""].join(":");

/** Used by the new alpha16 dispatcher. Missing or expired control state is not
 * permission to resume. Legacy dispatchers keep their existing policy until
 * their writer compatibility contract is migrated. */
export async function readOperatorDispatchGate(tx: Tx, scope: Scope, target: { flowId?: string; ruleId?: string } = {}, now = new Date()) {
  const keys = ["GLOBAL", operatorControlKey({ scopeKind: "GUILD", scope, targetId: null })];
  if (target.flowId) keys.push(operatorControlKey({ scopeKind: "FLOW", scope, targetId: target.flowId }));
  if (target.ruleId) keys.push(operatorControlKey({ scopeKind: "RULE", scope, targetId: target.ruleId }));
  const rows = (await sql<{ scope_key: string; state: string; expires_at: Date }>`SELECT scope_key,state,expires_at FROM alpha16_operator_controls WHERE scope_key=ANY(${keys}::text[])`.execute(tx)).rows;
  const blocked = rows.filter((row) => row.state !== "RUNNING" || row.expires_at.getTime() <= now.getTime());
  const missing = keys.filter((key) => !rows.some((row) => row.scope_key === key));
  return { allowed: blocked.length === 0 && missing.length === 0, blockingScopes: [...blocked.map((row) => row.scope_key), ...missing] };
}

export class Alpha16Operator {
  constructor(private readonly db: Database, private readonly auth: OperatorAuth, private readonly options: Alpha16OperatorOptions = {}) {}
  private async policy(): Promise<Alpha16OperatorPolicy> { return this.options.policy ? this.options.policy() : { revision: "UNCONFIGURED", retention: [] }; }
  private async grant(session: string, tx: Tx = this.db) { return this.options.grant ? this.options.grant(session, tx) : noGrant; }
  private async permission(session: string, permission: OperatorPermission, guildId?: string, global = false, tx: Tx = this.db) {
    authorizeOperator(await this.grant(session, tx), permission, guildId, global);
  }
  async capabilities(session: string) {
    const policy = await this.policy(), grant = await this.grant(session);
    const privacy = operatorMutationBlockers(policy, true);
    if (!this.options.vault || !this.options.publicSessionCipher || !this.options.privacy) privacy.push("PRIVACY_ADAPTER_REQUIRED");
    return { permissions: grant.permissions, guildIds: grant.guildIds, global: grant.global, policyRevision: policy.revision,
      mutationBlockingReasons: operatorMutationBlockers(policy), privacyBlockingReasons: privacy,
      globalDeletionBlockingReasons: ["GLOBAL_WRITER_COVERAGE_UNVERIFIED"],
      admissionBlockingReasons: [...operatorMutationBlockers(policy), ...(!this.options.beta ? ["ADMISSION_STATE_ADAPTER_REQUIRED"] : [])],
      betaLifecycleBlockingReasons: [...operatorMutationBlockers(policy), ...(!policy.betaLifecycleScopeVerified ? ["BETA_LIFECYCLE_CODE_SCOPE_UNVERIFIED"] : []), ...(!policy.guildErasureScopeVerified ? ["GUILD_ERASURE_CODE_SCOPE_UNVERIFIED"] : [])],
      publicationBlockingReasons: unconfiguredPublicationReadiness().blockers,
      publicationDraftBlockingReasons: [...operatorMutationBlockers(policy), ...(!this.options.publications ? ["ANNOUNCEMENT_ADAPTER_REQUIRED"] : [])] };
  }
  async status(session: string) {
    await this.permission(session, "OPERATOR_STATUS_READ");
    const observations = await this.options.health?.().catch(() => []) ?? [], now = new Date();
    return { generatedAt: now.toISOString(), components: OPERATOR_COMPONENTS.map((component) => operatorHealth(observations.find((row) => row.component === component), component, now)) };
  }
  async recovery(session: string) {
    await this.permission(session, "OPERATOR_RECOVERY_READ");
    return alpha16RestoreReadiness(await this.options.recovery?.().catch(() => unknownRestoreEvidence()) ?? unknownRestoreEvidence());
  }
  async configHealth(session: string) {
    await this.permission(session, "OPERATOR_CONFIG_READ");
    const policy = await this.policy();
    const extra = await this.options.configHealth?.() ?? [];
    // Fixed keys and boolean/status metadata only. A provider cannot return an
    // arbitrary credential object through this public response projection.
    const items = extra.map((row) => ({ settingKey: z.string().regex(/^[A-Z0-9_.-]{1,100}$/).parse(row.settingKey),
      configured: row.configured === true, valid: row.valid === true,
      keyId: row.keyId && /^[A-Za-z0-9_.-]{1,80}$/.test(row.keyId) ? row.keyId : null,
      rotationStatus: z.enum(["CURRENT", "REQUIRED", "UNKNOWN"]).parse(row.rotationStatus),
      blockingReason: row.blockingReason && /^[A-Z0-9_]{1,100}$/.test(row.blockingReason) ? row.blockingReason : null,
      lastCheckedAt: z.iso.datetime().parse(row.lastCheckedAt) }));
    return { items, mutationBlockingReasons: operatorMutationBlockers(policy), privacyBlockingReasons: operatorMutationBlockers(policy, true), policyRevision: policy.revision };
  }
  async admissions(session: string) {
    await this.permission(session, "OPERATOR_ADMISSION_READ");
    const grant = await this.grant(session);
    const items = (await sql<{ guild_id: string; status: string; generation: number; limits: unknown; updated_at: Date; deletion_state: string | null }>`SELECT b.guild_id,b.status,b.generation,b.limits,b.updated_at,d.state AS deletion_state FROM beta_guild_invitations b LEFT JOIN beta_deletion_jobs d ON d.organization_id=b.organization_id AND d.guild_id=b.guild_id WHERE ${grant.global ? sql`true` : sql`b.guild_id=ANY(${[...grant.guildIds]}::text[])`} ORDER BY b.created_at,b.guild_id`.execute(this.db)).rows;
    const policy = await this.policy(), canChange = grant.permissions.includes("OPERATOR_ADMISSION_MANAGE") && !operatorMutationBlockers(policy).length && !!this.options.beta;
    const canLifecycle = grant.permissions.includes("OPERATOR_BETA_LIFECYCLE_MANAGE") && grant.permissions.includes("OPERATOR_PRIVACY_ERASE_GUILD") && policy.betaLifecycleScopeVerified && policy.guildErasureScopeVerified && !operatorMutationBlockers(policy).length && !!this.options.beta;
    return { items: items.map((row) => ({ applicationId: row.guild_id, guildId: row.guild_id, betaState: row.status, revision: row.generation, limit: row.limits, updatedAt: row.updated_at,
      deletionState: row.deletion_state,
      allowedTransitions: !canChange ? [] : row.status === "REGISTERED" ? ["activate"] : row.status === "ACTIVE" ? ["pause"] : row.status === "PAUSED" ? ["resume"] : [],
      allowedLifecycleActions: !canLifecycle ? [] : ["PENDING", "ERASED"].includes(row.deletion_state ?? "") ? ["retryDeletion"] : !["REVOKED", "DELETING", "DELETED"].includes(row.status) ? ["revoke", "unlink", "delete"] : [] })),
      blockingReasons: [...operatorMutationBlockers(policy), ...(!this.options.beta ? ["ADMISSION_STATE_ADAPTER_REQUIRED"] : [])] };
  }
  async announcements(session: string) {
    await this.permission(session, "OPERATOR_ANNOUNCEMENT_PUBLISH");
    const source = await this.options.publications?.list() ?? [];
    return { items: source.map((item) => ({ ...item, announcementId: item.id, draftRevision: item.editRevision,
      sourcePublicationState: item.status, publicationState: item.status === "DRAFT" ? "DRAFT" : "UNKNOWN",
      artifactVersion: null, artifactHash: null, syncState: "UNVERIFIED" })), blockingReasons: unconfiguredPublicationReadiness().blockers,
      draftBlockingReasons: operatorMutationBlockers(await this.policy()) };
  }
  async announcementDetail(session: string, id: string) {
    await this.permission(session, "OPERATOR_ANNOUNCEMENT_PUBLISH");
    assert(this.options.publications, "ANNOUNCEMENT_ADAPTER_REQUIRED", 503);
    return this.options.publications.detail(z.uuid().parse(id));
  }
  async legal(session: string) {
    await this.permission(session, "OPERATOR_LEGAL_MANAGE", undefined, true);
    assert(this.options.publications, "ANNOUNCEMENT_ADAPTER_REQUIRED", 503);
    return { ...await this.options.publications.legal(), draftBlockingReasons: operatorMutationBlockers(await this.policy()) };
  }
  async audit(session: string) {
    await this.permission(session, "OPERATOR_AUDIT_READ");
    const grant = await this.grant(session);
    const events = (await sql<{ request_id: string; action: string; guild_id: string | null; result: string; occurred_at: Date }>`SELECT request_id,action,guild_id,result,occurred_at FROM operator_audit WHERE ${grant.global ? sql`true` : sql`guild_id=ANY(${[...grant.guildIds]}::text[])`} ORDER BY occurred_at DESC LIMIT 100`.execute(this.db)).rows;
    return { events: events.map((event) => ({ actor: "LOCAL_OPERATOR", action: event.action, scope: event.guild_id ? "GUILD" : "GLOBAL", outcome: event.result, requestId: event.request_id, at: event.occurred_at })) };
  }
  async controls(session: string) {
    await this.permission(session, "OPERATOR_AUTOMATION_CONTROL");
    const grant = await this.grant(session), policy = await this.policy();
    const items = (await sql`SELECT scope_kind,guild_id,target_id,state,revision,reason_code,updated_at,expires_at FROM alpha16_operator_controls WHERE ${grant.global ? sql`true` : sql`guild_id=ANY(${[...grant.guildIds]}::text[])`} ORDER BY scope_key`.execute(this.db)).rows;
    return { items, blockingReasons: [...operatorMutationBlockers(policy), ...(!approvedRetention(policy.retention, "OPERATOR_CONTROL") ? ["RETENTION_OPERATOR_CONTROL_UNAPPROVED"] : [])], missedSchedulePolicy: "SKIP", unknownResendAllowed: false };
  }
  private async readPreview(tx: Tx, session: string, id: string) {
    const row = (await sql<PreviewRow>`SELECT * FROM alpha16_operator_previews WHERE id=${id}::uuid AND session_digest=${session} FOR UPDATE`.execute(tx)).rows[0];
    assert(row, "TARGET_NOT_FOUND", 404);
    assert(row.expires_at.getTime() > Date.now(), "PREVIEW_EXPIRED", 410);
    return row;
  }
  private async savePreview(session: string, payload: PreviewPayload, policy: Alpha16OperatorPolicy) {
    const now = new Date(), cap = retentionExpiry(policy.retention, "OPERATOR_PREVIEW", now);
    const expiresAt = new Date(Math.min(cap.getTime(), now.getTime() + policy.previewMs!));
    const previewHash = operatorPreviewHash(payload, policy.revision), id = randomUUID();
    await sql`INSERT INTO alpha16_operator_previews(id,session_digest,command_kind,fingerprint,preview_hash,typed_payload,policy_revision,expires_at) VALUES(${id}::uuid,${session},${payload.kind},${hash("fingerprint", canonical(payload))},${previewHash},${json(payload)},${policy.revision},${expiresAt})`.execute(this.db);
    return { previewId: id, previewHash, expiresAt: expiresAt.toISOString(), policyRevision: policy.revision };
  }
  private async deletionTarget(tx: Tx, input: z.infer<typeof operatorDeletionInputSchema>) {
    assert(input.scopeKind === "GUILD", "GLOBAL_WRITER_COVERAGE_UNVERIFIED", 503);
    assert(this.options.vault, "PRIVACY_ADAPTER_REQUIRED", 503);
    const scope = (await sql<{ organizationId: string; guildId: string }>`SELECT organization_id AS "organizationId",guild_id AS "guildId" FROM guilds WHERE guild_id=${input.guildId}`.execute(tx)).rows[0];
    assert(scope, "TARGET_NOT_FOUND", 404);
    const subjectHash = this.options.vault.hash(scope, input.targetDiscordId);
    const target = (await sql<{ id: string; active: boolean }>`SELECT m.id,EXISTS(SELECT 1 FROM membership_episodes e WHERE e.organization_id=m.organization_id AND e.guild_id=m.guild_id AND e.identity_id=m.id AND e.left_at IS NULL) AS active FROM member_identity_map m WHERE ${tenant(scope)} AND lookup_hash=${subjectHash}`.execute(tx)).rows[0];
    assert(target, "TARGET_NOT_FOUND", 404);
    return { scope, subjectHash, targetRevision: target.id, targetState: target.active ? "ACTIVE" : "DEPARTED" };
  }
  async previewDeletion(session: string, raw: unknown) {
    const input = operatorDeletionInputSchema.parse(raw), policy = await this.policy();
    await this.permission(session, input.scopeKind === "GLOBAL" ? "OPERATOR_PRIVACY_DELETE_GLOBAL" : "OPERATOR_PRIVACY_DELETE_GUILD", input.guildId ?? undefined, input.scopeKind === "GLOBAL");
    assert(!operatorMutationBlockers(policy, true).length, "PRIVACY_POLICY_REQUIRED", 503);
    assert(this.options.vault && this.options.publicSessionCipher && this.options.privacy, "PRIVACY_ADAPTER_REQUIRED", 503);
    const target = await this.deletionTarget(this.db, input);
    const dataClasses = ["PRIMARY", "SESSION", "CACHE", "QUEUE", "FACT", "SUGGESTION", "DRAFT", "EVIDENCE", "IDEMPOTENCY"];
    const payload: PreviewPayload = { kind: "PRIVACY_DELETE", input, scope: target.scope, subjectHash: target.subjectHash, targetRevision: target.targetRevision, planRevision: "alpha16-privacy-v1", dataClasses };
    return { ...await this.savePreview(session, payload, policy), targetDiscordId: input.targetDiscordId, scopeKind: input.scopeKind, guildId: input.guildId,
      targetState: target.targetState, includedDataClasses: dataClasses,
      excludedDataClasses: ["DISCORD_MESSAGES_NOT_OWNED_BY_NEXUS"], residualDataClasses: ["BACKUP_UNTIL_CONFIRMED_EXPIRY", "MINIMAL_APPROVED_DELETION_RECEIPT"],
      irreversibleBoundary: "TOMBSTONE_COMMIT", deletionPlanRevision: payload.planRevision };
  }
  async previewControl(session: string, raw: unknown) {
    const input = operatorControlInputSchema.parse(raw), policy = await this.policy();
    await this.permission(session, "OPERATOR_AUTOMATION_CONTROL", input.scope?.guildId, input.scopeKind === "GLOBAL");
    assert(!operatorMutationBlockers(policy).length && approvedRetention(policy.retention, "OPERATOR_CONTROL"), "OPERATOR_POLICY_REQUIRED", 503);
    const row = (await sql<{ revision: string | number }>`SELECT revision FROM alpha16_operator_controls WHERE scope_key=${operatorControlKey(input)}`.execute(this.db)).rows[0];
    assert(Number(row?.revision ?? 0) === input.ifMatch, "VERSION_MISMATCH", 412);
    return { ...await this.savePreview(session, { kind: "CONTROL", input }, policy), target: input, dispatchOnly: true, cancelsAdmittedEffects: false, replaysUnknown: false, missedSchedulePolicy: "SKIP" };
  }
  async previewAdmission(session: string, raw: unknown) {
    const input = betaChangeSchema.parse(raw), policy = await this.policy();
    assert(["register", "activate", "pause", "resume", "extend", "limits"].includes(input.action), "ADMISSION_PRIVACY_COMMAND_SEPARATE", 428);
    reasonSchema.parse(input.reason);
    await this.permission(session, "OPERATOR_ADMISSION_MANAGE", input.guildId);
    assert(!operatorMutationBlockers(policy).length && this.options.beta, "OPERATOR_POLICY_REQUIRED", 503);
    const current = (await sql<{ generation: number; status: string }>`SELECT generation,status FROM beta_guild_invitations WHERE guild_id=${input.guildId}`.execute(this.db)).rows[0];
    assert((current?.generation ?? null) === input.generation, "VERSION_MISMATCH", 412);
    // Native domain still checks the exact transition, grant, capacity, Bot
    // membership and deletion state at confirm. No invite or billing request.
    return { ...await this.savePreview(session, { kind: "ADMISSION", input }, policy), target: { guildId: input.guildId, action: input.action, revision: input.generation, reason: input.reason }, externalInvitationIssued: false, billingChange: false };
  }
  async previewBetaLifecycle(session: string, raw: unknown) {
    const input = betaChangeSchema.parse(raw), policy = await this.policy();
    assert(["revoke", "unlink", "delete", "retryDeletion"].includes(input.action), "INVALID_REQUEST", 400);
    reasonSchema.parse(input.reason);
    await this.permission(session, "OPERATOR_BETA_LIFECYCLE_MANAGE", input.guildId);
    await this.permission(session, "OPERATOR_PRIVACY_ERASE_GUILD", input.guildId);
    assert(policy.betaLifecycleScopeVerified && policy.guildErasureScopeVerified, "GUILD_ERASURE_CODE_SCOPE_UNVERIFIED", 503);
    assert(!operatorMutationBlockers(policy).length && this.options.beta, "OPERATOR_POLICY_REQUIRED", 503);
    const scope = scopeForGuild(input.guildId);
    const current = (await sql<{ generation: number }>`SELECT generation FROM beta_guild_invitations WHERE ${tenant(scope)}`.execute(this.db)).rows[0];
    assert(current && current.generation === input.generation, "VERSION_MISMATCH", 412);
    const deletion = (await sql<{ state: "PENDING" | "ERASED" | "DONE" }>`SELECT state FROM beta_deletion_jobs WHERE ${tenant(scope)}`.execute(this.db)).rows[0];
    if (input.action === "retryDeletion") assert(deletion && ["PENDING", "ERASED"].includes(deletion.state), "STATE_CONFLICT", 409);
    return { ...await this.savePreview(session, { kind: "BETA_LIFECYCLE", input, deletionState: deletion?.state ?? null, targetType: "GUILD_SAVED_DATA" }, policy),
      target: { targetType: "GUILD_SAVED_DATA", guildId: input.guildId, revision: input.generation, action: input.action, deletionState: deletion?.state ?? null },
      impact: { stopCollection: true, revokeWebAccess: true, queueWholeGuildDataErasure: input.action !== "retryDeletion", retryOnlyIncompletePurge: input.action === "retryDeletion",
        cancelQueuedAndRunningAnalyses: input.action !== "retryDeletion", admittedExternalEffectsCancelled: false, unknownExternalEffectsReplayed: false,
        discordMessagesDeleted: false, billingContractChanged: false, externalInvitationIssued: false }, irreversibleBoundary: "GUILD_TOMBSTONE_COMMIT" };
  }
  async previewAnnouncement(session: string, raw: unknown) {
    const data = z.object({ input: publicationChangeSchema, reason: reasonSchema }).strict().parse(raw), policy = await this.policy();
    await this.permission(session, "OPERATOR_ANNOUNCEMENT_PUBLISH", undefined, true);
    assert(!operatorMutationBlockers(policy).length && this.options.publications, "OPERATOR_POLICY_REQUIRED", 503);
    assert(!["publish", "withdraw"].includes(data.input.action) || unconfiguredPublicationReadiness().enabled, "PUBLIC_PUBLISH_UNAVAILABLE", 503);
    const prepared = this.options.publications.prepareChange(data.input);
    return { ...await this.savePreview(session, { kind: "ANNOUNCEMENT", input: prepared.input, reason: data.reason }, policy),
      target: { announcementId: data.input.id, action: data.input.action, revision: data.input.expectedRevision, contentHash: hash("publication-content", canonical(data.input.content ?? null)), reason: data.reason },
      publicationBlockingReasons: unconfiguredPublicationReadiness().blockers, publicSiteChanged: false };
  }
  async previewLegal(session: string, raw: unknown) {
    const data = z.object({ input: legalChangeSchema, reason: reasonSchema }).strict().parse(raw), policy = await this.policy();
    await this.permission(session, "OPERATOR_LEGAL_MANAGE", undefined, true);
    assert(!operatorMutationBlockers(policy).length && this.options.publications, "OPERATOR_POLICY_REQUIRED", 503);
    const prepared = this.options.publications.prepareLegalChange(data.input);
    return { ...await this.savePreview(session, { kind: "LEGAL_SETTINGS", input: prepared.input, reason: data.reason }, policy),
      target: { targetType: "LEGAL_SETTINGS", revision: data.input.expectedRevision, contentHash: hash("legal-settings", canonical(data.input.settings)), reason: data.reason }, releaseBlocked: true };
  }
  async challenge(session: string, previewId: unknown) {
    const id = z.uuid().parse(previewId), policy = await this.policy();
    assert(!operatorMutationBlockers(policy).length, "STEP_UP_POLICY_REQUIRED", 503);
    return this.db.transaction().execute(async (tx) => {
      const preview = await this.readPreview(tx, session, id);
      assert(!preview.consumed_at, "STATE_CONFLICT", 409);
      assert(!(await sql`SELECT id FROM alpha16_operator_challenges WHERE preview_id=${id}::uuid`.execute(tx)).rows.length, "STATE_CONFLICT", 409);
      const secret = "n16challenge." + randomBytes(32).toString("base64url"), challengeId = randomUUID();
      const expiresAt = new Date(Math.min(preview.expires_at.getTime(), Date.now() + policy.challengeMs!, retentionExpiry(policy.retention, "OPERATOR_STEP_UP", new Date()).getTime()));
      await sql`INSERT INTO alpha16_operator_challenges(id,preview_id,session_digest,challenge_hash,expires_at) VALUES(${challengeId}::uuid,${id}::uuid,${session},${hash("challenge", secret)},${expiresAt})`.execute(tx);
      return { challengeId, challenge: secret, previewId: id, expiresAt: expiresAt.toISOString() };
    });
  }
  async reauthenticate(sessionValue: string, csrf: string, raw: unknown) {
    const input = z.object({ challengeId: z.uuid(), challenge: z.string().regex(/^n16challenge\.[A-Za-z0-9_-]{43}$/), password: z.string().min(1).max(1024) }).strict().parse(raw);
    const session = operatorDigest(sessionValue), policy = await this.policy();
    assert(!operatorMutationBlockers(policy).length, "STEP_UP_POLICY_REQUIRED", 503);
    const factor = await this.auth.reauthenticate(sessionValue, input.password, csrf);
    return this.db.transaction().execute(async (tx) => {
      const reference = (await sql<{ preview_id: string }>`SELECT preview_id FROM alpha16_operator_challenges WHERE id=${input.challengeId}::uuid AND session_digest=${session} AND challenge_hash=${hash("challenge", input.challenge)}`.execute(tx)).rows[0];
      assert(reference, "STEP_UP_REQUIRED", 403);
      // Same preview-first order as confirm and expiry cascade, including when
      // the challenge has already expired or another verifier is racing.
      const preview = await this.readPreview(tx, session, reference.preview_id);
      const row = (await sql<{ preview_id: string; expires_at: Date; consumed_at: Date | null }>`SELECT preview_id,expires_at,consumed_at FROM alpha16_operator_challenges WHERE id=${input.challengeId}::uuid AND session_digest=${session} AND challenge_hash=${hash("challenge", input.challenge)} FOR UPDATE`.execute(tx)).rows[0];
      assert(row && !row.consumed_at && row.expires_at.getTime() > Date.now(), "STEP_UP_REQUIRED", 403);
      assert(!preview.consumed_at && preview.policy_revision === policy.revision, "STATE_CONFLICT", 409);
      const token = "n16stepup." + randomBytes(32).toString("base64url"), expiresAt = new Date(Math.min(preview.expires_at.getTime(), Date.now() + policy.stepUpMs!, retentionExpiry(policy.retention, "OPERATOR_STEP_UP", new Date()).getTime()));
      await sql`UPDATE alpha16_operator_challenges SET consumed_at=clock_timestamp() WHERE id=${input.challengeId}::uuid`.execute(tx);
      await sql`INSERT INTO alpha16_operator_stepups(token_hash,preview_id,session_digest,credential_epoch,preview_hash,expires_at) VALUES(${hash("stepup", token)},${preview.id}::uuid,${session},${factor.credentialEpoch}::uuid,${preview.preview_hash},${expiresAt})`.execute(tx);
      return { stepUpToken: token, previewId: preview.id, expiresAt: expiresAt.toISOString() };
    });
  }
  private async consumeStepUp(tx: Tx, session: string, preview: PreviewRow, token: string) {
    assert(/^n16stepup\.[A-Za-z0-9_-]{43}$/.test(token), "STEP_UP_REQUIRED", 403);
    const result = await sql`UPDATE alpha16_operator_stepups s SET consumed_at=clock_timestamp() FROM operator_sessions o WHERE s.token_hash=${hash("stepup", token)} AND s.preview_id=${preview.id}::uuid AND s.preview_hash=${preview.preview_hash} AND s.session_digest=${session} AND s.consumed_at IS NULL AND s.expires_at>clock_timestamp() AND o.digest=s.session_digest AND o.credential_epoch=s.credential_epoch AND o.revoked_at IS NULL AND o.expires_at>clock_timestamp() RETURNING s.token_hash`.execute(tx);
    assert(result.rows.length === 1, "STEP_UP_REQUIRED", 403);
  }
  private async commandReplay(tx: Tx, session: string, key: string, preview: PreviewRow) {
    const keyHash = hash("command-key", session + ":" + key);
    const previous = (await sql<{ fingerprint: string; operation_id: string }>`SELECT fingerprint,operation_id FROM alpha16_operator_commands WHERE idempotency_hash=${keyHash} AND expires_at>clock_timestamp() FOR UPDATE`.execute(tx)).rows[0];
    if (previous) assert(previous.fingerprint === preview.fingerprint, "STATE_CONFLICT", 409);
    return { keyHash, previous };
  }
  async confirm(session: string, raw: unknown, idempotencyKey: string, expectedKind?: PreviewPayload["kind"], routeTarget?: string): Promise<Record<string, unknown>> {
    const input = confirmSchema.parse(raw), key = z.string().min(8).max(200).parse(idempotencyKey), policy = await this.policy();
    assert(!operatorMutationBlockers(policy).length, "OPERATOR_POLICY_REQUIRED", 503);
    // Read outside the transaction only to prepare the complete scope lock set.
    const initial = (await sql<PreviewRow>`SELECT * FROM alpha16_operator_previews WHERE id=${input.previewId}::uuid AND session_digest=${session}`.execute(this.db)).rows[0];
    assert(initial, "TARGET_NOT_FOUND", 404);
    const payload = previewPayloadSchema.parse(initial.typed_payload);
    assert(!expectedKind || payload.kind === expectedKind, "SCOPE_MISMATCH", 422);
    if ((payload.kind === "ADMISSION" || payload.kind === "BETA_LIFECYCLE") && routeTarget) assert(routeTarget === payload.input.guildId, "SCOPE_MISMATCH", 422);
    if (payload.kind === "ANNOUNCEMENT" && routeTarget) assert(routeTarget === payload.input.id, "SCOPE_MISMATCH", 422);
    assert(initial.expires_at.getTime() > Date.now(), "PREVIEW_EXPIRED", 410);
    const admission = payload.kind === "ADMISSION" || payload.kind === "BETA_LIFECYCLE" ? await this.options.beta?.prepareChange(payload.input) : null;
    if (payload.kind === "ADMISSION" || payload.kind === "BETA_LIFECYCLE") assert(admission, "ADMISSION_STATE_ADAPTER_REQUIRED", 503);
    const locks = payload.kind === "PRIVACY_DELETE" ? ruleScopeLockSet(payload.scope, { subjectHashes: [payload.subjectHash] })
      : payload.kind === "ADMISSION" || payload.kind === "BETA_LIFECYCLE" ? ruleScopeLockSet(scopeForGuild(payload.input.guildId))
      : payload.kind === "ANNOUNCEMENT" || payload.kind === "LEGAL_SETTINGS" ? [{ kind: "GLOBAL" as const, mode: "exclusive" as const }]
      : payload.input.scope ? ruleScopeLockSet(payload.input.scope) : [{ kind: "GLOBAL" as const, mode: "exclusive" as const }];
    return this.db.transaction().execute(async (tx) => {
      await acquireRuleScopeLocks(tx, locks);
      if (payload.kind === "PRIVACY_DELETE") {
        // Compatibility fence for old readers. Acquired after the complete new
        // scope set and before any tombstone/job/resource row is locked.
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"privacy:" + payload.scope.organizationId + ":" + payload.scope.guildId},0))`.execute(tx);
        await this.permission(session, "OPERATOR_PRIVACY_DELETE_GUILD", payload.scope.guildId, false, tx);
      } else if (payload.kind === "ADMISSION") {
        await this.permission(session, "OPERATOR_ADMISSION_MANAGE", payload.input.guildId, false, tx);
      } else if (payload.kind === "BETA_LIFECYCLE") {
        const nativeScope = scopeForGuild(payload.input.guildId);
        await sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${"privacy:" + nativeScope.organizationId + ":" + nativeScope.guildId},0))`.execute(tx);
        await this.permission(session, "OPERATOR_BETA_LIFECYCLE_MANAGE", payload.input.guildId, false, tx);
        await this.permission(session, "OPERATOR_PRIVACY_ERASE_GUILD", payload.input.guildId, false, tx);
        assert(policy.betaLifecycleScopeVerified && policy.guildErasureScopeVerified, "GUILD_ERASURE_CODE_SCOPE_UNVERIFIED", 503);
      } else if (payload.kind === "ANNOUNCEMENT") {
        await this.permission(session, "OPERATOR_ANNOUNCEMENT_PUBLISH", undefined, true, tx);
      } else if (payload.kind === "LEGAL_SETTINGS") {
        await this.permission(session, "OPERATOR_LEGAL_MANAGE", undefined, true, tx);
      } else await this.permission(session, "OPERATOR_AUTOMATION_CONTROL", payload.input.scope?.guildId, payload.input.scopeKind === "GLOBAL", tx);
      const preview = await this.readPreview(tx, session, input.previewId);
      assert(preview.policy_revision === policy.revision && preview.preview_hash === input.previewHash && operatorPreviewHash(payload, policy.revision) === input.previewHash, "VERSION_MISMATCH", 412);
      const { keyHash, previous } = await this.commandReplay(tx, session, key, preview);
      if (previous) {
        if (payload.kind === "PRIVACY_DELETE") return this.jobStatus(tx, previous.operation_id);
        return { operationId: previous.operation_id, state: "ACCEPTED", replay: true };
      }
      assert(!preview.consumed_at, "STATE_CONFLICT", 409);
      await this.consumeStepUp(tx, session, preview, input.stepUpToken);
      let result: Record<string, unknown>, operationId: string;
      if (payload.kind === "PRIVACY_DELETE") {
        assert(!operatorMutationBlockers(policy, true).length && this.options.vault && this.options.publicSessionCipher && this.options.privacy, "PRIVACY_POLICY_REQUIRED", 503);
        const tombstone = (await sql`SELECT id FROM deletion_requests WHERE ${tenant(payload.scope)} AND (lookup_hash=${payload.subjectHash} OR lookup_hash IS NULL) ORDER BY id FOR UPDATE`.execute(tx)).rows[0];
        assert(!tombstone, "TOMBSTONED", 409);
        const existing = (await sql<JobRow>`SELECT * FROM alpha16_privacy_jobs WHERE ${tenant(payload.scope)} AND subject_hash=${payload.subjectHash} FOR UPDATE`.execute(tx)).rows[0];
        assert(!existing, "STATE_CONFLICT", 409);
        const target = await this.deletionTarget(tx, payload.input);
        assert(target.targetRevision === payload.targetRevision && target.subjectHash === payload.subjectHash && canonical(target.scope) === canonical(payload.scope), "VERSION_MISMATCH", 412);
        const now = new Date(), tombstoneId = randomUUID(); operationId = randomUUID();
        const jobExpiry = retentionExpiry(policy.retention, "DELETION_JOB", now), receiptExpiry = retentionExpiry(policy.retention, "DELETION_RECEIPT", now);
        const tombstoneExpiry = retentionExpiry(policy.retention, "TOMBSTONE", now);
        assert(tombstoneExpiry.getTime() >= jobExpiry.getTime() + ALPHA16_MAX_BACKUP_RETENTION_MS, "TOMBSTONE_BACKUP_COVERAGE_REQUIRED", 503);
        // Tombstone → sessions → job → receipt, one commit. No external call.
        await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,lookup_hash,alpha16_expires_at) VALUES(${payload.scope.organizationId}::uuid,${payload.scope.guildId},${tombstoneId}::uuid,${payload.subjectHash},${tombstoneExpiry})`.execute(tx);
        await sql`UPDATE public_oauth_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),user_ciphertext='',token_ciphertext=NULL,refresh_owner=NULL,refresh_until=NULL,generation=generation+1 WHERE user_digest=${this.options.publicSessionCipher.userDigest(payload.input.targetDiscordId)}`.execute(tx);
        await sql`INSERT INTO alpha16_privacy_jobs(id,organization_id,guild_id,tombstone_id,subject_hash,subject_ciphertext,scope_kind,preview_hash,plan_revision,state,expires_at) VALUES(${operationId}::uuid,${payload.scope.organizationId}::uuid,${payload.scope.guildId},${tombstoneId}::uuid,${payload.subjectHash},${this.options.vault.seal(payload.scope, payload.input.targetDiscordId)},'GUILD',${preview.preview_hash},${payload.planRevision},'QUEUED',${jobExpiry})`.execute(tx);
        const receiptId = randomUUID(), receiptSecret = "n16del." + randomBytes(32).toString("base64url"), scopeHash = hash("receipt-scope", canonical({ scope: payload.scope, subjectHash: payload.subjectHash }));
        await sql`INSERT INTO alpha16_deletion_receipts(id,job_id,secret_hash,scope_hash,expires_at) VALUES(${receiptId}::uuid,${operationId}::uuid,${hash("receipt", receiptSecret)},${scopeHash},${receiptExpiry})`.execute(tx);
        result = { receiptId, receiptSecret, scopeProof: scopeHash, expiresAt: receiptExpiry.toISOString(), ...await this.jobStatus(tx, operationId) };
      } else if (payload.kind === "ADMISSION") {
        assert(admission && this.options.beta, "ADMISSION_STATE_ADAPTER_REQUIRED", 503);
        assert(["register", "activate", "pause", "resume", "extend", "limits"].includes(payload.input.action), "ADMISSION_PRIVACY_COMMAND_SEPARATE", 428);
        const invitation = await this.options.beta.changeInTransaction(tx, admission);
        operationId = payload.input.requestId;
        result = { operationId, state: invitation.status, revision: invitation.generation, guildId: invitation.guild_id, billingChange: false, externalInvitationIssued: false };
      } else if (payload.kind === "BETA_LIFECYCLE") {
        assert(admission && this.options.beta && ["revoke", "unlink", "delete", "retryDeletion"].includes(payload.input.action), "ADMISSION_STATE_ADAPTER_REQUIRED", 503);
        const scope = scopeForGuild(payload.input.guildId);
        const currentDeletion = (await sql<{ state: string }>`SELECT state FROM beta_deletion_jobs WHERE ${tenant(scope)} FOR UPDATE`.execute(tx)).rows[0];
        assert((currentDeletion?.state ?? null) === payload.deletionState, "VERSION_MISMATCH", 412);
        const invitation = await this.options.beta.changeInTransaction(tx, admission);
        operationId = payload.input.requestId;
        result = { operationId, state: invitation.status, revision: invitation.generation, guildId: invitation.guild_id, erasureTargetType: "GUILD_SAVED_DATA", unknownExternalEffectsReplayed: false };
      } else if (payload.kind === "ANNOUNCEMENT") {
        assert(this.options.publications, "ANNOUNCEMENT_ADAPTER_REQUIRED", 503);
        const publication = await this.options.publications.changeInTransaction(tx, payload.input);
        operationId = payload.input.requestId;
        result = { operationId, state: publication.status, revision: publication.revision, announcementId: publication.id, publicSiteChanged: false };
      } else if (payload.kind === "LEGAL_SETTINGS") {
        assert(this.options.publications, "ANNOUNCEMENT_ADAPTER_REQUIRED", 503);
        const legal = await this.options.publications.saveLegalInTransaction(tx, payload.input);
        operationId = payload.input.requestId;
        result = { operationId, state: "DRAFT", revision: legal.revision, releaseBlocked: true, publicSiteChanged: false };
      } else {
        assert(approvedRetention(policy.retention, "OPERATOR_CONTROL"), "RETENTION_POLICY_REQUIRED", 503);
        const target = payload.input, controlKey = operatorControlKey(target);
        const current = (await sql<{ revision: string | number }>`SELECT revision FROM alpha16_operator_controls WHERE scope_key=${controlKey} FOR UPDATE`.execute(tx)).rows[0];
        assert(Number(current?.revision ?? 0) === target.ifMatch, "VERSION_MISMATCH", 412);
        const state = target.action === "STOP" ? "STOPPED" : "RUNNING", revision = target.ifMatch + 1;
        await sql`INSERT INTO alpha16_operator_controls(scope_key,scope_kind,organization_id,guild_id,target_id,state,revision,reason_code,expires_at) VALUES(${controlKey},${target.scopeKind},${target.scope?.organizationId ?? null}::uuid,${target.scope?.guildId ?? null},${target.targetId},${state},${revision},${target.reason},${retentionExpiry(policy.retention, "OPERATOR_CONTROL", new Date())}) ON CONFLICT(scope_key) DO UPDATE SET state=EXCLUDED.state,revision=EXCLUDED.revision,reason_code=EXCLUDED.reason_code,updated_at=clock_timestamp(),expires_at=EXCLUDED.expires_at`.execute(tx);
        operationId = randomUUID();
        result = { operationId, state, revision, dispatchOnly: true, replaysUnknown: false, missedSchedulePolicy: "SKIP" };
      }
      await sql`INSERT INTO alpha16_operator_commands(idempotency_hash,session_digest,fingerprint,preview_id,operation_id,expires_at) VALUES(${keyHash},${session},${preview.fingerprint},${preview.id}::uuid,${operationId}::uuid,${preview.expires_at})`.execute(tx);
      await sql`INSERT INTO operator_audit(id,request_id,action,guild_id,result,reason,before_state,after_state,retention_class,expires_at) VALUES(${randomUUID()}::uuid,${operationId}::uuid,${payload.kind},${payload.kind === "PRIVACY_DELETE" ? payload.scope.guildId : payload.kind === "ADMISSION" || payload.kind === "BETA_LIFECYCLE" ? payload.input.guildId : payload.kind === "CONTROL" ? payload.input.scope?.guildId ?? null : null},'SUCCEEDED',${payload.kind === "CONTROL" ? payload.input.reason : payload.kind === "ANNOUNCEMENT" || payload.kind === "LEGAL_SETTINGS" ? payload.reason : "OPERATOR_REQUEST"},NULL,NULL,'ALPHA16',${retentionExpiry(policy.retention, "AUDIT", new Date())})`.execute(tx);
      await sql`UPDATE alpha16_operator_previews SET consumed_at=clock_timestamp() WHERE id=${preview.id}::uuid`.execute(tx);
      return result;
    });
  }
  private async jobStatus(tx: Tx, id: string) {
    const job = (await sql<JobRow>`SELECT * FROM alpha16_privacy_jobs WHERE id=${id}::uuid`.execute(tx)).rows[0];
    assert(job, "TARGET_NOT_FOUND", 404);
    return { operationId: job.id, state: job.state, livePurgeState: job.state === "LIVE_COMPLETED" ? "COMPLETED" : job.state === "QUEUED" ? "PENDING" : job.state,
      backupState: job.backup_state, progressClass: job.state === "LIVE_COMPLETED" ? (job.backup_state === "EXPIRED" ? "COMPLETE_LIVE_BACKUP_EXPIRED" : "COMPLETE_LIVE_PENDING_BACKUP_EXPIRY") : "LIVE_PURGE_PENDING",
      acceptedAt: job.created_at.toISOString(), updatedAt: job.updated_at.toISOString() };
  }
  async deletionStatus(session: string | null, receiptId: unknown, proof?: { secret: string; scopeProof: string }) {
    const id = z.uuid().parse(receiptId), policy = await this.policy();
    return this.db.transaction().execute(async (tx) => {
      const row = (await sql<{ job_id: string | null; secret_hash: string; scope_hash: string; issued_at: Date; expires_at: Date; guild_id: string | null; window_start: Date; window_uses: number; use_count: number }>`SELECT r.*,j.guild_id FROM alpha16_deletion_receipts r LEFT JOIN alpha16_privacy_jobs j ON j.id=r.job_id WHERE r.id=${id}::uuid FOR UPDATE OF r`.execute(tx)).rows[0];
      assert(row && row.expires_at.getTime() > Date.now(), "TARGET_NOT_FOUND", 404);
      if (session && row.guild_id) await this.permission(session, "OPERATOR_PRIVACY_DELETE_GUILD", row.guild_id, false, tx);
      else {
        assert(proof && /^n16del\.[A-Za-z0-9_-]{43}$/.test(proof.secret) && /^[a-f0-9]{64}$/.test(proof.scopeProof), "AUTH_REQUIRED", 401);
        const matches = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
        assert(matches(hash("receipt", proof.secret), row.secret_hash) && matches(proof.scopeProof, row.scope_hash), "AUTH_REQUIRED", 401);
        assert(positive(policy.receiptRateWindowMs) && positive(policy.receiptMaxUsesPerWindow) && positive(policy.receiptMaxTotalUses), "DELETION_POLICY_REQUIRED", 503);
        const newWindow = row.window_start.getTime() + policy.receiptRateWindowMs! <= Date.now(), uses = newWindow ? 0 : row.window_uses;
        assert(uses < policy.receiptMaxUsesPerWindow! && row.use_count < policy.receiptMaxTotalUses!, "RATE_LIMITED", 429);
        await sql`UPDATE alpha16_deletion_receipts SET last_used_at=clock_timestamp(),use_count=use_count+1,window_start=${newWindow ? new Date() : row.window_start},window_uses=${uses + 1} WHERE id=${id}::uuid`.execute(tx);
      }
      if (!row.job_id) return { receiptId: id, state: "UNKNOWN", livePurgeState: "UNKNOWN", backupState: "UNKNOWN", progressClass: "STATUS_RECORD_EXPIRED", acceptedAt: row.issued_at.toISOString(), expiresAt: row.expires_at.toISOString() };
      return { receiptId: id, ...await this.jobStatus(tx, row.job_id) };
    });
  }
  /** Called by the existing maintenance worker, never by a receipt holder. */
  async processDeletion(jobId: string) {
    const id = z.uuid().parse(jobId), policy = await this.policy();
    assert(!operatorMutationBlockers(policy, true).length && this.options.vault && this.options.privacy, "PRIVACY_POLICY_REQUIRED", 503);
    const worker = randomUUID();
    const job = await this.db.transaction().execute(async (tx) => {
      const before = (await sql<JobRow>`SELECT * FROM alpha16_privacy_jobs WHERE id=${id}::uuid`.execute(tx)).rows[0];
      assert(before, "TARGET_NOT_FOUND", 404);
      const scope = { organizationId: before.organization_id, guildId: before.guild_id };
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope, { subjectHashes: [before.subject_hash] }));
      assert((await sql`SELECT id FROM deletion_requests WHERE ${tenant(scope)} AND id=${before.tombstone_id}::uuid AND lookup_hash=${before.subject_hash} FOR UPDATE`.execute(tx)).rows.length === 1, "TOMBSTONED", 409);
      const current = (await sql<JobRow>`UPDATE alpha16_privacy_jobs SET worker_owner=${worker}::uuid,lease_until=clock_timestamp()+make_interval(secs=>${policy.deletionLeaseMs! / 1000}),state='RUNNING',state_version=state_version+1,attempt_count=attempt_count+1,updated_at=clock_timestamp() WHERE id=${id}::uuid AND state IN ('QUEUED','PARTIAL_FAILURE','RUNNING') AND expires_at>clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING *`.execute(tx)).rows[0];
      return current ?? null;
    });
    if (!job) return { processed: false };
    const scope = { organizationId: job.organization_id, guildId: job.guild_id };
    try {
      assert(job.subject_ciphertext, "PURGE_INCOMPLETE", 503);
      const userId = this.options.vault!.open(scope, job.subject_ciphertext);
      assert(this.options.vault!.hash(scope, userId) === job.subject_hash, "PURGE_INCOMPLETE", 503);
      await this.options.privacy!.delete(scope, userId, { key: job.subject_hash, permissions: "0", roles: [], source: "SYSTEM", requestId: randomUUID() });
      const completed = await this.db.transaction().execute(async (tx) => {
        await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope, { subjectHashes: [job.subject_hash] }));
        await sql`SELECT id FROM deletion_requests WHERE ${tenant(scope)} AND id=${job.tombstone_id}::uuid FOR UPDATE`.execute(tx);
        return sql`UPDATE alpha16_privacy_jobs SET state='LIVE_COMPLETED',live_completed_at=clock_timestamp(),subject_ciphertext=NULL,worker_owner=NULL,lease_until=NULL,failure_code=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid AND worker_owner=${worker}::uuid AND state_version=${job.state_version}::bigint RETURNING id`.execute(tx);
      });
      if (!completed.rows.length) return { processed: false, state: "CLAIM_LOST" };
      return { processed: true, state: "LIVE_COMPLETED" };
    } catch {
      const failed = await this.db.transaction().execute(async (tx) => {
        await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope, { subjectHashes: [job.subject_hash] }));
        await sql`SELECT id FROM deletion_requests WHERE ${tenant(scope)} AND id=${job.tombstone_id}::uuid FOR UPDATE`.execute(tx);
        return sql`UPDATE alpha16_privacy_jobs SET state='PARTIAL_FAILURE',worker_owner=NULL,lease_until=NULL,failure_code='PURGE_INCOMPLETE',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid AND worker_owner=${worker}::uuid AND state_version=${job.state_version}::bigint RETURNING id`.execute(tx);
      });
      return { processed: failed.rows.length > 0, state: failed.rows.length ? "PARTIAL_FAILURE" : "CLAIM_LOST" };
    }
  }
  /** Missing control state remains fail-closed after finite retention expiry. */
  async purgeEphemeral() {
    return this.db.transaction().execute(async (tx) => {
      await acquireRuleScopeLocks(tx, [{ kind: "GLOBAL", mode: "exclusive" }]);
      await sql`DELETE FROM alpha16_operator_previews WHERE expires_at<=clock_timestamp()`.execute(tx);
      // Factor proofs may have a shorter purpose-specific retention deadline
      // than their preview. Its later cascade cannot substitute for that TTL.
      await sql`DELETE FROM alpha16_operator_stepups WHERE expires_at<=clock_timestamp()`.execute(tx);
      await sql`DELETE FROM alpha16_operator_challenges WHERE expires_at<=clock_timestamp()`.execute(tx);
      await sql`DELETE FROM alpha16_deletion_receipts WHERE expires_at<=clock_timestamp()`.execute(tx);
      await sql`DELETE FROM operator_audit WHERE retention_class='ALPHA16' AND expires_at<=clock_timestamp()`.execute(tx);
      await sql`DELETE FROM alpha16_operator_controls WHERE expires_at<=clock_timestamp()`.execute(tx);
      // Incomplete deletion must be reported before its approved finite job
      // state expires. The existing scoped tombstone is never removed here.
      const incomplete = (await sql`SELECT id FROM alpha16_privacy_jobs WHERE expires_at<=clock_timestamp() AND state<>'LIVE_COMPLETED' LIMIT 1`.execute(tx)).rows.length > 0;
      await sql`UPDATE deletion_requests d SET completed_at=NULL FROM alpha16_privacy_jobs j WHERE j.organization_id=d.organization_id AND j.guild_id=d.guild_id AND j.tombstone_id=d.id AND j.expires_at<=clock_timestamp() AND j.state<>'LIVE_COMPLETED'`.execute(tx);
      await sql`DELETE FROM alpha16_privacy_jobs WHERE expires_at<=clock_timestamp()`.execute(tx);
      // Existing purpose-specific tombstones have NULL here and are unaffected.
      // A failed purge cannot clear its blocking tombstone at a deadline.
      await sql`DELETE FROM deletion_requests d WHERE d.alpha16_expires_at<=clock_timestamp() AND d.completed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM alpha16_privacy_jobs j WHERE j.organization_id=d.organization_id AND j.guild_id=d.guild_id AND j.tombstone_id=d.id)`.execute(tx);
      const orphaned = (await sql`SELECT d.id FROM deletion_requests d WHERE d.alpha16_expires_at IS NOT NULL AND d.completed_at IS NULL AND NOT EXISTS(SELECT 1 FROM alpha16_privacy_jobs j WHERE j.organization_id=d.organization_id AND j.guild_id=d.guild_id AND j.tombstone_id=d.id) LIMIT 1`.execute(tx)).rows.length > 0;
      return { ready: !incomplete && !orphaned, blockingReason: incomplete || orphaned ? "DELETION_LIFECYCLE_EXCEEDED" : null };
    });
  }
}
