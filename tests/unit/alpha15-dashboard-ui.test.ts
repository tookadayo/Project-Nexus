import {describe, expect, it} from "vitest";
import {automationLocation, automationSummary, scheduledTime} from "../../apps/web/app/alpha15-dashboard-model";

const summary = () => ({flows: [{id: "flow", name: "Notice", state: "ACTIVE"}], runs: [{id: "run", flowId: "flow", state: "UNKNOWN", startedAt: "2026-10-15T09:00:00Z"}], nextOccurrences: [{id: "occurrence", at: "2026-10-16T09:00:00Z", timezone: "Asia/Tokyo"}], usage: {limit: 100, reserved: 2, consumed: 8, compensated: 1, remaining: 91, updatedAt: "2026-10-15T10:00:00Z"}, status: "AVAILABLE"});
describe("alpha15 dashboard input boundaries", () => {
  it("accepts observed counts while rejecting malformed or inconsistent usage", () => {
    expect(automationSummary(summary())?.usage.remaining).toBe(91);
    for (const value of [-1, Infinity, NaN, 1.5, null, "100"]) expect(automationSummary({...summary(), usage: {...summary().usage, limit: value}})).toBeNull();
    expect(automationSummary({...summary(), usage: {...summary().usage, remaining: 100}})).toBeNull();
  });
  it("rejects null rows, duplicate IDs and missing flow/run properties", () => {
    expect(automationSummary({...summary(), runs: [null]})).toBeNull();
    expect(automationSummary({...summary(), flows: [...summary().flows, ...summary().flows]})).toBeNull();
    expect(automationSummary({...summary(), runs: [{id: "run", state: "UNKNOWN"}]})).toBeNull();
    expect(automationSummary({...summary(), nextOccurrences: [null]})).toBeNull();
  });
  it("keeps malformed occurrence meaning unconfirmed without using the device timezone", () => {
    expect(scheduledTime("2026-10-16T09:00:00Z", "Asia/Tokyo", "ja")).toContain("18:00");
    expect(scheduledTime("not-a-date", "Asia/Tokyo", "ja")).toBeNull();
    expect(scheduledTime("03/04", "Asia/Tokyo", "ja")).toBeNull();
    expect(scheduledTime("2026-02-30T09:00:00Z", "Asia/Tokyo", "ja")).toBeNull();
    expect(scheduledTime("2026-10-16T09:00:00Z", "Moon/Sea", "en")).toBeNull();
    expect(scheduledTime("2026-10-16T09:00:00Z", "", "en")).toBeNull();
  });
  it("encodes both the selected flow and specific run in navigation", () => {
    const url = new URL(automationLocation("flow & one", "run/one"), "https://example.invalid");
    expect(url.searchParams.get("flow")).toBe("flow & one");
    expect(url.searchParams.get("run")).toBe("run/one");
  });
});
