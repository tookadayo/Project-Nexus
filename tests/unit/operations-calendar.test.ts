import { expect, it } from "vitest";
import {
  calendarIcs,
  type EventTemplate,
} from "../../packages/operations/src/events";
import {
  nextReportOccurrence,
  wallTimeInstant,
} from "../../packages/operations/src/schedule";
it("selects the first DST fold once and skips nonexistent scheduled wall times", () => {
  const wall = { year: 2026, month: 11, day: 1, hour: 1, minute: 30 };
  expect(wallTimeInstant(wall, "America/New_York").toISOString()).toBe(
    "2026-11-01T05:30:00.000Z",
  );
  expect(
    nextReportOccurrence(
      {
        cadence: "WEEKLY",
        timezone: "America/New_York",
        day: 0,
        hour: 1,
        minute: 30,
      },
      new Date("2026-11-01T05:31:00Z"),
    ).toISOString(),
  ).toBe("2026-11-08T06:30:00.000Z");
  expect(
    nextReportOccurrence(
      {
        cadence: "WEEKLY",
        timezone: "America/New_York",
        day: 0,
        hour: 2,
        minute: 30,
      },
      new Date("2026-03-07T00:00:00Z"),
    ).toISOString(),
  ).toBe("2026-03-15T06:30:00.000Z");
});
it("escapes calendar text injection and folds UTF-8 lines without breaking characters", () => {
  const event: EventTemplate = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "コミュニティ運営".repeat(10) + "\r\nBEGIN:VEVENT",
    location: "Room, one; two\\three",
    timezone: "Asia/Tokyo",
    starts_at: new Date("2026-10-07T03:00:00Z"),
    duration_minutes: 60,
    recurrence: "MONTHLY",
    calendar_sequence: 2,
    created_at: new Date("2026-10-01T00:00:00Z"),
    state: "ENABLED",
    revision: 3,
  };
  const calendar = calendarIcs(event);
  expect(
    calendar.split("\r\n").every((line) => Buffer.byteLength(line) <= 75),
  ).toBe(true);
  expect(calendar.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
  const unfolded = calendar.replace(/\r\n /g, "");
  expect(unfolded).toContain("\\nBEGIN:VEVENT");
  expect(unfolded).toContain("LOCATION:Room\\, one\\; two\\\\three");
  expect(unfolded).toContain("SEQUENCE:2");
  expect(unfolded).toContain("RRULE:FREQ=MONTHLY;COUNT=12");
  expect(unfolded).not.toContain("�");
});
