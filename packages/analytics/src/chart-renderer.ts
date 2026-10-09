import { renderAsync } from "@resvg/resvg-js";
import type { ChartSpec } from "./chart-spec";
import {
  chartTitle,
  chartUnit,
  chartValue,
  chartCoverage,
  chartPeriod,
  chartCaveat,
  chartSummary,
  chartLinePath,
  type ChartLocale,
} from "./chart-language";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const cache = new Map<string, Promise<Buffer>>();
/** Native asynchronous rendering runs outside the JavaScript/Gateway thread. */
export function renderChartPng(
  spec: ChartSpec,
  locale: ChartLocale = "en",
): Promise<Buffer> {
  const key = `${spec.cacheKey}:${locale}:alpha14`;
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = renderAsync(
    chartSvg(spec, locale),
    {
      font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" },
      fitTo: { mode: "width", value: 1000 },
    },
    AbortSignal.timeout(15000),
  ).then((image) => image.asPng());
  cache.set(key, pending);
  while (cache.size > 32) cache.delete(cache.keys().next().value!);
  void pending.catch(() => cache.delete(key));
  return pending;
}
function fitText(value: string, units: number) {
  let used = 0,
    result = "";
  for (const character of value) {
    used += character.codePointAt(0)! > 0xff ? 2 : 1;
    if (used > units) return result + "…";
    result += character;
  }
  return result;
}
export function chartSvg(spec: ChartSpec, locale: ChartLocale = "en") {
  const ja = locale === "ja",
    points = spec.series.find((s) => s.key === "CURRENT")?.points ?? [],
    previous = spec.series.find((s) => s.key === "PREVIOUS")?.points ?? [],
    maximum = Math.max(1, ...[...points, ...previous].map((p) => p.value ?? 0)),
    plot = { x: 74, y: 204, w: 858, h: 180 },
    x = (index: number) =>
      plot.x + ((index + 0.5) * plot.w) / Math.max(1, points.length),
    y = (value: number) => plot.y + plot.h - (value / maximum) * plot.h,
    currentPath = chartLinePath(points, x, y),
    previousPath = chartLinePath(previous, x, y),
    total = chartValue(spec.evidence.value, locale),
    hasValues = [...points, ...previous].some((point) => point.value !== null),
    previousPeriod = previous.length
      ? `${previous[0]!.bucket.slice(0, 10)} — ${previous.at(-1)!.bucket.slice(0, 10)}`
      : "";
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const n = (maximum * index) / 4,
      at = y(n);
    return `<line x1="${plot.x}" x2="${plot.x + plot.w}" y1="${at}" y2="${at}" stroke="#dbe3ef"/><text x="${plot.x - 12}" y="${at + 5}" text-anchor="end" fill="#53627a" font-size="14">${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n)}</text>`;
  }).join("");
  const markers = points
    .map((point, i) =>
      point.value === null
        ? `<text x="${x(i)}" y="${y(0) - 9}" text-anchor="middle" font-size="15" fill="#53627a">?</text>`
        : `<circle cx="${x(i)}" cy="${y(point.value)}" r="3.5" fill="#2758ca"/>`,
    )
    .join("");
  const comparisons = previous
    .map((point, i) =>
      point.value === null
        ? ""
        : `<rect x="${x(i) - 3}" y="${y(point.value) - 3}" width="6" height="6" fill="#765027" stroke="white"/>`,
    )
    .join("");
  const stride = Math.max(1, Math.ceil(points.length / 7));
  const dates = points
    .map((point, index) =>
      (index % stride === 0 && points.length - 1 - index >= stride / 2) ||
      index === points.length - 1
        ? `<text x="${x(index)}" y="410" text-anchor="middle" fill="#53627a" font-size="14">${escape(point.bucket.slice(5, 10))}</text>`
        : "",
    )
    .join("");
  const brand = fitText(
    spec.branding?.title ?? (ja ? "コミュニティの活動" : "Community activity"),
    58,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500" viewBox="0 0 1000 500" role="img" aria-labelledby="title description">
<title id="title">${escape(chartTitle(spec, locale))}</title><desc id="description">${escape(chartSummary(spec, locale) + "\n" + chartCaveat(locale))}</desc>
<rect width="1000" height="500" rx="20" fill="#ffffff"/><rect x="1" y="1" width="998" height="498" rx="19" fill="none" stroke="#dbe3ef"/><g font-family="sans-serif">
<text x="42" y="35" fill="#2758ca" font-size="15" font-weight="bold">NEXUS · ${escape(brand)}</text>
${spec.branding?.logoBase64 && /^[A-Za-z0-9+/=]{1,140000}$/.test(spec.branding.logoBase64) ? `<image x="898" y="20" width="50" height="50" href="data:image/png;base64,${spec.branding.logoBase64}"/>` : ""}
<text x="42" y="73" fill="#172b4d" font-size="26" font-weight="bold">${escape(chartTitle(spec, locale))}</text>
<text x="42" y="100" fill="#53627a" font-size="15">${escape(chartPeriod(spec, locale))}</text>
<text x="42" y="133" fill="#172b4d" font-size="20">${ja ? "合計" : "Total"}: ${escape(total)} <tspan font-size="14">${spec.evidence.value === null ? "· " : escape(chartUnit(locale)) + " · "}${escape(chartCoverage(spec, locale))}</tspan></text>
<line x1="43" x2="65" y1="161" y2="161" stroke="#2758ca" stroke-width="3"/><circle cx="54" cy="161" r="3" fill="#2758ca"/><text x="74" y="166" fill="#172b4d" font-size="14">${ja ? "本期間" : "Current period"}</text>
${previous.length ? `<line x1="239" x2="263" y1="161" y2="161" stroke="#765027" stroke-width="2" stroke-dasharray="5 4"/><rect x="248" y="158" width="6" height="6" fill="#765027"/><text x="275" y="166" fill="#172b4d" font-size="14">${ja ? "比較期間" : "Previous"}: ${escape(previousPeriod)}</text>` : ""}
<text x="940" y="166" text-anchor="end" fill="#53627a" font-size="14">? ${ja ? "欠測・不明" : "Missing / unavailable"}</text>
<text x="74" y="191" fill="#53627a" font-size="13">${escape(chartUnit(locale))}</text>
${hasValues ? `${ticks}<path d="${currentPath}" fill="none" stroke="#2758ca" stroke-width="3"/>${previous.length ? `<path d="${previousPath}" fill="none" stroke="#765027" stroke-width="2" stroke-dasharray="5 4"/>` : ""}${markers}${comparisons}${dates}` : `<rect x="74" y="204" width="858" height="180" rx="10" fill="#f3f6fb"/><text x="503" y="278" text-anchor="middle" fill="#172b4d" font-size="21">${ja ? "日別の値を確認できません" : "Daily values are unavailable"}</text><text x="503" y="309" text-anchor="middle" fill="#53627a" font-size="15">${ja ? "データがない状態を0件として表示しません。" : "Missing data is not displayed as zero."}</text>`}
${previous.length ? `<text x="74" y="433" fill="#53627a" font-size="13">${spec.comparison?.comparable === false ? (ja ? "データまたは条件がそろわないため差は計算できません。" : "Data or conditions are not sufficient to calculate a difference.") : ja ? "同じ経過日の値を並べています。" : "Values are aligned by elapsed day."}</text>` : ""}
<text x="935" y="433" text-anchor="end" fill="#53627a" font-size="13">${ja ? "日付（UTC）" : "Date (UTC)"}</text>
<text x="42" y="456" fill="#53627a" font-size="13">${escape(chartCaveat(locale))}</text>
<text x="42" y="481" fill="#53627a" font-size="12">${escape(fitText(spec.branding?.footer ?? (ja ? "対象条件を満たす活動の集計です。個人の評価ではありません。" : "Activity within the stated scope. These are not individual scores."), 133))}</text>
</g></svg>`;
}
