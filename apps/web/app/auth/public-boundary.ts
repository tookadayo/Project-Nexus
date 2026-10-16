/** The PC Next listener exposes these actual application routes only. The
 * official static site and the internal API have separate deployment surfaces. */
export type WebRouteBoundary = "PUBLIC_READ" | "OAUTH_CALLBACK" | "MACHINE_CALLBACK" | "BROWSER" | "ASSET";
const publicPages = new Set([
  "/", "/product", "/pricing", "/news", "/terms", "/privacy", "/support",
  "/legal", "/legal/beta", "/legal/operator", "/legal/history",
  "/auth/login", "/auth/expired", "/auth/problem",
]);
const browserPages = new Set([
  "/dashboard", "/servers", "/setup", "/automation", "/automation/managed-roles", "/explore", "/analysis", "/operations", "/operations/maintenance", "/health", "/rules", "/templates", "/preferences", "/experiments", "/lifecycle-interventions", "/link",
  "/onboarding-flows", "/reports/definitions", "/rules/issues", "/rules/sources", "/rules/config", "/rules/context", "/rules/evaluations",
  "/billing", "/billing/admin", "/billing/manage", "/billing/payments", "/billing/plans",
  "/billing/promotions", "/billing/success", "/checkout", "/checkout/confirmation",
  "/checkout/payment", "/checkout/review",
]);
const browserHandlers: Readonly<Record<string, readonly string[]>> = {
  "/locale": ["POST"],
  "/auth/select": ["GET", "HEAD", "POST"],
  "/auth/logout": ["GET", "HEAD", "POST"],
  "/auth/disconnect": ["GET", "HEAD", "POST"],
  "/control": ["POST"],
  "/data/actions": ["GET", "HEAD"], "/data/attention": ["GET", "HEAD", "POST"],
  "/data/community": ["GET", "HEAD"], "/data/journey": ["GET", "HEAD"], "/data/results": ["GET", "HEAD"],
  "/explore/data": ["GET", "HEAD", "POST"], "/operations/data": ["GET", "HEAD", "POST"],
  "/templates/data": ["GET", "HEAD", "POST"], "/preferences/data": ["GET", "HEAD", "POST"],
  "/experiments/data": ["GET", "HEAD", "POST"], "/lifecycle-interventions/data": ["GET", "HEAD", "POST"],
  "/onboarding-flows/data": ["GET", "HEAD", "POST"],
  "/billing/actions": ["POST"], "/billing/admin/actions": ["POST"],
  "/billing/payments/actions": ["POST"], "/billing/history": ["GET", "HEAD"],
  "/billing/recipes": ["POST"], "/billing/status": ["GET", "HEAD"],
  "/checkout/abandon": ["POST"], "/checkout/actions": ["POST"],
  "/checkout/connect": ["POST"], "/checkout/status": ["GET", "HEAD"],
  "/link/redeem": ["POST"], "/link/disconnect": ["POST"],
};
const readMethods = ["GET", "HEAD"] as const;
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";

