import {
  chartQuerySchema,
  type ChartQuery,
} from "../../../../packages/analytics/src/chart-spec";

/** Filters are scope-bound; names, drafts, tokens and result data never enter URLs. */
export function exploreQuery(
  params: URLSearchParams,
  scope: string,
): ChartQuery {
  const fallback = chartQuerySchema.parse({});
  if (!scope || params.get("guild") !== scope) return fallback;
  const raw = params.get("q");
  if (!raw || raw.length > 4096) return fallback;
  try {
    const value = chartQuerySchema.safeParse(JSON.parse(raw));
    return value.success ? value.data : fallback;
  } catch {
    return fallback;
  }
}
export function exploreLocation(query: ChartQuery, scope: string): string {
  const parsed = chartQuerySchema.safeParse(query);
  if (!parsed.success || !/^\d{17,20}$/.test(scope)) return "/explore";
  return (
    "/explore?" +
    new URLSearchParams({ guild: scope, q: JSON.stringify(parsed.data) })
  );
}
