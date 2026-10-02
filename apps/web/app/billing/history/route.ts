import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { billingContext } from "../context";
import { sql, tenant } from "../../../../../packages/db/src/index";
import {
  EntitlementService,
  SYSTEM_MAX_HISTORY_DAYS,
} from "../../../../../packages/settings/src/entitlements";
import {
  assert,
  isDomainError,
} from "../../../../../packages/shared/src/index";
import { visibleMetrics } from "../../../../../packages/settings/src/metric-visibility";
export async function GET(request: NextRequest) {
  try {
    const context = await billingContext(),
      requested = z.coerce
        .number()
        .int()
        .min(1)
        .max(SYSTEM_MAX_HISTORY_DAYS)
        .parse(request.nextUrl.searchParams.get("days") ?? 30),
      days = await new EntitlementService(
        context.services.db,
      ).visibleHistoryDays(context.scope, requested);
    const rows = (
      await sql<{
        day: string;
        metrics: unknown;
      }>`SELECT day::text,metrics FROM daily_guild_metrics WHERE ${tenant(context.scope)} AND day>=(current_date-${days}) AND day<=current_date ORDER BY day LIMIT ${SYSTEM_MAX_HISTORY_DAYS + 1}`.execute(
        context.services.db,
      )
    ).rows;
    if (request.nextUrl.searchParams.get("format") === "csv") {
      await new EntitlementService(context.services.db).require(
        context.scope,
        "csv_export",
      );
      assert(rows.length <= SYSTEM_MAX_HISTORY_DAYS + 1, "EXPORT_TOO_LARGE");
      const safe = (value: unknown) => {
        const text = String(value ?? "");
        return (
          '"' +
          (/^[\s\t\r\n]*[=+@-]/.test(text) ? "'" : "") +
          text.replaceAll('"', '""') +
          '"'
        );
      };
      const lines = ["day,metric,value,definition_version,coverage"];
      for (const row of rows) {
        const data = row.metrics as {
          metrics?: Record<
            string,
            {
              value?: number | null;
              version?: string;
              definitionVersion?: string;
              coverage?: { state?: string };
              evidence?: { coverageState?: string };
            }
          >;
        };
        for (const [key, metric] of Object.entries(data.metrics ?? {}))
          lines.push(
            [
              row.day,
              key,
              typeof metric.value === "number" ? metric.value : null,
              metric.definitionVersion ?? metric.version ?? "",
              metric.evidence?.coverageState ??
                metric.coverage?.state ??
                "UNKNOWN",
            ]
              .map(safe)
              .join(","),
          );
      }
      return new NextResponse(lines.join("\r\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="nexus-aggregate-history.csv"',
          "Cache-Control": "no-store",
        },
      });
    }
    const state = await new EntitlementService(context.services.db).effective(
      context.scope,
    );
    const snapshots = rows.map((row) => {
      const data = row.metrics as {
        metrics?: Record<
          string,
          { value: number | null; evidence?: { value: number | null } }
        >;
      };
      return {
        ...row,
        metrics: {
          ...data,
          metrics: visibleMetrics(data.metrics ?? {}, state),
        },
      };
    });
    return NextResponse.json(
      {
        visibleDays: days,
        kind: "ROLLING_30_DAY_SNAPSHOTS",
        snapshots,
        effectivePlan: state.plan,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: isDomainError(error)
          ? error.code
          : error instanceof z.ZodError
            ? "INVALID_HISTORY_RANGE"
            : "HISTORY_UNAVAILABLE",
      },
      {
        status: isDomainError(error)
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
