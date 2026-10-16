import { describe, expect, it } from "vitest";
import {
  dateBoundary, dateRangeToInstantRange, isWithinInstantRange, isWithinLocalTimeWindow,
  nextScheduleOccurrences, offsetAt, parseInstant, parseLocalTime, resolveZonedDateTime,
  validateInstantRange, validateRecurrence, zonedDateTimeCandidates,
} from "../../packages/automation/src/datetime";
import { nextElapsedOccurrences } from "../../packages/automation/src/elapsed-schedule";
import { changedScheduleMeaning, currentScheduleMeaningReader, plannedCalendarMeaning, snapshotScheduleMeaning } from "../../packages/automation/src/schedule-rules";
import type { FlowDefinition, RecurrenceSpec } from "../../packages/automation/src/types";

const recurring: RecurrenceSpec = {
  kind: "recurring", frequency: "daily", time: "09:00", timeZone: "America/New_York",
  startDate: "2027-01-01", endDate: "2028-12-31", missingTime: "skip", repeatedTime: "earlier", pastOccurrences: "skip",
};
const definition = (schedule: RecurrenceSpec): FlowDefinition => ({
  schemaVersion: 1, id: "datetime-v2", guildId: "884111111111111111", name: "Datetime v2",
  trigger: { kind: "schedule", schedule }, variables: [], body: [{ kind: "end", id: "end" }],
});

