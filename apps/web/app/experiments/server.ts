import "server-only";
import {randomUUID} from "node:crypto";
import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {operationsContext} from "../operations/context";
import {sameOrigin} from "../auth/origin";
import {assertDisplayedGuild} from "../auth/displayed-guild";
import {billingBody} from "../billing/request";
import {actorPermissions} from "../../../../packages/operations/src/policy";
import {LifecycleWebWorkspace, lifecycleWebMutation, LIFECYCLE_WEB_REQUEST_POLICY, type LifecycleDomain} from "../../../../packages/lifecycle/src/web-workspace";
import {assert, isDomainError} from "../../../../packages/shared/src/index";
import {assertMaintenanceAuthorization} from "../../../../packages/operations/src/maintenance-authorization";
export async function lifecycleWorkspaceRoute(req: NextRequest, domain: LifecycleDomain, write: boolean) {
  const requestId = randomUUID(); let assertReadAuthorization = () => {};
  const reply = (data: unknown, status = 200) => {if (!write) assertReadAuthorization(); return NextResponse.json({ok: true, requestId, data}, {status, headers: {"Cache-Control": "no-store"}});};
  try {
    if (write) assert(sameOrigin(req), "ORIGIN_REJECTED", 403);
    const context = await operationsContext(); assertDisplayedGuild(req.headers.get("X-Nexus-Guild"), context.scope.guildId);
    const authorization = {scope: context.scope, actorHash: context.actor.key, expiresAt: new Date(context.snapshot.checkedAt + 10000)};
    assertReadAuthorization = () => assertMaintenanceAuthorization(authorization, context.scope, context.actor);
    const service = new LifecycleWebWorkspace(context.services.db, {policy: LIFECYCLE_WEB_REQUEST_POLICY, discord: context.services.discord, authorization});
    const query = req.nextUrl.searchParams;
    if (!write) {
      if (!query.size) return reply({...await service.catalog(context.scope, context.actor, domain), permissions: await actorPermissions(context.services.db, context.scope, context.actor)});
      if (query.get("op") === "preview") {assert([...query.keys()].every((key) => ["op", "id"].includes(key)), "INVALID_REQUEST"); return reply(await service.preview(context.scope, context.actor, domain, z.uuid().parse(query.get("id"))));}
      assert(query.get("op") === "request" && [...query.keys()].every((key) => ["op", "key"].includes(key)), "INVALID_REQUEST");
      return reply(await service.requestStatus(context.scope, context.actor, domain, z.uuid().parse(query.get("key"))));
    }
    assert([...query.keys()].every((key) => key === "op") && (!query.has("op") || query.get("op") === "request-key"), "INVALID_REQUEST");
    const input = lifecycleWebMutation.parse(JSON.parse(await billingBody(req, 32768))); assert(input.domain === domain, "INVALID_REQUEST");
    if (query.get("op") === "request-key") return reply(await service.prepare(context.scope, context.actor, input), 201);
    const key = req.headers.get("Idempotency-Key"); assert(key, "PRECONDITION_REQUIRED", 428);
    const expected = "expectedHead" in input ? input.expectedHead ?? "none" : "expectedState" in input ? input.expectedState : "expectedSettingsRevision" in input ? String(input.expectedSettingsRevision) : "sourceHash" in input ? input.sourceHash : undefined;
    if (expected !== undefined) {assert(req.headers.get("If-Match"), "PRECONDITION_REQUIRED", 428); assert(req.headers.get("If-Match") === `"${expected}"`, "VERSION_MISMATCH", 412);}
    return reply(await service.mutate(context.scope, context.actor, key, input));
  } catch (error) {
    const missing = !!error && typeof error === "object" && (error as {code?: string}).code === "42P01";
    const code = isDomainError(error) ? error.code : error instanceof z.ZodError || error instanceof SyntaxError ? "INVALID_REQUEST" : missing ? "SCHEMA_NOT_INSTALLED" : "AUTHORIZATION_OR_SERVICE_UNAVAILABLE";
    return NextResponse.json({ok: false, requestId, error: {code, retryable: false}}, {status: isDomainError(error) ? error.status : code === "INVALID_REQUEST" ? 400 : 503, headers: {"Cache-Control": "no-store"}});
  }
}
