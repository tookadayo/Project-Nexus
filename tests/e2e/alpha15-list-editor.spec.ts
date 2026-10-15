import { test, expect, type Page, type Locator } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { evaluateValue } from "../../packages/automation/src/expression";
import { registeredPairType } from "../../packages/automation/src/registered-pairs";
import {
  groupRecordType,
  findMatchType,
} from "../../packages/automation/src/structured-values";
import type {
  EvaluatedValue,
  FlowDefinition,
  ValueType,
} from "../../packages/automation/src/types";

const requireHere = createRequire(import.meta.url),
  esbuild = createRequire(requireHere.resolve("tsx"))("esbuild");
const guildId = "321111111111111111";
let html = "";
const errors = new WeakMap<Page, string[]>();
type Locale = "ja" | "en";
const words = (locale: Locale, ja: string, en: string) =>
  locale === "ja" ? ja : en;
test.beforeAll(async () => {
  const requireWeb = createRequire(resolve("apps/web/package.json"));
  const result = await esbuild.build({
    entryPoints: [resolve("tests/fixtures/alpha15-automation-editor.tsx")],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    outfile: "editor.js",
    jsx: "automatic",
    alias: {
      react: dirname(requireWeb.resolve("react/package.json")),
      "react-dom": dirname(requireWeb.resolve("react-dom/package.json")),
    },
  });
  const script = result.outputFiles.find((file: { path: string }) =>
      file.path.endsWith(".js"),
    ).text,
    css = result.outputFiles.find((file: { path: string }) =>
      file.path.endsWith(".css"),
    ).text;
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await mkdir(".local/alpha15-list-editor", { recursive: true });
});
test.beforeEach(async ({ page }) => {
  const captured: string[] = [];
  errors.set(page, captured);
  page.on("pageerror", (error) => captured.push(error.message));
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.route("**/editor-fixture*", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.route("**/api/automation/overview", (route) =>
    route.fulfill({
      json: {
        runs: [],
        nextOccurrences: [],
        usage: {
          limit: 10,
          reserved: 0,
          consumed: 0,
          compensated: 0,
          remaining: 10,
          updatedAt: "2026-10-15T00:00:00Z",
        },
        status: "CAPACITY_UNMEASURED",
      },
    }),
  );
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

async function open(
  page: Page,
  locale: Locale,
  type: ValueType,
  inputs: FlowDefinition["variables"] = [],
) {
  const flow: FlowDefinition = {
    schemaVersion: 1,
    id: "list-ui",
    guildId,
    name: "Synthetic list",
    trigger: { kind: "manual", inputs },
    variables: [],
    body: [
      {
        id: "value",
        kind: "declare",
        variable: { id: "out", name: "Result", type },
        value: { kind: "missing", type },
      },
    ],
  };
  let saved: FlowDefinition | undefined;
  const detail = {
    id: flow.id,
    name: flow.name,
    draftRevision: 1,
    activeRevision: null,
    state: "DRAFT",
    definition: flow,
    validation: { valid: true, complete: false, issues: [] },
  };
  await page.route("**/api/automation/flows", (route) =>
    route.fulfill({ json: { items: [detail] } }),
  );
  await page.route("**/api/automation/flows/list-ui", (route) =>
    route.fulfill({ json: detail }),
  );
  await page.route("**/api/automation/flows/list-ui/draft", (route) => {
    saved = route.request().postDataJSON().definition;
    return route.fulfill({
      json: {
        ...detail,
        definition: saved,
        draftRevision: 2,
        validation: { valid: true, complete: true, issues: [] },
      },
    });
  });
  await page.goto(`/editor-fixture?locale=${locale}&flow=list-ui`);
  await expect(
    page.getByRole("textbox", {
      name: words(locale, "自動化の名前", "Automation name"),
      exact: true,
    }),
  ).toHaveValue(flow.name);
  await page.locator(".automation-block-title").first().click();
  const slot = page
    .locator(".automation-details fieldset.automation-slot")
    .first();
  return {
    slot,
    async save(variables: Record<string, EvaluatedValue> = {}) {
      await page
        .getByRole("button", {
          name: words(locale, "下書きを保存", "Save draft"),
          exact: true,
        })
        .click();
      await expect.poll(() => Boolean(saved)).toBe(true);
      const statement = saved!.body[0];
      if (statement?.kind !== "declare") throw Error("DECLARE");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      return {
        input: statement.value,
        type: statement.variable.type,
        result: evaluateValue(statement.value, { guildId, variables }),
      };
    },
  };
}
async function calculation(
  slot: Locator,
  locale: Locale,
  operator: string,
  key?: string,
  firstInputType?: ValueType,
) {
  await slot
    .getByRole("button", {
      name: words(locale, "計算ブロック", "Calculation"),
      exact: true,
    })
    .first()
    .click();
  const select = slot.locator(":scope > .automation-expression > select");
  const value = await select
    .locator("option")
    .evaluateAll(
      (options, match) =>
        (options as HTMLOptionElement[]).find(
          (option) =>
            option.value.startsWith(match.operator + ":") &&
            (!match.firstInputType ||
              JSON.stringify(
                JSON.parse(option.value.slice(option.value.indexOf(":") + 1))
                  .inputs?.[0],
              ) === JSON.stringify(match.firstInputType)) &&
            (!match.key ||
              JSON.parse(option.value.slice(option.value.indexOf(":") + 1))
                .options?.key === match.key),
        )?.value,
      { operator, key, firstInputType },
    );
  expect(value).toBeTruthy();
  await select.selectOption(value!);
  return slot.locator(
    ":scope > .automation-expression > fieldset.automation-slot",
  );
}
async function numbers(slot: Locator, locale: Locale, values: number[]) {
  const list = slot.locator(":scope > .automation-list-input");
  for (const [index, value] of values.entries()) {
    await list
      .locator(":scope > button")
      .filter({ hasText: words(locale, "項目を追加", "Add item") })
      .click();
    await list.getByRole("textbox").nth(index).fill(String(value));
  }
}
const screenshot = async (page: Page, locale: Locale, name: string) =>
  page.screenshot({
    path: `.local/alpha15-list-editor/${locale}-${name}-320.png`,
    fullPage: true,
  });

for (const locale of ["ja", "en"] as const) {
  test(`compound Pair keeps Optional and nested List typed (${locale})`, async ({
    page,
  }) => {
    const pair = registeredPairType(
      { kind: "Optional", value: "Number" },
      { kind: "List", element: "Number" },
    )!;
    const ui = await open(page, locale, { kind: "List", element: pair });
    const second = page
      .getByRole("combobox", {
        name: words(locale, "二つ目の値の種類", "Second value type"),
        exact: true,
      })
      .locator("..")
      .locator("..");
    await second
      .getByRole("combobox", { name: words(locale, "型", "Type"), exact: true })
      .selectOption(JSON.stringify("PlainText"));
    const args = await calculation(ui.slot, locale, "list.zip");
    const firstList = args.nth(0).locator(":scope > .automation-list-input");
    await firstList
      .locator(":scope > button")
      .filter({ hasText: words(locale, "項目を追加", "Add item") })
      .click();
    await firstList
      .getByRole("combobox", {
        name: words(locale, "値の有無を明示", "Explicit presence"),
        exact: true,
      })
      .selectOption("unset");
    const secondList = args.nth(1).locator(":scope > .automation-list-input");
    await secondList
      .locator(":scope > button")
      .filter({ hasText: words(locale, "項目を追加", "Add item") })
      .click();
    await secondList
      .getByRole("button", {
        name: words(locale, "空の一覧を確定", "Use an empty list"),
        exact: true,
      })
      .click();
    const saved = await ui.save();
    expect(saved.type).toEqual({
      kind: "List",
      element: registeredPairType(
        { kind: "Optional", value: "Number" },
        { kind: "List", element: "PlainText" },
      ),
    });
    expect(saved.result.value).toEqual([
      { first: { state: "unset" }, second: [] },
    ]);
    await screenshot(page, locale, "compound-pair");
  });

  test(`grouping keeps first-key order and input order (${locale})`, async ({
    page,
  }) => {
    const ui = await open(page, locale, {
      kind: "List",
      element: groupRecordType("Number", "Number"),
    });
    await expect(
      page.getByRole("combobox", {
        name: words(locale, "グループのキーの種類", "Group key type"),
        exact: true,
      }),
    ).toHaveValue(JSON.stringify("Number"));
    const args = await calculation(ui.slot, locale, "list.group");
    await numbers(args.first(), locale, [2, 1, 2]);
    expect((await ui.save()).result.value).toEqual([
      { key: 2, items: [2, 2] },
      { key: 1, items: [1] },
    ]);
    await screenshot(page, locale, "group");
  });

  test(`find result preserves first item and one-based position (${locale})`, async ({
    page,
  }) => {
    const ui = await open(page, locale, {
      kind: "Optional",
      value: findMatchType("Number"),
    });
    const args = await calculation(ui.slot, locale, "list.findResult");
    await numbers(args.first(), locale, [1, 6, 6]);
    const predicate = args.last(),
      comparison = await calculation(
        predicate,
        locale,
        "compare.greater",
        undefined,
        "Number",
      );
    await comparison
      .first()
      .getByRole("button", {
        name: words(locale, "変数", "Variable"),
        exact: true,
      })
      .click();
    await comparison.first().locator("select").selectOption({ index: 1 });
    await comparison.nth(1).getByRole("textbox").fill("3");
    expect((await ui.save()).result.value).toEqual({
      state: "set",
      value: { item: 6, position: 2 },
    });
    await screenshot(page, locale, "find-position");
  });

  test(`minimum and maximum are both explicit Optional values (${locale})`, async ({
    page,
  }) => {
    const ui = await open(page, locale, {
      kind: "Record",
      schemaId: "MinMaxValue",
    });
    const args = await calculation(ui.slot, locale, "list.minMax");
    await numbers(args.first(), locale, [10, 30, 20]);
    expect((await ui.save()).result.value).toEqual({
      minimum: { state: "set", value: 10 },
      maximum: { state: "set", value: 30 },
    });
    await screenshot(page, locale, "min-max");
  });

  test(`registered duplicate-key selector retains the first service record (${locale})`, async ({
    page,
  }) => {
    const record: ValueType = {
        kind: "Record",
        schemaId: "nexus.ticket.status.v1",
      },
      type: ValueType = { kind: "List", element: record };
    const ui = await open(page, locale, type, [
      { id: "tickets", name: "Tickets", type },
    ]);
    const args = await calculation(ui.slot, locale, "list.unique", "state");
    await args
      .first()
      .getByRole("button", {
        name: words(locale, "変数", "Variable"),
        exact: true,
      })
      .click();
    await args.first().locator("select").selectOption("tickets");
    const source: EvaluatedValue = {
      type,
      value: [
        { state: "OPEN", version: 3 },
        { state: "RESOLVED", version: 4 },
        { state: "OPEN", version: 1 },
      ],
      provenance: [{ source: "service", guildId, resumable: true }],
    };
    const result = await ui.save({ tickets: source });
    expect(
      result.input.kind === "expression" &&
        result.input.expression.options?.key,
    ).toBe("state");
    expect(result.result.value).toEqual([
      { state: "OPEN", version: 3 },
      { state: "RESOLVED", version: 4 },
    ]);
    await screenshot(page, locale, "registered-key");
  });
}
