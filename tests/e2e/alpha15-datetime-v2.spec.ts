import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type {
  FlowDefinition,
  ValueInput,
  ValueType,
} from "../../packages/automation/src/types";
import { validateFlowDefinition } from "../../packages/automation/src/definition";
import {
  localTimeType,
  INSTANT_RANGE_V2_TYPE,
} from "../../packages/automation/src/temporal-types";

const requireHere = createRequire(import.meta.url),
  esbuild = createRequire(requireHere.resolve("tsx"))("esbuild");
let html = "";
test.beforeAll(async () => {
  const requireWeb = createRequire(resolve("apps/web/package.json"));
  const bundle = await esbuild.build({
    entryPoints: [resolve("tests/fixtures/alpha15-automation-editor.tsx")],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    outfile: "datetime-v2.js",
    jsx: "automatic",
    alias: {
      react: dirname(requireWeb.resolve("react/package.json")),
      "react-dom": dirname(requireWeb.resolve("react-dom/package.json")),
    },
  });
  const script = bundle.outputFiles.find((file: { path: string }) =>
    file.path.endsWith(".js"),
  ).text;
  const css = bundle.outputFiles.find((file: { path: string }) =>
    file.path.endsWith(".css"),
  ).text;
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await mkdir(".local/alpha15-datetime-20261016", { recursive: true });
});
const base = (
  type: ValueType = "Number",
  input?: ValueInput,
): FlowDefinition => ({
  schemaVersion: 1,
  semanticProfile: "scratch.v1",
  id: "datetime-v2",
  guildId: "321111111111111111",
  name: "Synthetic datetime",
  trigger: {
    kind: "manual",
    inputs: [
      {
        id: "minute-input",
        name: "Minute input",
        type: localTimeType("minute"),
      },
      {
        id: "second-input",
        name: "Second input",
        type: localTimeType("second"),
      },
    ],
  },
  variables: [],
  body: [
    {
      id: "typed-date",
      kind: "declare",
      variable: { id: "date-value", name: "Date value", type },
      value: input ?? { kind: "missing", type },
    },
  ],
});
function value(flow: FlowDefinition): ValueInput {
  const node = flow.body[0]!;
  if (node.kind !== "declare") throw Error("DECLARATION");
  return node.value;
}
async function open(
  page: Page,
  flow: FlowDefinition,
  locale: "ja" | "en",
  missingZone = false,
) {
  let saved = structuredClone(flow),
    revision = 1;
  const saves: FlowDefinition[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const detail = () => ({
    id: saved.id,
    name: saved.name,
    state: "DRAFT",
    definition: saved,
    draftRevision: revision,
    activeRevision: null,
    validation: validateFlowDefinition(saved),
  });
  await page.route("**/datetime-v2-fixture*", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.route("**/api/automation/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/time-zone"))
      return route.fulfill({
        json: missingZone
          ? { timeZone: null, source: "missing", revision: 0 }
          : { timeZone: "Asia/Tokyo", source: "saved", revision: 9 },
      });
    if (path.endsWith("/overview"))
      return route.fulfill({
        json: {
          runs: [],
          nextOccurrences: [],
          usage: {
            limit: 10,
            reserved: 0,
            consumed: 0,
            compensated: 0,
            remaining: 10,
            updatedAt: "2026-10-16T00:00:00Z",
          },
          status: "CAPACITY_UNMEASURED",
        },
      });
    if (path.endsWith("/flows")) return route.fulfill({ json: { items: [] } });
    if (path.endsWith("/flows/datetime-v2/draft")) {
      const body = route.request().postDataJSON();
      expect(body.expectedRevision).toBe(revision);
      saved = body.definition;
      saves.push(structuredClone(saved));
      revision++;
      return route.fulfill({ json: detail() });
    }
    if (path.endsWith("/flows/datetime-v2"))
      return route.fulfill({ json: detail() });
    return route.fulfill({
      status: 404,
      json: { error: "SYNTHETIC_NOT_FOUND" },
    });
  });
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto(`/datetime-v2-fixture?locale=${locale}&flow=datetime-v2`);
  await expect(page.locator(".automation-workspace")).toBeVisible();
  return { saved: () => saved, saves, errors };
}
const words = (locale: "ja" | "en", ja: string, en: string) =>
  locale === "ja" ? ja : en;