describe("approved datetime schedule deltas (2026-10-16)", () => {
  it("keeps the legacy minute parser and persisted millisecond instants unchanged", () => {
    expect(parseLocalTime("18:30")).toBe("18:30");
    expect(() => parseLocalTime("18:30:42")).toThrow();
    expect(parseInstant("2026-10-16T18:30:42.123Z")).toBe("2026-10-16T18:30:42.123Z");
    expect(resolveZonedDateTime({ date: "2026-10-16", time: "18:30", timeZone: "Asia/Tokyo" })).toBe("2026-10-16T09:30:00.000Z");
  });

  it("resolves explicitly second-precision input and rejects mismatched or fractional input", () => {
    expect(resolveZonedDateTime({ date: "2026-10-16", time: "18:30:42", timePrecision: "second", timeZone: "Asia/Tokyo" })).toBe("2026-10-16T09:30:42.000Z");
    for (const time of ["18:30", "18:30:42.001", "18:30:60", "24:00:00"])
      expect(() => zonedDateTimeCandidates({ date: "2026-10-16", time, timePrecision: "second", timeZone: "Asia/Tokyo" })).toThrow();
    expect(() => zonedDateTimeCandidates({ date: "2026-10-16", time: "18:30:42", timeZone: "Asia/Tokyo" })).toThrow();
  });

  it("requires correction for a second-precision gap and explicit selection for a fold", () => {
    expect(zonedDateTimeCandidates({ date: "2027-03-14", time: "02:30:17", timePrecision: "second", timeZone: "America/New_York" })).toEqual([]);
    const fold = { date: "2027-11-07", time: "01:30:17", timePrecision: "second" as const, timeZone: "America/New_York" };
    expect(zonedDateTimeCandidates(fold)).toEqual(["2027-11-07T05:30:17.000Z", "2027-11-07T06:30:17.000Z"]);
    expect(() => resolveZonedDateTime(fold)).toThrow("occurs twice");
    expect(resolveZonedDateTime({ ...fold, occurrence: "later" })).toBe("2027-11-07T06:30:17.000Z");
  });

  it("retains gap skip and one earlier fold occurrence with seconds", () => {
    const gap = { ...recurring, time: "02:30:17", timePrecision: "second" as const, startDate: "2027-03-13", endDate: "2027-03-15" };
    expect(nextScheduleOccurrences(gap, "2027-03-13T00:00:00Z").map(item => item.localDate)).toEqual(["2027-03-13", "2027-03-15"]);
    expect(nextScheduleOccurrences({ ...gap, time: "01:30:17", startDate: "2027-11-07", endDate: "2027-11-07" }, "2027-11-07T00:00:00Z").map(item => item.instant)).toEqual(["2027-11-07T05:30:17.000Z"]);
  });

  it("generates February 29 only in existing years and previews the next five", () => {
    const yearly: RecurrenceSpec = { ...recurring, frequency: "yearly", month: 2, monthDay: 29, time: "18:30:42", timePrecision: "second", timeZone: "Asia/Tokyo", startDate: "2027-01-01", endDate: "2046-12-31" };
    expect(nextScheduleOccurrences(yearly, "2026-12-31T00:00:00Z")).toEqual([2028, 2032, 2036, 2040, 2044].map(year => ({ localDate: `${year}-02-29`, localTime: "18:30:42", timeZone: "Asia/Tokyo", offset: "+09:00", instant: `${year}-02-29T09:30:42.000Z` })));
  });

  it("skips the non-leap century 2100 and keeps last-day separate from day 31", () => {
    const yearly: RecurrenceSpec = { ...recurring, frequency: "yearly", month: 2, monthDay: 29, startDate: "2096-01-01", endDate: "2104-12-31", timeZone: "UTC" };
    expect(nextScheduleOccurrences(yearly, "2095-12-31T00:00:00Z").map(item => item.localDate)).toEqual(["2096-02-29", "2104-02-29"]);
    const monthly: RecurrenceSpec = { ...recurring, frequency: "monthly", monthDay: 31, startDate: "2027-01-01", endDate: "2027-03-31" };
    expect(nextScheduleOccurrences(monthly, "2027-01-01T00:00:00Z").map(item => item.localDate)).toEqual(["2027-01-31", "2027-03-31"]);
    expect(nextScheduleOccurrences({ ...monthly, monthDay: "last" }, "2027-01-01T00:00:00Z").map(item => item.localDate)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it.each([{ month: 0, monthDay: 29 }, { month: 13, monthDay: 29 }, { month: 2, monthDay: 30 }, { month: 4, monthDay: 31 }])("rejects impossible annual month/day %o", fields => {
    expect(() => validateRecurrence({ ...recurring, frequency: "yearly", ...fields })).toThrow();
  });

  it("uses the exact first valid second of a historical midnight gap", () => {
    expect(dateBoundary("1972-01-07", "Africa/Monrovia")).toBe("1972-01-07T00:44:30.000Z");
    expect(offsetAt("1972-01-06T00:44:30.123Z", "Africa/Monrovia")).toBe("-00:44:30");
    expect(offsetAt("2026-10-16T09:30:42.123Z", "Asia/Tokyo")).toBe("+09:00");
  });

  it("takes the earlier midnight in a fold and rejects a wholly absent day", () => {
    expect(dateBoundary("2015-11-01", "America/Havana")).toBe("2015-11-01T04:00:00.000Z");
    expect(() => dateBoundary("2011-12-30", "Pacific/Apia")).toThrow("calendar date does not exist");
    const range = { start: "2011-12-29", end: "2011-12-30", timeZone: "Pacific/Apia", boundaryRule: "firstValidEarlier" as const };
    expect(() => dateRangeToInstantRange(range)).toThrow("calendar date does not exist");
    expect(dateRangeToInstantRange(range, { validateSelectedEnd: false })).toEqual({ start: "2011-12-29T10:00:00.000Z", end: "2011-12-30T10:00:00.000Z" });
  });

  it("includes a calendar day whose length is 23 or 25 hours and excludes its next boundary", () => {
    for (const [date, hours] of [["2027-03-14", 23], ["2027-11-07", 25]] as const) {
      const range = dateRangeToInstantRange({ start: date, end: date, timeZone: "America/New_York", boundaryRule: "firstValidEarlier" });
      expect(Date.parse(range.end) - Date.parse(range.start)).toBe(hours * 3_600_000);
      expect(isWithinInstantRange(range.start, range)).toBe(true);
      expect(isWithinInstantRange(range.end, range)).toBe(false);
    }
  });

  it("permits general v2 empty instant ranges only when requested, retaining the old nonempty default", () => {
    const range = { start: "2026-10-16T09:30:42.123Z", end: "2026-10-16T09:30:42.123Z" };
    expect(validateInstantRange(range, { allowEmpty: true })).toEqual(range);
    expect(isWithinInstantRange(range.start, range, { allowEmpty: true })).toBe(false);
    expect(() => validateInstantRange(range)).toThrow("after the start");
    expect(() => validateInstantRange({ start: range.start, end: "2026-10-16T09:30:42.122Z" }, { allowEmpty: true })).toThrow();
  });

  it("requires the next-day flag for a second-precision overnight window and excludes exact end", () => {
    const window = { start: "22:00:10", end: "02:00:20", timePrecision: "second" as const, endDayOffset: 1 as const, weekdays: [5], timeZone: "Asia/Tokyo" };
    expect(isWithinLocalTimeWindow("2026-10-16T13:00:09.999Z", window)).toBe(false);
    expect(isWithinLocalTimeWindow("2026-10-16T13:00:10.000Z", window)).toBe(true);
    expect(isWithinLocalTimeWindow("2026-10-16T17:00:19.999Z", window)).toBe(true);
    expect(isWithinLocalTimeWindow("2026-10-16T17:00:20.000Z", window)).toBe(false);
    expect(() => isWithinLocalTimeWindow("2026-10-16T16:00:00Z", { ...window, endDayOffset: 0 })).toThrow();
  });

  it("keeps regional daily wall time separate from fixed elapsed 24-hour occurrences", () => {
    const calendar = nextScheduleOccurrences({ ...recurring, startDate: "2027-03-13", endDate: "2027-03-15" }, "2027-03-13T00:00:00Z");
    const elapsed = nextElapsedOccurrences({ kind: "elapsed", anchor: calendar[0]!.instant, intervalSeconds: 86400, end: "2027-03-16T00:00:00Z", pastOccurrences: "skip" }, "2027-03-13T00:00:00Z");
    expect(calendar.map(item => item.instant)).toEqual(["2027-03-13T14:00:00.000Z", "2027-03-14T13:00:00.000Z", "2027-03-15T13:00:00.000Z"]);
    expect(elapsed.map(item => item.instant)).toEqual(["2027-03-13T14:00:00.000Z", "2027-03-14T14:00:00.000Z", "2027-03-15T14:00:00.000Z"]);
    expect(nextElapsedOccurrences({ kind: "elapsed", anchor: "2027-03-13T14:00:00.123Z", intervalSeconds: 1, end: "2027-03-13T14:00:03.123Z", pastOccurrences: "skip" }, "2027-03-13T14:00:00.123Z").map(item => item.instant)).toEqual(["2027-03-13T14:00:01.123Z", "2027-03-13T14:00:02.123Z"]);
  });

  it("retains precision in planned meaning and bounded timezone review probes", () => {
    const schedule = { ...recurring, time: "09:00:42", timePrecision: "second" as const };
    const reader = currentScheduleMeaningReader(), snapshot = snapshotScheduleMeaning(schedule, new Date("2027-01-01T00:00:00Z"));
    expect(snapshot.probes.every(probe => probe.local.timePrecision === "second" && probe.local.time === "09:00:42")).toBe(true);
    expect(changedScheduleMeaning(snapshot, reader)).toBeNull();
    const meaning = plannedCalendarMeaning(definition(schedule), new Date("2027-01-01T14:00:42.000Z"));
    expect(meaning).toEqual({ local: { date: "2027-01-01", time: "09:00:42", timeZone: "America/New_York", timePrecision: "second" }, offset: "-05:00" });
    expect(changedScheduleMeaning(snapshot, { ...reader, version: "synthetic-new-tz-version" })).toBe("TIME_ZONE_DATABASE_CHANGED");
  });
});
