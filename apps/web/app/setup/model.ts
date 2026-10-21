export type SetupLocale = "ja" | "en";
export type SetupScope = {
  mode: "all" | "include" | "exclude";
  channelIds: string[];
  excludedChannelIds?: string[];
};
export const participationGoals = ["reply", "lfg", "voice", "event", "feedback", "bug", "playtest"] as const;
export type ParticipationGoal = (typeof participationGoals)[number];
export type SetupSettings = {
  uiLanguage: "auto" | "ja" | "en" | "bilingual";
  timezone: string;
  analysisScope: SetupScope;
  helperChannelId: string | null;
  helperEnabled: boolean;
  managerRoleIds: string[];
  newMemberGoals: ParticipationGoal[];
  goalPreset?: "multiplayer" | "early_access" | "live_service" | null;
};
export type SetupPatch = Partial<Omit<SetupSettings, "helperEnabled" | "goalPreset">>;
export type SetupDraft = {
  id: string;
  version: number;
  settingsRevision: number;
  settings: SetupSettings;
  appliedRevision: number | null;
  expiresAt?: string;
};
export type SetupStatus = {
  state: "LINK_REQUIRED" | "SETUP_REQUIRED" | "COMPLETE" | "BOT_REQUIRED";
  connection?: string;
  guild?: {id: string; name: string};
  guildName?: string;
  checkedAt?: string;
  settingsRevision: number;
  setupVersion: number;
  existing: boolean;
  timeZoneSource?: "saved" | "legacy" | "missing" | "invalid";
  missing: string[];
  settings: SetupSettings;
  draft?: SetupDraft | null;
  installUrl?: string | null;
  installNotice?: {
    state: "WEB_ONLY" | "UNSENT" | "SENDING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
    reason?: "NO_VERIFIED_NOTICE" | "DELIVERY_UNAVAILABLE" | "RESULT_UNKNOWN" | "QUEUED" | "DELIVERED";
    nextAction?: "CONTINUE_WEB_SETUP" | "OPEN_DASHBOARD";
  };
};
export type SetupCandidates = {
  channels: {id: string; name: string; type: number; parentId?: string | null; selected?: boolean}[];
  roles: {id: string; name: string; managed?: boolean}[];
  checkedAt?: string;
};
export type SetupProblem = "SESSION" | "PERMISSION" | "UNAVAILABLE" | "BETA" | "CONFLICT" | "INVALID" | "INSTALL";

export function problemFor(code: string, status = 0): SetupProblem {
  if (status === 401 || /SESSION|AUTHENTICAT/.test(code)) return "SESSION";
  if (/BETA|INVITATION|TERMS|ELIGIBILITY/.test(code)) return "BETA";
  if (/BOT_NOT_INSTALLED|INSTALLATION_REQUIRED|GUILD_NOT_INSTALLED/.test(code)) return "INSTALL";
  if (status === 409 || /REVISION|CONFLICT|STALE/.test(code)) return "CONFLICT";
  if (/UNAVAILABLE|UNVERIFI|UNKNOWN|CHECK_FAILED|AUTHORIZATION_EXPIRED/.test(code)) return "UNAVAILABLE";
  if (status === 403 || /ADMIN_REQUIRED|FORBIDDEN|PERMISSION|REVOKED|ROLE_REQUIRED/.test(code)) return "PERMISSION";
  if (status === 400 || /VALIDATION|INVALID/.test(code)) return "INVALID";
  return "UNAVAILABLE";
}

export function validTimezone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try { new Intl.DateTimeFormat("en", {timeZone: value}); return true; } catch { return false; }
}

export type SetupTimeZoneSelection = {
  value: string;
  source: "draft" | "saved" | "browser" | "required";
  confirmed: boolean;
};

/** Browser region is a suggestion only; language never chooses a shared zone. */
export function initialSetupTimeZone(status: SetupStatus, browserZone: () => unknown = () => new Intl.DateTimeFormat().resolvedOptions().timeZone): SetupTimeZoneSelection {
  const draft = status.draft?.appliedRevision == null ? status.draft : null;
  if (draft && validTimezone(draft.settings.timezone)) return {value: draft.settings.timezone, source: "draft", confirmed: true};
  // Missing metadata supports older status responses without changing saved
  // settings. Current API responses always distinguish the raw saved field.
  if ((status.timeZoneSource === "saved" || (status.timeZoneSource === undefined && status.existing)) && validTimezone(status.settings.timezone))
    return {value: status.settings.timezone, source: "saved", confirmed: true};
  try {
    const candidate = browserZone();
    if (typeof candidate === "string" && validTimezone(candidate)) return {value: candidate, source: "browser", confirmed: false};
  } catch { /* Region unavailable: require selection instead of assuming UTC. */ }
  return {value: "", source: "required", confirmed: false};
}

/** Preserve the original scope, role IDs and goals unless a field was edited. */
export function setupPatch(original: SetupSettings, edited: SetupSettings): SetupPatch {
  const patch: SetupPatch = {};
  for (const key of ["uiLanguage", "timezone", "helperChannelId"] as const) {
    if (original[key] !== edited[key]) Object.assign(patch, {[key]: edited[key]});
  }
  for (const key of ["analysisScope", "managerRoleIds", "newMemberGoals"] as const) {
    if (JSON.stringify(original[key]) !== JSON.stringify(edited[key])) Object.assign(patch, {[key]: edited[key]});
  }
  return patch;
}

export function changedSettings(original: SetupSettings, edited: SetupSettings): (keyof SetupPatch)[] {
  return Object.keys(setupPatch(original, edited)) as (keyof SetupPatch)[];
}

/** Only IDs received in the permitted candidate projection can be newly added. */
export function selectedScope(original: SetupScope, ids: readonly string[], candidates: SetupCandidates["channels"]): SetupScope {
  const allowed = new Set(candidates.filter(c => c.type !== 4).map(c => c.id));
  if (original.mode === "include") for (const id of original.channelIds) allowed.add(id);
  const selected = [...new Set(ids)].filter(id => allowed.has(id));
  // Keep explicit exclusions; editing the visible selection must not remove them.
  const exclusions = [...new Set([...(original.excludedChannelIds ?? []), ...(original.mode === "exclude" ? original.channelIds : [])])];
  return {mode: "include", channelIds: selected, ...(original.excludedChannelIds || exclusions.length ? {excludedChannelIds: exclusions} : {})};
}

export function pollDelay(elapsed: number): number | null {
  if (elapsed >= 60_000) return null;
  return elapsed < 10_000 ? 2_000 : 5_000;
}

export function setupReturnUrl(guildId: string) {
  return `/auth/select?guild=${encodeURIComponent(guildId)}`;
}
