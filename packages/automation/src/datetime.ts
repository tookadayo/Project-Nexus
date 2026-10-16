import type {
  DateRange,
  InstantRange,
  LocalTimeWindowSpec,
  RecurrenceSpec,
  ScheduleOccurrence,
  ZonedDateTimeSpec,
} from "./types";
import { parseLocalTimeForPrecision } from "./temporal-types";

export class DateTimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DateTimeError";
  }
}
const dayMilliseconds = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone);
  if (!value) {
    assertTimeZone(timeZone);
    value = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    if (formatters.size >= 64)
      formatters.delete(formatters.keys().next().value!);
    formatters.set(timeZone, value);
  }
  return value;
}
export function assertTimeZone(value: string): void {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    (value !== "UTC" && !value.includes("/"))
  )
    throw new DateTimeError("TIME_ZONE", "Choose an IANA time zone.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
  } catch {
    throw new DateTimeError("TIME_ZONE", "Choose a valid IANA time zone.");
  }
}
export function parseDateOnly(value: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(value) ||
    value[4] !== value[7]
  )
    throw new DateTimeError(
      "DATE_FORMAT",
      "Enter the date in YYYY/MM/DD format.",
    );
  const normalized = value.replaceAll("/", "-");
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || year < 100 || year > 9999 || !month || !day)
    throw new DateTimeError("DATE_INVALID", "Choose an existing date.");
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new DateTimeError("DATE_INVALID", "Choose an existing date.");
  return normalized;
}
export function parseLocalTime(value: string): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new DateTimeError("TIME_FORMAT", "Enter a time in HH:MM format.");
  return value;
}
export function parseInstant(value: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new DateTimeError("INSTANT_INVALID", "Choose a valid UTC instant.");
  const result = new Date(value).toISOString();
  if (result.slice(0, 10) !== value.slice(0, 10))
    throw new DateTimeError("INSTANT_INVALID", "Choose an existing date.");
  return result;
}
export function addCalendarDays(date: string, days: number): string {
  const normalized = parseDateOnly(date);
  if (!Number.isSafeInteger(days) || Math.abs(days) > 36600)
    throw new DateTimeError(
      "DATE_RANGE",
      "The calendar-day change is outside the supported range.",
    );
  const result = new Date(
    Date.parse(`${normalized}T00:00:00Z`) + days * dayMilliseconds,
  )
    .toISOString()
    .slice(0, 10);
  return parseDateOnly(result);
}
function parts(
  milliseconds: number,
  timeZone: string,
): { date: string; time: string; second: number; wall: number } {
  const values = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(milliseconds)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const date = `${values.year!.padStart(4, "0")}-${values.month}-${values.day}`;
  const time = `${values.hour}:${values.minute}`;
  return {
    date,
    time,
    second: Number(values.second),
    wall: Date.parse(`${date}T${time}:${values.second}Z`),
  };
}
function offsetsForDate(date: string, timeZone: string): number[] {
  const anchor = Date.parse(`${date}T12:00:00Z`);
  const offsets = new Set<number>();
  for (let hour = -48; hour <= 48; hour += 6) {
    const at = anchor + hour * 3_600_000;
    offsets.add(parts(at, timeZone).wall - at);
  }
  return [...offsets];
}
function candidatesWithOffsets(
  date: string,
  time: string,
  timeZone: string,
  offsets: number[],
): string[] {
  const fullTime = time.length === 5 ? `${time}:00` : time;
  const wall = Date.parse(`${date}T${fullTime}Z`);
  return [
    ...new Set(
      offsets
        .map((offset) => wall - offset)
        .filter((at) => {
          const local = parts(at, timeZone);
          return (
            local.date === date && `${local.time}:${String(local.second).padStart(2, "0")}` === fullTime
          );
        }),
    ),
  ]
    .sort((a, b) => a - b)
    .map((at) => new Date(at).toISOString());
}
/** Returns zero (gap), one, or two (fold) instants without silently correcting input. */
export function zonedDateTimeCandidates(spec: ZonedDateTimeSpec): string[] {
  const date = parseDateOnly(spec.date),
    time = parseLocalTimeForPrecision(spec.time, spec.timePrecision ?? "minute");
  assertTimeZone(spec.timeZone);
  return candidatesWithOffsets(
    date,
    time,
    spec.timeZone,
    offsetsForDate(date, spec.timeZone),
  );
}
export function resolveZonedDateTime(spec: ZonedDateTimeSpec): string {
  const candidates = zonedDateTimeCandidates(spec);
  if (!candidates.length)
    throw new DateTimeError(
      "LOCAL_TIME_MISSING",
      "This local date and time does not exist. Choose another time.",
    );
  if (candidates.length > 1 && spec.occurrence === undefined)
    throw new DateTimeError(
      "LOCAL_TIME_AMBIGUOUS",
      "This time occurs twice. Choose an occurrence by its UTC offset.",
    );
  return (spec.occurrence === "later" ? candidates.at(-1) : candidates[0])!;
}
export function offsetAt(instant: string, timeZone: string): string {
  // Intl parts have second precision. Remove fractional milliseconds from both
  // sides of the subtraction so a positive offset cannot round down a minute.
  const at = Math.floor(Date.parse(parseInstant(instant)) / 1000) * 1000;
  const seconds = Math.round((parts(at, timeZone).wall - at) / 1000);
  const absolute = Math.abs(seconds),
    hours = Math.floor(absolute / 3600),
    minutes = Math.floor((absolute % 3600) / 60),
    remainingSeconds = absolute % 60;
  return `${seconds < 0 ? "-" : "+"}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}${remainingSeconds ? `:${String(remainingSeconds).padStart(2, "0")}` : ""}`;
}
/** Date boundaries differ deliberately from explicitly selected, nonexistent local times. */
export function dateBoundary(date: string, timeZone: string): string {
  const normalized = parseDateOnly(date);
  assertTimeZone(timeZone);
  const offsets = offsetsForDate(normalized, timeZone);
  for (let minute = 0; minute < 1440; minute++) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const candidates = candidatesWithOffsets(
      normalized,
      time,
      timeZone,
      offsets,
    );
    if (candidates.length) {
      // Historical IANA transitions can end a midnight gap between minute
      // marks. Refine only the preceding minute, preserving a finite bound of
      // 1,440 minute probes plus at most 59 second probes per boundary.
      for (let second = Math.max(0, minute * 60 - 59); second < minute * 60; second++) {
        const preciseTime = `${String(Math.floor(second / 3600)).padStart(2, "0")}:${String(Math.floor(second % 3600 / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}`;
        const precise = candidatesWithOffsets(normalized, preciseTime, timeZone, offsets);
        if (precise.length) return precise[0]!;
      }
      return candidates[0]!;
    }
  }
  throw new DateTimeError(
    "CALENDAR_DAY_MISSING",
    "This calendar date does not exist in the selected region.",
  );
}
export function dateRangeToInstantRange(range: DateRange, options: { validateSelectedEnd?: boolean } = {}): InstantRange {
  const start = parseDateOnly(range.start),
    end = parseDateOnly(range.end);
  if (end < start)
    throw new DateTimeError(
      "RANGE_REVERSED",
      "The end date is before the start date.",
    );
  if (range.boundaryRule !== "firstValidEarlier")
    throw new DateTimeError(
      "BOUNDARY_RULE",
      "Choose a registered date-boundary rule.",
    );
  // An inclusive selected end must itself exist, independently of its
  // exclusive next-day boundary (for example Apia's skipped 2011-12-30).
  if (options.validateSelectedEnd !== false) dateBoundary(end, range.timeZone);
  return {
    start: dateBoundary(start, range.timeZone),
    end: dateBoundary(addCalendarDays(end, 1), range.timeZone),
  };
}
export function validateInstantRange(range: InstantRange, options: { allowEmpty?: boolean } = {}): InstantRange {
  const start = parseInstant(range.start),
    end = parseInstant(range.end);
  if (Date.parse(end) < Date.parse(start) || !options.allowEmpty && Date.parse(end) === Date.parse(start))
    throw new DateTimeError(
      "RANGE_EMPTY",
      "The end time must be after the start time.",
    );
  return { start, end };
}
export function isWithinInstantRange(
  instant: string,
  range: InstantRange,
  options: { allowEmpty?: boolean } = {},
): boolean {
  const at = Date.parse(parseInstant(instant));
  const valid = validateInstantRange(range, options);
  return at >= Date.parse(valid.start) && at < Date.parse(valid.end);
}
export function isWithinLocalTimeWindow(
  instant: string,
  spec: LocalTimeWindowSpec,
): boolean {
  const at = parseInstant(instant),
    local = parts(Date.parse(at), spec.timeZone);
  parseLocalTimeForPrecision(spec.start, spec.timePrecision ?? "minute");
  parseLocalTimeForPrecision(spec.end, spec.timePrecision ?? "minute");
  if (
    ![0, 1].includes(spec.endDayOffset) ||
    !spec.weekdays.length ||
    spec.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  )
    throw new DateTimeError(
      "WINDOW_INVALID",
      "Choose valid start weekdays and an end day.",
    );
  if (spec.endDayOffset === 0 && spec.end <= spec.start)
    throw new DateTimeError(
      "RANGE_EMPTY",
      "The end time must be after the start time. Choose next day when needed.",
    );
  for (const startDate of [local.date, addCalendarDays(local.date, -1)]) {
    const weekday = new Date(`${startDate}T00:00:00Z`).getUTCDay();
    if (!spec.weekdays.includes(weekday)) continue;
    const endDate = addCalendarDays(startDate, spec.endDayOffset);
    const starts = zonedDateTimeCandidates({
        date: startDate,
        time: spec.start,
        timeZone: spec.timeZone,
        ...(spec.timePrecision ? { timePrecision: spec.timePrecision } : {}),
      }),
      ends = zonedDateTimeCandidates({
        date: endDate,
        time: spec.end,
        timeZone: spec.timeZone,
        ...(spec.timePrecision ? { timePrecision: spec.timePrecision } : {}),
      });
    if (
      starts[0] &&
      ends[0] &&
      isWithinInstantRange(at, { start: starts[0], end: ends[0] })
    )
      return true;
  }
  return false;
}
export function calendarRelativeInstant(
  instant: string,
  days: number,
  timeZone: string,
  occurrence?: "earlier" | "later",
): string {
  const at = Date.parse(parseInstant(instant)),
    local = parts(at, timeZone);
  const minute = resolveZonedDateTime({
    date: addCalendarDays(local.date, days),
    time: local.time,
    timeZone,
    occurrence,
  });
  return elapsedRelativeInstant(
    minute,
    local.second + (((at % 1000) + 1000) % 1000) / 1000,
  );
}
export function elapsedRelativeInstant(
  instant: string,
  seconds: number,
): string {
  if (!Number.isFinite(seconds))
    throw new DateTimeError(
      "DURATION_INVALID",
      "A finite duration is required.",
    );
  const at = Date.parse(parseInstant(instant)) + seconds * 1000;
  if (!Number.isFinite(at) || Math.abs(at) > 8.64e15)
    throw new DateTimeError(
      "INSTANT_INVALID",
      "The resulting instant is outside the supported range.",
    );
  return parseInstant(new Date(at).toISOString());
}
export function validateRecurrence(spec: RecurrenceSpec): void {
  if (
    spec.kind !== "recurring" ||
    !["daily", "weekly", "monthly", "yearly"].includes(spec.frequency)
  )
    throw new DateTimeError(
      "RECURRENCE_INVALID",
      "Choose a registered recurrence.",
    );
  parseLocalTimeForPrecision(spec.time, spec.timePrecision ?? "minute");
  assertTimeZone(spec.timeZone);
  const start = parseDateOnly(spec.startDate),
    end = parseDateOnly(spec.endDate);
  if (
    end < start ||
    Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) >
      36600 * dayMilliseconds
  )
    throw new DateTimeError(
      "RECURRENCE_RANGE",
      "Choose an ordered recurrence range within 100 years.",
    );
  if (
    spec.missingTime !== "skip" ||
    spec.repeatedTime !== "earlier" ||
    spec.pastOccurrences !== "skip"
  )
    throw new DateTimeError(
      "RECURRENCE_POLICY",
      "The supported recurrence skips gaps and past occurrences, and uses the earlier repeated time.",
    );
  if (
    spec.frequency === "weekly" &&
    (!spec.weekdays?.length ||
      spec.weekdays.some(
        (day) => !Number.isInteger(day) || day < 0 || day > 6,
      ) ||
      new Set(spec.weekdays).size !== spec.weekdays.length)
  )
    throw new DateTimeError(
      "RECURRENCE_WEEKDAY",
      "Choose unique start weekdays.",
    );
  if (
    (spec.frequency === "monthly" || spec.frequency === "yearly") &&
    spec.monthDay !== "last" &&
    (!Number.isInteger(spec.monthDay) ||
      Number(spec.monthDay) < 1 ||
      Number(spec.monthDay) > 31)
  )
    throw new DateTimeError(
      "RECURRENCE_MONTHDAY",
      "Choose a day of the month or its last day.",
    );
  if (spec.frequency === "yearly" && (!Number.isInteger(spec.month) || spec.month! < 1 || spec.month! > 12))
    throw new DateTimeError("RECURRENCE_MONTH", "Choose a month from 1 through 12.");
  if (spec.frequency === "yearly" && spec.monthDay !== "last") {
    const possible = new Date(Date.UTC(2000, spec.month! - 1, spec.monthDay));
    if (possible.getUTCMonth() + 1 !== spec.month)
      throw new DateTimeError("RECURRENCE_MONTHDAY", "Choose a date that exists in at least one year.");
  }
}
export function nextScheduleOccurrences(
  spec: RecurrenceSpec,
  after: string | Date,
  count = 5,
): ScheduleOccurrence[] {
  validateRecurrence(spec);
  if (!Number.isInteger(count) || count < 0 || count > 100)
    throw new DateTimeError("PREVIEW_LIMIT", "Choose a finite preview size.");
  const afterAt =
    after instanceof Date ? after.getTime() : Date.parse(parseInstant(after));
  if (!Number.isFinite(afterAt))
    throw new DateTimeError(
      "INSTANT_INVALID",
      "A valid preview start is required.",
    );
  const localAfter = parts(afterAt, spec.timeZone).date;
  let date =
    spec.startDate > localAfter ? parseDateOnly(spec.startDate) : localAfter;
  const end = parseDateOnly(spec.endDate),
    result: ScheduleOccurrence[] = [];
  for (
    let scanned = 0;
    date <= end && scanned <= 36600 && result.length < count;
    scanned++, date = addCalendarDays(date, 1)
  ) {
    const d = new Date(`${date}T00:00:00Z`),
      day = d.getUTCDate();
    if (spec.frequency === "weekly" && !spec.weekdays!.includes(d.getUTCDay()))
      continue;
    if (spec.frequency === "yearly" && d.getUTCMonth() + 1 !== spec.month) continue;
    if (spec.frequency === "monthly" || spec.frequency === "yearly") {
      const last = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
      ).getUTCDate();
      if (day !== (spec.monthDay === "last" ? last : spec.monthDay)) continue;
    }
    const instant = zonedDateTimeCandidates({
      date,
      time: spec.time,
      timeZone: spec.timeZone,
      ...(spec.timePrecision ? { timePrecision: spec.timePrecision } : {}),
    })[0];
    if (!instant || Date.parse(instant) <= afterAt) continue;
    result.push({
      localDate: date,
      localTime: spec.time,
      timeZone: spec.timeZone,
      offset: offsetAt(instant, spec.timeZone),
      instant,
    });
  }
  return result;
}
