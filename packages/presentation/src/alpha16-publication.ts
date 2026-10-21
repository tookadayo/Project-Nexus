import { createHash } from "node:crypto";
import { z } from "zod";
import { renderPublicationMarkdown } from "../../shared/src/publication-markdown";

/** Offline/public-only contracts. This module deliberately imports no Next,
 * cookies, authentication, database, Operator or local candidate loader. */
const timestamp = z.iso.datetime({ offset: false });
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const publicText = (maximum: number) => z.string().trim().min(1).max(maximum);
const translation = z.object({ title: publicText(160), summary: publicText(500), body: publicText(50000) }).strict();
export const publicAnnouncementSourceSchema = z.object({
  scope: z.literal("PUBLIC"),
  id: z.uuid(),
  sourceVersion: version,
  category: z.enum(["UPDATE", "MAINTENANCE", "INCIDENT", "SERVICE", "POLICY"]),
  incidentStatus: z.enum(["NONE", "INVESTIGATING", "MONITORING", "RESOLVED"]),
  ja: translation,
  en: translation.nullable(),
  publishedAt: timestamp,
  updatedAt: timestamp,
}).strict().refine(value => value.category === "INCIDENT" || value.incidentStatus === "NONE", { message: "INCIDENT_CATEGORY_REQUIRED" });
export type PublicAnnouncementSource = z.infer<typeof publicAnnouncementSourceSchema>;
const announcementPayloadSchema = z.object({ schemaVersion: z.literal(1), announcementId: z.uuid(), sourceVersion: version,
  generation: version, category: z.enum(["UPDATE", "MAINTENANCE", "INCIDENT", "SERVICE", "POLICY"]),
  incidentStatus: z.enum(["NONE", "INVESTIGATING", "MONITORING", "RESOLVED"]), ja: translation, en: translation.nullable(), publishedAt: timestamp, updatedAt: timestamp }).strict();

