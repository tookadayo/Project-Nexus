import { describe, it, expect } from "vitest";
import {
  addCalendarDays,
  calendarRelativeInstant,
  dateBoundary,
  dateRangeToInstantRange,
  elapsedRelativeInstant,
  isWithinInstantRange,
  isWithinLocalTimeWindow,
  nextScheduleOccurrences,
  parseDateOnly,
  resolveZonedDateTime,
  zonedDateTimeCandidates,
} from "../../packages/automation/src/datetime.js";
import type { RecurrenceSpec } from "../../packages/automation/src/types.js";
const weekly: RecurrenceSpec = {
  kind: "recurring",
  frequency: "weekly",
  time: "18:00",
  timeZone: "Asia/Tokyo",
  startDate: "2026-10-15",
  endDate: "2026-11-30",
  weekdays: [5],
  missingTime: "skip",
  repeatedTime: "earlier",
  pastOccurrences: "skip",
};
describe("alpha15 calendar, range and DST contracts", () => {
  it("preserves date-only values and rejects ambiguous/impossible input", () => {
    expect(parseDateOnly("2026/10/15")).toBe("2026-10-15");
    for (const value of ["03/04", "2026/2/3", "2026-02-30", "2026/10-15"])
      expect(() => parseDateOnly(value)).toThrow();
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("includes both selected dates using exclusive next-day local boundary", () => {
    const range = dateRangeToInstantRange({
      start: "2026-10-15",
      end: "2026-11-30",
      timeZone: "Asia/Tokyo",
      boundaryRule: "firstValidEarlier",
    });
    expect(range).toEqual({
      start: "2026-10-14T15:00:00.000Z",
      end: "2026-11-30T15:00:00.000Z",
    });
    expect(isWithinInstantRange("2026-11-30T14:59:59Z", range)).toBe(true);
    expect(isWithinInstantRange(range.end, range)).toBe(false);
    const single = dateRangeToInstantRange({
      start: "2026-10-15",
      end: "2026-10-15",
      timeZone: "Asia/Tokyo",
      boundaryRule: "firstValidEarlier",
    });
    expect(Date.parse(single.end) - Date.parse(single.start)).toBe(86400000);
    const dst = dateRangeToInstantRange({
      start: "2027-03-14",
      end: "2027-03-14",
      timeZone: "America/New_York",
      boundaryRule: "firstValidEarlier",
    });
    expect(Date.parse(dst.end) - Date.parse(dst.start)).toBe(23 * 3600000);
    expect(() =>
      dateRangeToInstantRange({
        start: "2026-10-15",
        end: "2026-10-14",
        timeZone: "Asia/Tokyo",
        boundaryRule: "firstValidEarlier",
      }),
    ).toThrow();
  });
  it("requires explicit fold selection and never corrects a missing single local time", () => {
    expect(
      zonedDateTimeCandidates({
        date: "2027-03-14",
        time: "02:30",
        timeZone: "America/New_York",
      }),
    ).toEqual([]);
    expect(() =>
      resolveZonedDateTime({
        date: "2027-03-14",
        time: "02:30",
        timeZone: "America/New_York",
      }),
    ).toThrow();
    const repeated = {
      date: "2027-11-07",
      time: "01:30",
      timeZone: "America/New_York",
    };
    expect(zonedDateTimeCandidates(repeated)).toEqual([
      "2027-11-07T05:30:00.000Z",
      "2027-11-07T06:30:00.000Z",
    ]);
    expect(() => resolveZonedDateTime(repeated)).toThrow();
    expect(resolveZonedDateTime({ ...repeated, occurrence: "later" })).toBe(
      "2027-11-07T06:30:00.000Z",
    );
  });
  it("separates calendar-day changes from elapsed 24-hour changes", () => {
    const before = resolveZonedDateTime({
      date: "2027-03-13",
      time: "09:00",
      timeZone: "America/New_York",
    });
    expect(calendarRelativeInstant(before, 1, "America/New_York")).toBe(
      "2027-03-14T13:00:00.000Z",
    );
    expect(elapsedRelativeInstant(before, 86400)).toBe(
      "2027-03-14T14:00:00.000Z",
    );
    const event = "2027-03-14T13:00:00Z";
    expect(calendarRelativeInstant(event, -1, "America/New_York")).toBe(
      "2027-03-13T14:00:00.000Z",
    );
    expect(elapsedRelativeInstant(event, -86400)).toBe(
      "2027-03-13T13:00:00.000Z",
    );
    expect(
      calendarRelativeInstant(
        "2027-03-14T13:00:12.500Z",
        -1,
        "America/New_York",
      ),
    ).toBe("2027-03-13T14:00:12.500Z");
  });
  it("uses the first valid boundary for midnight gaps and refuses an absent calendar day", () => {
    expect(dateBoundary("2018-11-04", "America/Sao_Paulo")).toBe(
      "2018-11-04T03:00:00.000Z",
    );
    expect(() => dateBoundary("2011-12-30", "Pacific/Apia")).toThrow();
  });
  it("requires explicit next-day overnight windows and excludes exact end", () => {
    const window = {
      start: "22:00",
      end: "02:00",
      endDayOffset: 1 as const,
      weekdays: [5],
      timeZone: "Asia/Tokyo",
    };
    expect(isWithinLocalTimeWindow("2026-10-16T13:00:00Z", window)).toBe(true);
    expect(isWithinLocalTimeWindow("2026-10-16T16:00:00Z", window)).toBe(true);
    expect(isWithinLocalTimeWindow("2026-10-16T17:00:00Z", window)).toBe(false);
    expect(() =>
      isWithinLocalTimeWindow("2026-10-16T16:00:00Z", {
        ...window,
        endDayOffset: 0,
      }),
    ).toThrow();
  });
  it("previews next five and only real remaining occurrences, with no past replay", () => {
    const occurrences = nextScheduleOccurrences(weekly, "2026-10-15T00:00:00Z");
    expect(occurrences.map((item) => item.localDate)).toEqual([
      "2026-10-16",
      "2026-10-23",
      "2026-10-30",
      "2026-11-06",
      "2026-11-13",
    ]);
    expect(
      occurrences.every(
        (item) =>
          item.offset === "+09:00" && item.instant.endsWith("09:00:00.000Z"),
      ),
    ).toBe(true);
    expect(nextScheduleOccurrences(weekly, "2026-11-10T00:00:00Z").length).toBe(
      3,
    );
    expect(
      nextScheduleOccurrences(weekly, "2026-10-15T00:00:00Z", 20).length,
    ).toBe(7);
  });
  it("distinguishes month-end from day31 and skips recurring gaps and duplicate folds", () => {
    const monthly = {
      ...weekly,
      frequency: "monthly" as const,
      startDate: "2027-01-01",
      endDate: "2027-03-31",
      monthDay: "last" as const,
    };
    expect(
      nextScheduleOccurrences(monthly, "2027-01-01T00:00:00Z").map(
        (item) => item.localDate,
      ),
    ).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(
      nextScheduleOccurrences(
        { ...monthly, monthDay: 31 },
        "2027-01-01T00:00:00Z",
      ).map((item) => item.localDate),
    ).toEqual(["2027-01-31", "2027-03-31"]);
    const gap = {
      ...weekly,
      frequency: "daily" as const,
      startDate: "2027-03-13",
      endDate: "2027-03-15",
      time: "02:30",
      timeZone: "America/New_York",
    };
    expect(
      nextScheduleOccurrences(gap, "2027-03-13T00:00:00Z").map(
        (item) => item.localDate,
      ),
    ).toEqual(["2027-03-13", "2027-03-15"]);
    const fold = {
      ...gap,
      startDate: "2027-11-07",
      endDate: "2027-11-07",
      time: "01:30",
    };
    expect(
      nextScheduleOccurrences(fold, "2027-11-07T00:00:00Z").map(
        (item) => item.instant,
      ),
    ).toEqual(["2027-11-07T05:30:00.000Z"]);
  });
});
