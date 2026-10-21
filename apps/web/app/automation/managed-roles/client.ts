import type { ManagedRolePolicyDto, ManagedRolePolicySpec,ManagedRoleRunDescriptor } from "../../../../../packages/automation/src/managed-roles";
import { csrfHeaders } from "../../auth/csrf-client";

export class ManagedRoleRequestError extends Error {
  constructor(readonly code: string, readonly status: number, readonly uncertain = false) { super(code); }
}
export function managedRoleClient(guildId: string) {
  async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    let response: Response;
    try { response = await fetch("/api/automation/" + path, { method, credentials: "same-origin", cache: "no-store",
      headers: csrfHeaders({ "X-Nexus-Guild": guildId, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) }); }
    catch { throw new ManagedRoleRequestError("CONNECTION_UNCONFIRMED", 0, method !== "GET"); }
    let value: unknown;
    try { value = await response.json(); } catch { throw new ManagedRoleRequestError("RESPONSE_UNCONFIRMED", response.status, method !== "GET"); }
    if (!response.ok) {
      const raw = value && typeof value === "object" ? (value as { error?: unknown }).error : null;
      const code = typeof raw === "string" ? raw : raw && typeof raw === "object" && typeof (raw as { code?: unknown }).code === "string" ? String((raw as { code: string }).code) : "REQUEST_UNAVAILABLE";
      throw new ManagedRoleRequestError(code, response.status, method !== "GET" && response.status >= 500);
    }
    return value as T;
  }
  const target = (id: string) => "managed-role-policies/" + encodeURIComponent(id);
  return {
    list: () => request<{ items: ManagedRolePolicyDto[]; incompatible: { id: string; reasonCode: string }[] }>("managed-role-policies"),
    detail: (id: string) => request<ManagedRolePolicyDto>(target(id)),
    save: (id: string, input: { policy: ManagedRolePolicySpec; expectedRevision: number; expectedActiveRevision: number | null; expectedGeneration: number; requestId: string }) =>
      request<{ id: string; policyVersion: number }>(target(id), "PUT", input),
    remove: (id: string, input: { expectedRevision: number; expectedActiveRevision: number | null; expectedGeneration: number; requestId: string }) => request<{ id: string; state: string }>(target(id), "DELETE", input),
    check: (id: string, input: { revision: number; kind: "VALIDATE" | "TEST" | "IMPACT"; simulation?: { memberId: string; outcome: "SUCCEEDED" | "FAILED" | "NOT_STARTED" | "UNKNOWN" } }) =>
      request<{ valid: boolean; complete: boolean; status?: string; productionUnavailableReason: string|null; issues: { code: string; message: string }[] }>(target(id) + "/check", "POST", input),
    prepareEnable:(id:string,input:{expectedRevision:number;expectedActiveRevision:number|null;expectedGeneration:number;semanticHash:string;requestId:string})=>request<{requestId:string;requestProof:string;requestProofExpiresAt:string}>(target(id)+'/prepare-enable','POST',input),
    enable:(id:string,input:{expectedRevision:number;expectedActiveRevision:number|null;expectedGeneration:number;semanticHash:string;requestId:string;requestProof:string})=>request<{id:string;state:string;activeRevision:number}>(target(id)+'/enable','POST',input),
    prepareRun:(id:string,input:{policyRevision:number;semanticHash:string;memberId:string;requestId:string})=>request<ManagedRoleRunDescriptor>(target(id)+'/prepare-run','POST',input),
    run:(id:string,input:{policyRevision:number;semanticHash:string;memberId:string;requestId:string;requestProof:string})=>request<{id:string;state:string;revision:number}>(target(id)+'/runs','POST',input),
    history: () => request<{ items: { flowId: string; runId: string; revision: number; operation: string; state: string; startedAt: string; finishedAt: string | null }[] }>("managed-role-policies/history"),
    lookup: (requestId: string) => request<{ state: string; kind: string; flowId: string; revision: number | null;runId?:string|null }>("requests/" + encodeURIComponent(requestId)),
  };
}
