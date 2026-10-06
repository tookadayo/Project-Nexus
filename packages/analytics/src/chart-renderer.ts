import { renderAsync } from "@resvg/resvg-js";
import type { ChartSpec } from "./chart-spec";

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
export function renderChartPng(spec: ChartSpec): Promise<Buffer> {
  const existing = cache.get(spec.cacheKey);
  if (existing) return existing;
  const pending = renderAsync(
    chartSvg(spec),
    {
      font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" },
      fitTo: { mode: "width", value: 1000 },
    },
    AbortSignal.timeout(15000),
  ).then((image) => image.asPng());
  cache.set(spec.cacheKey, pending);
  while (cache.size > 32) cache.delete(cache.keys().next().value!);
  void pending.catch(() => cache.delete(spec.cacheKey));
  return pending;
}
export function chartSvg(spec: ChartSpec) {
  const points = spec.series[0]?.points ?? [],
    previous = spec.series.find((s) => s.key === "PREVIOUS")?.points ?? [],
    maximum = Math.max(1, ...[...points, ...previous].map((p) => p.value ?? 0)),
    plot = { x: 74, y: 125, w: 858, h: 252 };
  const bars = points
    .map((p, i) => {
      const width = plot.w / Math.max(1, points.length),
        x = plot.x + i * width,
        height = ((p.value ?? 0) / maximum) * plot.h;
      return p.value === null
        ? `<rect x="${x + 2}" y="${plot.y + plot.h - 8}" width="${Math.max(1, width - 4)}" height="8" fill="#707e74"/><text x="${x + width / 2}" y="${plot.y + plot.h - 15}" text-anchor="middle" font-size="12" fill="#a9b5ad">?</text>`
        : `<rect x="${x + 2}" y="${plot.y + plot.h - height}" width="${Math.max(1, width - 4)}" height="${Math.max(1, height)}" rx="2" fill="#c8f169"/>`;
    })
    .join("");
  const comparison = previous
    .map((point, i) =>
      point.value === null
        ? ""
        : `<circle cx="${plot.x + ((i + 0.5) * plot.w) / Math.max(1, points.length)}" cy="${plot.y + plot.h - (point.value / maximum) * plot.h}" r="3" fill="#71b8ee"/>`,
    )
    .join("");
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const y = plot.y + plot.h - (i / 4) * plot.h;
    return `<line x1="${plot.x}" x2="${plot.x + plot.w}" y1="${y}" y2="${y}" stroke="#344638"/><text x="${plot.x - 12}" y="${y + 5}" text-anchor="end" fill="#b4c2b7" font-size="14">${Math.round((maximum * i) / 4)}</text>`;
  }).join("");
  const first = spec.range.from.slice(0, 10),
    last = spec.range.to.slice(0, 10),
    coverage = spec.evidence.coverageState,
    total =
      spec.evidence.value === null ? "UNKNOWN" : String(spec.evidence.value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500" viewBox="0 0 1000 500">
<rect width="1000" height="500" rx="20" fill="#131e17"/><g font-family="sans-serif">
<text x="42" y="43" fill="#c8f169" font-size="16" font-weight="bold">NEXUS · ${escape(spec.branding?.title?.slice(0, 70) ?? "COMMUNITY OPERATIONS")}</text>
${spec.branding?.logoBase64 && /^[A-Za-z0-9+/=]{1,140000}$/.test(spec.branding.logoBase64) ? `<image x="890" y="30" width="50" height="50" href="data:image/png;base64,${spec.branding.logoBase64}"/>` : ""}
<text x="42" y="79" fill="#eef6ef" font-size="23">${escape(spec.title)}</text>
<text x="42" y="104" fill="#b4c2b7" font-size="14">${first} — ${last} · ${spec.range.days} days · ${escape(spec.range.timezone)}${previous.length ? " · Blue dots: previous period" : ""}</text>
${ticks}${bars}${comparison}
<text x="${plot.x}" y="410" fill="#b4c2b7" font-size="14">${first}</text><text x="${plot.x + plot.w}" y="410" text-anchor="end" fill="#b4c2b7" font-size="14">${last}</text>
<text x="42" y="439" fill="#eef6ef" font-size="16">Observed: ${total} · Coverage: ${coverage} · Missing observations: ?</text>
<text x="42" y="462" fill="#9cac9f" font-size="12">Aggregate evidence only · Event signup ≠ Attendance · Voice co-presence ≠ Conversation</text>
<text x="42" y="483" fill="#9cac9f" font-size="12">${escape(spec.branding?.footer?.slice(0, 140) ?? "")}</text>
</g></svg>`;
}
