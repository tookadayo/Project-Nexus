import type {
  FlowDefinition,
  ValidationIssue,
} from "../../../../packages/automation/src/types";

export interface FlowSummary {
  id: string;
  name: string;
  draftRevision: number;
  activeRevision: number | null;
  state: string;
  updatedAt: string;
}
export interface FlowDetail extends FlowSummary {
  scheduleReview?: {required:boolean;reason:string|null};
  definition: FlowDefinition;
  validation: {
    valid: boolean;
    complete: boolean;
    issues: ValidationIssue[];
    semanticHash?: string;
  };
  requestId?: string;
}
export interface CheckResult {
  revision: number;
  semanticHash: string;
  valid: boolean;
  complete: boolean;
  issues: ValidationIssue[];
}
export interface SimulationResult extends CheckResult {
  mode: "SIMULATION";
  status?: "COMPLETED" | "FAILED" | "UNDETERMINED" | "UNKNOWN";
  externalChanges: 0;
  productionRuns: 0;
  approvalConsumption: 0;
  productionDraws?: 0;
  mocked?: boolean;
  steps: unknown[];
  iterations?: IterationResultSummary[];
}
export interface ImpactResult extends CheckResult {
  plannedActions: unknown;
  waits: unknown;
  retentionDays: number;
  runDeadlineDays: number;
  productionAvailable?: boolean;
  capacityMeasured?: boolean;
}
export interface TargetChoice {
  id: string;
  name: string;
  guildId?: string;
  type?: string | number;
}
export interface EditorTargets {
  channels: TargetChoice[];
  roles: TargetChoice[];
  available: boolean;
}
export interface RuntimeOverview {
  runs: {
    id: string;
    flowId: string;
    state: string;
    startedAt: string;
    endedAt: string | null;
    dueAt: string | null;
  }[];
  usage: {
    limit: number;
    reserved: number;
    consumed: number;
    compensated: number;
    remaining: number;
    updatedAt: string;
  };
  nextOccurrences: { id: string; at: string; timezone: string }[];
  status: string;
}
export interface ParallelRunStatus {
  identity: string;
  join: "ALL";
  branches: {
    id: string;
    state: "RUNNABLE" | "WAITING" | "WAITING_APPROVAL" | "COMPLETED";
    dueAt?: string;
    parallel?: ParallelRunStatus;
  }[];
}
export interface AutomationRunDetail {
  id: string;
  flowId: string;
  revision: number;
  state: string;
  startedAt: string;
  endedAt: string | null;
  dueAt: string | null;
  reason: string | null;
  events: { code?: string; state?: string; at?: string }[];
  parallel?: ParallelRunStatus;
  iterations?: IterationResultSummary[];
}
export type IterationState="SUCCEEDED"|"FAILED"|"NOT_STARTED"|"SKIPPED"|"CANCELLED"|"UNKNOWN";
export interface IterationResultSummary {
  blockId:string;
  identity:string;
  states:IterationState[];
  counts:Record<IterationState,number>;
}
export class AutomationRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly uncertain: boolean = false,
  ) {
    super(`AUTOMATION_REQUEST_${status}`);
  }
}
/** Same-origin BFF supplies identity and current authority; no actor is accepted here. */
export function automationClient(base = "/api/automation", guildId = "") {
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(base + path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "X-Nexus-Guild": guildId,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new AutomationRequestError(0, method !== "GET");
    }
    if (!response.ok)
      throw new AutomationRequestError(
        response.status,
        method !== "GET" && response.status >= 500,
      );
    try {
      return (await response.json()) as T;
    } catch {
      throw new AutomationRequestError(0, method !== "GET");
    }
  }
  return {
    list: () => request<{ items: FlowSummary[]; limits?: unknown }>("/flows"),
    targets: (kind: "ChannelRef" | "RoleRef") =>
      request<{ state: "AVAILABLE" | "UNAVAILABLE"; items: TargetChoice[] }>(
        `/targets?kind=${kind}`,
      ),
    overview: () => request<RuntimeOverview>("/overview"),
    eventReceipts: (flowId: string) =>
      request<{
        items: {
          source: string;
          eventId: string;
          flowId: string;
          revision: number;
          state: string;
          reason: string | null;
          runId: string | null;
          occurredAt: string;
        }[];
      }>(`/event-receipts?flowId=${encodeURIComponent(flowId)}`),
    run: (id: string) =>
      request<AutomationRunDetail>(`/runs/${encodeURIComponent(id)}`),
    start: (
      id: string,
      values: Record<string, { type: unknown; value: unknown }>,
      requestId: string,
    ) =>
      request<{ id: string; state: string }>(
        `/flows/${encodeURIComponent(id)}/runs`,
        "POST",
        { requestId, values },
      ),
    approvals: () =>
      request<{
        items: {
          id: string;
          runId: string;
          revision: number;
          operation: string;
          fingerprint: string;
          policyFingerprint?: string | null;
          changedChannelCount?: number;
          policyUnavailableReason?: string;
          inputs: Record<string, unknown>;
          expiresAt: string;
        }[];
      }>("/approvals"),
    decide: (
      id: string,
      decision: "APPROVE" | "REJECT",
      fingerprint: string,
      requestId: string,
      policyFingerprint?: string,
    ) =>
      request<unknown>(`/approvals/${encodeURIComponent(id)}`, "POST", {
        decision,
        fingerprint,
        requestId,
        ...(policyFingerprint ? { policyFingerprint } : {}),
      }),
    cancel: (id: string, requestId: string) =>
      request<unknown>(`/runs/${encodeURIComponent(id)}/cancel`, "POST", {
        requestId,
      }),
    read: (id: string) =>
      request<FlowDetail>(`/flows/${encodeURIComponent(id)}`),
    save: (
      definition: FlowDefinition,
      expectedRevision: number,
      requestId: string,
    ) =>
      request<FlowDetail>(
        `/flows/${encodeURIComponent(definition.id)}/draft`,
        "PUT",
        { definition, expectedRevision, requestId },
      ),
    validate: (id: string, revision: number) =>
      request<CheckResult>(
        `/flows/${encodeURIComponent(id)}/validate`,
        "POST",
        { revision },
      ),
    test: (id: string, revision: number, simulation?: unknown) =>
      request<SimulationResult>(
        `/flows/${encodeURIComponent(id)}/test`,
        "POST",
        { revision, ...(simulation ? { simulation } : {}) },
      ),
    impact: (id: string, revision: number) =>
      request<ImpactResult>(`/flows/${encodeURIComponent(id)}/impact`, "POST", {
        revision,
      }),
    enable: (
      id: string,
      revision: number,
      semanticHash: string,
      requestId: string,
    ) =>
      request<FlowDetail>(`/flows/${encodeURIComponent(id)}/enable`, "POST", {
        revision,
        semanticHash,
        requestId,
      }),
    lookup: (requestId: string) =>
      request<{
        state: "CONFIRMED";
        flowId?: string;
        revision: number | null;
        kind?: string;
        runId?: string;
      }>(`/requests/${encodeURIComponent(requestId)}`),
    disable: (id: string, requestId: string) =>
      request<FlowDetail>(`/flows/${encodeURIComponent(id)}/disable`, "POST", {
        requestId,
      }),
  };
}
