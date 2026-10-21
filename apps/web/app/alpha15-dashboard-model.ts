export type AutomationSummary = {
  flows: {id: string; name: string; state: string; revision?: number; triggerKind?: string}[];
  runs: {id: string; flowId: string; state: string; startedAt: string; endedAt?: string | null; dueAt?: string | null}[];
  nextOccurrences: {id: string; at: string; timezone: string}[];
  usage: {limit: number; reserved: number; consumed: number; compensated: number; remaining: number; updatedAt: string};
  status: string;
};
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, maximum = 200): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const timestamp = (value: unknown): value is string => {
  if (!text(value, 64)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return Boolean(days && day >= 1 && day <= days && Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6]) < 60 && Number.isFinite(Date.parse(value)));
};
const optionalTimestamp = (value: unknown) => value === undefined || value === null || timestamp(value);
const unique = (items: unknown[]) => new Set(items.map(item => (item as Record<string, unknown>).id)).size === items.length;

/** Treat inconsistent data as unavailable; never turn malformed counts into zero. */
export function automationSummary(value: unknown): AutomationSummary | null {
  if (!record(value) || !Array.isArray(value.flows) || !Array.isArray(value.runs) || !Array.isArray(value.nextOccurrences) || !record(value.usage) || !text(value.status, 64)) return null;
  if ([value.flows, value.runs, value.nextOccurrences].some(items => items.length > 1000)) return null;
  if (!value.flows.every(flow => record(flow) && text(flow.id, 128) && text(flow.name) && text(flow.state, 64) && (flow.revision === undefined || count(flow.revision)))) return null;
  if (!value.runs.every(run => record(run) && text(run.id, 128) && text(run.flowId, 128) && text(run.state, 64) && timestamp(run.startedAt) && optionalTimestamp(run.endedAt) && optionalTimestamp(run.dueAt))) return null;
  // A malformed occurrence remains a visible, unconfirmed row rather than
  // throwing from Intl or being silently removed from the upcoming list.
  if (!value.nextOccurrences.every(item => record(item) && text(item.id, 128) && text(item.at, 64) && text(item.timezone, 64))) return null;
  if (![value.flows, value.runs, value.nextOccurrences].every(unique)) return null;
  const usage = value.usage;
  if (![usage.limit, usage.reserved, usage.consumed, usage.compensated, usage.remaining].every(count) || !timestamp(usage.updatedAt)) return null;
  const remaining = Number(usage.limit) + Number(usage.compensated) - Number(usage.consumed) - Number(usage.reserved);
  if (!Number.isSafeInteger(remaining) || Math.max(0, remaining) !== usage.remaining) return null;
  return value as AutomationSummary;
}

export function automationLocation(flowId: string, runId?: string) {
  const query = new URLSearchParams({flow: flowId});
  if (runId) query.set("run", runId);
  return `/automation?${query}`;
}

export function scheduledTime(at: string, timeZone: string, locale: "ja" | "en"): string | null {
  if (!timestamp(at) || !text(timeZone, 64)) return null;
  try { return new Intl.DateTimeFormat(locale, {dateStyle: "medium", timeStyle: "short", timeZone}).format(new Date(at)); }
  catch { return null; }
}
