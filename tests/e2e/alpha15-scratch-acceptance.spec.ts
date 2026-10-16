import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type {
  FlowDefinition,
  Statement,
  ValueInput,
  ValueType,
} from "../../packages/automation/src/types";
import {
  compileFlowDefinition,
  validateFlowDefinition,
} from "../../packages/automation/src/definition";
import { simulateAutomationPlan } from "../../packages/automation/src/simulation";

// These are synthetic fixtures of the actual editor, not a production/OAuth server.
// The test route calls the real in-memory simulator, without a DB or connector.
const requireHere = createRequire(import.meta.url);
const esbuild = createRequire(requireHere.resolve("tsx"))("esbuild") as {
  build(input: Record<string, unknown>): Promise<{
    outputFiles: { path: string; text: string }[];
  }>;
};
const artifacts = ".local/alpha15-scratch-acceptance";
let html = "";
const faults = new WeakMap<Page, string[]>();
test.beforeAll(async () => {
  const web = createRequire(resolve("apps/web/package.json"));
  const result = await esbuild.build({
    entryPoints: [resolve("tests/fixtures/alpha15-automation-editor.tsx")],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    outfile: "editor.js",
    jsx: "automatic",
    alias: {
      react: dirname(web.resolve("react/package.json")),
      "react-dom": dirname(web.resolve("react-dom/package.json")),
    },
  });
  const script = result.outputFiles.find((file) =>
    file.path.endsWith(".js"),
  )!.text;
  const css = result.outputFiles.find((file) =>
    file.path.endsWith(".css"),
  )!.text;
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await mkdir(artifacts, { recursive: true });
});
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  faults.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  // Stop any unexpected external request or mutation; specific synthetic routes
  // below take precedence. No HTTP request leaves this intercepted browser.
  await page.route("**/*", (route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== "http://127.0.0.1:4193")
      errors.push(`Unexpected external request: ${request.method()}`);
    else if (!["GET", "HEAD"].includes(request.method()))
      errors.push(`Unexpected mutation: ${new URL(request.url()).pathname}`);
    return route.fulfill({
      status: 404,
      json: { error: "SYNTHETIC_ROUTE_ONLY" },
    });
  });
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
        },
        status: "CAPACITY_UNMEASURED",
      },
    }),
  );
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

type Locale = "ja" | "en";
type Branch = Extract<Statement, { kind: "branch" }>;
const literal = (value: number): ValueInput => ({
  kind: "literal",
  type: "Number",
  value,
});
const ref = (variableId: string): ValueInput => ({
  kind: "variable",
  type: "Number",
  variableId,
});
const wait = (id: string, seconds = 0): Statement => ({
  id,
  kind: "wait",
  duration: { kind: "literal", type: "Duration", value: seconds },
});
const base = (body: Statement[]): FlowDefinition => ({
  schemaVersion: 1,
  semanticProfile: "scratch.v1",
  id: "scratch-acceptance",
  guildId: "321111111111111111",
  name: "Scratch acceptance synthetic flow",
  trigger: { kind: "manual", inputs: [] },
  variables: [],
  body,
});
const branch = (id: string, otherwise: Statement[] = []): Branch => ({
  id,
  kind: "branch",
  condition: { kind: "literal", type: "Boolean", value: false },
  then: [wait(`${id}-yes`, 1)],
  otherwise,
  unknown: [wait(`${id}-unknown`, 2)],
});
async function open(page: Page, definition: FlowDefinition, locale: Locale) {
  let current = structuredClone(definition),
    revision = 2;
  const saves: FlowDefinition[] = [];
  const rejectedCodes: string[][] = [];
  const retained = new Map<number, FlowDefinition>([
    [revision, structuredClone(current)],
  ]);
  const revisionReads: number[] = [];
  const validation = () => {
    const { valid, complete, issues } = validateFlowDefinition(current, {
      deferNumericEngine: true,
    });
    return { valid, complete, issues };
  };
  const detail = () => ({
    id: current.id,
    name: current.name,
    definition: current,
    draftRevision: revision,
    activeRevision: null,
    state: "DRAFT",
    validation: validation(),
  });
  await page.route("**/api/automation/flows", (route) =>
    route.fulfill({ json: { items: [detail()] } }),
  );
  await page.route(`**/api/automation/flows/${definition.id}`, (route) =>
    route.fulfill({ json: detail() }),
  );
  await page.route(
    `**/api/automation/flows/${definition.id}/draft`,
    (route) => {
      const request = route.request().postDataJSON();
      expect(request.expectedRevision).toBe(revision);
      const checked = validateFlowDefinition(request.definition, {
        deferNumericEngine: true,
      });
      if (checked.issues.some((issue) => issue.severity === "error")) {
        const codes = checked.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.code);
        rejectedCodes.push(codes);
        return route.fulfill({
          status: 400,
          json: { error: "AUTOMATION_DEFINITION_INVALID", codes },
        });
      }
      current = structuredClone(request.definition);
      saves.push(structuredClone(current));
      revision++;
      retained.set(revision, structuredClone(current));
      return route.fulfill({ json: detail() });
    },
  );
  await page.route(
    `**/api/automation/flows/${definition.id}/revisions/*`,
    (route) => {
      const requested = Number(
        new URL(route.request().url()).pathname.split("/").at(-1),
      );
      revisionReads.push(requested);
      const stored = retained.get(requested);
      return stored
        ? route.fulfill({
            json: {
              id: definition.id,
              revision: requested,
              definition: stored,
            },
          })
        : route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
    },
  );
  await page.goto(`/editor-fixture?locale=${locale}&flow=${definition.id}`);
  await expect(
    page.getByRole("textbox", {
      name: locale === "ja" ? "自動化の名前" : "Automation name",
      exact: true,
    }),
  ).toHaveValue(definition.name);
  return {
    saved: () => structuredClone(current),
    saves,
    revision: () => revision,
    validation,
    revisionReads,
    rejectedCodes,
  };
}
function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (record.kind === "literal") return [];
  return [
    ...(typeof record.variableId === "string" ? [record.variableId] : []),
    ...Object.values(record).flatMap(references),
  ];
}

