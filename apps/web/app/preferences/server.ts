import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { operationsContext } from "../operations/context";
import { sameOrigin } from "../auth/origin";
import { assertDisplayedGuild } from "../auth/displayed-guild";
import { billingBody } from "../billing/request";
import { actorPermissions } from "../../../../packages/operations/src/policy";
import { PersonalizationService, personalizationMutation, PERSONALIZATION_POLICY } from "../../../../packages/operations/src/alpha16-personalization";
import { AutomationService } from "../../../../packages/automation/src/service";
import { assert, isDomainError } from "../../../../packages/shared/src/index";
import {assertMaintenanceAuthorization} from "../../../../packages/operations/src/maintenance-authorization";

export async function personalizationRoute(request: NextRequest, kind: "templates" | "preferences", write: boolean) {
  const requestId = randomUUID();
  let assertReadAuthorization = () => {};
  const reply = (data: unknown, status = 200) => {if (!write) assertReadAuthorization(); return NextResponse.json({ok: true, requestId, data}, {status, headers: {"Cache-Control": "no-store"}});};
  try {
    if (write) assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const context = await operationsContext();
    assertDisplayedGuild(request.headers.get("X-Nexus-Guild"), context.scope.guildId);
    const authorization = {scope: context.scope, actorHash: context.actor.key, expiresAt: new Date(context.snapshot.checkedAt + 10000)};
    assertReadAuthorization = () => assertMaintenanceAuthorization(authorization, context.scope, context.actor);
    const service = new PersonalizationService(context.services.db, {policy: PERSONALIZATION_POLICY, authorization});
    const permissions = await actorPermissions(context.services.db, context.scope, context.actor);
    const query = request.nextUrl.searchParams;
    if (!write) {
      if (query.get("op") === "request") {
        assert([...query.keys()].every((key) => ["op", "key"].includes(key)), "INVALID_REQUEST");
        return reply(await service.requestStatus(context.scope, context.actor, z.uuid().parse(query.get("key")), kind));
      }
      assert([...query.keys()].every((key) => kind === "templates" && ["id", "op"].includes(key)), "INVALID_REQUEST");
      if (kind === "preferences") return reply({...await service.preferences(context.scope, context.actor), permissions});
      if (query.get("op") === "sources") {
        assert(!query.has("id"), "INVALID_REQUEST");
        const flows = await new AutomationService(context.services.db).list(context.scope, context.actor);
        assertMaintenanceAuthorization(authorization, context.scope, context.actor);
        return reply({items: flows.items.map((flow) => ({id: flow.id, name: flow.name, draftRevision: flow.draftRevision})), permissions});
      }
      assert(!query.has("op"), "INVALID_REQUEST");
      const id = query.has("id") ? z.uuid().parse(query.get("id")) : undefined;
      return reply({...await service.templates(context.scope, context.actor, id), permissions});
    }
    assert([...query.keys()].every((key) => key === "op") && (!query.has("op") || query.get("op") === "request-key"), "INVALID_REQUEST");
    const input = personalizationMutation.parse(JSON.parse(await billingBody(request, 20000)));
    assert(input.operation.startsWith(kind === "preferences" ? "PREFERENCE_" : "TEMPLATE_"), "INVALID_REQUEST");
    if (query.get("op") === "request-key") return reply(await service.prepare(context.scope, context.actor, input), 201);
    const key = request.headers.get("Idempotency-Key");
    assert(key, "PRECONDITION_REQUIRED", 428);
    if ("expectedVersion" in input) {
      const match = request.headers.get("If-Match"); assert(match, "PRECONDITION_REQUIRED", 428);
      assert(match === `"${input.expectedVersion}"`, "VERSION_MISMATCH", 412);
    }
    return reply(await service.mutate(context.scope, context.actor, key, input));
  } catch (error) {
    const schemaMissing = !!error && typeof error === "object" && (error as {code?: string}).code === "42P01";
    const code = isDomainError(error) ? error.code : error instanceof z.ZodError || error instanceof SyntaxError ? "INVALID_REQUEST" : schemaMissing ? "SCHEMA_NOT_INSTALLED" : "AUTHORIZATION_OR_SERVICE_UNAVAILABLE";
    const status = isDomainError(error) ? error.status : code === "INVALID_REQUEST" ? 400 : 503;
    return NextResponse.json({ok: false, requestId, error: {code, retryable: false}}, {status, headers: {"Cache-Control": "no-store"}});
  }
}
