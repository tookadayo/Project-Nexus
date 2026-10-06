import { z } from "zod";
import { assert } from "../../shared/src/index";
export const timezoneSchema = z
  .string()
  .max(80)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  });
export type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};
const formatters = new Map<string, Intl.DateTimeFormat>();
export function wallTime(at: Date, timezone: string): WallTime {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
    if (formatters.size > 64)
      formatters.delete(formatters.keys().next().value!);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}
export const wallUtc = (wall: WallTime) =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
export function wallTimeInstant(wall: WallTime, timezone: string) {
  const guess = wallUtc(wall),
    offsets = new Set(
      [-36, -12, 0, 12, 36].map((hours) => {
        const at = new Date(guess + hours * 3600000);
        return wallUtc(wallTime(at, timezone)) - at.getTime();
      }),
    );
  const candidates = [...offsets]
    .map((offset) => new Date(guess - offset))
    .filter(
      (at) => JSON.stringify(wallTime(at, timezone)) === JSON.stringify(wall),
    );
  assert(candidates.length, "SCHEDULE_TIME_NONEXISTENT");
  return new Date(Math.min(...candidates.map((at) => at.getTime())));
}
export const scheduleInput = z
  .object({
    cadence: z.enum(["WEEKLY", "MONTHLY"]),
    timezone: timezoneSchema,
    day: z.number().int().min(0).max(28),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59).default(0),
  })
  .strict()
  .refine(
    (schedule) =>
      schedule.cadence === "WEEKLY" ? schedule.day <= 6 : schedule.day >= 1,
    "INVALID_SCHEDULE_DAY",
  );
export type ReportClock = z.infer<typeof scheduleInput>;
/** Earliest future wall-clock occurrence. DST gaps are skipped; repeated times
 * select their first occurrence. One schedule can never run twice in a fold. */
export function nextReportOccurrence(schedule: ReportClock, after: Date) {
  const current = wallTime(after, schedule.timezone),
    base = Date.UTC(current.year, current.month - 1, current.day);
  for (let i = 0; i <= 40; i++) {
    const day = new Date(base + i * 86400000);
    if (
      schedule.cadence === "WEEKLY"
        ? day.getUTCDay() !== schedule.day
        : day.getUTCDate() !== schedule.day
    )
      continue;
    try {
      const candidate = wallTimeInstant(
        {
          year: day.getUTCFullYear(),
          month: day.getUTCMonth() + 1,
          day: day.getUTCDate(),
          hour: schedule.hour,
          minute: schedule.minute,
        },
        schedule.timezone,
      );
      if (candidate > after) return candidate;
    } catch {
      /* A nonexistent DST wall time has no occurrence. */
    }
  }
  throw new Error("SCHEDULE_UNRESOLVED");
}
