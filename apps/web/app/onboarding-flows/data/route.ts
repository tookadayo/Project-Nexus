import {randomUUID} from "node:crypto";
import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {operationsContext} from "../../operations/context";
import {assertDisplayedGuild} from "../../auth/displayed-guild";
import {sameOrigin} from "../../auth/origin";
import {billingBody} from "../../billing/request";
import {actorPermissions} from "../../../../../packages/operations/src/policy";
import {assertMaintenanceAuthorization} from "../../../../../packages/operations/src/maintenance-authorization";
import {OnboardingFlowAuthoring} from "../../../../../packages/onboarding/src/flow-authoring";
import {onboardingDraftMutation} from "../../../../../packages/onboarding/src/flow-drafts";
import {LIFECYCLE_WEB_REQUEST_POLICY} from "../../../../../packages/lifecycle/src/web-workspace";
import {assert, isDomainError} from "../../../../../packages/shared/src/index";
export const dynamic = "force-dynamic";
async function route(request: NextRequest, write: boolean) {
  const requestId = randomUUID();
  try {
    if (write) assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const context = await operationsContext(), authorization = {scope: context.scope, actorHash: context.actor.key, expiresAt: new Date(context.snapshot.checkedAt + 10000)};
    assertDisplayedGuild(request.headers.get("X-Nexus-Guild"), context.scope.guildId);
    const service = new OnboardingFlowAuthoring(context.services.db, {authorization, requestPolicy: LIFECYCLE_WEB_REQUEST_POLICY, discord: context.services.discord}), permissions = await actorPermissions(context.services.db, context.scope, context.actor);
    const reply = (data: unknown, status = 200) => {if (!write) assertMaintenanceAuthorization(authorization, context.scope, context.actor); return NextResponse.json({ok: true, requestId, data}, {status, headers: {"Cache-Control": "no-store"}});}, query = request.nextUrl.searchParams;
    if (!write) {
      if (!query.size) return reply({...await service.catalog(context.scope, context.actor), permissions});
      if (query.get("op") === "options") {assert(query.size === 1 && permissions.includes("CONFIGURE"), "ADMIN_REQUIRED", 403); const options = await context.services.discord.options(context.scope.guildId); assertMaintenanceAuthorization(authorization, context.scope, context.actor); return reply({channels: options.channels, roles: options.roles});}
      if (query.get("op") === "published") {assert(query.size === 1, "INVALID_REQUEST"); return reply(await service.published(context.scope, context.actor));}
      if (query.get("op") === "request") {assert([...query.keys()].every((key) => ["op", "key"].includes(key)), "INVALID_REQUEST"); return reply(await service.status(context.scope, context.actor, z.uuid().parse(query.get("key"))));}
      assert(["detail", "preview"].includes(query.get("op") ?? "") && [...query.keys()].every((key) => ["op", "id"].includes(key)), "INVALID_REQUEST"); const id = z.uuid().parse(query.get("id"));
      return reply(query.get("op") === "detail" ? await service.native.detail(context.scope, context.actor, id) : await service.native.transaction(context.scope, context.actor, "READ", (tx) => service.native.previewInTransaction(tx, context.scope, context.actor, id)));
    }
    assert([...query.keys()].every((key) => key === "op") && (!query.size || query.get("op") === "request-key"), "INVALID_REQUEST");
    const input = onboardingDraftMutation.parse(JSON.parse(await billingBody(request, 262144)));
    if (query.get("op") === "request-key") return reply(await service.prepare(context.scope, context.actor, input), 201);
    assert(request.headers.get("Idempotency-Key") && request.headers.get("If-Match"), "PRECONDITION_REQUIRED", 428);
    const key = z.uuid().parse(request.headers.get("Idempotency-Key")), expected = "expectedRevision" in input && input.expectedRevision !== undefined ? input.expectedRevision : "expectedSettingsRevision" in input ? input.expectedSettingsRevision : undefined;
    assert(request.headers.get("If-Match") === `"${expected}"`, "VERSION_MISMATCH", 412);
    return reply(await service.mutate(context.scope, context.actor, key, input));
  } catch (error) {const missing = !!error && typeof error === "object" && (error as {code?: string}).code === "42P01", code = isDomainError(error) ? error.code : error instanceof z.ZodError || error instanceof SyntaxError ? "INVALID_REQUEST" : missing ? "SCHEMA_NOT_INSTALLED" : "AUTHORIZATION_OR_SERVICE_UNAVAILABLE"; return NextResponse.json({ok: false, requestId, error: {code, retryable: false}}, {status: isDomainError(error) ? error.status : code === "INVALID_REQUEST" ? 400 : 503, headers: {"Cache-Control": "no-store"}});}
}
export const GET = (request: NextRequest) => route(request, false);
export const POST = (request: NextRequest) => route(request, true);
