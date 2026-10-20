import type { Page, Request, Response } from "@playwright/test";

export const STATUS_DIAGNOSTIC_LIMIT = 4;
export const STATUS_DIAGNOSTIC_BODY_LIMIT = 16 * 1024;
const states = ["LINK_REQUIRED", "SETUP_REQUIRED", "COMPLETE", "BOT_REQUIRED"] as const;
const errors = [
  "SESSION_REQUIRED", "AUTH_SESSION", "AUTHENTICATION_REQUIRED", "SESSION_EXPIRED",
  "ADMIN_REQUIRED", "FORBIDDEN", "PERMISSION", "PERMISSION_DENIED", "ROLE_REQUIRED",
  "SERVER_VERIFICATION_REQUIRED", "SERVER_SELECTION_CHANGED", "SERVER_AUTHORIZATION_UNAVAILABLE",
  "AUTHORIZATION_UNAVAILABLE", "AUTHORIZATION_EXPIRED", "UNAVAILABLE", "UNKNOWN", "CHECK_FAILED",
  "BETA_REQUIRED", "BETA_UNAVAILABLE", "BETA_INELIGIBLE", "INVITATION_REQUIRED", "TERMS_REQUIRED",
  "BOT_NOT_INSTALLED", "INSTALLATION_REQUIRED", "GUILD_NOT_INSTALLED",
  "REVISION_CONFLICT", "CONFLICT", "STALE_REVISION", "VALIDATION", "INVALID_INPUT",
] as const;
type State = typeof states[number] | "OTHER" | null;
type ErrorCode = typeof errors[number] | "OTHER" | null;
type Phase = "WAITING_RESPONSE" | "WAITING_FINISH" | "WAITING_SIZE" | "WAITING_BODY" |
  "READ" | "REQUEST_FAILED" | "FINISH_FAILED" | "SIZE_UNAVAILABLE" | "TOO_LARGE" |
  "ENCODED" | "SERVICE_WORKER" | "INVALID_LENGTH" | "LENGTH_MISMATCH" | "INVALID_JSON" | "NON_OBJECT" | "OBSERVATION_FAILED";
type Entry = { status: number | null; phase: Phase; error: ErrorCode; state: State; hasSettings: boolean | null };
export type SetupStatusSnapshot = {
  schema: "alpha17-setup-status-v1"; limit: 4; requestCount: number; responseCount: number;
  limitReached: boolean; observerFailure: boolean; entries: Entry[];
};

/** Only closed-vocabulary classifications leave this helper, never response text. */
export function classifySetupStatus(body: unknown): Pick<Entry, "error" | "state" | "hasSettings" | "phase"> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { phase: "NON_OBJECT", error: null, state: null, hasSettings: null };
  const data = body as Record<string, unknown>;
  return {
    phase: "READ",
    error: data.error == null ? null : errors.find(value => value === data.error) ?? "OTHER",
    state: data.state == null ? null : states.find(value => value === data.state) ?? "OTHER",
    hasSettings: !!data.settings && typeof data.settings === "object" && !Array.isArray(data.settings),
  };
}

/** Encoded wire size bounds decoded bytes only when no content encoding is applied. */
export function setupStatusBodyGate(size: number, encoding: string | null, length: string | null): Phase | null {
  if (encoding !== null && encoding.trim().toLowerCase() !== "identity") return "ENCODED";
  if (!Number.isSafeInteger(size) || size < 1) return "SIZE_UNAVAILABLE";
  if (size > STATUS_DIAGNOSTIC_BODY_LIMIT) return "TOO_LARGE";
  if (length !== null) {
    if (!/^(0|[1-9][0-9]{0,8})$/.test(length)) return "INVALID_LENGTH";
    if (Number(length) !== size) return "LENGTH_MISMATCH";
  }
  return null;
}

/** Passive observation of the page's existing GET; no additional request or interception. */
export function observeSetupStatus(page: Page, origin: string): { stop(): SetupStatusSnapshot } {
  const tracked = new Map<Request, Entry>();
  let active = true, requestCount = 0, responseCount = 0, limitReached = false, observerFailure = false;
  const matches = (request: Request) => {
    const url = new URL(request.url());
    return request.method() === "GET" && url.origin === new URL(origin).origin && url.pathname === "/data/setup/status";
  };
  const onRequest = (request: Request) => {
    try {
      if (!active || !matches(request)) return;
      if (tracked.size === STATUS_DIAGNOSTIC_LIMIT) { limitReached = true; return; }
      requestCount++;
      tracked.set(request, { status: null, phase: "WAITING_RESPONSE", error: null, state: null, hasSettings: null });
    } catch { observerFailure = true; }
  };
  const inspect = async (response: Response, entry: Entry) => {
    try {
      if (response.fromServiceWorker()) { entry.phase = "SERVICE_WORKER"; return; }
      const finished = await response.finished();
      if (!active) return;
      if (finished) { entry.phase = "FINISH_FAILED"; return; }
      entry.phase = "WAITING_SIZE";
      const [sizes, encoding, length] = await Promise.all([
        response.request().sizes(), response.headerValue("content-encoding"), response.headerValue("content-length"),
      ]);
      if (!active) return;
      const gate = setupStatusBodyGate(sizes.responseBodySize, encoding, length);
      if (gate) { entry.phase = gate; return; }
      entry.phase = "WAITING_BODY";
      // The browser measured the completed, unencoded wire body before body() materializes it.
      // Absent Content-Length is acceptable only with that measured bound; unavailable size is not.
      const body = await response.body();
      if (!active) return;
      if (body.byteLength > STATUS_DIAGNOSTIC_BODY_LIMIT || body.byteLength > sizes.responseBodySize) {
        entry.phase = "LENGTH_MISMATCH"; return;
      }
      let parsed: unknown;
      try { parsed = JSON.parse(body.toString("utf8")); }
      catch { entry.phase = "INVALID_JSON"; return; }
      Object.assign(entry, classifySetupStatus(parsed));
    } catch { if (active) entry.phase = "OBSERVATION_FAILED"; }
  };
  const onResponse = (response: Response) => {
    try {
      if (!active) return;
      const entry = tracked.get(response.request());
      if (!entry || entry.phase !== "WAITING_RESPONSE") return;
      responseCount++;
      const status = response.status();
      entry.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
      entry.phase = "WAITING_FINISH";
      void inspect(response, entry);
    } catch { observerFailure = true; }
  };
  const onFailed = (request: Request) => {
    const entry = tracked.get(request);
    if (active && entry) entry.phase = "REQUEST_FAILED";
  };
  try {
    page.on("request", onRequest);
    page.on("response", onResponse);
    page.on("requestfailed", onFailed);
  } catch { observerFailure = true; }
  return { stop() {
    active = false;
    try { page.off("request", onRequest); } catch { observerFailure = true; }
    try { page.off("response", onResponse); } catch { observerFailure = true; }
    try { page.off("requestfailed", onFailed); } catch { observerFailure = true; }
    return { schema: "alpha17-setup-status-v1", limit: STATUS_DIAGNOSTIC_LIMIT, requestCount, responseCount,
      limitReached, observerFailure, entries: [...tracked.values()].map(entry => ({ ...entry })) };
  } };
}
