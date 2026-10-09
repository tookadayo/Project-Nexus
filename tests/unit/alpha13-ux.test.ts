import { expect, it } from "vitest";
import {
  dashboardView,
  dashboardLocation,
  dashboardViews,
} from "../../apps/web/app/navigation-model";
import { safeError } from "../../apps/web/app/safe-error";
import { workflowHome } from "../../packages/discord-panels/src/views/workflow-home";
import { validatePanel } from "../../packages/discord-panels/src/primitives";
import type { Issue } from "../../packages/discord-panels/src/types";
it("retains old numeric deep links and normalizes invalid input without including it in URLs", () => {
  for (const view of dashboardViews) {
    expect(dashboardView(String(view))).toBe(view);
    expect(
      dashboardLocation(
        "https://example.invalid/dashboard/111111111111111111",
        view,
      ),
    ).toBe("/dashboard/111111111111111111" + (view ? `?view=${view}` : ""));
  }
  for (const input of ["secret", "99", "-1", "1.2", ""])
    expect(dashboardView(input)).toBe(0);
});
it.each(["ja", "en"] as const)(
  "does not reveal raw transport details (%s)",
  (locale) => {
    expect(
      safeError("database password=not-for-display stack trace", locale),
    ).not.toMatch(/password|stack|database/);
    expect(safeError("SESSION_EXPIRED", locale)).not.toBe(
      safeError("INTERNAL", locale),
    );
  },
);
it.each(["ja", "en"] as const)(
  "keeps shared entry private and preserves private history (%s)",
  async (locale) => {
    for (const sharedEntry of [false, true]) {
      const intents: Parameters<Issue>[0][] = [];
      const issue: Issue = async (intent) => {
        intents.push(intent);
        return "test-" + intents.length;
      };
      // validatePanel is a void assertion (primitives.ts:13); violations throw.
      // Keep the actual validator and verify it rejects a boundary violation too.
      const panel = await workflowHome(issue, { sharedEntry }, locale);
      validatePanel(panel);
      expect(() =>
        validatePanel({
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 2,
                  label: "x".repeat(81),
                  custom_id: "invalid-label",
                },
              ],
            },
          ],
        }),
      ).toThrow("DISCORD_BUTTON_LIMIT");
      expect(
        intents.some((intent) => intent.action === "analysisHistory"),
      ).toBe(!sharedEntry);
      expect(intents.some((intent) => intent.action === "analysisMenu")).toBe(
        true,
      );
      expect(
        intents.some(
          (intent) =>
            intent.action === "controlNavigate" && intent.page === "settings",
        ),
      ).toBe(true);
    }
  },
);

it.each(["ja", "en"] as const)(
  "connects the existing disconnect preview without skipping its confirmation (%s)",
  async (locale) => {
    const { controlPanel } =
      await import("../../packages/discord-panels/src/views/control");
    const intents: Parameters<Issue>[0][] = [];
    const panel = await controlPanel(
      async (intent) => {
        intents.push(intent);
        return "preview-" + intents.length;
      },
      "settings",
      {},
      locale,
      "connection",
    );
    validatePanel(panel);
    expect(intents.some((intent) => intent.action === "unlink")).toBe(true);
    expect(intents.some((intent) => intent.action === "unlinkConfirm")).toBe(
      false,
    );
  },
);

it("does not copy unrelated URL data into navigation entries", () => {
  expect(
    dashboardLocation(
      "https://example.invalid/dashboard?token=private#personal",
      5,
    ),
  ).toBe("/dashboard?view=5");
});

it("restores only allowed dashboard filters and rejects cross-server Explore filters", async () => {
  const { dashboardFilters } =
    await import("../../apps/web/app/navigation-model");
  const { exploreQuery, exploreLocation } =
    await import("../../apps/web/app/explore/navigation");
  const filters = dashboardFilters(
    new URLSearchParams("range=7&tab=channels&token=private"),
  );
  expect(filters).toEqual({ range: 7, tab: "channels" });
  expect(
    dashboardLocation("https://example.invalid/dashboard", 5, filters),
  ).toBe("/dashboard?view=5&range=7&tab=channels");
  expect(
    dashboardFilters(new URLSearchParams("range=999&tab=private")),
  ).toEqual({ range: 30, tab: "overall" });
  const a = "111111111111111111",
    b = "222222222222222222";
  const defaults = exploreQuery(new URLSearchParams(), a);
  const query = {
    ...defaults,
    days: 30 as const,
    filter: { ...defaults.filter, channelIds: [a] },
  };
  const url = new URL(exploreLocation(query, a), "https://example.invalid");
  expect(exploreQuery(url.searchParams, a)).toEqual(query);
  expect(exploreQuery(url.searchParams, b)).toEqual(defaults);
  url.searchParams.set("q", JSON.stringify({ ...query, token: "private" }));
  expect(exploreQuery(url.searchParams, a)).toEqual(defaults);
});

it("preserves Attention filters and its scoped page cursor during hydration without carrying it to another view", () => {
  const href =
    "https://example.invalid/dashboard?view=8&attentionState=OPEN&attentionChannel=333333333333333333&attentionCursor=synthetic-page-2&secret=drop";
  expect(dashboardLocation(href, 8)).toBe(
    "/dashboard?view=8&attentionState=OPEN&attentionChannel=333333333333333333&attentionCursor=synthetic-page-2",
  );
  expect(dashboardLocation(href, 0)).toBe("/dashboard");
  expect(dashboardLocation(href, 5)).toBe("/dashboard?view=5");
  expect(
    dashboardLocation(
      "https://example.invalid/dashboard?view=8&attentionState=UNKNOWN&attentionChannel=wrong",
      8,
    ),
  ).toBe("/dashboard?view=8");
});
