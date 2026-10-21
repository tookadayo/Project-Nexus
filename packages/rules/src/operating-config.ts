import { z } from "zod";
import type { Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import { digest, retentionExpiry, type PlatformPolicy } from "./domain";
import { validateRuleConfig, type RuleEngineConfig } from "./rule-config";

const label = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().safe().int().positive();
const scopeSchema = z.object({ organizationId: z.uuid(), guildId: z.string().regex(/^\d{17,20}$/) }).strict();
export const configActivationInput = z.object({ baseConfigVersion: z.number().int().positive().max(2147483646), draftConfigVersion: z.number().int().positive(), draftContentHash: hash }).strict();
export const configRetirementInput = z.object({ baseConfigVersion: z.number().int().positive().max(2147483646), activeConfigVersion: z.number().int().positive(), activeContentHash: hash }).strict();
export type ConfigActivationInput = z.infer<typeof configActivationInput>;
export type ConfigRetirementInput = z.infer<typeof configRetirementInput>;
export const measuredOperatingProfileSchema = z.object({
  kind: z.literal("MEASURED_OPERATIONAL"), scope: scopeSchema, actorHash: hash,
  revision: label, configHash: hash, measuredAt: z.iso.datetime(), measurementExpiresAt: z.iso.datetime(), measurementReference: label,
  observedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), retentionRevision: label, retentionEnforced: z.literal(true),
  sourceRegistryRevision: label, workerReady: z.literal(true),
  budget: z.object({ maxRules: counter, maxFacts: counter, maxTargets: counter, maxDurationMs: counter, maxSteps: counter }).strict(),
  sourceAuthorizations: z.array(z.object({ sourceType: label, expiresAt: z.iso.datetime() }).strict()).max(128),
}).strict();
export type MeasuredOperatingProfile = z.infer<typeof measuredOperatingProfileSchema>;
export type OperatingProfileRequest = Readonly<{ scope: Scope; actorHash: string; config: RuleEngineConfig; configHash: string; retentionRevision: string }>;
/** Trusted measured PC/provider configuration, never request JSON. observe
 * performs external/live checks outside locks; recheck verifies the current
 * registry/measurement/source authorization inside the canonical transaction,
 * using existing local evidence only, with no network or side effects. */
