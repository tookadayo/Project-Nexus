import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";
import {operationsContext} from "../../../operations/context";
import {assertDisplayedGuild} from "../../../auth/displayed-guild";
import {failureResponse} from "../../../auth/failure-response";
import {HealthWorkspaceService} from "../../../../../../packages/presentation/src/health-workspace";
import {DomainError} from "../../../../../../packages/shared/src/index";
import {lifecyclePreviewReplaySchema} from "../../../../../../packages/presentation/src/lifecycle-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Route = {params: Promise<{path: string[]}>};
/** This route deliberately has no mutation export and never queues a refresh. */
export async function GET(request: NextRequest, route: Route) {
  try {
    const path = (await route.params).path;
    if (path.length !== 1 || !["overview", "lifecycle-preview"].includes(path[0]!)) throw new DomainError("TARGET_NOT_FOUND", 404);
    const c = await operationsContext();
    assertDisplayedGuild(request.headers.get("X-Nexus-Guild") ?? request.nextUrl.searchParams.get("guild"), c.scope.guildId);
    const service = new HealthWorkspaceService(c.services.db);
    const asOf = request.nextUrl.searchParams.get("asOf"), sourceHash = request.nextUrl.searchParams.get("sourceHash");
    const replay = asOf === null && sourceHash === null ? undefined : lifecyclePreviewReplaySchema.parse({asOf, sourceHash});
    const value = path[0] === "overview" ? await service.overview(c.scope, c.actor, c.snapshot)
      : await service.lifecyclePreview(c.scope, c.actor, z.uuid().parse(request.nextUrl.searchParams.get("revision")), replay, c.snapshot);
    return NextResponse.json(value, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    return failureResponse(error instanceof z.ZodError ? new DomainError("INVALID_REQUEST", 400) : error, "NOT_STARTED");
  }
}
