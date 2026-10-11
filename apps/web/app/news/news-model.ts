export const newsCategories = [
  "UPDATE",
  "MAINTENANCE",
  "INCIDENT",
  "SERVICE",
  "POLICY",
] as const;
export type NewsCategory = (typeof newsCategories)[number];
export type NewsQuery = { category?: NewsCategory; page: number };
export type NewsSearchParams = Record<string, string | string[] | undefined>;

export type NewsContentsItem = {
  id: string;
  level: number;
  text: string;
  children: NewsContentsItem[];
};

export function newsContents(
  headings: { id: string; level: number; text: string }[],
): NewsContentsItem[] {
  const roots: NewsContentsItem[] = [];
  const parents: NewsContentsItem[] = [];
  for (const heading of headings) {
    const item: NewsContentsItem = { ...heading, children: [] };
    while (parents.length && parents.at(-1)!.level >= heading.level)
      parents.pop();
    const parent = parents.at(-1);
    (parent ? parent.children : roots).push(item);
    parents.push(item);
  }
  return roots;
}

export function newsQuery(params: NewsSearchParams): NewsQuery {
  const category = newsCategories.find((value) => value === params.category);
  const rawPage = typeof params.page === "string" ? params.page : "";
  const parsed = /^\d{1,6}$/.test(rawPage) ? Number(rawPage) : 1;
  return { category, page: parsed >= 1 && parsed <= 100000 ? parsed : 1 };
}

export function newsHref(query: NewsQuery, id?: string) {
  const params = new URLSearchParams();
  if (query.category) params.set("category", query.category);
  if (query.page > 1) params.set("page", String(query.page));
  const path = id ? `/news/${encodeURIComponent(id)}` : "/news";
  return params.size ? `${path}?${params.toString()}` : path;
}

export const newsCategoryLabels: Record<
  NewsCategory,
  { ja: string; en: string }
> = {
  UPDATE: { ja: "アップデート", en: "Updates" },
  MAINTENANCE: { ja: "メンテナンス", en: "Maintenance" },
  INCIDENT: { ja: "障害情報", en: "Incidents" },
  SERVICE: { ja: "サービス案内", en: "Service information" },
  POLICY: { ja: "規約・ポリシー改定", en: "Terms & policy changes" },
};

export function newsTimestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : null;
}