export interface RuleOperatingProfileProvider {
  observe(request: OperatingProfileRequest): Promise<unknown>;
  recheck(tx: Tx, request: OperatingProfileRequest, profile: Readonly<MeasuredOperatingProfile>, now: Date): Promise<void>;
}
export type RuleOperatingProfileProof = Readonly<{ revision: string; expiresAt: string }>;
export function operatingProfileIdentity(profile: MeasuredOperatingProfile) {
  return digest({ scope: profile.scope, revision: profile.revision, configHash: profile.configHash, measuredAt: profile.measuredAt,
    measurementExpiresAt: profile.measurementExpiresAt, measurementReference: profile.measurementReference, retentionRevision: profile.retentionRevision,
    sourceRegistryRevision: profile.sourceRegistryRevision, budget: profile.budget, sourceTypes: profile.sourceAuthorizations.map(source => source.sourceType).sort() });
}
export function assertMeasuredOperatingProfile(profile: MeasuredOperatingProfile, request: OperatingProfileRequest, policy: PlatformPolicy | undefined, now: Date) {
  const parsed = measuredOperatingProfileSchema.parse(profile), config = request.config;
  validateRuleConfig(config);
  assert(config.profile === "OPERATIONAL" && config.approval === "APPROVED" && config.retentionApproved && config.budget && digest(config) === request.configHash, "OPERATING_CONFIG_INVALID", 409);
  assert(parsed.scope.organizationId === request.scope.organizationId && parsed.scope.guildId === request.scope.guildId && parsed.actorHash === request.actorHash
    && parsed.configHash === request.configHash && parsed.retentionRevision === request.retentionRevision && parsed.retentionRevision === policy?.revision,
  "OPERATING_PROFILE_BINDING_MISMATCH", 403);
  const measured = Date.parse(parsed.measuredAt), observed = Date.parse(parsed.observedAt), end = Date.parse(parsed.expiresAt), measurementEnd = Date.parse(parsed.measurementExpiresAt);
  assert(Number.isFinite(now.getTime()) && measured <= observed && observed <= now.getTime() && end > now.getTime() && end <= measurementEnd && measurementEnd > measured, "OPERATING_PROFILE_EXPIRED", 409);
  for (const [kind, maximum] of Object.entries(parsed.budget)) assert(config.budget[kind as keyof typeof config.budget] <= maximum, "OPERATING_BUDGET_EXCEEDED", 409);
  assert(Object.values(config.rules).filter(rule => rule?.enabled).length <= config.budget.maxRules, "OPERATING_BUDGET_EXCEEDED", 409);
  const authorized = parsed.sourceAuthorizations.map(source => source.sourceType);
  assert(new Set(authorized).size === authorized.length && authorized.length === config.approvedSourceTypes.length
    && config.approvedSourceTypes.every(source => authorized.includes(source)) && parsed.sourceAuthorizations.every(source => Date.parse(source.expiresAt) >= end), "OPERATING_SOURCE_AUTHORIZATION_REQUIRED", 403);
  // Evaluation and proposal visibility are independent of external Apply's
  // TARGET_LIVE_SAFETY policy. Every evaluation persistence class is explicit.
  assert(policy?.visibilityApproved, "VISIBILITY_NOT_APPROVED", 409);
  for (const kind of ["CONFIG", "FACT", "SOURCE_HEALTH", "EVALUATION", "SUGGESTION", "HISTORY", "REQUEST_KEY"] as const) retentionExpiry(policy, kind, now);
  return parsed;
}
export class RuleOperatingAdmission {
  private readonly issued = new WeakMap<RuleOperatingProfileProof, { request: OperatingProfileRequest; profile: MeasuredOperatingProfile }>();
  constructor(private readonly provider?: RuleOperatingProfileProvider, private readonly clock: () => Date = () => new Date()) {}
  readiness() { return { enabled: !!this.provider, reasonCode: this.provider ? null : "MEASURED_OPERATING_PROVIDER_UNCONFIGURED" }; }
  async observe(scope: Scope, actor: Actor, config: RuleEngineConfig, policy: PlatformPolicy | undefined) {
    assert(this.provider && policy, "MEASURED_OPERATING_PROVIDER_UNCONFIGURED", 503);
    const request: OperatingProfileRequest = { scope: { ...scope }, actorHash: actor.key, config: structuredClone(config), configHash: digest(config), retentionRevision: policy.revision };
    const profile = assertMeasuredOperatingProfile(measuredOperatingProfileSchema.parse(await this.provider.observe(structuredClone(request))), request, policy, this.clock());
    const proof = Object.freeze({ revision: profile.revision, expiresAt: profile.expiresAt });
    this.issued.set(proof, { request, profile }); return proof;
  }
  async require(tx: Tx, scope: Scope, actor: Actor, config: RuleEngineConfig, policy: PlatformPolicy | undefined, proof: RuleOperatingProfileProof, now: Date) {
    assert(tx.isTransaction && this.provider, "OPERATING_PROFILE_UNVERIFIED", 409);
    const record = this.issued.get(proof);
    assert(record && record.request.scope.organizationId === scope.organizationId && record.request.scope.guildId === scope.guildId && record.request.actorHash === actor.key
      && record.request.configHash === digest(config), "OPERATING_PROFILE_UNVERIFIED", 403);
    const profile = assertMeasuredOperatingProfile(record.profile, record.request, policy, now);
    await this.provider.recheck(tx, structuredClone(record.request), structuredClone(profile), now);
    assertMeasuredOperatingProfile(record.profile, record.request, policy, this.clock());
    return { profileRevision: profile.revision, profileHash: operatingProfileIdentity(profile), expiresAt: new Date(profile.expiresAt) };
  }
}