for (const locale of ["ja", "en"] as const) {
  const t = (ja: string, en: string) => (locale === "ja" ? ja : en);
  const title = (page: Page, id: string) =>
    page.locator(`[data-block-id="${id}"] > .automation-block-head button`);
  const save = async (
    page: Page,
    state: Awaited<ReturnType<typeof open>>,
    count: number,
  ) => {
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(() => state.saves.length).toBe(count);
    await expect(
      page.locator(".automation-draft-heading strong"),
    ).toContainText(`${t("下書き版", "Draft revision")} ${state.revision()}`);
  };
  const blocks = async (page: Page) => {
    if (
      await page
        .getByRole("button", { name: t("手順", "Steps"), exact: true })
        .first()
        .isVisible()
    )
      await page
        .getByRole("button", { name: t("手順", "Steps"), exact: true })
        .first()
        .click();
  };

  test(`T043 inner else editing preserves the outer ownership after save and reload (${locale}, desktop)`, async ({
    page,
  }) => {
    const inner = branch("inner", [wait("inner-else", 3)]);
    const outer = branch("outer", [wait("outer-else", 7)]);
    outer.then = [inner, wait("outer-then-tail", 5)];
    const original = base([outer, wait("outer-tail", 9)]);
    expect(validateFlowDefinition(original).complete).toBe(true);
    const state = await open(page, original, locale);
    await title(page, "inner-else").click();
    await page
      .getByRole("textbox", {
        name: t("待機時間", "Wait duration"),
        exact: true,
      })
      .fill("4");
    await save(page, state, 1);
    const expected = structuredClone(original);
    (expected.body[0] as Branch).then[0] = {
      ...inner,
      otherwise: [wait("inner-else", 4)],
    };
    expect(state.saved()).toEqual(expected);
    await page.reload();
    const outerTrue = page.locator('[data-owner="outer"][data-branch="then"]');
    const innerElse = page.locator(
      '[data-owner="inner"][data-branch="otherwise"]',
    );
    await expect(
      outerTrue.locator(':scope > ol > [data-block-id="inner"]'),
    ).toHaveCount(1);
    await expect(
      innerElse.locator(':scope > ol > [data-block-id="inner-else"]'),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-owner="outer"][data-branch="otherwise"] > ol > [data-block-id="outer-else"]',
      ),
    ).toHaveCount(1);
    await title(page, "inner-else").click();
    await expect(
      page.getByRole("textbox", {
        name: t("待機時間", "Wait duration"),
        exact: true,
      }),
    ).toHaveValue("4");
    expect(state.saved()).toEqual(expected);
    await blocks(page);
    await page.screenshot({
      path: `${artifacts}/${locale}-nested-desktop.png`,
      fullPage: true,
    });
  });

  test(`T051 T052 reordered clauses survive reload and both views while unsafe nesting stays nested (${locale}, desktop)`, async ({
    page,
  }) => {
    const third = branch("third", [wait("last-else", 4)]);
    const second = branch("second", [third]);
    const first = branch("first", [second]);
    const unsafe = branch("unsafe", [
      branch("nested-false"),
      wait("after-nested-false", 8),
    ]);
    const flow = base([first, unsafe]);
    const state = await open(page, flow, locale);
    await expect(
      page.locator(".automation-draft-heading strong"),
    ).toContainText(`${t("下書き版", "Draft revision")} 2`);
    await title(page, "first").click();
    await expect(page.locator(".automation-condition-chain li")).toHaveCount(3);
    await page
      .locator(".automation-condition-chain li")
      .nth(2)
      .getByRole("button", {
        name: t("節を上へ", "Move clause up"),
        exact: true,
      })
      .click();
    await expect(
      page.locator(".automation-draft-heading strong"),
    ).toContainText(t("未保存の変更", "Unsaved changes"));
    await save(page, state, 1);
    const snapshot = state.saved();
    const a = snapshot.body[0] as Branch,
      c = a.otherwise[0] as Branch,
      b = c.otherwise[0] as Branch;
    expect([a.id, c.id, b.id]).toEqual(["first", "third", "second"]);
    for (const node of [a, c, b]) {
      expect(node.then[0]?.id).toBe(`${node.id}-yes`);
      expect(node.unknown[0]?.id).toBe(`${node.id}-unknown`);
    }
    expect(b.otherwise).toEqual([wait("last-else", 4)]);
    expect(snapshot.body[1]).toEqual(unsafe);
    await page.reload();
    await title(page, "first").click();
    await expect(page.locator(".automation-condition-chain li")).toHaveCount(3);
    const views = page.getByRole("group", {
      name: t("同じ手順の表示方法", "View the same steps"),
      exact: true,
    });
    await views
      .getByRole("button", { name: t("手順一覧", "Steps"), exact: true })
      .click();
    await expect(page.locator(".automation-tree")).toHaveClass(/view-steps/);
    await expect(
      page
        .locator('[data-owner="first"][data-branch="otherwise"] > ol > li')
        .first(),
    ).toHaveAttribute("data-block-id", "third");
    await views
      .getByRole("button", {
        name: t("ブロックで編集", "Edit with blocks"),
        exact: true,
      })
      .click();
    await expect(page.locator(".automation-tree")).toHaveClass(/view-blocks/);
    await title(page, "unsafe").click();
    await expect(page.locator(".automation-condition-chain li")).toHaveCount(1);
    await expect(page.locator(".automation-condition-chain")).toContainText(
      t("所属を保った入れ子", "stays visibly nested to preserve ownership"),
    );
    await expect(
      page.locator('[data-owner="unsafe"][data-branch="otherwise"] > ol > li'),
    ).toHaveCount(2);
    expect(state.saved()).toEqual(snapshot);
    expect(state.saves).toHaveLength(1);
    await page
      .getByRole("textbox", {
        name: t("自動化の名前", "Automation name"),
        exact: true,
      })
      .fill("UNSAVED-MUST-NOT-ENTER-REVISION-DIFF");
    const comparison = page.locator(".automation-revision-comparison");
    await expect(comparison).toHaveCount(1);
    await comparison.locator(":scope > summary").click();
    await comparison
      .getByRole("button", {
        name: t("差分を表示", "Show changes"),
        exact: true,
      })
      .dblclick();
    const difference = comparison.locator(".automation-saved-revision-diff");
    await expect(difference).toContainText(
      t("保存済み版 2 → 保存済み版 3", "Saved revision 2 → saved revision 3"),
    );
    await expect(difference).toContainText("body.0.otherwise.0.id");
    await expect(difference).toContainText('"second"');
    await expect(difference).toContainText('"third"');
    await expect(difference).toContainText("unknown.0.id");
    await expect(difference).not.toContainText(
      "UNSAVED-MUST-NOT-ENTER-REVISION-DIFF",
    );
    await expect(comparison).toContainText(
      t(
        "未保存の変更や試運転の値は含みません",
        "Unsaved edits and trial values are excluded",
      ),
    );
    expect(state.revisionReads).toEqual([2]);
    await difference.locator("h3").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${artifacts}/${locale}-revision-diff-desktop.png`,
    });
    await page.setViewportSize({ width: 320, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await difference.locator("h3").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${artifacts}/${locale}-revision-diff-320.png`,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${artifacts}/${locale}-reloaded-clauses-desktop.png`,
      fullPage: true,
    });
  });

  test(`T069 rename changes only the display name and keeps every fixture reference stable (${locale}, desktop)`, async ({
    page,
  }) => {
    const flow = base([
      {
        id: "source",
        kind: "declare",
        variable: { id: "stable-id", name: "Before", type: "Number" },
        value: literal(2),
      },
      {
        id: "copy",
        kind: "declare",
        variable: { id: "copy-id", name: "Copy", type: "Number" },
        value: ref("stable-id"),
      },
      {
        id: "repeat",
        kind: "repeat",
        count: ref("stable-id"),
        itemVariable: { id: "iteration", name: "Iteration", type: "Number" },
        body: [
          {
            id: "nested-copy",
            kind: "declare",
            variable: { id: "nested-id", name: "Nested", type: "Number" },
            value: {
              kind: "expression",
              type: "Number",
              expression: {
                operator: "number.add",
                args: [ref("stable-id"), literal(1)],
              },
            },
          },
        ],
      },
      {
        ...branch("renamed-branch"),
        then: [
          {
            id: "branch-copy",
            kind: "declare",
            variable: {
              id: "branch-copy-id",
              name: "Branch copy",
              type: "Number",
            },
            value: ref("stable-id"),
          },
        ],
      },
    ]);
    expect(validateFlowDefinition(flow).complete).toBe(true);
    const state = await open(page, flow, locale);
    const renamed = t("変更後の数", "Renamed count");
    await title(page, "source").click();
    await page
      .getByRole("textbox", { name: t("値の名前", "Value name"), exact: true })
      .fill(renamed);
    await save(page, state, 1);
    const expected = structuredClone(flow);
    (
      expected.body[0] as Extract<Statement, { kind: "declare" }>
    ).variable.name = renamed;
    expect(state.saved()).toEqual(expected);
    expect(references(state.saved())).toEqual([
      "stable-id",
      "stable-id",
      "stable-id",
      "stable-id",
    ]);
    await page.reload();
    await title(page, "source").click();
    await expect(
      page.getByRole("textbox", {
        name: t("値の名前", "Value name"),
        exact: true,
      }),
    ).toHaveValue(renamed);
    for (const id of ["copy", "nested-copy", "branch-copy"]) {
      await title(page, id).click();
      const input = page.getByRole("combobox", {
        name: t("初期値（明示入力）", "Initial value (explicit)"),
        exact: true,
      });
      if (id === "nested-copy") {
        await expect(page.locator(".automation-details")).toContainText(
          renamed,
        );
      } else {
        await expect(input).toHaveValue("stable-id");
        await expect(input.locator('option[value="stable-id"]')).toContainText(
          renamed,
        );
      }
    }
    expect(validateFlowDefinition(state.saved()).complete).toBe(true);
  });

  test(`T080 duplicate list inspection uses the real simulator and show hide changes no contents or requests (${locale}, 320px)`, async ({
    page,
  }) => {
    const listType = { kind: "List", element: "PlainText" } as const;
    const flow = base([
      {
        id: "list-block",
        kind: "declare",
        variable: { id: "list-id", name: "Duplicate list", type: listType },
        value: { kind: "literal", type: listType, value: ["A", "A", "B"] },
      },
    ]);
    const state = await open(page, flow, locale);
    let trials = 0;
    const browserLogs: string[] = [];
    page.on("console", (message) => browserLogs.push(message.text()));
    await page.route(
      "**/api/automation/flows/scratch-acceptance/test",
      (route) => {
        trials++;
        const request = route.request().postDataJSON();
        expect(request.simulation.inspectVariables).toEqual(["list-id"]);
        expect(request.simulation.values).toEqual({});
        const definition = state.saved();
        const before = structuredClone(definition);
        const result = simulateAutomationPlan(
          compileFlowDefinition(definition),
          request.simulation,
        );
        expect(result.inspection?.values[0]?.value).toEqual(["A", "A", "B"]);
        expect(result.externalChanges).toBe(0);
        expect(result.productionRuns).toBe(0);
        expect(result.productionDraws).toBe(0);
        expect(JSON.stringify(result.steps)).not.toContain('"A"');
        expect(definition).toEqual(before);
        return route.fulfill({
          json: {
            ...state.validation(),
            ...result,
            revision: 2,
            semanticHash: "e".repeat(64),
          },
        });
      },
    );
    await page
      .locator(".automation-details > details")
      .getByText(t("変数と使用範囲", "Variables and scope"), { exact: true })
      .click();
    await page
      .getByRole("checkbox", {
        name: t(
          "Duplicate list: この試運転で値を確認",
          "Duplicate list: Inspect this trial",
        ),
        exact: true,
      })
      .check();
    await page
      .getByRole("button", {
        name: t("送信せずに試す", "Test without sending"),
        exact: true,
      })
      .click();
    const inspector = page.locator(".automation-simulation-inspector");
    await expect(inspector).toContainText(
      t("この試運転だけ", "this trial only"),
    );
    await expect(inspector.locator("pre")).toHaveCount(1);
    const shown = await inspector.locator("pre").innerText();
    expect(JSON.parse(shown)).toEqual(["A", "A", "B"]);
    await inspector
      .getByRole("button", {
        name: t("値を閉じる", "Hide values"),
        exact: true,
      })
      .click();
    await expect(inspector.locator("pre")).toHaveCount(0);
    await inspector
      .getByRole("button", {
        name: t("値を再表示", "Show values again"),
        exact: true,
      })
      .click();
    await expect(inspector.locator("pre")).toHaveText(shown);
    expect(trials).toBe(1);
    expect(state.saves).toHaveLength(0);
    expect(state.saved()).toEqual(flow);
    expect(
      browserLogs.filter((message) => /\[\s*"A"|"A"\s*,\s*"A"/.test(message)),
    ).toEqual([]);
    await page.setViewportSize({ width: 320, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await inspector.screenshot({
      path: `${artifacts}/${locale}-duplicate-list-320.png`,
    });
  });

  test(`S057 colorless typed sockets explain refusal and keyboard error links restore focus (${locale}, 320px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ forcedColors: "active" });
    const flow = base([
      {
        id: "text-source",
        kind: "declare",
        variable: { id: "wrong-type", name: "Text only", type: "PlainText" },
        value: { kind: "literal", type: "PlainText", value: "synthetic" },
      },
      {
        id: "repeat",
        kind: "repeat",
        count: literal(2),
        itemVariable: { id: "item", name: "Iteration", type: "Number" },
        body: [],
      },
      {
        id: "bounds",
        kind: "boundedLoop",
        semanticVersion: 1,
        mode: "while",
        maxBody: literal(1),
        condition: {
          kind: "literal",
          type: "ConditionResult",
          value: { state: "unknown" },
        },
        until: {
          kind: "literal",
          type: "Instant",
          value: "2026-10-16T12:00:00.000Z",
        },
        body: [],
        handlers: { conditionUnknown: [] },
      },
    ]);
    const state = await open(page, flow, locale);
    await title(page, "repeat").focus();
    await title(page, "repeat").press("ArrowDown");
    await expect(title(page, "bounds")).toBeFocused();
    await title(page, "bounds").press("Home");
    await expect(title(page, "text-source")).toBeFocused();
    await title(page, "text-source").press("End");
    await expect(title(page, "bounds")).toBeFocused();
    await expect(page.locator('[data-block-id="bounds"]')).toHaveAttribute(
      "data-shape",
      "container",
    );
    const unknown = page.locator(
      '[data-owner="bounds"][data-branch="handler:conditionUnknown"]',
    );
    await expect(unknown).toContainText(t("不明", "unknown"));
    await expect(unknown.locator(".automation-terminal-label")).toContainText(
      t("非成功", "without success"),
    );
    await title(page, "bounds").press("Enter");
    const conditionSlot = page.locator(
      '.automation-details .automation-slot[data-value-type="ConditionResult"]',
    );
    await expect(conditionSlot).toHaveClass(/is-condition/);
    await expect(
      conditionSlot.locator(".automation-socket-symbol"),
    ).toHaveClass(/is-condition/);
    await expect(conditionSlot).toContainText(
      t("不明を含む条件", "condition including unknown"),
    );
    await conditionSlot.screenshot({
      path: `${artifacts}/${locale}-condition-colorless-320.png`,
    });
    await blocks(page);
    await title(page, "repeat").press("Enter");
    const slot = page.locator(".automation-slot").filter({
      has: page.getByRole("textbox", {
        name: t("繰り返す回数", "Repeat count"),
        exact: true,
      }),
    });
    await expect(slot).toHaveClass(/is-value/);
    await expect(slot.locator(".automation-socket-symbol")).toHaveClass(
      /is-value/,
    );
    await expect(slot).toContainText(t("必要な型", "Expected type"));
    await slot
      .getByRole("button", { name: t("変数", "Variable"), exact: true })
      .click();
    const choices = page.getByRole("combobox", {
      name: t("繰り返す回数", "Repeat count"),
      exact: true,
    });
    await expect(choices.locator('option[value="wrong-type"]')).toHaveCount(0);
    await expect(page.locator(".automation-details")).toContainText(
      t(
        "この位置で使える同型の変数はありません",
        "No matching variable is available here",
      ),
    );
    await choices.press("Escape");
    await expect(
      page.locator(".automation-details .automation-slot-mode button").first(),
    ).toBeFocused();
    const input = page.getByRole("textbox", {
      name: t("繰り返す回数", "Repeat count"),
      exact: true,
    });
    await expect(input).toHaveValue("2");
    await input.fill("2.5");
    const errorLink = page.locator(".automation-problem").getByRole("button", {
      name: t(
        "表示された範囲の半角整数を入力してください。例示は入力値ではありません。",
        "Enter a whole number within the displayed range.",
      ),
      exact: true,
    });
    await expect(errorLink).toBeVisible();
    await errorLink.focus();
    await errorLink.press("Enter");
    await expect(input).toBeFocused();
    await input.press("Escape");
    await expect(
      page.locator(".automation-details .automation-slot-mode button").first(),
    ).toBeFocused();
    expect(state.saves).toHaveLength(0);
    await blocks(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${artifacts}/${locale}-colorless-keyboard-320.png`,
      fullPage: true,
    });
  });

  test(`T001 S058 examples stay missing and Undo Redo saves the AST and common metadata together (${locale}, desktop)`, async ({
    page,
  }) => {
    const repeat: Statement = {
      id: "repeat",
      kind: "repeat",
      count: { kind: "missing", type: "Number" },
      itemVariable: { id: "item", name: "Iteration", type: "Number" },
      body: [],
    };
    const state = await open(page, base([repeat]), locale);
    await title(page, "repeat").click();
    const input = page.getByRole("textbox", {
      name: t("繰り返す回数", "Repeat count"),
      exact: true,
    });
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute(
      "placeholder",
      t("例: 3（未入力）", "e.g. 3 (not entered)"),
    );
    await page
      .getByRole("textbox", {
        name: t("自動化の名前", "Automation name"),
        exact: true,
      })
      .fill("Explicitly saved incomplete synthetic draft");
    await save(page, state, 1);
    expect(
      (state.saved().body[0] as Extract<Statement, { kind: "repeat" }>).count,
    ).toEqual({ kind: "missing", type: "Number" });
    expect(state.validation().complete).toBe(false);
    expect(() => compileFlowDefinition(state.saved())).toThrow();
    await expect(
      page.locator(".automation-details .automation-unset"),
    ).toContainText(t("未設定", "Not set"));
    const enable = page.getByRole("button", {
      name: t("確認して有効にする", "Review and enable"),
      exact: true,
    });
    await expect(enable).toBeDisabled();
    let missingChecks = 0;
    await page.route(
      "**/api/automation/flows/scratch-acceptance/validate",
      (route) => {
        missingChecks++;
        const result = state.validation();
        expect(result.complete).toBe(false);
        expect(
          result.issues.some((issue) => issue.code === "MISSING_INPUT"),
        ).toBe(true);
        return route.fulfill({
          json: {
            ...result,
            revision: state.revision(),
            semanticHash: "c".repeat(64),
          },
        });
      },
    );
    await page
      .getByRole("button", {
        name: t("構造を確認", "Validate steps"),
        exact: true,
      })
      .click();
    await expect.poll(() => missingChecks).toBe(1);
    await expect(enable).toBeDisabled();
    expect(
      (state.saved().body[0] as Extract<Statement, { kind: "repeat" }>).count
        ?.kind,
    ).toBe("missing");
    await input.fill("0");
    await save(page, state, 2);
    const beforeCommon = state.saved();
    expect(state.validation().complete).toBe(true);
    await page
      .locator(".automation-palette-card")
      .filter({
        hasText: t(
          "共通の不明経路を持つ新しい条件連鎖",
          "New condition chain with a common unknown path",
        ),
      })
      .click();
    const editor = page.locator(".automation-common-editor");
    await editor
      .getByRole("combobox", {
        name: t("この節の条件", "Clause condition"),
        exact: true,
      })
      .selectOption("unknown");
    await editor
      .getByRole("button", {
        name: t("それ以外でもしを追加", "Add else if"),
        exact: true,
      })
      .click();
    await editor
      .getByRole("combobox", {
        name: t("この節の条件", "Clause condition"),
        exact: true,
      })
      .nth(1)
      .selectOption("false");
    const template = editor
      .locator("details")
      .filter({
        has: page.locator("summary", {
          hasText: t(
            "共通の不明経路のテンプレート",
            "Common unknown path template",
          ),
        }),
      })
      .last();
    await template
      .getByRole("combobox", {
        name: t("ここに手順を追加", "Add a step here"),
        exact: true,
      })
      .selectOption("wait");
    await template.locator("li > details > summary").first().click();
    await template
      .getByRole("textbox", {
        name: t("待機時間", "Wait duration"),
        exact: true,
      })
      .fill("0");
    await editor
      .getByRole("button", {
        name: t("連鎖全体を下書きへ適用", "Apply the whole chain to the draft"),
        exact: true,
      })
      .click();
    await save(page, state, 3);
    const complete = state.saved();
    expect(complete.scratchAuthoring?.chains).toHaveLength(1);
    expect(complete.body).toHaveLength(2);
    expect(state.validation().complete).toBe(true);
    await page
      .getByRole("button", { name: t("編集を戻す", "Undo edit"), exact: true })
      .click();
    await save(page, state, 4);
    expect(state.saved()).toEqual(beforeCommon);
    expect(state.saved().scratchAuthoring).toBeUndefined();
    await page
      .getByRole("button", { name: t("やり直す", "Redo edit"), exact: true })
      .click();
    await save(page, state, 5);
    expect(state.saved()).toEqual(complete);
    await page.reload();
    expect(state.saved()).toEqual(complete);
    const entryId = complete.scratchAuthoring!.chains[0]!.entryId;
    await title(page, entryId).click();
    await expect(page.locator(".automation-details")).toContainText(
      t("共通の不明経路を持つ新規連鎖", "uses a common unknown template"),
    );
    await expect(
      page.locator('[data-branch="unknown"]').getByRole("button", {
        name: t("この中に追加", "Add inside"),
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-branch="unknown"]').getByRole("button", {
        name: t("共通の不明経路を編集", "Edit the common unknown path"),
        exact: true,
      }),
    ).toHaveCount(2);
    expect(faults.get(page)).toEqual([]);
  });

  test(`saved revision comparison distinguishes unavailable permission and network states and retries only on request (${locale}, 320px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const flow = base([wait("wait")]);
    const state = await open(page, flow, locale);
    let mode: "missing" | "forbidden" | "network" | "success" = "missing",
      reads = 0;
    await page.route(
      "**/api/automation/flows/scratch-acceptance/revisions/1",
      (route) => {
        reads++;
        if (mode === "network") return route.abort("failed");
        if (mode === "success")
          return route.fulfill({
            json: { id: flow.id, revision: 1, definition: flow },
          });
        return route.fulfill({
          status: mode === "missing" ? 404 : 403,
          json: { error: "SYNTHETIC_READ_FAILURE" },
        });
      },
    );
    const comparison = page.locator(".automation-revision-comparison");
    await comparison.locator(":scope > summary").focus();
    await comparison.locator(":scope > summary").press("Enter");
    const show = comparison.getByRole("button", {
      name: t("差分を表示", "Show changes"),
      exact: true,
    });
    const cases = [
      [
        "missing",
        t(
          "指定した保存版は見つかりません",
          "The requested saved revision was not found",
        ),
      ],
      [
        "forbidden",
        t(
          "この保存版を確認する権限がありません",
          "You do not have permission to review this saved revision",
        ),
      ],
      [
        "network",
        t("差分は確認できていません", "Changes have not been verified"),
      ],
    ] as const;
    for (const [failure, copy] of cases) {
      mode = failure;
      await show.click();
      await expect(comparison.getByRole("alert")).toContainText(copy);
      await expect(
        comparison.locator(".automation-saved-revision-diff"),
      ).toHaveCount(0);
    }
    expect(reads).toBe(3);
    mode = "success";
    await show.click();
    await expect(
      comparison.locator(".automation-saved-revision-diff"),
    ).toContainText(
      t("内容に差分はありません", "The saved contents are identical"),
    );
    expect(reads).toBe(4);
    await comparison
      .getByRole("spinbutton", {
        name: t("比較元の保存版番号", "Earlier saved revision number"),
        exact: true,
      })
      .fill("2");
    await show.click();
    await expect(comparison.getByRole("alert")).toContainText(
      t("現在の保存版より前の版番号", "earlier than the current revision"),
    );
    expect(reads).toBe(4);
    expect(state.saves).toHaveLength(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await comparison.screenshot({
      path: `${artifacts}/${locale}-revision-read-error-320.png`,
    });
  });

  test(`T008 T016 T130 number help distinguishes precision floor ceiling truncate and halfway modes (${locale}, desktop)`, async ({
    page,
  }) => {
    const flow = base([
      {
        id: "precision",
        kind: "declare",
        variable: { id: "precision-value", name: "Precision", type: "Number" },
        value: {
          kind: "expression",
          type: "Number",
          expression: {
            operator: "number.add",
            args: [literal(0.1), literal(0.2)],
          },
        },
      },
    ]);
    const state = await open(page, flow, locale);
    const simulated = simulateAutomationPlan(compileFlowDefinition(flow), {
      inspectVariables: ["precision-value"],
    });
    expect(simulated.inspection?.values[0]?.value).toBe(0.30000000000000004);
    await title(page, "precision").click();
    const help = page
      .locator(".automation-details .automation-number-semantics")
      .first();
    await help.locator(":scope > summary").click();
    await expect(help).toContainText("0.1 + 0.2");
    await expect(help).toContainText("0.30000000000000004");
    await expect(help).toContainText("false");
    await expect(help).toContainText(t("floor(-1.2) = -2", "Floor(-1.2) = -2"));
    await expect(help).toContainText(t("ceil(-1.2) = -1", "Ceil(-1.2) = -1"));
    await expect(help).toContainText(
      t("truncate(-1.2) = -1", "Truncate(-1.2) = -1"),
    );
    await expect(help).toContainText(
      t("半値は0から遠い方", "Halfway away from zero"),
    );
    await expect(help).toContainText("-1.5 → -2");
    await expect(help).toContainText("-0.5 → -1");
    await expect(help).toContainText(
      t(
        "半値は大きい方（Scratch方式）",
        "Halfway toward positive infinity (Scratch style)",
      ),
    );
    await expect(help).toContainText("-1.5 → -1");
    await expect(help).toContainText("-0.5 → 0");
    await help.screenshot({
      path: `${artifacts}/${locale}-number-help-desktop.png`,
    });
    expect(state.saves).toHaveLength(0);
  });

  test(`T128 S044 text help distinguishes scalar contains from grapheme find on a combining accent (${locale}, 320px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const args: ValueInput[] = [
      { kind: "literal", type: "PlainText", value: "e\u0301" },
      { kind: "literal", type: "PlainText", value: "\u0301" },
    ];
    const flow = base([
      {
        id: "contains",
        kind: "declare",
        variable: {
          id: "contains-value",
          name: "Contains accent",
          type: "Boolean",
        },
        value: {
          kind: "expression",
          type: "Boolean",
          expression: { operator: "text.contains", args },
        },
      },
      {
        id: "find",
        kind: "searchBranch",
        value: {
          kind: "expression",
          type: { kind: "Record", schemaId: "nexus.index-result.v1" },
          expression: { operator: "text.find", args },
        },
        index: { id: "found-index", name: "Found index", type: "Number" },
        found: [wait("wrong-found")],
        notFound: [wait("expected-not-found")],
      },
    ]);
    const state = await open(page, flow, locale);
    const simulation = simulateAutomationPlan(compileFlowDefinition(flow), {
      inspectVariables: ["contains-value"],
    });
    expect(simulation.inspection?.values[0]?.value).toBe(true);
    expect(
      simulation.steps.some((step) => step.blockId === "expected-not-found"),
    ).toBe(true);
    expect(
      simulation.steps.some((step) => step.blockId === "wrong-found"),
    ).toBe(false);
    await title(page, "contains").click();
    const help = page.locator(".automation-text-semantics");
    await help.locator(":scope > summary").focus();
    await help.locator(":scope > summary").press("Enter");
    await expect(help).toContainText("Unicode 16.0");
    await expect(help).toContainText("EGC");
    await expect(help).toContainText("scalar");
    await expect(help).toContainText(t("結合アクセント", "combining accent"));
    await expect(help).toContainText("true");
    await expect(help).toContainText("not_found");
    await expect(help).toContainText(
      t(
        "連結後は文字のまとまりを数え直します",
        "Joined text is segmented again",
      ),
    );
    await help.screenshot({
      path: `${artifacts}/${locale}-unicode-help-320.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(state.saved()).toEqual(flow);
    expect(state.saves).toHaveLength(0);
  });

  test(`T131 rounding mode edits require a new saved revision and all three reviews (${locale}, desktop)`, async ({
    page,
  }) => {
    const flow = base([
      {
        id: "round",
        kind: "declare",
        variable: { id: "rounded", name: "Rounded number", type: "Number" },
        value: {
          kind: "expression",
          type: "Number",
          expression: {
            operator: "number.roundInteger",
            args: [literal(-1.5)],
            options: { roundingMode: "tiesTowardPositiveInfinity" },
          },
        },
      },
    ]);
    const oldPlan = compileFlowDefinition(flow);
    const oldSnapshot = structuredClone(oldPlan.definition);
    const state = await open(page, flow, locale);
    const reviews: { kind: string; revision: number }[] = [];
    for (const kind of ["validate", "test", "impact"] as const)
      await page.route(
        `**/api/automation/flows/${flow.id}/${kind}`,
        (route) => {
          const request = route.request().postDataJSON();
          expect(request.revision).toBe(state.revision());
          reviews.push({ kind, revision: request.revision });
          const definition = state.saved();
          const checked = validateFlowDefinition(definition);
          const common = {
            valid: checked.valid,
            complete: checked.complete,
            issues: checked.issues,
            revision: request.revision,
            semanticHash: String(request.revision).repeat(64),
          };
          return route.fulfill({
            json:
              kind === "test"
                ? {
                    ...common,
                    ...simulateAutomationPlan(
                      compileFlowDefinition(definition),
                      request.simulation,
                    ),
                  }
                : kind === "impact"
                  ? {
                      ...common,
                      plannedActions: [],
                      waits: [],
                      retentionDays: 7,
                      runDeadlineDays: 7,
                      productionAvailable: true,
                      capacityMeasured: true,
                    }
                  : common,
          });
        },
      );
    const review = async () => {
      for (const [ja, en] of [
        ["構造を確認", "Validate steps"],
        ["送信せずに試す", "Test without sending"],
        ["影響を確認", "Review impact"],
      ])
        await page
          .getByRole("button", { name: t(ja!, en!), exact: true })
          .click();
    };
    const enable = page.getByRole("button", {
      name: t("確認して有効にする", "Review and enable"),
      exact: true,
    });
    await review();
    await expect(enable).toBeEnabled();
    await title(page, "round").click();
    const choice = page.getByRole("combobox", {
      name: t("初期値（明示入力）", "Initial value (explicit)"),
      exact: true,
    });
    await choice.selectOption({
      label: t(
        "整数へ丸める（半値は0から遠い方） · Number",
        "Round to an integer (halfway away from zero) · Number",
      ),
    });
    await page
      .getByRole("textbox", { name: t("数値", "Number"), exact: true })
      .fill("-1.5");
    await expect(enable).toBeDisabled();
    await save(page, state, 1);
    expect(state.revision()).toBe(3);
    await expect(enable).toBeDisabled();
    const changed = state.saved().body[0] as Extract<
      Statement,
      { kind: "declare" }
    >;
    expect(
      changed.value.kind === "expression" &&
        changed.value.expression.options?.roundingMode,
    ).toBe("tiesAwayFromZero");
    expect(reviews).toEqual([
      { kind: "validate", revision: 2 },
      { kind: "test", revision: 2 },
      { kind: "impact", revision: 2 },
    ]);
    await page
      .getByRole("button", {
        name: t("構造を確認", "Validate steps"),
        exact: true,
      })
      .click();
    await expect(enable).toBeDisabled();
    await page
      .getByRole("button", {
        name: t("送信せずに試す", "Test without sending"),
        exact: true,
      })
      .click();
    await expect(enable).toBeDisabled();
    await page
      .getByRole("button", {
        name: t("影響を確認", "Review impact"),
        exact: true,
      })
      .click();
    await expect(enable).toBeEnabled();
    expect(reviews.slice(3)).toEqual([
      { kind: "validate", revision: 3 },
      { kind: "test", revision: 3 },
      { kind: "impact", revision: 3 },
    ]);
    expect(oldPlan.definition).toEqual(oldSnapshot);
    expect(
      simulateAutomationPlan(oldPlan, { inspectVariables: ["rounded"] })
        .inspection?.values[0]?.value,
    ).toBe(-1);
    expect(
      simulateAutomationPlan(compileFlowDefinition(state.saved()), {
        inspectVariables: ["rounded"],
      }).inspection?.values[0]?.value,
    ).toBe(-2);
    const incomplete = structuredClone(flow);
    const missingMode = (
      incomplete.body[0] as Extract<Statement, { kind: "declare" }>
    ).value;
    if (missingMode.kind !== "expression")
      throw new Error("FIXTURE_EXPRESSION_REQUIRED");
    delete missingMode.expression.options;
    const checked = validateFlowDefinition(incomplete);
    expect(checked.valid && checked.complete).toBe(false);
    await open(page, incomplete, locale);
    await expect(enable).toBeDisabled();
    await title(page, "round").click();
    const help = page.locator(".automation-number-semantics").first();
    await help.locator(":scope > summary").click();
    await expect(help).toContainText(
      t("方式を明示して選びます", "Choose an explicit mode"),
    );
    await expect(help).toContainText(
      t(
        "構造の確認・送信しない試運転・影響確認をやり直します",
        "validate, test without sending and review impact again",
      ),
    );
  });

  test(`certified math cards expose all fourteen functions and retain fixed options without browser evaluation (${locale}, desktop and 320px)`, async ({
    page,
  }) => {
    const flow = base([
      {
        id: "math",
        kind: "declare",
        variable: { id: "math-value", name: "Math result", type: "Number" },
        value: { kind: "missing", type: "Number" },
      },
    ]);
    const state = await open(page, flow, locale);
    await title(page, "math").click();
    const slot = page.locator(".automation-details .automation-slot").first();
    await slot
      .getByRole("button", {
        name: t("計算ブロック", "Calculation"),
        exact: true,
      })
      .click();
    const selector = page.getByRole("combobox", {
      name: t("初期値（明示入力）", "Initial value (explicit)"),
      exact: true,
    });
    const names = [
      ["絶対値", "Absolute value"],
      ["整数へ切り下げ", "Floor"],
      ["整数へ切り上げ", "Ceiling"],
      ["平方根", "Square root"],
      ["サイン（度）", "Sine (degrees)"],
      ["コサイン（度）", "Cosine (degrees)"],
      ["タンジェント（度）", "Tangent (degrees)"],
      ["逆サイン（度）", "Arc sine (degrees)"],
      ["逆コサイン（度）", "Arc cosine (degrees)"],
      ["逆タンジェント（度）", "Arc tangent (degrees)"],
      ["自然対数", "Natural logarithm"],
      ["常用対数", "Base-10 logarithm"],
      ["eの累乗", "e to a power"],
      ["10の累乗", "10 to a power"],
    ] as const;
    for (const [ja, en] of names) {
      await expect(
        selector.locator("option").filter({ hasText: t(ja, en) }),
      ).not.toHaveCount(0);
      await selector.selectOption({ label: `${t(ja, en)} · Number` });
      await expect(
        page.getByRole("textbox", { name: t("数値", "Number"), exact: true }),
      ).toHaveValue("");
    }
    await selector.selectOption({
      label: `${t("サイン（度）", "Sine (degrees)")} · Number`,
    });
    const operand = page.getByRole("textbox", {
      name: t("数値", "Number"),
      exact: true,
    });
    await expect(operand).toHaveValue("");
    await operand.fill("30");
    await save(page, state, 1);
    const node = state.saved().body[0] as Extract<
      Statement,
      { kind: "declare" }
    >;
    expect(node.value).toEqual({
      kind: "expression",
      type: "Number",
      expression: {
        operator: "number.math",
        args: [literal(30)],
        options: { mathFunction: "sin" },
      },
    });
    expect(state.validation().complete).toBe(true);
    await page.reload();
    await title(page, "math").click();
    await expect(selector.locator("option:checked")).toContainText(
      t("サイン（度）", "Sine (degrees)"),
    );
    const help = page.locator(".automation-number-semantics").last();
    await help.locator(":scope > summary").click();
    await expect(help).toContainText("MPFR");
    await expect(help).toContainText("4 ulp");
    await expect(help).toContainText("subnormal");
    await expect(help).toContainText(
      t(
        "ブラウザの近似値では代用しません",
        "browser approximations are not substituted",
      ),
    );
    await help.screenshot({
      path: `${artifacts}/${locale}-math-engine-desktop.png`,
    });
    await page.setViewportSize({ width: 320, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await help.screenshot({
      path: `${artifacts}/${locale}-math-engine-320.png`,
    });
    await blocks(page);
    await page
      .getByRole("button", {
        name: t("部品を探す", "Find blocks"),
        exact: true,
      })
      .click();
    const rules = page
      .locator("details")
      .filter({
        has: page.locator("summary", {
          hasText: t("数学関数の計算規則", "Math calculation rules"),
        }),
      })
      .last();
    await rules.locator(":scope > summary").click();
    await expect(rules.locator("li")).toHaveCount(14);
    await expect(rules).not.toContainText(
      t("検証待ち", "Awaiting verification"),
    );
    await expect(rules).toContainText(
      t(
        "逆三角関数の出力は度数",
        "inverse-trigonometric outputs are in degrees",
      ),
    );
    expect(state.saves).toHaveLength(1);
  });

  test(`T054 joins reject Number and ChannelRef inputs and explain explicit text re-entry (${locale}, desktop)`, async ({
    page,
  }) => {
    for (const badType of ["Number", "ChannelRef"] as const) {
      const invalid = base([
        {
          id: "number-source",
          kind: "declare",
          variable: { id: "number-id", name: "Number source", type: "Number" },
          value: literal(3),
        },
        {
          id: "join",
          kind: "declare",
          variable: { id: "joined", name: "Joined text", type: "PlainText" },
          value: {
            kind: "expression",
            type: "PlainText",
            expression: {
              operator: "text.join",
              args: [
                {
                  kind: "variable",
                  type: badType,
                  variableId: badType === "Number" ? "number-id" : "channel-id",
                },
                { kind: "literal", type: "PlainText", value: "suffix" },
              ],
            },
          },
        },
      ]);
      invalid.trigger = {
        kind: "manual",
        inputs: [
          { id: "channel-id", name: "Channel source", type: "ChannelRef" },
        ],
      };
      expect(validateFlowDefinition(invalid).valid).toBe(false);
      const state = await open(page, invalid, locale);
      await title(page, "join").click();
      await expect(
        page.locator(".automation-details [role=alert]"),
      ).toContainText(t("PlainTextが必要", "requires PlainText"));
      await expect(
        page
          .locator(".automation-details .automation-typed-text-guidance")
          .first(),
      ).toContainText(t("文章を明示入力", "Enter the text explicitly"));
      await expect(
        page.getByRole("button", {
          name: t("下書きを保存", "Save draft"),
          exact: true,
        }),
      ).toBeDisabled();
      const root = page.locator(".automation-details .automation-slot").first();
      await root
        .getByRole("combobox", {
          name: t("初期値（明示入力）", "Initial value (explicit)"),
          exact: true,
        })
        .selectOption({
          label: `${t("文字をつなぐ", "Join text")} · PlainText`,
        });
      const first = root.locator(".automation-slot").first();
      await first
        .getByRole("button", { name: t("変数", "Variable"), exact: true })
        .click();
      const candidates = first.getByRole("combobox", {
        name: t("文字", "Text"),
        exact: true,
      });
      await expect(candidates.locator('option[value="number-id"]')).toHaveCount(
        0,
      );
      await expect(
        candidates.locator('option[value="channel-id"]'),
      ).toHaveCount(0);
      await first
        .getByRole("button", { name: t("固定値", "Fixed value"), exact: true })
        .click();
      const texts = root.getByRole("textbox", {
        name: t("文字", "Text"),
        exact: true,
      });
      await texts.nth(0).fill("Explicit text");
      await texts.nth(1).fill(" suffix");
      await save(page, state, 1);
      const valid = state.saved().body[1] as Extract<
        Statement,
        { kind: "declare" }
      >;
      expect(
        valid.value.kind === "expression" &&
          valid.value.expression.args.every((arg) => arg.type === "PlainText"),
      ).toBe(true);
      expect(state.validation().complete).toBe(true);
      expect(state.rejectedCodes).toEqual([]);
      await page.reload();
      await title(page, "join").click();
      await expect(texts.nth(0)).toHaveValue("Explicit text");
    }
  });

  test(`S034 state values have no generic comparison cards and point to their typed branches (${locale}, desktop)`, async ({
    page,
  }) => {
    for (const type of [
      { kind: "Optional", value: "Number" },
      "ConditionResult",
      { kind: "OperationOutcome", value: "Number" },
    ] as const satisfies readonly ValueType[]) {
      const flow = base([
        {
          id: "compare",
          kind: "declare",
          variable: { id: "comparison", name: "Comparison", type: "Boolean" },
          value: {
            kind: "expression",
            type: "Boolean",
            expression: {
              operator: "compare.equal",
              args: [
                { kind: "variable", type, variableId: "state-input" },
                { kind: "variable", type, variableId: "state-input" },
              ],
            },
          },
        },
      ]);
      flow.trigger = {
        kind: "manual",
        inputs: [{ id: "state-input", name: "State input", type }],
      };
      expect(validateFlowDefinition(flow).valid).toBe(false);
      const state = await open(page, flow, locale);
      await title(page, "compare").click();
      await expect(
        page.locator(".automation-details [role=alert]"),
      ).toContainText(
        t("汎用比較できません", "cannot use generic comparisons"),
      );
      const guidance = page
        .locator(".automation-state-comparison-guidance")
        .first();
      await expect(guidance).toContainText(
        t("値があるときとないときで分ける", "Branch on an optional value"),
      );
      await expect(guidance).toContainText(
        t("成立・不成立・不明", "true, false and unknown"),
      );
      await expect(guidance).toContainText(
        t("読み取り・操作の結果で分ける", "Branch on a typed result"),
      );
      const selector = page.getByRole("combobox", {
        name: t("初期値（明示入力）", "Initial value (explicit)"),
        exact: true,
      });
      const comparisons = await selector
        .locator("option")
        .filter({ hasText: t("値が等しい", "Values are equal") })
        .allTextContents();
      expect(comparisons.length).toBeGreaterThan(0);
      expect(
        comparisons.every(
          (name) =>
            !/(Optional|ConditionResult|OperationOutcome|ParseResult)/.test(
              name,
            ),
        ),
      ).toBe(true);
      await expect(selector.locator("option:checked")).toContainText(
        t("型を確認", "Review the saved value block type"),
      );
      await expect(
        page.getByRole("button", {
          name: t("下書きを保存", "Save draft"),
          exact: true,
        }),
      ).toBeDisabled();
      expect(state.saves).toHaveLength(0);
      expect(state.saved()).toEqual(flow);
    }
  });

  test(`T065 malformed surrogates stay diagnosed through editing loading and rejected API save round trips (${locale}, desktop)`, async ({
    page,
  }) => {
    const flow = base([
      {
        id: "text",
        kind: "declare",
        variable: { id: "text-id", name: "Text", type: "PlainText" },
        value: {
          kind: "literal",
          type: "PlainText",
          value: "Original valid text",
        },
      },
    ]);
    const state = await open(page, flow, locale);
    await title(page, "text").click();
    const field = page.getByRole("textbox", {
      name: t("初期値（明示入力）", "Initial value (explicit)"),
      exact: true,
    });
    await field.evaluate((element) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(element, String.fromCharCode(0xd800));
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(
      page.locator(".automation-details [role=alert]"),
    ).toContainText(t("不正なサロゲート", "unpaired surrogate"));
    await expect(
      page.locator(".automation-details [role=alert]"),
    ).toContainText(
      t(
        "置換文字へ自動では変更しません",
        "not automatically changed to a replacement character",
      ),
    );
    expect(
      await field.evaluate((element) =>
        (element as HTMLTextAreaElement).value.charCodeAt(0),
      ),
    ).toBe(0xd800);
    await expect(
      page.getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      }),
    ).toBeDisabled();
    expect(state.saves).toHaveLength(0);
    const malformed = structuredClone(flow);
    (malformed.body[0] as Extract<Statement, { kind: "declare" }>).value = {
      kind: "literal",
      type: "PlainText",
      value: String.fromCharCode(0xd800),
    };
    const response = await page.evaluate(async (serialized) => {
      const definition = JSON.parse(serialized);
      const response = await fetch(
        `/api/automation/flows/${definition.id}/draft`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            definition,
            expectedRevision: 2,
            requestId: "11111111-2222-4333-8444-555555555555",
          }),
        },
      );
      return { status: response.status, body: await response.json() };
    }, JSON.stringify(malformed));
    expect(response.status).toBe(400);
    expect(response.body.codes).toContain("InvalidUnicodeScalarText");
    expect(state.rejectedCodes).toHaveLength(1);
    expect(state.saved()).toEqual(flow);
    await page.reload();
    await title(page, "text").click();
    await expect(field).toHaveValue("Original valid text");
    const loaded = await open(page, malformed, locale);
    await title(page, "text").click();
    await expect(
      page.locator(".automation-details [role=alert]"),
    ).toContainText(t("不正なサロゲート", "unpaired surrogate"));
    expect(
      await field.evaluate((element) =>
        (element as HTMLTextAreaElement).value.charCodeAt(0),
      ),
    ).toBe(0xd800);
    await expect(
      page.getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      }),
    ).toBeDisabled();
    await field.fill("A😀e\u0301");
    await save(page, loaded, 1);
    const saved = loaded.saved().body[0] as Extract<
      Statement,
      { kind: "declare" }
    >;
    expect(saved.value).toEqual({
      kind: "literal",
      type: "PlainText",
      value: "A😀e\u0301",
    });
    await page.reload();
    await title(page, "text").click();
    await expect(field).toHaveValue("A😀e\u0301");
    await expect(page.locator(".automation-details [role=alert]")).toHaveCount(
      0,
    );
  });

  test(`T079 numeric positions refuse magic words and last cards separate optional empty from strict failure (${locale}, desktop)`, async ({
    page,
  }) => {
    const listType = { kind: "List", element: "Number" } as const;
    const source: Statement = {
      id: "list-source",
      kind: "declare",
      variable: { id: "list-id", name: "Numbers", type: listType },
      value: { kind: "literal", type: listType, value: [1, 2] },
    };
    const flow = base([
      source,
      {
        id: "item",
        kind: "declare",
        variable: { id: "last-value", name: "Selected item", type: "Number" },
        value: {
          kind: "expression",
          type: "Number",
          expression: {
            operator: "list.item",
            args: [
              { kind: "variable", type: listType, variableId: "list-id" },
              literal(1),
            ],
          },
        },
      },
    ]);
    const state = await open(page, flow, locale);
    await title(page, "item").click();
    const position = page.getByRole("textbox", {
      name: t("位置（1 始まり）", "Position (starts at 1)"),
      exact: true,
    });
    const guidance = page.locator(".automation-list-position-guidance").first();
    for (const word of ["random", "last", "all"]) {
      await position.fill(word);
      await expect(position).toHaveValue(word);
      await expect(position).toHaveAttribute("aria-invalid", "true");
      await expect(
        page.getByRole("button", {
          name: t("下書きを保存", "Save draft"),
          exact: true,
        }),
      ).toBeDisabled();
      await expect(guidance).toContainText(
        t("文字は入力できません", "not valid numbers"),
      );
    }
    await expect(guidance).toContainText(
      t(
        "抽選ブロックで一度確定した数値",
        "number fixed once by the random-draw block",
      ),
    );
    await expect(guidance).toContainText(
      t("一覧を空にした値", "Create a cleared list"),
    );
    expect(state.saves).toHaveLength(0);
    const selector = page.getByRole("combobox", {
      name: t("初期値（明示入力）", "Initial value (explicit)"),
      exact: true,
    });
    await selector.selectOption({
      label: `${t("最後の項目（空ならエラー）", "Last item (empty means error)")} · List<Number>`,
    });
    await expect(position).toHaveCount(0);
    const operand = page
      .locator(".automation-details .automation-slot")
      .first()
      .locator(".automation-slot")
      .first();
    await operand
      .getByRole("button", { name: t("変数", "Variable"), exact: true })
      .click();
    await operand
      .getByRole("combobox", { name: t("一覧", "List"), exact: true })
      .selectOption("list-id");
    await save(page, state, 1);
    const strict = state.saved().body[1] as Extract<
      Statement,
      { kind: "declare" }
    >;
    expect(
      strict.value.kind === "expression" && strict.value.expression.operator,
    ).toBe("list.lastStrict");
    expect(
      strict.value.kind === "expression" && strict.value.expression.args,
    ).toHaveLength(1);
    expect(
      simulateAutomationPlan(compileFlowDefinition(state.saved()), {
        inspectVariables: ["last-value"],
      }).inspection?.values[0]?.value,
    ).toBe(2);
    const emptyStrict = state.saved();
    (emptyStrict.body[0] as Extract<Statement, { kind: "declare" }>).value = {
      kind: "literal",
      type: listType,
      value: [],
    };
    const failed = simulateAutomationPlan(compileFlowDefinition(emptyStrict));
    expect(failed.status).toBe("FAILED");
    expect(failed.steps.some((step) => step.code === "IndexError")).toBe(true);
    const optionalFlow = base([
      { ...source, value: { kind: "literal", type: listType, value: [] } },
      {
        id: "optional-last",
        kind: "optionalBranch",
        value: { kind: "missing", type: { kind: "Optional", value: "Number" } },
        output: {
          id: "present-value",
          name: "Present last item",
          type: "Number",
        },
        present: [wait("wrong-present")],
        unset: [wait("expected-empty")],
      },
    ]);
    const optionalState = await open(page, optionalFlow, locale);
    await title(page, "optional-last").click();
    const optionalRoot = page
      .locator(".automation-details .automation-slot")
      .first();
    await optionalRoot
      .getByRole("button", {
        name: t("計算ブロック", "Calculation"),
        exact: true,
      })
      .first()
      .click();
    await page
      .getByRole("combobox", {
        name: t("有無を確認する値", "Optional value to inspect"),
        exact: true,
      })
      .selectOption({
        label: `${t("最後の項目（空なら値なし）", "Last item (empty means unset)")} · List<Number>`,
      });
    const optionalOperand = optionalRoot.locator(".automation-slot").first();
    await optionalOperand
      .getByRole("button", { name: t("変数", "Variable"), exact: true })
      .click();
    await optionalOperand
      .getByRole("combobox", { name: t("一覧", "List"), exact: true })
      .selectOption("list-id");
    await save(page, optionalState, 1);
    expect(optionalState.validation().complete).toBe(true);
    const optional = (
      optionalState.saved().body[1] as Extract<
        Statement,
        { kind: "optionalBranch" }
      >
    ).value;
    expect(optional.kind === "expression" && optional.expression.operator).toBe(
      "list.lastOptional",
    );
    const empty = simulateAutomationPlan(
      compileFlowDefinition(optionalState.saved()),
    );
    expect(empty.status).toBe("COMPLETED");
    expect(empty.steps.some((step) => step.blockId === "expected-empty")).toBe(
      true,
    );
    expect(empty.steps.some((step) => step.blockId === "wrong-present")).toBe(
      false,
    );
    await page.reload();
    await title(page, "optional-last").click();
    await expect(
      page
        .getByRole("combobox", {
          name: t("有無を確認する値", "Optional value to inspect"),
          exact: true,
        })
        .locator("option:checked"),
    ).toContainText(t("空なら値なし", "empty means unset"));
    await expect(page.locator(".automation-details")).toContainText(
      t(
        "値がある経路だけで中の値を使います",
        "Only the present branch can use the contained value",
      ),
    );
  });

  test(`S021 legacy CT01 collapse expand and saves preserve the AST IDs semantic hash and unknown ownership (${locale}, desktop and 320px)`, async ({
    page,
  }) => {
    const b: Branch = {
      id: "b",
      kind: "branch",
      condition: { kind: "literal", type: "ConditionResult", value: "unknown" },
      then: [wait("b-yes")],
      otherwise: [wait("b-no")],
      unknown: [wait("b-unknown")],
    };
    const a = branch("a", [b]);
    const flow = base([a, wait("after-a")]);
    delete flow.semanticProfile;
    const baseline = compileFlowDefinition(flow),
      baselineSimulation = simulateAutomationPlan(baseline);
    expect(
      baselineSimulation.steps.some((step) => step.blockId === "b-unknown"),
    ).toBe(true);
    expect(
      baselineSimulation.steps.some((step) => step.blockId === "a-unknown"),
    ).toBe(false);
    const state = await open(page, flow, locale);
    const fold = page.locator('[data-block-id="a"] > .automation-fold-control');
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await fold.focus();
    await fold.press("Enter");
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(title(page, "b")).toBeHidden();
    await save(page, state, 1);
    expect(state.saved().body).toEqual(flow.body);
    expect(state.saved().semanticProfile).toBeUndefined();
    expect(state.saved().ui?.collapsed).toEqual(["a"]);
    expect(compileFlowDefinition(state.saved()).semanticHash).toBe(
      baseline.semanticHash,
    );
    expect(
      simulateAutomationPlan(compileFlowDefinition(state.saved())),
    ).toEqual(baselineSimulation);
    await page.reload();
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(title(page, "b")).toBeHidden();
    await title(page, "a").focus();
    await title(page, "a").press("ArrowDown");
    await expect(title(page, "after-a")).toBeFocused();
    await fold.focus();
    await fold.press("Enter");
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await expect(title(page, "b")).toBeVisible();
    await expect(
      page.locator(
        '[data-owner="b"][data-branch="unknown"] > ol > [data-block-id="b-unknown"]',
      ),
    ).toHaveCount(1);
    await save(page, state, 2);
    expect(state.saved().body).toEqual(flow.body);
    expect(state.saved().ui?.collapsed).toEqual([]);
    const current = compileFlowDefinition(state.saved());
    expect(current.semanticHash).toBe(baseline.semanticHash);
    expect(current.definition.body).toEqual(baseline.definition.body);
    expect(simulateAutomationPlan(current)).toEqual(baselineSimulation);
    await page.setViewportSize({ width: 320, height: 900 });
    await blocks(page);
    await expect(fold).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await fold.screenshot({
      path: `${artifacts}/${locale}-fold-control-320.png`,
    });
  });
}
