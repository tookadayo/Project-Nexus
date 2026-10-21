import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type {
  FlowDefinition,
  Statement,
} from "../../packages/automation/src/types";
import { validateFlowDefinition } from "../../packages/automation/src/definition";

const requireHere = createRequire(import.meta.url);
const esbuild = createRequire(requireHere.resolve("tsx"))("esbuild") as {
  build(
    input: Record<string, unknown>,
  ): Promise<{ outputFiles: { path: string; text: string }[] }>;
};
let html = "";
const errors = new WeakMap<Page, string[]>();
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
  await mkdir(".local/alpha15-scratch-ui", { recursive: true });
});
test.beforeEach(async ({ page }) => {
  const items: string[] = [];
  errors.set(page, items);
  page.on("pageerror", (error) => items.push(error.message));
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
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});
const base = (body: Statement[], scratch = true): FlowDefinition => ({
  schemaVersion: 1,
  ...(scratch ? { semanticProfile: "scratch.v1" as const } : {}),
  id: "scratch-ui",
  guildId: "321111111111111111",
  name: "Scratch synthetic flow",
  trigger: { kind: "manual", inputs: [] },
  variables: [],
  body,
});
async function open(page: Page, flow: FlowDefinition, locale: "ja" | "en") {
  let current = structuredClone(flow),
    revision = 2,
    writes = 0;
  const detail = () => ({
    id: current.id,
    name: current.name,
    definition: current,
    draftRevision: revision,
    activeRevision: null,
    state: "DRAFT",
    validation: { valid: true, complete: true, issues: [] },
  });
  await page.route("**/api/automation/flows", (route) =>
    route.fulfill({ json: { items: [detail()] } }),
  );
  await page.route("**/api/automation/flows/scratch-ui", (route) =>
    route.fulfill({ json: detail() }),
  );
  await page.route("**/api/automation/flows/scratch-ui/draft", (route) => {
    writes++;
    current = route.request().postDataJSON().definition;
    revision++;
    return route.fulfill({ json: detail() });
  });
  await page.goto(`/editor-fixture?locale=${locale}&flow=scratch-ui`);
  await expect(
    page.getByRole("textbox", {
      name: locale === "ja" ? "自動化の名前" : "Automation name",
      exact: true,
    }),
  ).toHaveValue(flow.name);
  return { saved: () => current, writes: () => writes };
}
for (const locale of ["ja", "en"] as const) {
  const t = (ja: string, en: string) => (locale === "ja" ? ja : en);
  test(`safe elif keeps separate unknown paths and stable IDs across save, reorder and undo (${locale})`, async ({
    page,
  }) => {
    const first: Extract<Statement, { kind: "branch" }> = {
      id: "first",
      kind: "branch",
      condition: { kind: "literal", type: "Boolean", value: false },
      then: [{ id: "first-yes", kind: "end" }],
      unknown: [{ id: "first-unknown", kind: "end" }],
      otherwise: [
        {
          id: "second",
          kind: "branch",
          condition: { kind: "literal", type: "Boolean", value: true },
          then: [{ id: "second-yes", kind: "end" }],
          unknown: [{ id: "second-unknown", kind: "end" }],
          otherwise: [{ id: "else", kind: "end" }],
        },
      ],
    };
    const state = await open(page, base([first], false), locale);
    await page
      .locator('[data-block-id="first"] > .automation-block-head button')
      .click();
    await expect(page.locator(".automation-condition-chain li")).toHaveCount(2);
    await expect(
      page.locator('[data-block-id="second"] > .automation-block-head'),
    ).toContainText(t("それ以外でもし", "Else if"));
    await page
      .locator(".automation-condition-chain li")
      .nth(1)
      .getByRole("button", {
        name: t("節を上へ", "Move clause up"),
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .dblclick();
    await expect.poll(state.writes).toBe(1);
    const second = state.saved().body[0] as Extract<
      Statement,
      { kind: "branch" }
    >;
    expect(second.id).toBe("second");
    expect(second.unknown[0]?.id).toBe("second-unknown");
    const moved = second.otherwise[0] as Extract<Statement, { kind: "branch" }>;
    expect(moved.id).toBe("first");
    expect(moved.unknown[0]?.id).toBe("first-unknown");
    expect(moved.otherwise[0]?.id).toBe("else");
    expect(state.saved().semanticProfile).toBeUndefined();
    await page
      .getByRole("button", { name: t("編集を戻す", "Undo edit"), exact: true })
      .click();
    await expect(
      page.locator(".automation-tree > ol > li").first(),
    ).toHaveAttribute("data-block-id", "first");
  });
  test(`bounded loop sockets, keyboard navigation, Escape and terminal paths fit a 320px screen (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const state = await open(page, base([]), locale);
    await page
      .getByRole("button", {
        name: t("部品を探す", "Find blocks"),
        exact: true,
      })
      .click();
    await page
      .locator(".automation-palette-card")
      .filter({
        hasText: t(
          "条件が成立する間、上限つきで繰り返す",
          "Repeat while true, with bounds",
        ),
      })
      .click();
    const maximum = page.getByRole("textbox", {
      name: t("本文を実行する最大回数", "Maximum body executions"),
      exact: true,
    });
    await expect(maximum).toHaveValue("");
    await maximum.fill("-1");
    await expect(
      page.locator(".automation-details [role=alert]"),
    ).toBeVisible();
    await maximum.press("Escape");
    await expect(maximum).toHaveValue("");
    await maximum.fill("2");
    await page
      .getByRole("combobox", {
        name: t("毎回確認する条件", "Condition to check each time"),
        exact: true,
      })
      .selectOption("true");
    const deadline = page.getByLabel(
      t(
        "開始時に固定する期限（必須・UTC）",
        "Deadline frozen on entry (required, UTC)",
      ),
      { exact: true },
    );
    await expect(deadline).toHaveValue("");
    await expect(
      page.getByRole("button", {
        name: t("確認して有効にする", "Review and enable"),
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(state.writes).toBe(1);
    const incomplete = validateFlowDefinition(state.saved());
    expect(incomplete.complete).toBe(false);
    expect(
      incomplete.issues.some((issue) => issue.path.includes("until")),
    ).toBe(true);
    await deadline.fill("2026-10-16T12:00");
    await page
      .getByRole("combobox", {
        name: t("毎回確認する条件", "Condition to check each time"),
        exact: true,
      })
      .selectOption("true");
    await page
      .getByRole("checkbox", {
        name: t("上限に達したとき", "When the limit is reached"),
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: t("手順", "Steps"), exact: true })
      .first()
      .click();
    await expect(
      page.locator('[data-statement-kind="boundedLoop"]'),
    ).toHaveAttribute("data-shape", "container");
    await expect(
      page.locator('[data-branch="handler:limit"] .automation-terminal-label'),
    ).toContainText(t("非成功", "without success"));
    const title = page.locator(".automation-block-title").first();
    await title.focus();
    await title.press("Home");
    await expect(title).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/alpha15-scratch-ui/${locale}-bounded-320.png`,
      fullPage: true,
    });
    await page.emulateMedia({ forcedColors: "active" });
    await expect(
      page.locator('[data-branch="handler:limit"] .automation-terminal-label'),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
  test(`common unknown template applies all copies atomically and Undo restores metadata with the tree (${locale})`, async ({
    page,
  }) => {
    const state = await open(page, base([]), locale);
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
    await expect(editor).toHaveCount(0);
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(state.writes).toBe(1);
    const saved = state.saved(),
      a = saved.body[0] as Extract<Statement, { kind: "branch" }>,
      b = a.otherwise[0] as Extract<Statement, { kind: "branch" }>;
    expect(saved.scratchAuthoring?.chains).toHaveLength(1);
    expect(a.unknown[0]?.kind).toBe("wait");
    expect(b.unknown[0]?.kind).toBe("wait");
    expect(a.unknown[0]?.id).not.toBe(b.unknown[0]?.id);
    await page
      .getByRole("button", { name: t("編集を戻す", "Undo edit"), exact: true })
      .click();
    await expect(page.locator(".automation-block")).toHaveCount(0);
    await page
      .getByRole("button", { name: t("やり直す", "Redo edit"), exact: true })
      .click();
    await expect(page.locator('[data-statement-kind="branch"]')).toHaveCount(2);
    await page.screenshot({
      path: `.local/alpha15-scratch-ui/${locale}-common-desktop.png`,
      fullPage: true,
    });
  });
  test(`legacy profile change is explicit and cancellation preserves old semantics (${locale})`, async ({
    page,
  }) => {
    const state = await open(page, base([], false), locale);
    const review = page.getByRole("button", {
      name: t(
        "新しいScratch意味版への変更を確認",
        "Review a change to Scratch semantics",
      ),
      exact: true,
    });
    await review.click();
    await expect(page.getByRole("dialog")).toContainText(t("変更前", "Before"));
    await page
      .getByRole("dialog")
      .getByRole("button", { name: t("取消", "Cancel"), exact: true })
      .click();
    await expect(review).toBeFocused();
    expect(state.saved().semanticProfile).toBeUndefined();
    expect(state.writes()).toBe(0);
    await review.click();
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name: t("変更を下書きへ適用", "Apply the change to this draft"),
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(state.writes).toBe(1);
    expect(state.saved().semanticProfile).toBe("scratch.v1");
  });
  test(`common template modal supports Tab, Cancel focus, stable copy updates and narrow screens (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const state = await open(page, base([]), locale);
    await page
      .getByRole("button", {
        name: t("部品を探す", "Find blocks"),
        exact: true,
      })
      .click();
    const source = page.locator(".automation-palette-card").filter({
      hasText: t(
        "共通の不明経路を持つ新しい条件連鎖",
        "New condition chain with a common unknown path",
      ),
    });
    await source.click();
    const dialog = page.getByRole("dialog"),
      editor = dialog.locator(".automation-common-editor");
    await expect(dialog).toBeVisible();
    const cancel = editor.getByRole("button", {
      name: t("取消して戻る", "Cancel and go back"),
      exact: true,
    });
    await cancel.focus();
    await cancel.press("Tab");
    await expect(editor.locator("button").first()).toBeFocused();
    await editor.locator("button").first().press("Shift+Tab");
    await expect(cancel).toBeFocused();
    await editor
      .getByRole("combobox", {
        name: t("この節の条件", "Clause condition"),
        exact: true,
      })
      .selectOption("unknown");
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(source).toBeFocused();
    expect(state.writes()).toBe(0);
    await source.click();
    await expect(
      editor.getByRole("combobox", {
        name: t("この節の条件", "Clause condition"),
        exact: true,
      }),
    ).toHaveValue("");
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
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(state.writes).toBe(1);
    const prior = state
      .saved()
      .scratchAuthoring!.chains[0]!.copies.map(
        (copy) => Object.values(copy.nodeIds)[0],
      );
    await page
      .getByRole("button", { name: t("手順", "Steps"), exact: true })
      .first()
      .click();
    await page.locator(".automation-block-title").first().click();
    await page
      .locator(".automation-details")
      .getByRole("button", {
        name: t("共通の不明経路を編集", "Edit the common unknown path"),
        exact: true,
      })
      .click();
    await template.locator("li > details > summary").first().click();
    await template
      .getByRole("textbox", {
        name: t("待機時間", "Wait duration"),
        exact: true,
      })
      .fill("1");
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await dialog.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: `.local/alpha15-scratch-ui/${locale}-common-modal-320.png`,
      fullPage: false,
    });
    await editor
      .getByRole("button", {
        name: t("連鎖全体を下書きへ適用", "Apply the whole chain to the draft"),
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(state.writes).toBe(2);
    expect(
      state
        .saved()
        .scratchAuthoring!.chains[0]!.copies.map(
          (copy) => Object.values(copy.nodeIds)[0],
        ),
    ).toEqual(prior);
    const first = state.saved().body[0] as Extract<
        Statement,
        { kind: "branch" }
      >,
      second = first.otherwise[0] as Extract<Statement, { kind: "branch" }>;
    for (const clause of [first, second])
      expect(
        (clause.unknown[0] as Extract<Statement, { kind: "wait" }>).duration,
      ).toEqual({ kind: "literal", type: "Duration", value: 1 });
  });
  test(`permission and failed communication stay distinct from an empty result (${locale})`, async ({
    page,
  }) => {
    await page.route("**/api/automation/flows", (route) =>
      route.fulfill({ status: 403, json: { error: "DENIED" } }),
    );
    await page.goto(`/editor-fixture?locale=${locale}&empty=1`);
    await expect(page.getByRole("alert")).toContainText(
      t("権限", "permission"),
    );
    await expect(
      page.getByText(t("自動化はまだありません", "No automations yet."), {
        exact: false,
      }),
    ).toHaveCount(0);
    await page.route("**/api/automation/flows", (route) =>
      route.abort("failed"),
    );
    await page.reload();
    await expect(page.getByRole("alert")).toContainText(
      t("取得", "could not be retrieved"),
    );
    await expect(
      page.getByRole("button", {
        name: t("再取得", "Fetch again"),
        exact: true,
      }),
    ).toBeVisible();
  });
  test(`new choices have stable domains and explicit revisions while empty examples stay unset (${locale})`, async ({
    page,
  }) => {
    const state = await open(page, base([]), locale);
    await page
      .getByRole("button", {
        name: t("型付き入力を追加", "Add a typed input"),
        exact: true,
      })
      .click();
    const picker = page.getByRole("combobox", {
      name: t("入力の種類", "Input type"),
      exact: true,
    });
    await picker.selectOption("new-choice");
    const choices = page.getByRole("textbox", {
      name: t("選択肢を一行に一つ入力", "Enter one choice per line"),
      exact: true,
    });
    await expect(choices).toHaveValue("");
    await expect(
      page.getByRole("button", {
        name: t("この選択肢を使う", "Use these choices"),
        exact: true,
      }),
    ).toBeDisabled();
    await choices.fill("OPEN\nCLOSED");
    await page
      .getByRole("button", {
        name: t("この選択肢を使う", "Use these choices"),
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(state.writes).toBe(1);
    const savedBefore = state.saved().trigger;
    const before =
      savedBefore.kind === "manual" ? savedBefore.inputs[0]!.type : undefined;
    expect(before).toMatchObject({
      kind: "Enum",
      values: ["OPEN", "CLOSED"],
      schemaRevision: 1,
    });
    expect(
      typeof before === "object" && before.kind === "Enum" && before.schemaId,
    ).toMatch(/^[a-f0-9-]{36}$/);
    await page
      .getByRole("button", {
        name: t("選択肢の次の版を作成", "Create the next choice revision"),
        exact: true,
      })
      .click();
    await choices.fill("OPEN\nCLOSED\nPAUSED");
    await page
      .getByRole("button", {
        name: t("この選択肢を使う", "Use these choices"),
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(state.writes).toBe(2);
    const savedAfter = state.saved().trigger;
    const after =
      savedAfter.kind === "manual" ? savedAfter.inputs[0]!.type : undefined;
    expect(after).toMatchObject({
      ...(before as object),
      values: ["OPEN", "CLOSED", "PAUSED"],
      schemaRevision: 2,
    });
  });
  test(`run and parallel-branch termination stay separate terminal shapes (${locale})`, async ({
    page,
  }) => {
    const state = await open(page, base([]), locale);
    for (const title of [
      t("この並列の枝を終える", "End this parallel branch"),
      t(
        "子手順と並列を含め、この実行を終える",
        "End this run, including child and parallel steps",
      ),
    ]) {
      await page
        .locator(".automation-palette-card")
        .filter({ hasText: title })
        .click();
      await expect(page.locator(".automation-details")).toContainText(
        title === t("この並列の枝を終える", "End this parallel branch")
          ? t("いちばん内側", "innermost")
          : t("新しい処理", "Stops new steps"),
      );
    }
    await expect(
      page.locator('[data-statement-kind="endBranch"]'),
    ).toHaveAttribute("data-shape", "terminal");
    await expect(
      page.locator('[data-statement-kind="endRun"]'),
    ).toHaveAttribute("data-shape", "terminal");
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(state.writes).toBe(1);
    expect(state.saved().body.map((node) => node.kind)).toEqual([
      "endBranch",
      "endRun",
    ]);
  });
  test(`trial-only variable and list inspection is opt-in and show/hide never repeats the trial (${locale})`, async ({
    page,
  }) => {
    const flow = base([
      {
        id: "count-block",
        kind: "declare",
        variable: {
          id: "count-preview",
          name: "Preview count",
          type: "Number",
        },
        value: { kind: "literal", type: "Number", value: 2 },
      },
      {
        id: "list-block",
        kind: "declare",
        variable: {
          id: "list-preview",
          name: "Preview list",
          type: { kind: "List", element: "PlainText" },
        },
        value: {
          kind: "literal",
          type: { kind: "List", element: "PlainText" },
          value: ["red", "blue"],
        },
      },
    ]);
    const state = await open(page, flow, locale);
    let trials = 0;
    await page.route("**/api/automation/flows/scratch-ui/test", (route) => {
      const request = route.request().postDataJSON();
      trials++;
      expect(request.simulation.inspectVariables).toEqual([
        "count-preview",
        "list-preview",
      ]);
      return route.fulfill({
        json: {
          revision: 2,
          semanticHash: "f".repeat(64),
          valid: true,
          complete: true,
          issues: [],
          mode: "SIMULATION",
          status: "COMPLETED",
          externalChanges: 0,
          productionRuns: 0,
          approvalConsumption: 0,
          steps: [],
          inspection: {
            mode: "SIMULATION_ONLY",
            values: [
              {
                variableId: "count-preview",
                type: "Number",
                value: 2,
                blockId: "count-block",
              },
              {
                variableId: "list-preview",
                type: { kind: "List", element: "PlainText" },
                value: ["red", "blue"],
                blockId: "list-block",
              },
              {
                variableId: "unrequested",
                type: "PlainText",
                value: "UNREQUESTED-MUST-NOT-RENDER",
                blockId: "unrequested",
              },
            ],
            unavailable: [],
          },
        },
      });
    });
    await page
      .locator(".automation-details > details")
      .getByText(t("変数と使用範囲", "Variables and scope"), { exact: true })
      .click();
    for (const name of ["Preview count", "Preview list"])
      await page
        .getByRole("checkbox", {
          name: t(
            `${name}: この試運転で値を確認`,
            `${name}: Inspect this trial`,
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
    await expect(inspector).toContainText('"red"');
    await expect(inspector).not.toContainText("UNREQUESTED-MUST-NOT-RENDER");
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
    await expect(inspector.locator("pre")).toHaveCount(2);
    await page.setViewportSize({ width: 320, height: 900 });
    await inspector.screenshot({
      path: `.local/alpha15-scratch-ui/${locale}-trial-inspector-320.png`,
    });
    expect(trials).toBe(1);
    expect(state.writes()).toBe(0);
    expect(state.saved()).toEqual(flow);
    await page
      .getByRole("textbox", {
        name: t("自動化の名前", "Automation name"),
        exact: true,
      })
      .fill("Edited after the trial");
    await expect(inspector).toHaveCount(0);
  });
  test(`Duplicate keeps an outside variable whose ID matches the source block (${locale})`, async ({
    page,
  }) => {
    const flow = base([
      {
        id: "x",
        kind: "declare",
        variable: { id: "inside", name: "Inside value", type: "Number" },
        value: { kind: "variable", type: "Number", variableId: "x" },
      },
    ]);
    flow.trigger = {
      kind: "manual",
      inputs: [{ id: "x", name: "Outside value", type: "Number" }],
    };
    expect(validateFlowDefinition(flow)).toMatchObject({
      valid: true,
      complete: true,
    });
    const state = await open(page, flow, locale);
    await page
      .locator('[data-block-id="x"] > .automation-block-actions')
      .getByRole("button", { name: t("複製", "Duplicate"), exact: true })
      .click();
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(state.writes).toBe(1);
    const cloned = state.saved().body[1] as Extract<
      Statement,
      { kind: "declare" }
    >;
    expect(cloned.id).not.toBe("x");
    expect(cloned.variable.id).not.toBe("inside");
    expect(cloned.value).toEqual({
      kind: "variable",
      type: "Number",
      variableId: "x",
    });
    expect(validateFlowDefinition(state.saved())).toMatchObject({
      valid: true,
      complete: true,
    });
  });
  test(`search positions are offered only in the found scope (${locale})`, async ({
    page,
  }) => {
    await open(
      page,
      base([
        {
          id: "search",
          kind: "searchBranch",
          value: {
            kind: "missing",
            type: { kind: "Record", schemaId: "nexus.index-result.v1" },
          },
          index: {
            id: "found-index",
            name: "Position only when found",
            type: "Number",
          },
          found: [
            {
              id: "inside-found",
              kind: "declare",
              variable: {
                id: "found-copy",
                name: "Found copy",
                type: "Number",
              },
              value: {
                kind: "variable",
                type: "Number",
                variableId: "found-index",
              },
            },
          ],
          notFound: [
            {
              id: "inside-missing",
              kind: "declare",
              variable: {
                id: "missing-copy",
                name: "Missing copy",
                type: "Number",
              },
              value: { kind: "variable", type: "Number", variableId: "" },
            },
          ],
        },
      ]),
      locale,
    );
    await page
      .locator('[data-block-id="inside-found"] > .automation-block-head button')
      .click();
    const input = page.getByRole("combobox", {
      name: t("初期値（明示入力）", "Initial value (explicit)"),
      exact: true,
    });
    await expect(input.locator('option[value="found-index"]')).toHaveCount(1);
    await page
      .locator(
        '[data-block-id="inside-missing"] > .automation-block-head button',
      )
      .click();
    await expect(input.locator('option[value="found-index"]')).toHaveCount(0);
    await expect(page.locator(".automation-details")).toContainText(
      t(
        "この位置で使える同型の変数はありません",
        "No matching variable is available here",
      ),
    );
  });
}
