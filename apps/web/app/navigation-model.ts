export const dashboardViews = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
] as const;
export function dashboardView(value: string | null | undefined): number {
  return value &&
    /^\d{1,2}$/.test(value) &&
    dashboardViews.includes(Number(value) as (typeof dashboardViews)[number])
    ? Number(value)
    : 0;
}
export type DashboardFilters = {
  range: 7 | 30 | 90;
  tab: "overall" | "channels" | "behavior";
};
export function dashboardFilters(params: URLSearchParams): DashboardFilters {
  const range = Number(params.get("range"));
  const tab = params.get("tab");
  return {
    range: range === 7 || range === 90 ? range : 30,
    tab: tab === "channels" || tab === "behavior" ? tab : "overall",
  };
}
export function dashboardLocation(
  href: string,
  view: number,
  filters?: DashboardFilters,
): string {
  const url = new URL(href);
  // Only existing non-sensitive view / range / analysis-tab identifiers.
  url.search = "";
  url.hash = "";
  if (view === 0) url.searchParams.delete("view");
  else url.searchParams.set("view", String(dashboardView(String(view))));
  if (filters?.range && filters.range !== 30)
    url.searchParams.set("range", String(filters.range));
  if (filters?.tab && filters.tab !== "overall")
    url.searchParams.set("tab", filters.tab);
  return url.pathname + url.search;
}
