import type {Database, Tx} from "../../db/src/index";
import type {Scope} from "../../shared/src/index";
import type {Actor} from "../../settings/src/index";
import type {DiscordPort} from "../../discord/src/rest";
import type {MaintenanceAuthorizationProof} from "../../operations/src/maintenance-authorization";
import type {CaseValue, CohortMetadata, Quality, Target, Unit, Window} from "./case-types";

export const operationalSourceIds = ["CASE_01_12_NATIVE", "ROLE_ACCESS_NATIVE", "CASE_13_20_NATIVE"] as const;
export type OperationalSourceId = typeof operationalSourceIds[number];
export interface OperationalSourceField {
  fieldId: string; value: CaseValue; quality: Quality; unit: Unit;
  sourceKind: "OPERATOR" | "SYSTEM_OBSERVATION";
  /** Original observation clocks/ref. A newly captured aggregate records its
   * one capture clock; VALIDATE reuses that stored clock, never a retry clock. */
  observedAt: string; expiresAt: string; sourceRevision: string; sourceReference: string;
  window?: Window; periodRole?: "CURRENT" | "PRIOR" | "CONTEXT";
  metricId?: string; cohort?: CohortMetadata;
}
export interface OperationalSourceRequest {
  contextId: string; caseId: string; target: Target; window: Window;
  /** Server-derived base-rule resource. A program locator is distinct from
   * the native event that receives the recommendation. Never browser input. */
  rootTarget?: Target;
  evaluationAsOf: string; proof: MaintenanceAuthorizationProof;
  /** The already validated parent first-capture/native ceiling; never a
   * browser-provided lifetime. Children may only shorten this deadline. */
  captureExpiresAt?: string;
  config: unknown; prepared?: unknown;
  /** VALIDATE performs no writes. CAPTURE may save a native immutable typed
   * source in this same transaction, checking beforeWrite at every write. */
  phase: "VALIDATE" | "CAPTURE"; beforeWrite(): Promise<void>;
}
export interface OperationalSourcePlugin {
  id: OperationalSourceId;
  supportedFields: Readonly<Record<string, readonly string[]>>;
  /** A finite JSON-schema form description (no executable fields/default
   * thresholds). Runtime validation remains parseConfig, not this UI hint. */
  editorSchema?: Record<string, unknown>;
  parseConfig(value: unknown): unknown;
  /** Optional Discord/current metadata reads complete before the scoped TX. */
  outsideTx?(db: Database, scope: Scope, actor: Actor, request: Omit<OperationalSourceRequest, "phase" | "beforeWrite" | "prepared">, ports: {discord?: DiscordPort}): Promise<unknown>;
  read(tx: Tx, scope: Scope, actor: Actor, request: OperationalSourceRequest): Promise<readonly OperationalSourceField[]>;
  purge?(tx: Tx, scope: Scope): Promise<void>;
  /** Runs before the existing subject source rows are erased. A source that
   * cannot prove person independence invalidates its aggregate snapshots. */
  purgeActor?(tx: Tx, scope: Scope, actorHash: string): Promise<void>;
  expire?(tx: Tx, scope: Scope, now: Date): Promise<void>;
}
