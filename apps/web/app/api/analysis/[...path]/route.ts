import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { operationsContext } from "../../../operations/context";
import { sameOrigin } from "../../../auth/origin";
import { assertDisplayedGuild } from "../../../auth/displayed-guild";
import { billingBody } from "../../../billing/request";
import { failureResponse } from "../../../auth/failure-response";
import { analysisRunDto, analysisStartSchema } from "../../../analysis/model";
import { AnalysisService } from "../../../../../../packages/analysis/src/index";
import { analysisRequest, analysisTypes } from "../../../../../../packages/analysis/src/domain";
import { actorPermissions } from "../../../../../../packages/operations/src/policy";
import { assert, DomainError } from "../../../../../../packages/shared/src/index";

export const runtime = "nodejs";
type Route = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const daysSchema = z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]));
async function context(request: NextRequest) {
  const value = await operationsContext();
  assertDisplayedGuild(request.headers.get("X-Nexus-Guild") ?? request.nextUrl.searchParams.get("guild"), value.scope.guildId);
  return { ...value, service: new AnalysisService(value.services.db) };
}
function failure(error: unknown, effect: "NOT_STARTED" | "UNKNOWN" = "NOT_STARTED") {
  const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
  return failureResponse(invalid ? new DomainError("INVALID_REQUEST", 400) : error, invalid ? "NOT_STARTED" : effect);
}

export async function GET(request: NextRequest, route: Route) {
  try {
    const path = (await route.params).path, c = await context(request), q = request.nextUrl.searchParams;
    if (path.length === 1 && path[0] === "menu") {
      const data = await c.service.menu(c.scope, c.actor, daysSchema.parse(q.get("days") ?? 30));
      const permissions = await c.services.db.transaction().execute(tx => actorPermissions(tx, c.scope, c.actor));
      return json({ ...data, canAnalyze: permissions.includes("ANALYZE") });
    }
    if (path.length === 1 && path[0] === "history") {
      const data = await c.service.historyPage(c.scope, c.actor, {
        ...(q.has("cursor") ? { cursor: z.uuid().parse(q.get("cursor")) } : {}),
        direction: z.enum(["next", "previous"]).parse(q.get("direction") ?? "next"),
        ...(q.has("type") ? { type: z.enum(analysisTypes).parse(q.get("type")) } : {}),
        limit: z.coerce.number().int().min(1).max(25).parse(q.get("limit") ?? 10),
      });
      return json({ ...data, runs: data.runs.map(analysisRunDto) });
    }
    if (path[0] === "runs" && (path.length === 2 || path.length === 3 && path[2] === "compare")) {
      const id = z.uuid().parse(path[1]);
      if (path[2] === "compare") return json(await c.service.compare(c.scope, c.actor, id));
      const data = await c.service.result(c.scope, c.actor, id);
      const permissions = await c.services.db.transaction().execute(tx => actorPermissions(tx, c.scope, c.actor));
      return json({ run: analysisRunDto(data.run), result: data.result, reviews: data.reviews,
        canCancel: data.run.status === "QUEUED" && (permissions.includes("OPERATE") || permissions.includes("ANALYZE") && data.run.requested_by_actor_hash === c.actor.key) });
    }
    throw new DomainError("TARGET_NOT_FOUND", 404);
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, route: Route) {
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const path = (await route.params).path, c = await context(request);
    const body: unknown = JSON.parse(await billingBody(request, 8192));
    if (path.length === 1 && path[0] === "preview") {
      const data = await c.service.preview(c.scope, c.actor, analysisRequest.parse(body));
      // No private configured channel list or raw run row is returned.
      return json({ request: data.request, targetChannelCount: data.targetChannelCount, availability: data.availability, quality: data.quality,
        metrics: data.metrics, periodStart: data.periodStart.toISOString(), periodEnd: data.periodEnd.toISOString(), usage: data.usage,
        duplicate: data.duplicate, configRevision: data.configRevision, inputFingerprint: data.inputFingerprint, consumeCount: data.consumeCount, correctionOf: data.correctionOf });
    }
    if (path.length === 1 && path[0] === "runs") {
      const input = analysisStartSchema.parse(body);
      const key = z.string().regex(/^[\x21-\x7e]{1,128}$/).parse(request.headers.get("Idempotency-Key"));
      const accepted = await c.service.request(c.scope, c.actor, input.request, key, input.expected);
      return json({ run: analysisRunDto(accepted.run), reused: accepted.reused }, accepted.reused ? 200 : 202);
    }
    if (path.length === 3 && path[0] === "runs" && path[2] === "cancel") {
      z.object({}).strict().parse(body);
      // Use the same existing visible/retained-result gate before exposing the
      // cancel response. Domain cancellation rechecks actor and queued state.
      await c.service.result(c.scope, c.actor, z.uuid().parse(path[1]));
      const canceled = await c.service.cancel(c.scope, c.actor, z.uuid().parse(path[1]));
      return json({ run: analysisRunDto(canceled.run), canceled: canceled.canceled });
    }
    throw new DomainError("TARGET_NOT_FOUND", 404);
  } catch (error) { return failure(error, "UNKNOWN"); }
}
