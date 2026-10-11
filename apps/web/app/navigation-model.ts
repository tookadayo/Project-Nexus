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
  // Preserve the Attention position only while normalizing that same view.
  // Server switches use a new URL; the server also binds every cursor to scope.
  const previous = new URLSearchParams(url.search);
  // Only explicit view, filter and signed paging identifiers.
  url.search = "";
  url.hash = "";
  if (view === 0) url.searchParams.delete("view");
  else url.searchParams.set("view", String(dashboardView(String(view))));
  if (filters?.range && filters.range !== 30)
    url.searchParams.set("range", String(filters.range));
  if (filters?.tab && filters.tab !== "overall")
    url.searchParams.set("tab", filters.tab);
  if (view === 8 && dashboardView(previous.get("view")) === 8) {
    const state = previous.get("attentionState"),
      channel = previous.get("attentionChannel"),
      cursor = previous.get("attentionCursor");
    if (
      state &&
      ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "SNOOZED", "RESOLVED"].includes(
        state,
      )
    )
      url.searchParams.set("attentionState", state);
    if (channel && /^\d{17,20}$/.test(channel))
      url.searchParams.set("attentionChannel", channel);
    if (cursor && cursor.length <= 2048)
      url.searchParams.set("attentionCursor", cursor);
  }
  return url.pathname + url.search;
}
