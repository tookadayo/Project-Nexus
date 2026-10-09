import { operationsPresentation } from "../../../../../packages/operations/src/access-presentation";
import { failureResponse } from "../../auth/failure-response";
import { isDomainError } from "../../../../../packages/shared/src/index";
import { assertDisplayedGuild } from "../../auth/displayed-guild";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { operationsContext } from "../../operations/context";
import { sameOrigin } from "../../auth/origin";
import { billingBody, billingFailure } from "../../billing/request";
import {
  ExploreService,
  savedViewSchema,
} from "../../../../../packages/analytics/src/explore";
import {
  chartQuerySchema,
  chartCsv,
} from "../../../../../packages/analytics/src/chart-spec";
import { renderChartPng } from "../../../../../packages/analytics/src/chart-renderer";
import { EntitlementService } from "../../../../../packages/settings/src/billing/entitlements";
import { latestCapability } from "../../../../../packages/lifecycle/src/discovery";
import { assert } from "../../../../../packages/shared/src/index";
export const runtime = "nodejs";
function failure(error: unknown) {
  if (isDomainError(error) && error.code === "SERVER_SELECTION_CHANGED")
    return failureResponse(error, "NOT_STARTED");
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return NextResponse.json(
      { error: "INVALID_EXPLORE_REQUEST" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  return billingFailure(error);
}
export async function GET(request: NextRequest) {
  try {
    const context = await operationsContext(),
      explore = new ExploreService(context.services.db),
      params = request.nextUrl.searchParams,
      q = params.get("q") ?? "{}";
    assert(q.length <= 4096, "REQUEST_TOO_LARGE", 413);
    assertDisplayedGuild(
      request.headers.get("X-Nexus-Guild") ?? params.get("guild"),
      context.scope.guildId,
    );
    const query = chartQuerySchema.parse(JSON.parse(q)),
      saved = params.get("saved"),
      spec = saved
        ? await explore.saved(context.scope, z.uuid().parse(saved))
        : await explore.chart(context.scope, query),
      entitlements = new EntitlementService(context.services.db);
    if (params.get("format") === "csv") {
      await entitlements.require(context.scope, "csv_export");
      return new Response(chartCsv(spec), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="nexus-aggregate.csv"',
          "Cache-Control": "no-store",
        },
      });
    }
    if (params.get("format") === "png")
      return new Response(
        new Uint8Array(
          await renderChartPng(
            spec,
            request.cookies.get("nexus_locale")?.value === "ja" ? "ja" : "en",
          ),
        ),
        {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        },
      );
    const capabilities = await context.services.db
      .transaction()
      .execute((tx) =>
        operationsPresentation(tx, context.scope, context.actor),
      );
    const advanced = capabilities.advanced;
    return NextResponse.json(
      {
        spec,
        views: advanced ? await explore.list(context.scope) : [],
        segments: advanced ? await explore.segments(context.scope) : [],
        capabilities,
        channels:
          (
            await latestCapability(context.services.db, context.scope)
          )?.channels.map((channel) => ({
            id: channel.id,
            type: channel.type,
            observable: channel.observable,
          })) ?? [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const context = await operationsContext(),
      input = z
        .discriminatedUnion("action", [
          z
            .object({ action: z.literal("saveView"), view: savedViewSchema })
            .strict(),
          z
            .object({ action: z.literal("saveSegment"), segment: z.unknown() })
            .strict(),
        ])
        .parse(JSON.parse(await billingBody(request, 8192))),
      explore = new ExploreService(context.services.db);
    assertDisplayedGuild(
      request.headers.get("X-Nexus-Guild"),
      context.scope.guildId,
    );
    const result =
      input.action === "saveView"
        ? await explore.save(context.scope, context.actor, input.view)
        : await explore.saveSegment(
            context.scope,
            context.actor,
            input.segment,
          );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
