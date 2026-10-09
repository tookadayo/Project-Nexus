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
export function dashboardLocation(href: string, view: number): string {
  const url = new URL(href);
  // Dashboard has only the existing numeric view URL contract.
  url.search = "";
  url.hash = "";
  if (view === 0) url.searchParams.delete("view");
  else url.searchParams.set("view", String(dashboardView(String(view))));
  return url.pathname + url.search + url.hash;
}