export const publicationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(["ANNOUNCEMENT", "LEGAL", "STATUS"]),
  sourceId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  sourceVersion: version,
  generation: version,
  artifactHash: hash,
  state: z.enum(["STAGED", "ACTIVE", "RETIRED", "RETRACTED"]),
  createdAt: timestamp,
  publishedAt: timestamp.nullable(),
}).strict();
export type PublicationManifest = z.infer<typeof publicationManifestSchema>;
export const publicationHeadSchema = z.object({
  type: z.enum(["ANNOUNCEMENT", "LEGAL", "STATUS"]),
  sourceId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  active: publicationManifestSchema.nullable(),
  withdrawnGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  withdrawnSourceVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((value, context) => {
  if (value.withdrawnGeneration > value.generation || (value.active && (value.active.state !== "ACTIVE" || value.active.generation > value.generation || value.active.sourceId !== value.sourceId || value.active.type !== value.type))) context.addIssue({ code: "custom", message: "PUBLICATION_HEAD_INVALID" });
});
export type PublicationHead = z.infer<typeof publicationHeadSchema>;
export const emptyPublicationHead = (type: PublicationHead["type"], sourceId: string): PublicationHead => publicationHeadSchema.parse({ type, sourceId, generation: 0, active: null, withdrawnGeneration: 0, withdrawnSourceVersion: 0 });

export function canonicalPublicJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPublicJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalPublicJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("PUBLIC_ARTIFACT_NOT_JSON");
  return result;
}
export function publicArtifactHash(value: unknown) { return createHash("sha256").update(canonicalPublicJson(value)).digest("hex"); }
function invariant(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }

export function prepareAnnouncement(sourceInput: unknown, generation: number, createdAt: string) {
  const source = publicAnnouncementSourceSchema.parse(sourceInput);
  // The approved PUBLIC projection is reconstructed, never spread from a DB row.
  const payload = { schemaVersion: 1 as const, announcementId: source.id, sourceVersion: source.sourceVersion,
    generation: version.parse(generation), category: source.category, incidentStatus: source.incidentStatus,
    ja: source.ja, en: source.en, publishedAt: source.publishedAt, updatedAt: source.updatedAt };
  const manifest = publicationManifestSchema.parse({ schemaVersion: 1, type: "ANNOUNCEMENT", sourceId: source.id,
    sourceVersion: source.sourceVersion, generation, artifactHash: publicArtifactHash(payload), state: "STAGED", createdAt, publishedAt: null });
  return { payload, manifest };
}
export type PreparedAnnouncement = ReturnType<typeof prepareAnnouncement>;

/** A local state transition only. Persistence/active-pointer CAS and the
 * publisher's conditional switch must surround this in one publication flow. */
export function activatePublication(headInput: PublicationHead, stagedInput: PublicationManifest, payload: unknown, expectedGeneration: number, publishedAt: string): PublicationHead {
  const head = publicationHeadSchema.parse(headInput), staged = publicationManifestSchema.parse(stagedInput);
  invariant(head.generation === expectedGeneration, "PUBLICATION_GENERATION_CONFLICT");
  invariant(staged.type === head.type && staged.sourceId === head.sourceId, "PUBLICATION_SOURCE_CONFLICT");
  invariant(staged.state === "STAGED" && staged.generation > head.generation && staged.generation > head.withdrawnGeneration, "PUBLICATION_STALE_GENERATION");
  invariant(staged.sourceVersion > head.withdrawnSourceVersion, "PUBLICATION_WITHDRAWN_SOURCE");
  invariant(!head.active || (staged.type === head.active.type && staged.sourceId === head.active.sourceId && staged.sourceVersion >= head.active.sourceVersion), "PUBLICATION_SOURCE_CONFLICT");
  if (staged.type === "ANNOUNCEMENT") {
    const content = announcementPayloadSchema.parse(payload);
    invariant(content.announcementId === staged.sourceId && content.sourceVersion === staged.sourceVersion && content.generation === staged.generation, "PUBLICATION_SOURCE_CONFLICT");
    invariant(content.category === "INCIDENT" || content.incidentStatus === "NONE", "INCIDENT_CATEGORY_REQUIRED");
  } else if (staged.type === "STATUS") {
    const content = publicStatusSnapshotSchema.parse(payload);
    invariant(content.snapshotVersion === staged.sourceVersion, "PUBLICATION_SOURCE_CONFLICT");
  } else staticLegalDocumentSchema.parse(payload);
  invariant(staged.artifactHash === publicArtifactHash(payload), "PUBLICATION_HASH_MISMATCH");
  return { ...head, generation: staged.generation, active: { ...staged, state: "ACTIVE", publishedAt: timestamp.parse(publishedAt) } };
}
export function withdrawPublication(headInput: PublicationHead, expectedGeneration: number, generation: number, withdrawnAt: string): { head: PublicationHead; manifest: PublicationManifest } {
  const head = publicationHeadSchema.parse(headInput);
  invariant(head.generation === expectedGeneration && head.active, "PUBLICATION_GENERATION_CONFLICT");
  invariant(version.parse(generation) > head.generation, "PUBLICATION_STALE_GENERATION");
  const createdAt = timestamp.parse(withdrawnAt);
  const manifest: PublicationManifest = { ...head.active, generation, artifactHash: publicArtifactHash({ schemaVersion: 1, type: "WITHDRAWAL", sourceId: head.sourceId, generation, withdrawnAt: createdAt }), state: "RETRACTED", createdAt, publishedAt: null };
  return { head: { ...head, generation, active: null, withdrawnGeneration: generation, withdrawnSourceVersion: Math.max(head.withdrawnSourceVersion, head.active.sourceVersion) }, manifest };
}

const component = z.object({ state: z.enum(["OK", "DEGRADED", "STOPPED", "UNKNOWN"]), observedAt: timestamp.nullable() }).strict();
export const publicStatusSnapshotSchema = z.object({
  schemaVersion: z.literal(1), snapshotVersion: version, generatedAt: timestamp, validUntil: timestamp,
  quality: z.enum(["FRESH", "STALE", "UNKNOWN"]),
  observationSource: z.enum(["PC_HEALTH", "EXTERNAL_PROBE", "COMBINED", "UNAVAILABLE"]),
  components: z.object({ pc: component, tunnel: component, worker: component, discordOutbound: component }).strict(),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.validUntil) <= Date.parse(value.generatedAt)) context.addIssue({ code: "custom", message: "STATUS_WINDOW_INVALID" });
  for (const item of Object.values(value.components)) {
    if (item.state !== "UNKNOWN" && item.observedAt === null) context.addIssue({ code: "custom", message: "STATUS_OBSERVATION_REQUIRED" });
    if (item.observedAt !== null && Date.parse(item.observedAt) > Date.parse(value.generatedAt)) context.addIssue({ code: "custom", message: "STATUS_OBSERVATION_IN_FUTURE" });
  }
});
export type PublicStatusSnapshot = z.infer<typeof publicStatusSnapshotSchema>;
export function effectivePublicStatus(input: unknown, now: number) {
  const parsed = publicStatusSnapshotSchema.safeParse(input);
  const unknown = { state: "UNKNOWN" as const, observedAt: null };
  if (!parsed.success) return { state: "UNKNOWN" as const, expired: false, generatedAt: null, validUntil: null, components: { pc: unknown, tunnel: unknown, worker: unknown, discordOutbound: unknown } };
  const snapshot = parsed.data, expired = now > Date.parse(snapshot.validUntil), unusable = !Number.isFinite(now) || expired || now < Date.parse(snapshot.generatedAt) || snapshot.quality !== "FRESH" || snapshot.observationSource === "UNAVAILABLE";
  const components = unusable ? { pc: unknown, tunnel: unknown, worker: unknown, discordOutbound: unknown } : snapshot.components;
  const states = Object.values(components).map(item => item.state);
  const state = states.includes("UNKNOWN") ? "UNKNOWN" as const : states.some(value => value !== "OK") ? "DEGRADED" as const : "OK" as const;
  return { state, expired, generatedAt: snapshot.generatedAt, validUntil: snapshot.validUntil, components };
}

