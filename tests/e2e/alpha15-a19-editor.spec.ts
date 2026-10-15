import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type {
  FlowDefinition,
  Statement,
} from "../../packages/automation/src/types";
import { evaluateValue } from "../../packages/automation/src/expression";
const requireHere = createRequire(import.meta.url),
  esbuild = createRequire(requireHere.resolve("tsx"))("esbuild") as {
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
  const script = result.outputFiles.find((item) =>
      item.path.endsWith(".js"),
    )!.text,
    css = result.outputFiles.find((item) => item.path.endsWith(".css"))!.text;
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await mkdir(".local/alpha15-editor", { recursive: true });
});
test.beforeEach(async ({ page }) => {
  const collected: string[] = [];
  errors.set(page, collected);
  page.on("pageerror", (error) => collected.push(error.message));
  await page.route("**/editor-fixture*", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.route("**/api/automation/overview", (route) =>
    route.fulfill({
      json: {
        runs: [],
        nextOccurrences: [],
        usage: {
          limit: 100,
          reserved: 0,
          consumed: 0,
          compensated: 0,
          remaining: 100,
          updatedAt: "2026-10-15T00:00:00Z",
        },
        status: "AVAILABLE",
      },
    }),
  );
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page) ?? []).toEqual([]);
});
const base = (body: Statement[]): FlowDefinition => ({
  schemaVersion: 1,
  id: "a19",
  guildId: "321111111111111111",
  name: "Approved editor",
  trigger: { kind: "manual", inputs: [] },
  variables: [],
  targets: {
    channelIds: ["621111111111111111"],
    roleIds: ["721111111111111111"],
    parentCategoryIds: [],
  },
  body,
});
async function open(page: Page, flow: FlowDefinition, locale: "ja" | "en") {
  let current = flow,
    revision = 2;
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
  await page.route("**/api/automation/flows/a19", (route) =>
    route.fulfill({ json: detail() }),
  );
  await page.route("**/api/automation/flows/a19/draft", (route) => {
    current = route.request().postDataJSON().definition;
    revision++;
    return route.fulfill({ json: detail() });
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/editor-fixture?locale=${locale}&flow=a19`);
  await expect(
    page.getByRole("textbox", {
      name: locale === "ja" ? "自動化の名前" : "Automation name",
      exact: true,
    }),
  ).toHaveValue(flow.name);
  return () => current;
}
for (const locale of ["ja", "en"] as const) {
  const t = (ja: string, en: string) => (locale === "ja" ? ja : en);
  test(`strict parsing and optional zero retain typed branches after save and reload (${locale})`, async ({
    page,
  }) => {
    const flow = base([
      {
        id: "parse",
        kind: "resultBranch",
        value: {
          kind: "expression",
          type: { kind: "ParseResult", value: "Number" },
          expression: {
            operator: "value.parse",
            args: [{ kind: "literal", type: "PlainText", value: "12.5" }],
            options: { conversion: "decimal" },
          },
        },
        output: { id: "parsed", name: "Parsed number", type: "Number" },
        reason: { id: "parse-reason", name: "Safe reason", type: "PlainText" },
        succeeded: [
          {
            id: "copy",
            kind: "declare",
            variable: { id: "copy-value", name: "Copy", type: "Number" },
            value: { kind: "variable", type: "Number", variableId: "parsed" },
          },
        ],
        failed: [],
        notStarted: [],
        unknown: [],
      },
      {
        id: "optional",
        kind: "optionalBranch",
        value: { kind: "missing", type: { kind: "Optional", value: "Number" } },
        output: { id: "present", name: "Present number", type: "Number" },
        present: [],
        unset: [],
      },
    ]);
    const saved = await open(page, flow, locale);
    await page
      .locator(".automation-block-title")
      .filter({
        hasText: t("読み取り・操作の結果で分ける", "Branch on a typed result"),
      })
      .click();
    await page.locator(".automation-result-branch textarea").fill("12.75");
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(() => JSON.stringify(saved().body[0])).toContain("12.75");
    const parsed = saved().body[0];
    if (parsed?.kind !== "resultBranch") throw Error("RESULT");
    expect(
      evaluateValue(parsed.value, { guildId: flow.guildId, variables: {} })
        .value,
    ).toEqual({ state: "SUCCEEDED", value: 12.75 });
    await page
      .getByRole("button", { name: t("手順", "Steps"), exact: true })
      .first()
      .click();
    await page
      .locator(".automation-block-title")
      .filter({
        hasText: t(
          "値があるときとないときで分ける",
          "Branch on an optional value",
        ),
      })
      .click();
    await page
      .getByRole("combobox", {
        name: t("値の有無を明示", "Explicit presence"),
        exact: true,
      })
      .selectOption("set");
    await page
      .getByRole("textbox", {
        name: t("中の値", "Contained value"),
        exact: true,
      })
      .fill("0");
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect
      .poll(() => {
        const item = saved().body[1];
        return item?.kind === "optionalBranch" && item.value.kind;
      })
      .toBe("literal");
    const optional = saved().body[1];
    if (optional?.kind !== "optionalBranch") throw Error("OPTIONAL");
    expect(optional.value).toEqual({
      kind: "literal",
      type: { kind: "Optional", value: "Number" },
      value: { state: "set", value: 0 },
    });
    await page.reload();
    await page
      .locator(".automation-block-title")
      .filter({
        hasText: t(
          "値があるときとないときで分ける",
          "Branch on an optional value",
        ),
      })
      .click();
    await expect(
      page.getByRole("combobox", {
        name: t("値の有無を明示", "Explicit presence"),
        exact: true,
      }),
    ).toHaveValue("set");
    await expect(
      page.getByRole("textbox", {
        name: t("中の値", "Contained value"),
        exact: true,
      }),
    ).toHaveValue("0");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/alpha15-editor/${locale}-a19-optional-320.png`,
      fullPage: true,
    });
  });
  test(`fixed mappings keep keys literal, reject duplicates and require an explicit fallback (${locale})`, async ({
    page,
  }) => {
    const flow = base([
      {
        id: "map",
        kind: "declare",
        variable: { id: "mapped", name: "Mapped", type: "PlainText" },
        value: {
          kind: "expression",
          type: "PlainText",
          expression: {
            operator: "value.lookup",
            args: [
              { kind: "missing", type: "PlainText" },
              { kind: "missing", type: { kind: "List", element: "PlainText" } },
              { kind: "missing", type: "PlainText" },
            ],
          },
        },
      },
    ]);
    const saved = await open(page, flow, locale);
    await page.locator(".automation-block-title").click();
    const panel = page.locator(".automation-fixed-lookup");
    await panel
      .getByRole("textbox", {
        name: t("対応を調べるキー", "Key to look up"),
        exact: true,
      })
      .fill("yes");
    await panel
      .getByRole("textbox", {
        name: t(
          "一致するキーがないときの値",
          "Explicit value when no key matches",
        ),
        exact: true,
      })
      .fill("No matching row");
    await panel
      .getByRole("button", {
        name: t("対応行を追加", "Add a mapping row"),
        exact: true,
      })
      .click();
    await panel
      .getByRole("textbox", {
        name: t("固定の対応キー", "Fixed mapping key"),
        exact: true,
      })
      .fill("yes");
    await panel
      .getByRole("textbox", {
        name: t("このキーに対応する値", "Value for this key"),
        exact: true,
      })
      .fill("Found");
    await panel
      .getByRole("button", {
        name: t("対応行を追加", "Add a mapping row"),
        exact: true,
      })
      .click();
    await panel
      .getByRole("textbox", {
        name: t("固定の対応キー", "Fixed mapping key"),
        exact: true,
      })
      .last()
      .fill("yes");
    await panel
      .getByRole("textbox", {
        name: t("このキーに対応する値", "Value for this key"),
        exact: true,
      })
      .last()
      .fill("Other");
    await expect(
      page.getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      }),
    ).toBeDisabled();
    await panel
      .getByRole("textbox", {
        name: t("固定の対応キー", "Fixed mapping key"),
        exact: true,
      })
      .last()
      .fill("no");
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(() => JSON.stringify(saved().body[0])).toContain("Found");
    const node = saved().body[0];
    if (node?.kind !== "declare" || node.value.kind !== "expression")
      throw Error("MAP");
    expect(node.value.expression.args[1]).toEqual({
      kind: "literal",
      type: { kind: "List", element: "PlainText" },
      value: ["yes", "no"],
    });
    expect(
      evaluateValue(node.value, { guildId: flow.guildId, variables: {} }).value,
    ).toBe("Found");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/alpha15-editor/${locale}-a19-mapping-320.png`,
      fullPage: true,
    });
  });
  test(`formal role approval and named iteration results keep explicit trial outcomes (${locale})`, async ({
    page,
  }) => {
    const flow = base([
      {
        id: "approval",
        kind: "approval",
        actionId: "",
        until: { kind: "missing", type: "Instant" },
        approved: [],
        rejected: [],
        expired: [],
      },
      {
        id: "role",
        kind: "action",
        operation: "discord.addRole",
        approvalRequired: true,
        inputs: {
          member: { kind: "variable", type: "MemberRef", variableId: "person" },
          role: {
            kind: "literal",
            type: "RoleRef",
            value: { id: "721111111111111111", guildId: "321111111111111111" },
          },
        },
      },
      {
        id: "repeat",
        kind: "repeat",
        count: { kind: "literal", type: "Number", value: 2 },
        itemVariable: {
          id: "iteration",
          name: "Current iteration",
          type: "Number",
        },
        body: [],
      },
    ]);
    flow.trigger = {
      kind: "manual",
      inputs: [{ id: "person", name: "Person", type: "MemberRef" }],
    };
    const saved = await open(page, flow, locale);
    await page
      .locator(".automation-block-title")
      .filter({
        hasText: t(
          "後続のロール操作の正式な承認を待つ",
          "Await formal approval for a later role action",
        ),
      })
      .click();
    await page
      .getByRole("combobox", {
        name: t(
          "正式な承認が必要な後続のロール操作",
          "Later role action requiring formal approval",
        ),
        exact: true,
      })
      .selectOption("role");
    await page
      .getByLabel(t("承認を待つ期限（UTC）", "Approval deadline (UTC)"), {
        exact: true,
      })
      .fill("2026-10-16T10:00");
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect
      .poll(() => {
        const item = saved().body[0];
        return item?.kind === "approval" && item.actionId;
      })
      .toBe("role");
    await page
      .getByRole("button", { name: t("手順", "Steps"), exact: true })
      .first()
      .click();
    await page
      .locator(".automation-block-title")
      .filter({ hasText: t("決まった回数繰り返す", "Repeat a count") })
      .click();
    await page
      .getByRole("button", {
        name: t("各回の名前付き結果を追加", "Add a named iteration result"),
        exact: true,
      })
      .click();
    const result = page
      .locator(".automation-repeat-results .automation-slot")
      .last();
    await result
      .getByRole("button", { name: t("変数", "Variable"), exact: true })
      .click();
    await result.locator("select").selectOption("iteration");
    await page
      .getByRole("button", {
        name: t("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect
      .poll(() => {
        const item = saved().body[2];
        return item?.kind === "repeat" && item.results?.length;
      })
      .toBe(1);
    const repeat = saved().body[2];
    if (repeat?.kind !== "repeat") throw Error("REPEAT");
    expect(repeat.results?.[0]?.value).toEqual({
      kind: "variable",
      type: "Number",
      variableId: "iteration",
    });
    let simulation: Record<string, unknown> | undefined;
    await page.route("**/api/automation/flows/a19/test", (route) => {
      simulation = route.request().postDataJSON().simulation;
      return route.fulfill({
        json: {
          revision: 4,
          semanticHash: "a".repeat(64),
          valid: true,
          complete: true,
          issues: [],
          mode: "SIMULATION",
          status: "UNDETERMINED",
          externalChanges: 0,
          productionRuns: 0,
          approvalConsumption: 0,
          steps: [],
        },
      });
    });
    await page
      .getByText(
        t("試運転だけで使う模擬入力", "Mock inputs used only for simulation"),
        { exact: true },
      )
      .click();
    await expect(
      page.getByRole("combobox", {
        name: t("模擬する正式承認の結果", "Mock formal approval result"),
        exact: true,
      }),
    ).toHaveValue("");
    await page
      .getByRole("combobox", {
        name: t("模擬する正式承認の結果", "Mock formal approval result"),
        exact: true,
      })
      .selectOption("APPROVED");
    await page
      .getByRole("button", {
        name: t("送信せずに試す", "Test without sending"),
        exact: true,
      })
      .click();
    await expect
      .poll(() => simulation?.approvals)
      .toEqual({ approval: "APPROVED" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/alpha15-editor/${locale}-a19-loop-approval-320.png`,
      fullPage: true,
    });
  });
}