export function webRouteBoundary(path: string): { kind: WebRouteBoundary; methods: readonly string[] } | null {
  // Encoded separators, malformed escapes and traversal spellings never expand
  // a registered route into another namespace.
  // eslint-disable-next-line no-control-regex -- Explicitly reject ASCII controls at the public route boundary.
  if (!path.startsWith("/") || /[\\\x00-\x20]|\/\//.test(path) || /%(?:2f|5c|2e|00)/i.test(path)) return null;
  try { if (decodeURIComponent(path).includes("%")) return null; } catch { return null; }
  if (path === "/auth/callback") return { kind: "OAUTH_CALLBACK", methods: ["GET"] };
  if (path === "/billing/webhooks/stripe") return { kind: "MACHINE_CALLBACK", methods: ["POST"] };
  if (publicPages.has(path) || new RegExp(`^/news/${uuid}$`, "i").test(path)) return { kind: "PUBLIC_READ", methods: readMethods };
  if (browserPages.has(path) || /^\/dashboard\/\d{17,20}$/.test(path)) return { kind: "BROWSER", methods: readMethods };
  const methods = browserHandlers[path];
  if (methods) return { kind: "BROWSER", methods };
  if (/^\/data\/setup\/(?:status|candidates)$/.test(path) || new RegExp(`^/data/setup/requests/${uuid}$`, "i").test(path)) return { kind: "BROWSER", methods: readMethods };
  if (/^\/data\/setup\/(?:requests|verify|draft|apply|complete)$/.test(path)) return { kind: "BROWSER", methods: ["POST"] };
  // The alpha15 handler has its own bounded action/path registry; this only
  // admits that existing handler, never arbitrary /api or internal prefixes.
  if (/^\/api\/automation\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+){0,4}$/.test(path)) return { kind: "BROWSER", methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] };
  if (/^\/api\/operations-maintenance\/[a-zA-Z0-9_-]{1,80}(?:\/[a-zA-Z0-9_-]{1,80}){0,3}$/.test(path)) return { kind: "BROWSER", methods: ["GET", "HEAD", "POST"] };
  if (["/api/health/overview", "/api/health/lifecycle-preview"].includes(path)) return { kind: "BROWSER", methods: readMethods };
  if (["/api/rule-issues", "/api/rule-context"].includes(path)) return { kind: "BROWSER", methods: ["GET", "HEAD", "POST"] };
  if (new RegExp(`^/api/report-definitions/(?:templates(?:/${uuid})?|drafts/${uuid}(?:/preview)?)$`, "i").test(path)) return { kind: "BROWSER", methods: readMethods };
  if (new RegExp(`^/api/report-definitions/drafts(?:/${uuid}/(?:revisions|commit|cancel))?$`, "i").test(path)) return { kind: "BROWSER", methods: ["POST"] };
  if (path === "/api/rules/rule-evaluations") return { kind: "BROWSER", methods: ["GET", "HEAD", "POST"] };
  if (["/api/rules/source-config", "/api/rules/source-config/options"].includes(path) || new RegExp(`^/api/rules/source-config/${uuid}$`, "i").test(path)) return { kind: "BROWSER", methods: readMethods };
  if (path === "/api/rules/source-config/revisions" || new RegExp(`^/api/rules/source-config/${uuid}/disable$`, "i").test(path)) return { kind: "BROWSER", methods: ["POST"] };
  if (["/api/rules/evaluation-request-key", "/api/rules/evaluation-request-status", "/api/rules/mutation-request-key"].includes(path)) return { kind: "BROWSER", methods: ["POST"] };
  if (["/api/rules/source-health/observations", "/api/rules/config/activate", "/api/rules/config/retire"].includes(path)) return { kind: "BROWSER", methods: ["POST"] };
  if (new RegExp(`^/api/analysis/(?:menu|history|runs/${uuid}(?:/compare)?)$`, "i").test(path)) return { kind: "BROWSER", methods: readMethods };
  if (new RegExp(`^/api/analysis/(?:preview|runs|runs/${uuid}/cancel)$`, "i").test(path)) return { kind: "BROWSER", methods: ["POST"] };
  if (/^\/api\/rules\/(?:catalog|config|config\/history|suggestions|suggestions\/[a-zA-Z0-9_-]+(?:\/history)?|fact-snapshots\/[a-zA-Z0-9_-]+|rule-evaluations(?:\/[a-zA-Z0-9_-]+)?|operations\/[a-zA-Z0-9_-]+)$/.test(path)) return { kind: "BROWSER", methods: readMethods };
  if (/^\/api\/rules\/(?:config\/revisions|rule-evaluations|rule-evaluations\/[a-zA-Z0-9_-]+\/cancel|suggestions\/[a-zA-Z0-9_-]+\/(?:view|dismiss|save|reject|draft|apply))$/.test(path)) return { kind: "BROWSER", methods: ["POST"] };
  if (path === "/favicon.ico" || path === "/_next/image" || /^\/(?:_next\/static|nexus)\/[a-zA-Z0-9_./@-]+$/.test(path)) return { kind: "ASSET", methods: readMethods };
  return null;
}

/** Forwarded headers never establish the trusted origin. Tunnel listener and
 * ingress restrictions remain a separate alpha17 configuration gate. */
export function canonicalWebHost(request: Request, canonical: string, production = process.env.NODE_ENV === "production") {
  try {
    const origin = new URL(canonical);
    return (!production || origin.protocol === "https:") && request.headers.get("host")?.toLowerCase() === origin.host.toLowerCase();
  } catch { return false; }
}

export const browserMutation = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method);