export const staticLegalDocumentSchema = z.object({
  document: z.enum(["terms", "privacy", "beta", "operator"]), locale: z.enum(["ja", "en"]),
  version: publicText(100), effectiveDate: z.iso.date(), approval: z.literal("APPROVED_PUBLIC"),
  title: publicText(200), body: publicText(100000),
}).strict();
export const contactUnavailable = { state: "UNAVAILABLE" as const, messageCode: "CONTACT_OPERATIONS_NOT_APPROVED" as const };
/** No accepting/submitted state exists until recipient, retention and actual
 * delivery operations are approved and implemented. */
export const staticContactSchema = z.object({ state: z.literal("UNAVAILABLE"), messageCode: z.literal("CONTACT_OPERATIONS_NOT_APPROVED") }).strict();

/** This is the reviewed source-copy revision, not a claim about an installed
 * runtime or a published product release. Release metadata is explicit input. */
export const PUBLIC_SITE_CONTENT_VERSION = "alpha16-static-copy-v1";
export const publicReleaseSnapshotSchema = z.object({ version: publicText(100), publishedAt: timestamp, approval: z.literal("APPROVED_PUBLIC") }).strict();
export const publicPricingSnapshotSchema = z.object({
  schemaVersion: z.literal(1), snapshotVersion: version, source: z.literal("NEXUS_BILLING_CATALOG"), approval: z.literal("APPROVED_PUBLIC"),
  observedAt: timestamp, validUntil: timestamp,
  status: z.enum(["READY", "CLOSED", "EMPTY", "UNAVAILABLE"]),
  offerings: z.array(z.object({ id: z.uuid(), plan_key: z.enum(["STARTER", "GROWTH", "SCALE"]), currency: z.literal("USD"),
    final_price_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), tax_behavior: z.enum(["INCLUSIVE", "EXCLUSIVE"]) }).strict()).max(3),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.validUntil) <= Date.parse(value.observedAt)) context.addIssue({ code: "custom", message: "PRICING_WINDOW_INVALID" });
  if ((value.status === "READY") !== (value.offerings.length > 0)) context.addIssue({ code: "custom", message: "PRICING_STATUS_MISMATCH" });
  if (new Set(value.offerings.map(row => row.plan_key)).size !== value.offerings.length || new Set(value.offerings.map(row => row.id)).size !== value.offerings.length) context.addIssue({ code: "custom", message: "PRICING_MAPPING_AMBIGUOUS" });
});
export type PublicPricingSnapshot = z.infer<typeof publicPricingSnapshotSchema>;
/** A snapshot never authorizes checkout. The PC dynamic catalog and current
 * commercial/permission gates remain authoritative for every purchase. */
export function effectivePublicPricing(input: unknown, now: number) {
  const parsed = publicPricingSnapshotSchema.safeParse(input);
  if (!parsed.success) return { state: "UNAVAILABLE" as const, observedAt: null, validUntil: null, snapshotVersion: null, offerings: [] as PublicPricingSnapshot["offerings"] };
  const data = parsed.data, valid = Number.isFinite(now) && now >= Date.parse(data.observedAt) && now < Date.parse(data.validUntil);
  return { state: valid ? data.status : "STALE" as const, observedAt: data.observedAt, validUntil: data.validUntil, snapshotVersion: data.snapshotVersion, offerings: valid && data.status === "READY" ? data.offerings : [] };
}

/** Immutable synthetic illustration only: no current guild/member/post data,
 * request to the PC, analysis job, saved state or quota consumption. */