test("captured operation outcomes create an adjacent typed consumer and synthetic reference mocks stay outside definitions", async ({
  page,
}) => {
  const flow = base([
    {
      id: "send",
      kind: "action",
      operation: "discord.sendMessage",
      inputs: {
        channel: {
          kind: "literal",
          type: "ChannelRef",
          value: { id: "621111111111111111", guildId: "321111111111111111" },
        },
        content: {
          kind: "literal",
          type: "PlainText",
          value: "Synthetic only",
        },
      },
    },
  ]);
  const saved = await open(page, flow, "en");
  await page.locator(".automation-block-title").click();
  await page
    .getByRole("button", {
      name: "Capture the typed outcome and add its branches",
      exact: true,
    })
    .click();
  await expect(page.locator(".automation-block-title")).toHaveCount(2);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => saved().body.length).toBe(2);
  const action = saved().body[0],
    branch = saved().body[1];
  if (action?.kind !== "action" || branch?.kind !== "resultBranch")
    throw Error("OUTCOME");
  expect(action.outcome?.type).toEqual({
    kind: "OperationOutcome",
    value: "MessageRef",
  });
  expect(branch.value).toMatchObject({
    kind: "variable",
    variableId: action.outcome?.id,
  });
  let simulation:
    | { outputs?: Record<string, { value: { id: string; guildId: string } }> }
    | undefined;
  await page.route("**/api/automation/flows/a19/test", (route) => {
    simulation = route.request().postDataJSON().simulation;
    return route.fulfill({
      json: {
        revision: 3,
        semanticHash: "a".repeat(64),
        valid: true,
        complete: true,
        issues: [],
        mode: "SIMULATION",
        status: "COMPLETED",
        externalChanges: 0,
        productionRuns: 0,
        approvalConsumption: 0,
        steps: [],
      },
    });
  });
  await page
    .getByText("Mock inputs used only for simulation", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Mock outcome", exact: true })
    .selectOption("SUCCEEDED");
  await page
    .getByRole("button", {
      name: "Use a synthetic MessageRef reference",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Test without sending", exact: true })
    .click();
  await expect.poll(() => Boolean(simulation)).toBe(true);
  expect(simulation?.outputs?.send?.value.id).toMatch(/^\d{18}$/);
  expect(simulation?.outputs?.send?.value.guildId).toBe(flow.guildId);
  expect(JSON.stringify(saved())).not.toContain(
    simulation!.outputs!.send!.value.id,
  );
});

test("iteration evidence separates all six states and renders no payload or operation identity", async ({
  page,
}) => {
  const flow = base([]),
    states = [
      "SUCCEEDED",
      "FAILED",
      "NOT_STARTED",
      "SKIPPED",
      "CANCELLED",
      "UNKNOWN",
    ];
  await page.route("**/api/automation/overview", (route) =>
    route.fulfill({
      json: {
        runs: [
          {
            id: "loop-run",
            flowId: flow.id,
            state: "UNKNOWN",
            startedAt: "2026-10-15T00:00:00Z",
            endedAt: "2026-10-15T00:10:00Z",
            dueAt: null,
          },
        ],
        nextOccurrences: [],
        usage: {
          limit: 100,
          reserved: 0,
          consumed: 1,
          compensated: 0,
          remaining: 99,
          updatedAt: "2026-10-15T00:00:00Z",
        },
        status: "AVAILABLE",
      },
    }),
  );
  await page.route("**/api/automation/runs/loop-run", (route) =>
    route.fulfill({
      json: {
        id: "loop-run",
        flowId: flow.id,
        revision: 2,
        state: "UNKNOWN",
        startedAt: "2026-10-15T00:00:00Z",
        endedAt: "2026-10-15T00:10:00Z",
        dueAt: null,
        reason: null,
        events: [],
        iterations: [
          {
            blockId: "repeat",
            identity: "INTERNAL_IDENTITY_DO_NOT_RENDER",
            states,
            counts: Object.fromEntries(states.map((state) => [state, 1])),
            payload: "PAYLOAD_DO_NOT_RENDER",
          },
        ],
      },
    }),
  );
  await open(page, flow, "en");
  await page
    .getByRole("button", {
      name: "Load branch states and run details",
      exact: true,
    })
    .click();
  const summary = page.locator(".automation-iteration-summary");
  for (const name of [
    "Confirmed success",
    "Confirmed failure",
    "Not started",
    "Skipped",
    "Cancelled",
    "Unknown",
  ])
    await expect(summary).toContainText(name);
  await summary
    .getByText("Verified state of each iteration", { exact: true })
    .click();
  await expect(summary.locator("ol > li")).toHaveCount(6);
  await expect(page.locator("body")).not.toContainText("PAYLOAD_DO_NOT_RENDER");
  await expect(page.locator("body")).not.toContainText(
    "INTERNAL_IDENTITY_DO_NOT_RENDER",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("generic registered record mocks remain incomplete until all typed fields are explicitly supplied", async ({
  page,
}) => {
  const flow = base([]);
  flow.trigger = {
    kind: "manual",
    inputs: [
      {
        id: "pair",
        name: "Pair input",
        type: { kind: "Record", schemaId: "nexus.pair.Number.PlainText.v1" },
      },
    ],
  };
  let simulation:
    { values?: Record<string, { type: unknown; value: unknown }> } | undefined;
  await page.route("**/api/automation/flows/a19/test", (route) => {
    simulation = route.request().postDataJSON().simulation;
    return route.fulfill({
      json: {
        revision: 2,
        semanticHash: "a".repeat(64),
        valid: true,
        complete: true,
        issues: [],
        mode: "SIMULATION",
        status: "COMPLETED",
        externalChanges: 0,
        productionRuns: 0,
        approvalConsumption: 0,
        steps: [],
      },
    });
  });
  await open(page, flow, "en");
  await page
    .getByText("Mock inputs used only for simulation", { exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Mock first value", exact: true })
    .fill("0");
  await page
    .getByRole("button", { name: "Test without sending", exact: true })
    .click();
  await expect.poll(() => Boolean(simulation)).toBe(true);
  expect(simulation?.values?.pair).toBeUndefined();
  await page
    .getByRole("textbox", { name: "Mock second value", exact: true })
    .fill("Explicit text");
  simulation = undefined;
  await page
    .getByRole("button", { name: "Test without sending", exact: true })
    .click();
  await expect
    .poll(() => simulation?.values?.pair)
    .toEqual({
      type: { kind: "Record", schemaId: "nexus.pair.Number.PlainText.v1" },
      value: { first: 0, second: "Explicit text" },
    });
});

test("unverified schedule times stay explicit and do not leak into a new blank draft", async ({
  page,
}) => {
  const flow = base([]);
  await open(page, flow, "en");
  await page.route("**/api/automation/flows/a19", (route) =>
    route.fulfill({
      json: {
        id: flow.id,
        name: flow.name,
        definition: flow,
        draftRevision: 2,
        activeRevision: 2,
        state: "ACTIVE",
        validation: { valid: true, complete: true, issues: [] },
        scheduleReview: {
          required: true,
          reason: "TIME_ZONE_MEANING_UNAVAILABLE",
        },
      },
    }),
  );
  await page.reload();
  await expect(
    page.getByText("Review schedule times and explicitly enable again", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(".automation-notice")
      .filter({ hasText: "could not be verified under current rules" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create a blank draft", exact: true })
    .click();
  await expect(
    page.getByText("Review schedule times and explicitly enable again", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Automation name", exact: true }),
  ).toHaveValue("New automation");
});

test("saved unsupported fixed-reference mapping keys roundtrip unchanged while result values remain editable", async ({
  page,
}) => {
  const fixedKeys = {
    kind: "literal" as const,
    type: { kind: "List" as const, element: "MemberRef" as const },
    value: [{ id: "421111111111111111", guildId: "321111111111111111" }],
  };
  const flow = base([
    {
      id: "member-map",
      kind: "declare",
      variable: { id: "mapped", name: "Mapped result", type: "PlainText" },
      value: {
        kind: "expression",
        type: "PlainText",
        expression: {
          operator: "value.lookup",
          args: [
            { kind: "variable", type: "MemberRef", variableId: "person" },
            fixedKeys,
            { kind: "literal", type: "PlainText", value: "No match" },
            { kind: "literal", type: "PlainText", value: "Original" },
          ],
        },
      },
    },
  ]);
  flow.trigger = {
    kind: "manual",
    inputs: [{ id: "person", name: "Person", type: "MemberRef" }],
  };
  const saved = await open(page, flow, "en");
  await page.locator(".automation-block-title").click();
  const panel = page.locator(".automation-fixed-lookup");
  await expect(
    panel.getByText("Saved fixed reference preserved unchanged", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Add a mapping row", exact: true }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "Remove this mapping row", exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator(".automation-details .automation-expression > select").first(),
  ).toBeDisabled();
  await expect(
    page
      .locator(
        ".automation-details .automation-expression > select > option:checked",
      )
      .first(),
  ).toHaveText("Saved mapping (keys preserved unchanged)");
  await expect(page.locator("body")).not.toContainText("421111111111111111");
  await panel
    .getByRole("textbox", { name: "Value for this key", exact: true })
    .fill("Changed safely");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => JSON.stringify(saved())).toContain("Changed safely");
  const node = saved().body[0];
  if (node?.kind !== "declare" || node.value.kind !== "expression")
    throw Error("MAP");
  expect(node.value.expression.args[1]).toEqual(fixedKeys);
  await page.reload();
  await page.locator(".automation-block-title").click();
  await expect(
    page
      .locator(".automation-fixed-lookup")
      .getByText("Saved fixed reference preserved unchanged", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".automation-fixed-lookup")
      .getByRole("textbox", { name: "Value for this key", exact: true }),
  ).toHaveValue("Changed safely");
  expect(saved().body[0]).toEqual(node);
});
