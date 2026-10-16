import { describe, expect, it } from "vitest";
import {
  calendarMonth,
  calendarMove,
  instantInputState,
} from "../../apps/web/app/automation/date-controls";

describe("approved date/time input navigation and preservation", () => {
  it("moves ISO calendar days across leap and year boundaries without a local-zone shift", () => {
    expect(calendarMove("2024-02-28", 1)).toBe("2024-02-29");
    expect(calendarMove("2024-02-29", 1)).toBe("2024-03-01");
    expect(calendarMove("2025-01-01", -1)).toBe("2024-12-31");
    expect(calendarMove("0100-01-01", -1)).toBe("0100-01-01");
    expect(calendarMove("9999-12-31", 1)).toBe("9999-12-31");
  });
  it("rejects incomplete, ambiguous and invalid selected dates instead of completing them", () => {
    for (const value of [
      "03/04",
      "02-29",
      "2025-02-29",
      "2024-13-01",
      "2024-02-30",
    ])
      expect(() => calendarMove(value, 1)).toThrow();
  });
  it("clamps only a navigation cursor for month/year movement and keeps the saved value outside the helper", () => {
    expect(calendarMonth("2024-01-31", 1)).toBe("2024-02-29");
    expect(calendarMonth("2024-02-29", 12)).toBe("2025-02-28");
    expect(calendarMonth("2024-01-31", -1)).toBe("2023-12-31");
    expect(calendarMonth("0100-01-01", -1)).toBe("0100-01-01");
    expect(calendarMonth("9999-12-31", 1)).toBe("9999-12-31");
  });
  it("displays whole-second saved values without dropping their seconds", () => {
    expect(instantInputState("2026-10-16T18:30:42.000Z")).toEqual({
      draft: "2026-10-16T18:30:42",
      preserved: false,
    });
    expect(instantInputState("2026-10-16T18:30Z")).toEqual({
      draft: "2026-10-16T18:30",
      preserved: false,
    });
    expect(instantInputState(undefined)).toEqual({
      draft: "",
      preserved: false,
    });
  });
  it("requires explicit replacement for fractional or otherwise non-user-input saved syntax", () => {
    for (const value of [
      "2026-10-16T18:30:42.123Z",
      "2026-10-16T18:30:42.001Z",
      "2026-10-16T18:30:42+09:00",
    ])
      expect(instantInputState(value)).toEqual({ draft: "", preserved: true });
  });
});