export function officialDemoSeries(days: 7 | 30) {
  const end = Date.parse("2026-09-01T00:00:00Z"), from = end - days * 86400000;
  return Array.from({ length: days }, (_, index) => ({ day: new Date(from + index * 86400000).toISOString().slice(0, 10), value: index === 2 ? null : index === 3 ? 0 : (index * 3 + 5) % 13 }));
}

export type PublisherCapability = { atomicSwitch: boolean; conditionalGeneration: boolean; readBackHash: boolean; routeWithdrawal: boolean; cacheBehaviorVerified: boolean };
export function publicationReadiness(input: { enabled: boolean; retentionApproved: boolean; canonicalOriginsVerified: boolean; capability?: PublisherCapability }) {
  const blockers: string[] = [];
  if (!input.enabled) blockers.push("PUBLIC_PUBLISH_DISABLED");
  if (!input.retentionApproved) blockers.push("PUBLICATION_RETENTION_NOT_APPROVED");
  if (!input.canonicalOriginsVerified) blockers.push("PUBLICATION_ORIGINS_NOT_VERIFIED");
  if (!input.capability || (["atomicSwitch", "conditionalGeneration", "readBackHash", "routeWithdrawal", "cacheBehaviorVerified"] as const).some(key => input.capability?.[key] !== true)) blockers.push("PUBLISHER_CAPABILITY_UNVERIFIED");
  return { enabled: blockers.length === 0, blockers };
}
export const unconfiguredPublicationReadiness = () => publicationReadiness({ enabled: false, retentionApproved: false, canonicalOriginsVerified: false });

const originSchema = z.string().transform((value, context) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || !url.hostname.includes(".") || url.hostname.startsWith("[") || /^[\d.]+$/.test(url.hostname) || /(?:\.(?:local|internal|localhost)|^localhost)$/.test(url.hostname)) throw new Error();
    return url.origin;
  } catch { context.addIssue({ code: "custom", message: "PUBLIC_ORIGIN_INVALID" }); return z.NEVER; }
});
export const officialStaticInputSchema = z.object({
  schemaVersion: z.literal(1), generation: version, generatedAt: timestamp,
  officialOrigin: originSchema, appOrigin: originSchema,
  announcements: z.array(z.object({ source: publicAnnouncementSourceSchema, manifest: publicationManifestSchema }).strict()).max(1000),
  status: publicStatusSnapshotSchema.nullable(), legal: z.array(staticLegalDocumentSchema).max(8), contact: staticContactSchema,
  release: publicReleaseSnapshotSchema.nullable().optional(), pricing: publicPricingSnapshotSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.officialOrigin === value.appOrigin) context.addIssue({ code: "custom", message: "OFFICIAL_APP_ORIGINS_MUST_DIFFER" });
  const seen = new Set<string>();
  for (const item of value.announcements) {
    const key = item.source.id;
    if (seen.has(key)) context.addIssue({ code: "custom", message: "DUPLICATE_PUBLIC_ANNOUNCEMENT" });
    seen.add(key);
  }
  const documents = new Set<string>();
  for (const item of value.legal) {
    const key = `${item.document}:${item.locale}`;
    if (documents.has(key)) context.addIssue({ code: "custom", message: "DUPLICATE_PUBLIC_LEGAL" });
    documents.add(key);
  }
});
export type OfficialStaticInput = z.infer<typeof officialStaticInputSchema>;
const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const css = "body{font-family:system-ui,sans-serif;line-height:1.65;max-width:68rem;margin:auto;padding:2rem;color:#17243b;background:#f6f8fc}nav{display:flex;gap:1rem;flex-wrap:wrap}a{color:#214db0}main{padding:2rem 0}article,section{background:white;padding:1.5rem;margin:1rem 0;border:1px solid #dbe2ee;border-radius:.75rem}pre{overflow:auto}time{font-variant-numeric:tabular-nums}.status{font-weight:700}footer{border-top:1px solid #dbe2ee;padding-top:1rem}";

/** Produces reviewable files in memory. It neither reads a DB nor performs a
 * publish, remote switch, active-pointer mutation or environment configuration. */
