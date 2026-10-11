import { describe, expect, it } from "vitest";
import type { ProductData } from "../../apps/web/app/console";
import { homeSummaryModel } from "../../apps/web/app/home-summary-model";

const time = "2026-10-09T12:00:00Z";
function fixture() {
  return {
    home: {
      generatedAt: time,
      kpis: [],
      dataHealth: {
        label: "healthy",
        notes: [],
        coverageRatio: 1,
        status: "healthy",
      },
      setup: { required: false, steps: [] },
    },
    community: {
      generatedAt: time,
      daily: {
        ready: true,
        attentionCount: 2,
        todayJoined: 4,
        yesterdayJoined: 6,
        from: "2026-10-09T00:00:00Z",
        timezone: "UTC",
      },
    },
    results: { generatedAt: time, items: [], simple: [] },
  } as unknown as ProductData;
}
describe("Home priorities preserve existing data meaning", () => {
  it("makes available attention the primary action, not collection diagnostics", () => {
    expect(homeSummaryModel(fixture())).toMatchObject({
      state: "ready",
      primary: "attention",
      attention: 2,
    });
  });
  it("distinguishes a real zero from unavailable and makes analysis primary", () => {
    const data = fixture();
    data.community!.daily.attentionCount = 0;
    expect(homeSummaryModel(data)).toMatchObject({
      state: "ready",
      primary: "analysis",
      attention: 0,
    });
    data.community!.daily.attentionCount = null;
    expect(homeSummaryModel(data)).toMatchObject({
      state: "partial",
      attention: null,
    });
  });
  it("does not reuse stale counts or daily values when collection is unavailable", () => {
    const data = fixture();
    data.community!.daily.ready = false;
    expect(homeSummaryModel(data)).toMatchObject({
      state: "unavailable",
      primary: "details",
      attention: null,
      activity: null,
    });
  });
  it("keeps an individual unknown value distinct from zero with partial available data", () => {
    const data = fixture();
    data.community!.daily.todayJoined = null;
    expect(homeSummaryModel(data)).toMatchObject({
      state: "partial",
      primary: "attention",
      activity: { today: null, yesterday: 6 },
    });
  });
  it("does not infer first-time collection from missing data", () => {
    const data = fixture();
    data.home = null;
    data.community = null;
    data.results = null;
    expect(homeSummaryModel(data)).toMatchObject({
      state: "unavailable",
      primary: "details",
      attention: null,
      records: [],
    });
  });
  it("uses the existing explicit measurement-waiting signal for collecting", () => {
    const data = fixture();
    data.community = null;
    data.home!.setup = {
      ...data.home!.setup,
      required: true,
      steps: [
        { key: "measuring", complete: false, reason: "measurement_waiting" },
      ],
    };
    expect(homeSummaryModel(data).state).toBe("collecting");
    data.home!.setup.steps[0]!.reason = "ingestion_unavailable";
    expect(homeSummaryModel(data).state).toBe("unavailable");
  });
  it("keeps setup distinct from a connection diagnosis", () => {
    const data = fixture();
    data.community = null;
    data.home!.setup = {
      ...data.home!.setup,
      required: true,
      steps: [
        { key: "activation", complete: false, reason: "activation_missing" },
      ],
    };
    expect(homeSummaryModel(data)).toMatchObject({
      state: "setup",
      primary: "details",
    });
  });
  it.each([
    ["PAUSED", "paused"],
    ["EXPIRED", "expired"],
  ] as const)(
    "prioritizes %s access guidance while preserving permitted history",
    (betaState, state) => {
      const data = fixture();
      data.betaState = betaState;
      data.results!.simple = [
        {
          actionId: "allowed",
          name: "Allowed saved response",
          startedAt: time,
          collecting: false,
        },
      ] as NonNullable<ProductData["results"]>["simple"];
      expect(homeSummaryModel(data)).toMatchObject({
        state,
        primary: "settings",
        records: [{ id: "response:allowed" }],
      });
    },
  );
  it("keeps a partial endpoint failure separate from the valid attention count", () => {
    const data = fixture();
    data.results = null;
    expect(homeSummaryModel(data)).toMatchObject({
      state: "partial",
      primary: "attention",
      attention: 2,
      records: [],
    });
  });
  it("uses the authoritative current count without subtracting from stale initial data", () => {
    expect(homeSummaryModel(fixture(), 1).attention).toBe(1);
    expect(homeSummaryModel(fixture(), 3).attention).toBe(3);
    expect(homeSummaryModel(fixture(), 0)).toMatchObject({
      attention: 0,
      primary: "analysis",
    });
    expect(homeSummaryModel(fixture(), null)).toMatchObject({
      attention: null,
      primary: "details",
    });
    expect(homeSummaryModel(fixture(), -1).attention).toBeNull();
    expect(homeSummaryModel(fixture(), NaN).attention).toBeNull();
    const data = fixture();
    data.community!.daily.ready = false;
    expect(homeSummaryModel(data, 3).attention).toBeNull();
  });
  it("sorts permitted records newest first with deterministic ties and no source mutation", () => {
    const data = fixture();
    data.results!.simple = [
      { actionId: "b", name: "Second", startedAt: time, collecting: true },
      { actionId: "a", name: "First", startedAt: time, collecting: false },
      {
        actionId: "old",
        name: "Old",
        startedAt: "2026-10-01T12:00:00Z",
        collecting: false,
      },
      {
        actionId: "new",
        name: "Newest",
        startedAt: "2026-10-10T12:00:00Z",
        collecting: false,
      },
    ] as NonNullable<ProductData["results"]>["simple"];
    const original = structuredClone(data.results);
    expect(homeSummaryModel(data).records.map((record) => record.id)).toEqual([
      "response:new",
      "response:a",
      "response:b",
    ]);
    expect(homeSummaryModel(data).recordCount).toBe(4);
    expect(data.results).toEqual(original);
  });
});
