import {randomUUID} from "node:crypto";
import {NextResponse, type NextRequest} from "next/server";
import {z} from "zod";
import {operationsContext} from "../../operations/context";
import {assertDisplayedGuild} from "../../auth/displayed-guild";
import {sameOrigin} from "../../auth/origin";
import {billingBody} from "../../billing/request";
import {OperationalCaseContexts} from "../../../../../packages/rules/src/operational-context";
import {operationalMutation} from "../../../../../packages/rules/src/operational-context-contract";
import {assertMaintenanceAuthorization} from "../../../../../packages/operations/src/maintenance-authorization";
import {actorPermissions} from "../../../../../packages/operations/src/policy";
import {assert, isDomainError} from "../../../../../packages/shared/src/index";
export const dynamic = "force-dynamic";
async function handler(request: NextRequest, write: boolean) {
  const requestId = randomUUID();
  try {
    if (write) assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const context = await operationsContext(), proof = {scope: context.scope, actorHash: context.actor.key, expiresAt: new Date(context.snapshot.checkedAt + 10000)}, service = new OperationalCaseContexts(context.services.db, proof,{discord:context.services.discord}), query = request.nextUrl.searchParams;
    assertDisplayedGuild(request.headers.get("X-Nexus-Guild"), context.scope.guildId);
    const reply = (data: unknown, status = 200) => {if (!write) assertMaintenanceAuthorization(proof, context.scope, context.actor); return NextResponse.json({ok: true, requestId, data}, {status, headers: {"Cache-Control": "no-store"}});};
    if (!write) {
      if (!query.size) return reply(await service.catalog(context.scope, context.actor));
      if (query.get("op") === "options") {assert(query.size === 1, "INVALID_REQUEST"); const options = await service.options(context.scope, context.actor), native = await context.services.discord.options(context.scope.guildId); return reply({...options, roles: native.roles.map((role) => ({id: role.id, name: role.label}))});}
      if (query.get("op") === "detail") {assert([...query.keys()].every((key) => ["op", "id"].includes(key)), "INVALID_REQUEST"); return reply(await service.detail(context.scope, context.actor, z.uuid().parse(query.get("id"))));}
      assert(query.get("op") === "request" && [...query.keys()].every((key) => ["op", "key"].includes(key)), "INVALID_REQUEST"); return reply(await service.status(context.scope, context.actor, z.uuid().parse(query.get("key"))));
    }
    assert([...query.keys()].every((key) => key === "op") && (!query.size || query.get("op") === "request-key"), "INVALID_REQUEST");
    const body = operationalMutation.parse(JSON.parse(await billingBody(request, 65536)));
    assert((await actorPermissions(context.services.db, context.scope, context.actor)).includes("GOVERN"), "PERMISSION_DENIED", 403);
    const ownerRole = body.operation === "CONTEXT_SAVE" ? body.fields["request.ownerRoleId"] : null, resources = typeof ownerRole === "string" ? {roleIds: (await context.services.discord.options(context.scope.guildId)).roles.map((role) => role.id), expiresAt: proof.expiresAt} : {}, writer = new OperationalCaseContexts(context.services.db, proof, {...resources,discord:context.services.discord});
    assertMaintenanceAuthorization(proof, context.scope, context.actor);
    if (query.get("op") === "request-key") return reply(await writer.prepare(context.scope, context.actor, body), 201);
    assert(request.headers.get("Idempotency-Key") && request.headers.get("If-Match"), "PRECONDITION_REQUIRED", 428); const key = z.uuid().parse(request.headers.get("Idempotency-Key")); assert(request.headers.get("If-Match") === `"${body.expectedVersion}"`, "VERSION_MISMATCH", 412); return reply(await writer.mutate(context.scope, context.actor, key, body));
  } catch (error) {const missing = !!error && typeof error === "object" && (error as {code?: string}).code === "42P01", code = isDomainError(error) ? error.code : error instanceof z.ZodError || error instanceof SyntaxError ? "INVALID_REQUEST" : missing ? "SCHEMA_NOT_INSTALLED" : "AUTHORIZATION_OR_SERVICE_UNAVAILABLE"; return NextResponse.json({ok: false, requestId, error: {code, retryable: false}}, {status: isDomainError(error) ? error.status : code === "INVALID_REQUEST" ? 400 : 503, headers: {"Cache-Control": "no-store"}});}
}
export const GET = (request: NextRequest) => handler(request, false);
export const POST = (request: NextRequest) => handler(request, true);