export function buildOfficialStatic(input: unknown, now: number): { files: Record<string, string>; manifest: { schemaVersion: 1; generation: number; generatedAt: string; files: { path: string; sha256: string }[] }; readiness: ReturnType<typeof unconfiguredPublicationReadiness> } {
  const data = officialStaticInputSchema.parse(input), files: Record<string, string> = {};
  const cssPath = `assets/site-${createHash("sha256").update(css).digest("hex").slice(0,16)}.css`;
  const page = (title: string, content: string, language: "ja" | "en" = "ja", section = "", languageSwitchHref?: string) => {
    const prefix = language === "en" ? "/en" : "", here = section ? `/${section}/` : "/";
    const label = (ja: string, en: string) => language === "ja" ? ja : en;
    const languageHref = languageSwitchHref ?? `${language === "ja" ? "/en" : ""}${here}`;
    return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>${escapeHtml(title)} · NEXUS</title><link rel="stylesheet" href="/${cssPath}"></head><body><nav aria-label="${label("サイト案内", "Site navigation")}"><a href="${prefix}/">NEXUS</a><a href="${prefix}/product/">${label("製品", "Product")}</a><a href="${prefix}/demo/">${label("デモ", "Demo")}</a><a href="${prefix}/pricing/">${label("価格", "Pricing")}</a><a href="/announcements/">${label("お知らせ", "Announcements")}</a><a href="/status/">${label("稼働状況", "Status")}</a><a href="${escapeHtml(data.appOrigin)}/auth/login">${label("ダッシュボード", "Dashboard")}</a><a lang="${language === "ja" ? "en" : "ja"}" hreflang="${language === "ja" ? "en" : "ja"}" href="${escapeHtml(languageHref)}">${label("English", "日本語")}</a></nav><main>${content}</main><footer>${label("生成", "Generated")}: <time>${escapeHtml(data.generatedAt)}</time> · generation ${data.generation}<br>${label("公開説明の版", "Public copy revision")}: ${PUBLIC_SITE_CONTENT_VERSION}<br>${data.release ? `${label("製品の公開版", "Published product release")}: ${escapeHtml(data.release.version)} · <time>${escapeHtml(data.release.publishedAt)}</time>` : label("製品の公開版は未確認です。", "The published product release is unverified.")}</footer></body></html>`;
  };
  files[cssPath] = css;
  const entries: string[] = [];
  for (const entry of data.announcements) {
    const { source, manifest } = entry;
    invariant(manifest.type === "ANNOUNCEMENT" && manifest.sourceId === source.id && manifest.sourceVersion === source.sourceVersion, "PUBLICATION_SOURCE_CONFLICT");
    if (manifest.state !== "ACTIVE") continue;
    const prepared = prepareAnnouncement(source, manifest.generation, manifest.createdAt);
    invariant(manifest.artifactHash === prepared.manifest.artifactHash, "PUBLICATION_HASH_MISMATCH");
    invariant(manifest.publishedAt !== null, "PUBLICATION_NOT_CONFIRMED");
    const slug = `${source.id}-${manifest.generation}-${manifest.artifactHash.slice(0,16)}`;
    const body = `<article><h1>${escapeHtml(source.ja.title)}</h1><p>${escapeHtml(source.ja.summary)}</p><time>${escapeHtml(source.updatedAt)}</time>${renderPublicationMarkdown(source.ja.body).html}</article>`;
    files[`announcements/${slug}/index.html`] = page(source.ja.title, body, "ja", "", source.en ? `/announcements/${slug}/en/` : undefined);
    if (source.en) files[`announcements/${slug}/en/index.html`] = page(source.en.title, `<article><h1>${escapeHtml(source.en.title)}</h1><p>${escapeHtml(source.en.summary)}</p>${renderPublicationMarkdown(source.en.body).html}</article>`, "en", "", `/announcements/${slug}/`);
    entries.push(`<li><a href="/announcements/${slug}/">${escapeHtml(source.ja.title)}</a> <time>${escapeHtml(source.updatedAt)}</time></li>`);
  }
  files["announcements/index.html"] = page("お知らせ / Announcements", `<h1>お知らせ / Announcements</h1>${entries.length ? `<ul>${entries.join("")}</ul>` : "<p>公開中のお知らせはありません。 / No published announcements.</p>"}`);
  const status = effectivePublicStatus(data.status, now);
  const statusLabels = { OK: "正常 / Operational", DEGRADED: "一部利用不可 / Degraded", STOPPED: "停止 / Stopped", UNKNOWN: "現在状態不明 / Current status unknown" };
  const rows = Object.keys(status.components).map(key => `<li>${escapeHtml(key)}: <span data-component="${key}">${statusLabels.UNKNOWN}</span></li>`).join("");
  files["status/status.json"] = canonicalPublicJson(data.status === null ? { schemaVersion: 1, generatedAt: null, validUntil: null, state: "UNKNOWN", components: status.components } : data.status);
  const statusScript = `(()=>{let snapshot=${JSON.stringify(data.status)};const labels=${JSON.stringify(statusLabels)},keys=['pc','tunnel','worker','discordOutbound'],known=['OK','DEGRADED','STOPPED','UNKNOWN'];const update=()=>{const valid=snapshot&&snapshot.schemaVersion===1&&snapshot.quality==='FRESH'&&['PC_HEALTH','EXTERNAL_PROBE','COMBINED'].includes(snapshot.observationSource)&&snapshot.validUntil&&snapshot.generatedAt&&Date.now()<=Date.parse(snapshot.validUntil)&&Date.now()>=Date.parse(snapshot.generatedAt)&&Date.parse(snapshot.validUntil)>Date.parse(snapshot.generatedAt)&&keys.every(key=>{const item=snapshot.components&&snapshot.components[key];return item&&known.includes(item.state)&&(item.state==='UNKNOWN'||item.observedAt!==null&&Number.isFinite(Date.parse(item.observedAt))&&Date.parse(item.observedAt)<=Date.parse(snapshot.generatedAt))});const states=keys.map(key=>valid?snapshot.components[key].state:'UNKNOWN');document.querySelector('[data-overall]').textContent=labels[states.includes('UNKNOWN')?'UNKNOWN':states.some(state=>state!=='OK')?'DEGRADED':'OK'];document.querySelectorAll('[data-component]').forEach(node=>node.textContent=labels[valid?snapshot.components[node.dataset.component].state:'UNKNOWN']);document.querySelector('[data-status-generated]').textContent=snapshot&&snapshot.generatedAt||'UNKNOWN';document.querySelector('[data-status-valid-until]').textContent=snapshot&&snapshot.validUntil||'UNKNOWN'};let fetching=false;const poll=async()=>{if(fetching)return;fetching=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const response=await fetch('/status/status.json',{cache:'no-store',credentials:'omit',signal:controller.signal});if(!response.ok)throw new Error();snapshot=await response.json()}catch{snapshot=null}finally{clearTimeout(timer);fetching=false;update()}};update();void poll();setInterval(update,1000);setInterval(poll,30000)})();`;
  const statusPath = `assets/status-${createHash("sha256").update(statusScript).digest("hex").slice(0,16)}.js`;
  files[statusPath] = statusScript;
  files["status/index.html"] = page("稼働状況 / Status", `<h1>稼働状況 / Status</h1><p class="status" data-overall>${statusLabels.UNKNOWN}</p><ul>${rows}</ul><p>最終生成 / Generated: <time data-status-generated>${escapeHtml(status.generatedAt ?? "UNKNOWN")}</time><br>有効期限 / Valid until: <time data-status-valid-until>${escapeHtml(status.validUntil ?? "UNKNOWN")}</time></p><p>PC・Tunnel・Worker・Discordへの外部通信は別々の状態です。 / PC, Tunnel, Worker and Discord outbound have independent states.</p><noscript>時刻を検証できないため現在状態不明です。 / Current status is unknown without a clock check.</noscript><script src="/${statusPath}" defer></script>`);
  const legalLinks: string[] = [];
  for (const document of data.legal) {
    const target = `legal/${document.document}/${document.locale}/index.html`;
    const translatedLocale = document.locale === "ja" ? "en" : "ja";
    const languageSwitchHref = data.legal.some(item => item.document === document.document && item.locale === translatedLocale)
      ? `/legal/${document.document}/${translatedLocale}/` : undefined;
    files[target] = page(document.title, `<article><h1>${escapeHtml(document.title)}</h1><p>Version: ${escapeHtml(document.version)} · ${escapeHtml(document.effectiveDate)}</p>${renderPublicationMarkdown(document.body).html}</article>`, document.locale, "", languageSwitchHref);
    legalLinks.push(`<li><a href="/${target.replace("index.html", "")}">${escapeHtml(document.title)} (${document.locale})</a></li>`);
  }
  files["index.html"] = page("NEXUS", `<h1>NEXUS</h1><p>Discordコミュニティの運営を支えるサービス。 / Tools for Discord community operations.</p><section><h2>公開文書 / Public documents</h2>${legalLinks.length ? `<ul>${legalLinks.join("")}</ul>` : "<p>公開の承認待ちです。 / Public documents await approval.</p>"}</section><section><h2>お問い合わせ / Contact</h2><p>受付体制の準備中です。現在このサイトから送信できません。 / Contact operations are not ready. This site does not accept submissions.</p></section>`);
  const demoScript = `(()=>{const selector=document.querySelector('[data-demo-period-select]'),reset=document.querySelector('[data-demo-reset]'),show=()=>document.querySelectorAll('[data-demo-period]').forEach(node=>node.hidden=node.dataset.demoPeriod!==selector.value);selector.addEventListener('change',show);reset.addEventListener('click',()=>{selector.value='7';show();selector.focus()});show()})();`;
  const demoPath = `assets/demo-${createHash("sha256").update(demoScript).digest("hex").slice(0,16)}.js`;
  files[demoPath] = demoScript;
  const pricing = effectivePublicPricing(data.pricing, now);
  // Non-READY, expired or future input is not copied into the public artifact.
  // A legitimate READY snapshot is still clock-checked in the browser; without
  // script the page shows no price. There is no purchase form in static output.
  const publicPricing = pricing.offerings.length ? publicPricingSnapshotSchema.parse(data.pricing) : null;
  files["pricing/snapshot.json"] = canonicalPublicJson(publicPricing ?? { schemaVersion: 1, state: pricing.state, snapshotVersion: pricing.snapshotVersion, observedAt: pricing.observedAt, validUntil: pricing.validUntil, offerings: [] });
  const pricingScript = `(()=>{const snapshot=${JSON.stringify(publicPricing)};const update=()=>{document.querySelectorAll('[data-pricing]').forEach(root=>{const list=root.querySelector('[data-offerings]'),state=root.querySelector('[data-pricing-state]'),en=root.dataset.pricing==='en';list.replaceChildren();const valid=snapshot&&Date.now()>=Date.parse(snapshot.observedAt)&&Date.now()<Date.parse(snapshot.validUntil);state.textContent=valid?(en?'A dated price snapshot. Current terms are checked in the dashboard.':'日時つきの価格snapshotです。現在の条件はダッシュボードで確認します。'):(en?'Current prices are unavailable. Check the current catalog in the dashboard.':'現在の価格は確認できません。ダッシュボードで現在のcatalogをご確認ください。');if(valid)snapshot.offerings.forEach(row=>{const item=document.createElement('li');item.textContent=row.plan_key+': '+new Intl.NumberFormat(en?'en-US':'ja-JP',{style:'currency',currency:row.currency}).format(row.final_price_minor/100)+' / '+(en?'month':'月')+' · '+(row.tax_behavior==='INCLUSIVE'?(en?'tax included':'税込'):(en?'tax excluded':'税別'));list.append(item)})})};update();setInterval(update,1000)})();`;
  const pricingPath = `assets/pricing-${createHash("sha256").update(pricingScript).digest("hex").slice(0,16)}.js`;
  files[pricingPath] = pricingScript;
  for (const language of ["ja", "en"] as const) {
    const ja = language === "ja", prefix = ja ? "" : "en/", text = (japanese: string, english: string) => ja ? japanese : english;
    const intro = text("Discordの活動と、投稿への返信状況を確認する。", "Review Discord activity and replies to posts.");
    const description = text("コミュニティの活動を知り、投稿を確認し、対応後を振り返る。個人の評価や満足度を推定せず、確認できる事実から進めます。", "Understand activity, review posts, and look back on your response. Work from available facts without inferring individual performance or satisfaction.");
    const product = `<h1>${intro}</h1><p>${description}</p><section><h2>${text("活動を確認", "Review activity")}</h2><p>${text("期間と対象を選び、記録された活動と欠測を区別します。変化だけで原因や対応の効果は断定しません。", "Choose a period and scope, and distinguish recorded activity from missing data. Changes alone do not establish causes or effects.")}</p></section><section><h2>${text("運営の対応を整理", "Organize follow-up")}</h2><p>${text("要確認や対応記録を確認します。推奨される対応を読んだだけで、投稿や設定変更は実行されません。", "Review items and follow-up records. Reading a recommended action does not post a message or change settings.")}</p></section><section><h2>${text("ブロックで手順を作る", "Build a flow with blocks")}</h2><p>${text("型の合う入力を使って手順を組み、実行前の模擬確認を行えます。実際の操作には現在の権限と明示操作が必要です。", "Connect typed inputs and preview a flow before running it. Real actions require current permission and an explicit operation.")}</p></section><p><a href="/${prefix}demo/">${text("合成データのデモを試す", "Try the synthetic-data demo")}</a></p><p>${text("利用できる機能と上限は、現在のプラン・招待状態・設定によって異なります。", "Available features and limits depend on the current plan, invitation state and configuration.")}</p>`;
    files[`${prefix}product/index.html`] = page(text("製品", "Product"), product, language, "product");
    const demoTables = ([7, 30] as const).map(days => `<section data-demo-period="${days}"${days === 30 ? " hidden" : ""}><h2>${days}${text("日間の合成データ", " days of synthetic data")}</h2><table><thead><tr><th>${text("日付 (UTC)", "Date (UTC)")}</th><th>${text("返信の観測例", "Example reply observations")}</th></tr></thead><tbody>${officialDemoSeries(days).map(row => `<tr><td>${row.day}</td><td>${row.value === null ? text("不明（欠測）", "Unknown (missing data)") : row.value}</td></tr>`).join("")}</tbody></table></section>`).join("");
    files[`${prefix}demo/index.html`] = page(text("操作デモ", "Interactive demo"), `<h1>${text("合成データによる操作デモ", "Interactive demo with synthetic data")}</h1><p>${text("接続済みサーバーではありません。分析の実行・保存・利用枠消費は行いません。", "This is not a connected server. No analysis runs, saves or allowance consumption occur.")}</p><label>${text("サンプル期間", "Sample period")} <select data-demo-period-select><option value="7">7${text("日", " days")}</option><option value="30">30${text("日", " days")}</option></select></label> <button type="button" data-demo-reset>${text("リセット", "Reset demo")}</button>${demoTables}<details><summary>${text("測定の根拠と限界", "Measurement context and limits")}</summary><p>${text("この例では不明とゼロを区別します。実際の本文・個人・サーバーの記録は含みません。返信の件数だけで満足度や対応の効果は分かりません。", "This example distinguishes unknown from zero. It contains no real message, person or server records. Reply counts alone do not establish satisfaction or the effect of an action.")}</p></details><noscript>${text("期間切替にはJavaScriptが必要です。上の7日例は静的に閲覧できます。", "JavaScript is needed to switch periods. The 7-day example above remains readable.")}</noscript><script src="/${demoPath}" defer></script>`, language, "demo");
    files[`${prefix}pricing/index.html`] = page(text("価格", "Pricing"), `<h1>${text("プランと価格", "Plans and pricing")}</h1><section data-pricing="${language}"><p data-pricing-state>${text("現在の価格は確認できません。", "Current prices are unavailable.")}</p><ul data-offerings></ul></section><p>${text("snapshot版", "Snapshot revision")}: ${pricing.snapshotVersion ?? text("未確認", "Unverified")}<br>${text("観測", "Observed")}: <time>${escapeHtml(pricing.observedAt ?? "UNKNOWN")}</time><br>${text("有効期限", "Valid until")}: <time>${escapeHtml(pricing.validUntil ?? "UNKNOWN")}</time></p><p>${text("静的snapshotは購入条件を確定しません。現在の価格・提供条件・権限をPC側の正本で再確認します。", "A static snapshot does not establish purchase terms. The PC catalog rechecks current prices, availability and permission.")}</p><a href="${escapeHtml(data.appOrigin)}/pricing">${text("現在のプランと条件を確認", "Check current plans and terms")}</a><noscript><p>${text("時刻を検証できないため、価格を表示しません。", "Prices are hidden because snapshot time cannot be checked.")}</p></noscript><script src="/${pricingPath}" defer></script>`, language, "pricing");
    if (!ja) files["en/index.html"] = page("NEXUS", `<h1>NEXUS</h1><p>${description}</p><p><a href="/en/product/">Explore the product</a> · <a href="/en/demo/">Try the demo</a></p><section><h2>Public documents</h2>${legalLinks.length ? `<ul>${legalLinks.join("")}</ul>` : "<p>Public documents await approval.</p>"}</section><section><h2>Contact</h2><p>Contact operations are not ready. This site does not accept submissions.</p></section>`, "en");
  }
  files["version.json"] = canonicalPublicJson({ schemaVersion: 1, generation: data.generation, generatedAt: data.generatedAt, contentVersion: PUBLIC_SITE_CONTENT_VERSION, release: data.release ?? null, pricingSnapshotVersion: pricing.snapshotVersion });
  files["404.html"] = page("見つかりません / Not found", "<h1>見つかりません / Not found</h1><a href=\"/\">戻る / Back</a>");
  const artifactManifest = { schemaVersion: 1 as const, generation: data.generation, generatedAt: data.generatedAt,
    files: Object.keys(files).sort().map(path => ({ path, sha256: createHash("sha256").update(files[path]!).digest("hex") })) };
  files["manifest.json"] = canonicalPublicJson(artifactManifest);
  return { files, manifest: artifactManifest, readiness: unconfiguredPublicationReadiness() };
}