async function selectValue(page: Page, locale: "ja" | "en") {
  await page
    .getByRole("button", { name: words(locale, "手順", "Steps"), exact: true })
    .first()
    .click();
  await page.locator(".automation-block-title").first().click();
  return page.locator(".automation-details fieldset.automation-slot").first();
}
async function save(
  page: Page,
  locale: "ja" | "en",
  state: { saves: FlowDefinition[] },
) {
  const count = state.saves.length;
  await page
    .getByRole("button", {
      name: words(locale, "下書きを保存", "Save draft"),
      exact: true,
    })
    .click();
  await expect.poll(() => state.saves.length).toBe(count + 1);
}
async function narrow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
for (const locale of ["ja", "en"] as const) {
  test(`DT02 DT13 typed seconds use matching variables and nested values through save reload Undo (${locale})`, async ({
    page,
  }) => {
    const state = await open(page, base(), locale);
    let slot = await selectValue(page, locale);
    const picker = page
      .locator(".automation-details .automation-type-picker > label > select")
      .first();
    await picker.selectOption(JSON.stringify(localTimeType("second")));
    await slot
      .getByRole("button", {
        name: words(locale, "変数", "Variable"),
        exact: true,
      })
      .first()
      .click();
    const variables = slot.locator(":scope > div > select");
    await expect(variables.locator("option[value=second-input]")).toHaveCount(
      1,
    );
    await expect(variables.locator("option[value=minute-input]")).toHaveCount(
      0,
    );
    await variables.selectOption("second-input");
    await save(page, locale, state);
    expect(value(state.saved())).toEqual({
      kind: "variable",
      type: localTimeType("second"),
      variableId: "second-input",
    });
    slot = await selectValue(page, locale);
    await slot
      .getByRole("button", {
        name: words(locale, "計算ブロック", "Calculation"),
        exact: true,
      })
      .first()
      .click();
    const menu = slot.locator(":scope > .automation-expression > select");
    const option = await menu
      .locator("option")
      .evaluateAll(
        (options: HTMLOptionElement[]) =>
          options.find((item) => item.value.startsWith("time.compose:"))?.value,
      );
    expect(option).toBeTruthy();
    await menu.selectOption(option!);
    const args = slot.locator(
      ":scope > .automation-expression > fieldset.automation-slot input",
    );
    await expect(args).toHaveCount(3);
    await args.nth(0).fill("18");
    await args.nth(1).fill("30");
    await args.nth(2).fill("45");
    await save(page, locale, state);
    const expected = value(state.saved());
    expect(expected).toMatchObject({
      kind: "expression",
      type: localTimeType("second"),
      expression: {
        operator: "time.compose",
        args: [{ value: 18 }, { value: 30 }, { value: 45 }],
      },
    });
    await page.reload();
    slot = await selectValue(page, locale);
    await expect(
      slot
        .locator(
          ":scope > .automation-expression > fieldset.automation-slot input",
        )
        .nth(2),
    ).toHaveValue("45");
    await picker.selectOption(JSON.stringify("DateOnly"));
    await page
      .getByRole("button", {
        name: words(locale, "編集を戻す", "Undo edit"),
        exact: true,
      })
      .click();
    await selectValue(page, locale);
    await expect(picker).toHaveValue(JSON.stringify(localTimeType("second")));
    await page
      .getByRole("textbox", {
        name: words(locale, "自動化の名前", "Automation name"),
        exact: true,
      })
      .fill("Saved after Undo");
    await save(page, locale, state);
    expect(value(state.saved())).toEqual(expected);
    await narrow(page);
    expect(state.errors).toEqual([]);
  });
  test(`DT01 DT04 DT05 date and range meanings persist and v2 empty ranges remain explicit (${locale})`, async ({
    page,
  }) => {
    const state = await open(page, base("DateOnly"), locale);
    await selectValue(page, locale);
    const input = page
      .locator(".automation-details .automation-date-control input[type=text]")
      .first();
    await input.fill("03/04");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("button", {
        name: words(locale, "下書きを保存", "Save draft"),
        exact: true,
      }),
    ).toBeDisabled();
    await input.press("Escape");
    await expect(input).toHaveValue("");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await input.fill("2028-02-29");
    await save(page, locale, state);
    expect(value(state.saved())).toMatchObject({ value: "2028-02-29" });
    await selectValue(page, locale);
    const picker = page
      .locator(".automation-details .automation-type-picker > label > select")
      .first();
    await picker.selectOption(JSON.stringify("DateRange"));
    const range = page.locator(
        ".automation-details .automation-temporal-input",
      ),
      dates = range.locator(".automation-date-control input[type=text]");
    await dates.nth(0).fill("2026-10-15");
    await dates.nth(1).fill("2026-10-15");
    await range.locator(".automation-zone-review input").fill("Asia/Tokyo");
    await range
      .getByRole("button", {
        name: words(
          locale,
          "確認してこの地域を使う",
          "Confirm and use this region",
        ),
        exact: true,
      })
      .click();
    await expect(range.locator("output")).toContainText(
      "2026-10-14T15:00:00.000Z",
    );
    await save(page, locale, state);
    expect(value(state.saved())).toMatchObject({
      value: { start: "2026-10-15", end: "2026-10-15", timeZone: "Asia/Tokyo" },
    });
    await page.reload();
    await selectValue(page, locale);
    await expect(dates.nth(0)).toHaveValue("2026-10-15");
    await picker.selectOption(JSON.stringify(INSTANT_RANGE_V2_TYPE));
    const instants = range.locator("input[type=datetime-local]");
    await instants.nth(0).fill("2026-10-15T00:00:42");
    await instants.nth(1).fill("2026-10-15T00:00:42");
    await save(page, locale, state);
    expect(value(state.saved())).toEqual({
      kind: "literal",
      type: INSTANT_RANGE_V2_TYPE,
      value: {
        start: "2026-10-15T00:00:42.000Z",
        end: "2026-10-15T00:00:42.000Z",
      },
    });
    expect(validateFlowDefinition(state.saved()).complete).toBe(true);
    await narrow(page);
    expect(state.errors).toEqual([]);
  });
  test(`DT03 saved fractional instants survive unrelated save reload and replacement cancellation (${locale})`, async ({
    page,
  }) => {
    const instant = "2026-10-15T18:30:42.123Z",
      state = await open(
        page,
        base("Instant", { kind: "literal", type: "Instant", value: instant }),
        locale,
      );
    await selectValue(page, locale);
    const savedInput = page.locator(
      ".automation-details .automation-instant-control input[readonly]",
    );
    await expect(savedInput).toHaveValue(instant);
    await page
      .getByRole("textbox", {
        name: words(locale, "自動化の名前", "Automation name"),
        exact: true,
      })
      .fill("Unrelated configuration change");
    await save(page, locale, state);
    expect(value(state.saved())).toMatchObject({ value: instant });
    await page.reload();
    await selectValue(page, locale);
    await expect(savedInput).toHaveValue(instant);
    await page
      .getByRole("button", {
        name: words(
          locale,
          "日時を明示的に置き換える",
          "Explicitly replace date and time",
        ),
        exact: true,
      })
      .click();
    await page
      .locator(".automation-details input[type=datetime-local]")
      .fill("2026-10-16T18:30:42.123");
    await expect(
      page.getByRole("button", {
        name: words(locale, "下書きを保存", "Save draft"),
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByRole("button", {
        name: words(locale, "置換を取り消す", "Cancel replacement"),
        exact: true,
      })
      .click();
    await page
      .getByRole("textbox", {
        name: words(locale, "自動化の名前", "Automation name"),
        exact: true,
      })
      .fill("Saved after cancellation");
    await save(page, locale, state);
    expect(value(state.saved())).toMatchObject({ value: instant });
    await narrow(page);
    expect(state.errors).toEqual([]);
  });
  test(`DT06 overnight windows require an explicit next day and preserve second precision (${locale})`, async ({
    page,
  }) => {
    const state = await open(page, base("LocalTimeWindowSpec"), locale);
    await selectValue(page, locale);
    const window = page.locator(
        ".automation-details .automation-temporal-input",
      ),
      times = window.locator("input[type=time]");
    await times.nth(0).fill("22:00");
    await times.nth(1).fill("02:00");
    await window
      .getByRole("combobox", { name: words(locale, "終了する日", "End day") })
      .selectOption("0");
    await window.getByRole("checkbox").nth(5).check();
    await window.locator(".automation-zone-review input").fill("Asia/Tokyo");
    await window
      .getByRole("button", {
        name: words(
          locale,
          "確認してこの地域を使う",
          "Confirm and use this region",
        ),
        exact: true,
      })
      .click();
    await expect(window.getByRole("alert")).toBeVisible();
    await window
      .getByRole("combobox", { name: words(locale, "終了する日", "End day") })
      .selectOption("1");
    await window
      .getByRole("combobox", {
        name: new RegExp(words(locale, "時刻の精度", "Time precision")),
      })
      .selectOption("second");
    await expect(times.nth(0)).toHaveValue("");
    await times.nth(0).fill("22:00:30");
    await times.nth(1).fill("02:00:45");
    await save(page, locale, state);
    expect(value(state.saved())).toMatchObject({
      value: {
        start: "22:00:30",
        end: "02:00:45",
        endDayOffset: 1,
        timePrecision: "second",
        weekdays: [5],
      },
    });
    await page.reload();
    await selectValue(page, locale);
    await expect(times.nth(1)).toHaveValue("02:00:45");
    await narrow(page);
    await page.screenshot({
      path: `.local/alpha15-datetime-20261016/${locale}-overnight-window-320.png`,
      fullPage: true,
    });
    expect(state.errors).toEqual([]);
  });
  test(`DT08 DT09 DT11 yearly previews show five regional instants and region changes require review (${locale})`, async ({
    page,
  }) => {
    const flow = base("Number", { kind: "literal", type: "Number", value: 1 });
    flow.trigger = {
      kind: "schedule",
      schedule: {
        kind: "recurring",
        frequency: "yearly",
        month: 2,
        monthDay: 29,
        time: "18:30:45",
        timePrecision: "second",
        timeZone: "Asia/Tokyo",
        startDate: "2028-01-01",
        endDate: "2060-12-31",
        missingTime: "skip",
        repeatedTime: "earlier",
        pastOccurrences: "skip",
      },
    };
    const state = await open(page, flow, locale);
    await page
      .getByRole("button", {
        name: words(locale, "手順", "Steps"),
        exact: true,
      })
      .first()
      .click();
    const trigger = page.locator(".automation-trigger");
    await expect(
      trigger.locator(".automation-schedule-preview li"),
    ).toHaveCount(5);
    await expect(
      trigger.getByRole("button", {
        name: /Use device region candidate|端末の地域候補/,
      }),
    ).toHaveCount(0);
    await expect(
      trigger.locator(".automation-schedule-preview li").first(),
    ).toContainText("2028-02-29 18:30:45 · Asia/Tokyo · UTC+09:00");
    const zone = trigger.locator(".automation-zone-review input");
    await zone.fill("America/New_York");
    await expect(
      trigger.locator(".automation-zone-review section"),
    ).toContainText("Asia/Tokyo");
    await expect(
      trigger.locator(".automation-zone-review section"),
    ).toContainText("America/New_York");
    await trigger
      .getByRole("button", {
        name: words(locale, "地域変更を取り消す", "Cancel region change"),
        exact: true,
      })
      .click();
    await expect(zone).toHaveValue("Asia/Tokyo");
    await zone.fill("America/New_York");
    await trigger
      .getByRole("button", {
        name: words(
          locale,
          "確認してこの地域を使う",
          "Confirm and use this region",
        ),
        exact: true,
      })
      .click();
    await expect(
      trigger.locator(".automation-schedule-preview li").first(),
    ).toContainText("America/New_York · UTC-05:00");
    await save(page, locale, state);
    expect(state.saved().trigger).toMatchObject({
      schedule: {
        time: "18:30:45",
        timeZone: "America/New_York",
        timePrecision: "second",
        frequency: "yearly",
        monthDay: 29,
      },
    });
    await page.reload();
    await page
      .getByRole("button", {
        name: words(locale, "手順", "Steps"),
        exact: true,
      })
      .first()
      .click();
    await expect(zone).toHaveValue("America/New_York");
    await narrow(page);
    await page.screenshot({
      path: `.local/alpha15-datetime-20261016/${locale}-yearly-preview-320.png`,
      fullPage: true,
    });
    expect(state.errors).toEqual([]);
  });
  test(`DT10 a device region is only a confirmed candidate and lookup failure never selects UTC (${locale})`, async ({
    page,
  }) => {
    const flow = base("Number", { kind: "literal", type: "Number", value: 1 });
    flow.trigger = {
      kind: "schedule",
      schedule: {
        kind: "once",
        at: { date: "2030-01-01", time: "18:30", timeZone: "" },
      },
    };
    const state = await open(page, flow, locale, true);
    await page
      .getByRole("button", {
        name: words(locale, "手順", "Steps"),
        exact: true,
      })
      .first()
      .click();
    const trigger = page.locator(".automation-trigger"),
      zone = trigger.locator(".automation-zone-review input");
    await expect(zone).toHaveValue("");
    const candidate = trigger.getByRole("button", {
      name: words(
        locale,
        "端末の地域候補 Pacific/Honolulu を使用",
        "Use device region candidate Pacific/Honolulu",
      ),
      exact: true,
    });
    await expect(candidate).toBeVisible();
    await candidate.focus();
    await page.keyboard.press("Enter");
    await expect(zone).toHaveValue("Pacific/Honolulu");
    expect(state.saves).toHaveLength(0);
    await page.addInitScript(() => {
      const original = Intl.DateTimeFormat.prototype.resolvedOptions;
      Object.defineProperty(Intl.DateTimeFormat.prototype, "resolvedOptions", {
        value: function (this: Intl.DateTimeFormat) {
          return { ...original.call(this), timeZone: undefined };
        },
      });
    });
    await page.reload();
    await page
      .getByRole("button", {
        name: words(locale, "手順", "Steps"),
        exact: true,
      })
      .first()
      .click();
    await expect(zone).toHaveValue("");
    await expect(
      trigger.getByRole("button", {
        name: /Use device region candidate|端末の地域候補/,
      }),
    ).toHaveCount(0);
    await zone.fill("Asia/Tokyo");
    await trigger
      .getByRole("button", {
        name: words(
          locale,
          "確認してこの地域を使う",
          "Confirm and use this region",
        ),
        exact: true,
      })
      .click();
    await save(page, locale, state);
    expect(state.saved().trigger).toMatchObject({
      schedule: { at: { timeZone: "Asia/Tokyo" } },
    });
    await narrow(page);
    expect(state.errors).toEqual([]);
  });
}
