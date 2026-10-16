import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";
import {operationsContext} from "../../operations/context";
import {assertDisplayedGuild} from "../../auth/displayed-guild";
import {sameOrigin} from "../../auth/origin";
import {failureResponse} from "../../auth/failure-response";
import {billingBody} from "../../billing/request";
import {assert, DomainError} from "../../../../../packages/shared/src/index";
import {actorPermissions} from "../../../../../packages/operations/src/policy";
import {RuleIssueRegistry} from "../../../../../packages/rules/src/issue-registry";
import {ruleIssueMutation} from "../../rules/issues/model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function context(request: NextRequest) {
  assert([...request.nextUrl.searchParams.keys()].length === 0, "INVALID_REQUEST", 400);
  const c = await operationsContext(); assertDisplayedGuild(request.headers.get("X-Nexus-Guild"), c.scope.guildId);
  const authorization = {scope: c.scope, actorHash: c.actor.key, expiresAt: new Date(c.snapshot.checkedAt + 10000)};
  return {...c, registry: new RuleIssueRegistry(c.services.db, {authorization})};
}
const failure = (error: unknown, started = false) => failureResponse(error instanceof z.ZodError || error instanceof SyntaxError ? new DomainError("INVALID_REQUEST", 400) : error, started ? "UNKNOWN" : "NOT_STARTED");
export async function GET(request: NextRequest) {
  try {const c = await context(request); return NextResponse.json({data: await c.registry.list(c.scope, c.actor), permissions: await actorPermissions(c.services.db, c.scope, c.actor)}, {headers: {"Cache-Control": "no-store"}});}
  catch (error) {return failure(error);}
}
export async function POST(request: NextRequest) {
  let started = false;
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const c = await context(request), body = ruleIssueMutation.parse(JSON.parse(await billingBody(request, 32000)));
    assert(request.headers.get("If-Match"), "PRECONDITION_REQUIRED", 428);
    assert(request.headers.get("If-Match") === `"${body.expectedVersion}"`, "VERSION_MISMATCH", 412);
    started = true;
    const data = body.operation === "UPSERT" ? await c.registry.save(c.scope, c.actor, {id: body.id, expectedVersion: body.expectedVersion, issueCode: body.issueCode, baseTarget: body.baseTarget,
      experimentIds: body.experimentIds, playbookIds: body.playbookIds, experimentsComplete: body.experimentsComplete, playbooksComplete: body.playbooksComplete, validForSeconds: body.validForSeconds, inventoryHashes: body.inventoryHashes})
      : await c.registry.remove(c.scope, c.actor, {id: body.id, expectedVersion: body.expectedVersion});
    return NextResponse.json({data}, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {return failure(error, started);}
}
