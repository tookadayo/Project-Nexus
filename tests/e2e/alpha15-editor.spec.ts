import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { FlowDefinition } from "../../packages/automation/src/types";
import { evaluateValue } from "../../packages/automation/src/expression";

const requireHere = createRequire(import.meta.url);
const esbuild = createRequire(requireHere.resolve("tsx"))("esbuild") as {
  build(
    input: Record<string, unknown>,
  ): Promise<{ outputFiles: { path: string; text: string }[] }>;
};
let html = "";
const browserErrors = new WeakMap<Page, string[]>();
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
  const script = result.outputFiles.find((file) =>
      file.path.endsWith(".js"),
    )!.text,
    css = result.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await mkdir(".local/alpha15-editor", { recursive: true });
});
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/editor-fixture*", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.route("**/api/automation/flows", (route) =>
    route.fulfill({ json: { items: [] } }),
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
  expect(browserErrors.get(page) ?? []).toEqual([]);
});
for (const locale of ["ja", "en"] as const) {
  test(`typed count stays unset until explicit entry; nested steps fit 320px (${locale})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 320, height: 880 });
    await page.goto(`/editor-fixture?locale=${locale}`);
    await page.locator(".automation-block-title").first().click();
    const field = page
      .locator(".automation-details .automation-slot input")
      .first();
    await expect(field).toHaveValue("");
    await field.fill("3.1");
    await expect(
      page.locator(".automation-details [role=alert]"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: locale === "ja" ? "下書きを保存" : "Save draft",
        exact: true,
      }),
    ).toBeDisabled();
    await field.fill("0");
    await expect(field).toHaveValue("0");
    await page
      .getByRole("button", {
        name: locale === "ja" ? "手順" : "Steps",
        exact: true,
      })
      .first()
      .click();
    await page
      .getByRole("button", {
        name: locale === "ja" ? "手順一覧" : "Steps",
        exact: true,
      })
      .last()
      .click();
    await expect(page.locator(".automation-block")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/alpha15-editor/${locale}-steps-320.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: locale === "ja" ? "編集を戻す" : "Undo edit",
        exact: true,
      })
      .click();
    await page.locator(".automation-block-title").first().click();
    await expect(
      page.locator(".automation-details .automation-slot input").first(),
    ).toHaveValue("");
    expect(errors).toEqual([]);
  });
}
test("save, structural simulation and impact bind one revision; Undo never revives enable", async ({
  page,
}) => {
  let saved: FlowDefinition | undefined;
  let revision = 0;
  const writes: string[] = [];
  await page.route("**/api/automation/flows/a15-ui-flow/**", async (route) => {
    const req = route.request(),
      body = req.postDataJSON() as Record<string, unknown>;
    expect(req.headers()["x-nexus-guild"]).toBe("321111111111111111");
    if (req.url().endsWith("/draft")) {
      writes.push("save");
      saved = body.definition as FlowDefinition;
      expect(body.expectedRevision).toBe(revision);
      revision++;
      return route.fulfill({
        json: {
          id: saved.id,
          definition: saved,
          draftRevision: revision,
          activeRevision: null,
          validation: { valid: true, complete: true, issues: [] },
        },
      });
    }
    if (req.url().endsWith("/enable")) {
      writes.push("enable");
      return route.fulfill({
        json: { id: "a15-ui-flow", activeRevision: revision, state: "ACTIVE" },
      });
    }
    return route.fulfill({
      json: {
        revision,
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
        plannedActions: [],
        waits: [],
        productionAvailable: true,
        retentionDays: 7,
        runDeadlineDays: 7,
      },
    });
  });
  await page.goto("/editor-fixture?locale=en");
  await page.locator(".automation-block-title").first().click();
  await page
    .locator(".automation-details .automation-slot input")
    .first()
    .fill("3");
  await page
    .getByRole("button", { name: "Save draft", exact: true })
    .dblclick();
  await expect
    .poll(() => writes.filter((item) => item === "save").length)
    .toBe(1);
  expect(saved?.body[0]?.kind === "repeat" && saved.body[0].count).toEqual({
    kind: "literal",
    type: "Number",
    value: 3,
  });
  for (const name of [
    "Validate steps",
    "Test without sending",
    "Review impact",
  ])
    await page.getByRole("button", { name, exact: true }).click();
  const enable = page.getByRole("button", {
    name: "Review and enable",
    exact: true,
  });
  await expect(enable).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Automation name", exact: true })
    .fill("Changed name");
  await expect(enable).toBeDisabled();
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect(enable).toBeDisabled();
  expect(writes).toEqual(["save"]);
});
test("lost save response is reconciled without a repeated write and Cancel leaves draft intact", async ({
  page,
}) => {
  let writes = 0,
    requestId = "";
  await page.route("**/api/automation/flows/a15-ui-flow/draft", (route) => {
    writes++;
    requestId = route.request().postDataJSON().requestId;
    return route.abort("failed");
  });
  await page.route("**/api/automation/requests/*", (route) =>
    route.fulfill({ status: 404, json: { error: "NOT_CONFIRMED" } }),
  );
  await page.goto("/editor-fixture?locale=en");
  await page
    .getByRole("textbox", { name: "Automation name", exact: true })
    .fill("Keep this draft");
  await page
    .getByRole("button", { name: "Create a blank draft", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Automation name", exact: true }),
  ).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Check request status", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check request status", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(1);
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
});
test("permission and network failures do not become an empty success", async ({
  page,
}) => {
  await page.route("**/api/automation/flows", (route) =>
    route.fulfill({ status: 403, json: { error: "DENIED" } }),
  );
  await page.goto("/editor-fixture?locale=en&empty=1");
  await expect(page.getByRole("alert")).toContainText("permission");
  await expect(
    page.getByText("No automations yet.", { exact: false }),
  ).toHaveCount(0);
  await page.route("**/api/automation/flows", (route) => route.abort("failed"));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("could not be retrieved");
  await expect(
    page.getByRole("button", { name: "Fetch again", exact: true }),
  ).toBeVisible();
});
test("manual production and fixed role approval require confirmation, never consume during cancel or double click", async ({
  page,
}) => {
  const definition: FlowDefinition = {
    schemaVersion: 1,
    id: "ready-flow",
    guildId: "321111111111111111",
    name: "Ready synthetic flow",
    trigger: { kind: "manual", inputs: [] },
    variables: [],
    body: [{ id: "end", kind: "end" }],
  };
  const item = {
    id: definition.id,
    name: definition.name,
    draftRevision: 2,
    activeRevision: 2,
    state: "ACTIVE",
    updatedAt: "2026-10-15T00:00:00Z",
  };
  const writes: string[] = [];
  await page.route("**/api/automation/flows", (route) =>
    route.fulfill({ json: { items: [item] } }),
  );
  await page.route("**/api/automation/flows/ready-flow", (route) =>
    route.fulfill({
      json: {
        ...item,
        definition,
        validation: { valid: true, complete: true, issues: [] },
      },
    }),
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
        status: "AVAILABLE",
      },
    }),
  );
  await page.route("**/api/automation/flows/ready-flow/runs", (route) => {
    writes.push("start");
    expect(route.request().postDataJSON().values).toEqual({});
    return route.fulfill({ json: { id: "run-synthetic", state: "QUEUED" } });
  });
  await page.route("**/api/automation/approvals", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "approval-synthetic",
            runId: "run-synthetic",
            revision: 2,
            operation: "discord.addRole",
            fingerprint: "f".repeat(64),
            policyFingerprint: "p".repeat(64),
            changedChannelCount: 2,
            inputs: {
              member: { id: "821111111111111111", guildId: definition.guildId },
              role: { id: "721111111111111111", guildId: definition.guildId },
            },
            expiresAt: "2026-10-16T00:00:00Z",
          },
        ],
      },
    }),
  );
  await page.route(
    "**/api/automation/approvals/approval-synthetic",
    (route) => {
      writes.push("approve");
      const data = route.request().postDataJSON();
      expect(data.decision).toBe("APPROVE");
      expect(data.fingerprint).toBe("f".repeat(64));
      expect(data.policyFingerprint).toBe("p".repeat(64));
      return route.fulfill({ json: { state: "APPROVED" } });
    },
  );
  await page.goto("/editor-fixture?locale=en&empty=1");
  await page
    .getByRole("combobox", { name: "Saved automations", exact: true })
    .selectOption("ready-flow");
  await page.getByText("Manual production run", { exact: true }).click();
  await page
    .getByRole("button", { name: "Review and start production", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("one execution");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(writes).toEqual([]);
  await page
    .getByRole("button", { name: "Review and start production", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start production", exact: true })
    .dblclick();
  await expect.poll(() => writes.length).toBe(1);
  await page.getByText("Pending formal approvals", { exact: true }).click();
  await page
    .getByRole("button", { name: "Load pending approvals", exact: true })
    .click();
  await expect(page.locator(".automation-run-panel")).toContainText(
    "Participant",
  );
  await page
    .getByRole("button", { name: "Review and approve", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Fixed revision 2");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save approval", exact: true })
    .dblclick();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes).toEqual(["start", "approve"]);
});
test("unresolved mock outcomes block enable and production starts after an uncertain request are not repeated", async ({
  page,
}) => {
  let saved: FlowDefinition | undefined;
  let starts = 0;
  await page.route("**/api/automation/flows/a15-ui-flow/**", (route) => {
    const req = route.request();
    if (req.url().endsWith("/draft")) {
      saved = req.postDataJSON().definition as FlowDefinition;
      return route.fulfill({
        json: {
          id: saved.id,
          definition: saved,
          draftRevision: 1,
          validation: { valid: true, complete: true, issues: [] },
        },
      });
    }
    return route.fulfill({
      json: {
        revision: 1,
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
        plannedActions: [],
        waits: [],
      },
    });
  });
  await page.goto("/editor-fixture?locale=en");
  await page
    .getByRole("textbox", { name: "Automation name", exact: true })
    .fill("Unconfirmed mocks");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  for (const name of [
    "Validate steps",
    "Test without sending",
    "Review impact",
  ])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review and enable", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".automation-review")).toContainText(
    "Undetermined input or outcome",
  );
  const detail = {
    id: "ready-flow",
    name: "Ready synthetic flow",
    draftRevision: 2,
    activeRevision: 2,
    state: "ACTIVE",
    definition: {
      ...saved!,
      id: "ready-flow",
      trigger: { kind: "manual", inputs: [] },
      body: [],
    },
    validation: { valid: true, complete: true, issues: [] },
  };
  await page.route("**/api/automation/flows", (route) =>
    route.fulfill({ json: { items: [detail] } }),
  );
  await page.route("**/api/automation/flows/ready-flow", (route) =>
    route.fulfill({ json: detail }),
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
        status: "AVAILABLE",
      },
    }),
  );
  await page.route("**/api/automation/flows/ready-flow/runs", (route) => {
    starts++;
    return route.abort("failed");
  });
  await page.route("**/api/automation/requests/*", (route) =>
    route.fulfill({ status: 404, json: { error: "UNCONFIRMED" } }),
  );
  await page.goto("/editor-fixture?locale=en&empty=1");
  await page
    .getByRole("combobox", { name: "Saved automations", exact: true })
    .selectOption("ready-flow");
  await page.getByText("Manual production run", { exact: true }).click();
  await page
    .getByRole("button", { name: "Review and start production", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start production", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check pending request", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Review and start production",
      exact: true,
    }),
  ).toBeDisabled();
  expect(starts).toBe(1);
});
test("dashboard deep link loads the requested flow and focuses only its verified run", async ({
  page,
}) => {
  const flowId = "b4f41c25-e40d-46d4-873f-58e7a970f0fd",
    runId = "4b7f04ac-d353-4d45-bc03-6118212ff660";
  const definition: FlowDefinition = {
    schemaVersion: 1,
    id: flowId,
    guildId: "321111111111111111",
    name: "Linked synthetic flow",
    trigger: { kind: "manual", inputs: [] },
    variables: [],
    body: [],
  };
  const summary = {
    id: flowId,
    name: definition.name,
    draftRevision: 2,
    activeRevision: 2,
    state: "ACTIVE",
    updatedAt: "2026-10-15T00:00:00Z",
  };
  await page.route("**/api/automation/flows", (route) =>
    route.fulfill({ json: { items: [summary] } }),
  );
  await page.route(`**/api/automation/flows/${flowId}`, (route) =>
    route.fulfill({
      json: {
        ...summary,
        definition,
        validation: { valid: true, complete: true, issues: [] },
      },
    }),
  );
  await page.route("**/api/automation/overview", (route) =>
    route.fulfill({
      json: {
        runs: [
          {
            id: runId,
            flowId,
            state: "UNKNOWN",
            startedAt: "2026-10-15T00:00:00Z",
            endedAt: null,
            dueAt: null,
          },
        ],
        nextOccurrences: [],
        usage: {
          limit: 10,
          reserved: 0,
          consumed: 1,
          compensated: 0,
          remaining: 9,
          updatedAt: "2026-10-15T00:00:00Z",
        },
        status: "AVAILABLE",
      },
    }),
  );
  await page.goto(`/editor-fixture?locale=en&flow=${flowId}&run=${runId}`);
  await expect(
    page.getByRole("textbox", { name: "Automation name", exact: true }),
  ).toHaveValue("Linked synthetic flow");
  await expect(page.locator(`[id="automation-run-${runId}"]`)).toBeFocused();
  await expect(page.locator(`[id="automation-run-${runId}"]`)).toContainText(
    "Result unknown",
  );
});
test("view-only access can select an authorized saved draft while all mutations remain disabled", async ({
  page,
}) => {
  const definition: FlowDefinition = {
    schemaVersion: 1,
    id: "view-only-flow",
    guildId: "321111111111111111",
    name: "Viewable synthetic flow",
    trigger: { kind: "manual", inputs: [] },
    variables: [],
    body: [],
  };
  const summary = {
    id: definition.id,
    name: definition.name,
    draftRevision: 1,
    activeRevision: null,
    state: "DRAFT",
  };
  await page.route("**/api/automation/flows", (route) =>
    route.fulfill({ json: { items: [summary] } }),
  );
  await page.route("**/api/automation/flows/view-only-flow", (route) =>
    route.fulfill({
      json: {
        ...summary,
        definition,
        validation: { valid: true, complete: true, issues: [] },
      },
    }),
  );
  await page.goto("/editor-fixture?locale=en&empty=1&readonly=1");
  await page
    .getByRole("combobox", { name: "Saved automations", exact: true })
    .selectOption("view-only-flow");
  await expect(
    page.getByRole("textbox", { name: "Automation name", exact: true }),
  ).toHaveValue(definition.name);
  await expect(
    page.getByRole("textbox", { name: "Automation name", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Create a blank draft", exact: true }),
  ).toBeDisabled();
});
test("stacked container shapes and the same tree can be edited without dragging at desktop width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/editor-fixture?locale=en");
  await page
    .locator(".automation-palette-card")
    .filter({ hasText: "Branch by condition" })
    .click();
  await expect(
    page.locator(".automation-tree>.automation-stack>.automation-block"),
  ).toHaveCount(2);
  await expect(page.locator(".automation-cavity")).toHaveCount(4);
  await page
    .locator(".automation-tree>.automation-stack>.automation-block")
    .last()
    .getByRole("button", { name: "Inside previous", exact: true })
    .click();
  await expect(
    page.locator(".automation-tree>.automation-stack>.automation-block"),
  ).toHaveCount(1);
  await expect(page.locator(".automation-cavity")).toHaveCount(4);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: ".local/alpha15-editor/en-blocks-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Steps", exact: true }).last().click();
  await expect(page.locator(".automation-cavity")).toHaveCount(4);
  await page
    .locator(".automation-cavity .automation-block")
    .first()
    .getByRole("button", { name: "Out", exact: true })
    .first()
    .click();
  await expect(
    page.locator(".automation-tree>.automation-stack>.automation-block"),
  ).toHaveCount(2);
});

async function openDefinition(
  page: Page,
  definition: FlowDefinition,
  locale: "ja" | "en" = "en",
) {
  const detail = {
    id: definition.id,
    name: definition.name,
    draftRevision: 2,
    activeRevision: 2,
    state: "ACTIVE",
    definition,
    validation: { valid: true, complete: true, issues: [] },
  };
  await page.route("**/api/automation/flows", (route) =>
    route.fulfill({ json: { items: [detail] } }),
  );
  await page.route(`**/api/automation/flows/${definition.id}`, (route) =>
    route.fulfill({ json: detail }),
  );
  await page.goto(`/editor-fixture?locale=${locale}&flow=${definition.id}`);
  await expect(
    page.getByRole("textbox", {
      name: locale === "ja" ? "自動化の名前" : "Automation name",
      exact: true,
    }),
  ).toHaveValue(definition.name);
}
const bridgeFlow = (body: FlowDefinition["body"] = []): FlowDefinition => ({
  schemaVersion: 1,
  id: "bridge-flow",
  guildId: "321111111111111111",
  name: "Bridge flow",
  trigger: { kind: "manual", inputs: [] },
  variables: [],
  targets: {
    channelIds: ["621111111111111111"],
    roleIds: [],
    parentCategoryIds: [],
  },
  body,
});

for (const locale of ["ja", "en"] as const) {
  const text = (ja: string, en: string) => (locale === "ja" ? ja : en);
  test(`rounding precision survives save and reload at 320px (${locale})`, async ({
    page,
  }) => {
    const flow = bridgeFlow([
      {
        id: "rounded",
        kind: "declare",
        variable: { id: "rounded-result", name: "Rounded", type: "Number" },
        value: { kind: "missing", type: "Number" },
      },
    ]);
    let saved: FlowDefinition | undefined;
    await page.route("**/api/automation/flows/bridge-flow/draft", (route) => {
      saved = route.request().postDataJSON().definition;
      return route.fulfill({
        json: {
          id: flow.id,
          definition: saved,
          draftRevision: 3,
          state: "DRAFT",
          validation: { valid: true, complete: true, issues: [] },
        },
      });
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await openDefinition(page, flow, locale);
    await page.locator(".automation-block-title").click();
    const slot = page
      .locator(".automation-details fieldset.automation-slot")
      .first();
    await slot
      .getByRole("button", {
        name: text("計算ブロック", "Calculation"),
        exact: true,
      })
      .click();
    const expression = slot.locator(":scope > .automation-expression > select");
    const roundOption = await expression
      .locator("option")
      .evaluateAll(
        (options) =>
          (options as HTMLOptionElement[]).find((option) =>
            option.value.startsWith("number.round:"),
          )?.value,
      );
    expect(roundOption).toBeTruthy();
    await expression.selectOption(roundOption!);
    await page
      .getByRole("combobox", {
        name: text("丸める桁", "Rounding precision"),
        exact: true,
      })
      .selectOption("2");
    await slot
      .locator(
        ":scope > .automation-expression > fieldset.automation-slot input",
      )
      .fill("1.23456");
    await page
      .getByRole("button", {
        name: text("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(() => Boolean(saved)).toBe(true);
    const statement = saved!.body[0];
    if (statement?.kind !== "declare" || statement.value.kind !== "expression")
      throw Error("EXPRESSION");
    expect(statement.value.expression.options?.digits).toBe(2);
    expect(
      evaluateValue(statement.value, { guildId: flow.guildId, variables: {} })
        .value,
    ).toBe(1.23);
    await page.route("**/api/automation/flows/bridge-flow", (route) =>
      route.fulfill({
        json: {
          id: flow.id,
          name: flow.name,
          definition: saved,
          draftRevision: 3,
          activeRevision: null,
          state: "DRAFT",
          validation: { valid: true, complete: true, issues: [] },
        },
      }),
    );
    await page.reload();
    await page.locator(".automation-block-title").click();
    await expect(
      page.getByRole("combobox", {
        name: text("丸める桁", "Rounding precision"),
        exact: true,
      }),
    ).toHaveValue("2");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/alpha15-editor/${locale}-rounding-320.png`,
      fullPage: true,
    });
  });

  test(`bounded ticket reads preserve unset bounds and readonly result slots at 320px (${locale})`, async ({
    page,
  }) => {
    const flow = bridgeFlow([
      {
        id: "poll-ticket",
        kind: "poll",
        ticket: { kind: "missing", type: "TicketRef" },
        maxAttempts: { kind: "missing", type: "Number" },
        interval: { kind: "missing", type: "Duration" },
        until: { kind: "missing", type: "Instant" },
        output: {
          id: "poll-result",
          name: "Checked ticket",
          type: { kind: "Record", schemaId: "nexus.ticket.status.v1" },
        },
        condition: { kind: "missing", type: "Boolean" },
        matched: [],
        exhausted: [],
        timedOut: [],
      },
    ]);
    flow.trigger = {
      kind: "internal",
      event: "ticketCreated",
      inputs: [{ id: "event.ticket", name: "Ticket", type: "TicketRef" }],
    };
    let saved: FlowDefinition | undefined;
    await page.route("**/api/automation/flows/bridge-flow/draft", (route) => {
      saved = route.request().postDataJSON().definition;
      return route.fulfill({
        json: {
          id: flow.id,
          definition: saved,
          draftRevision: 3,
          state: "DRAFT",
          validation: { valid: true, complete: true, issues: [] },
        },
      });
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 320, height: 900 });
    await openDefinition(page, flow, locale);
    await expect(
      page.getByRole("heading", {
        name: text("最大回数に達したとき", "When attempts are exhausted"),
        exact: true,
      }),
    ).toBeVisible();
    await page.locator(".automation-block-title").click();
    const maximum = page.getByRole("textbox", {
      name: text("確認する最大回数", "Maximum read attempts"),
      exact: true,
    });
    await expect(maximum).toHaveValue("");
    await maximum.fill("0");
    await expect(
      page.getByRole("button", {
        name: text("下書きを保存", "Save draft"),
        exact: true,
      }),
    ).toBeDisabled();
    await maximum.fill("2");
    const interval = page.getByRole("textbox", {
      name: text("次の確認までの間隔", "Interval between reads"),
      exact: true,
    });
    await expect(interval).toHaveValue("");
    await interval.fill("0");
    await expect(
      page.getByRole("button", {
        name: text("下書きを保存", "Save draft"),
        exact: true,
      }),
    ).toBeDisabled();
    await interval.fill("10");
    const ticket = page
      .locator(".automation-bounded-wait > fieldset.automation-slot")
      .first();
    await ticket
      .getByRole("button", { name: text("変数", "Variable"), exact: true })
      .click();
    await ticket.locator("select").selectOption("event.ticket");
    await page
      .getByRole("textbox", {
        name: text("確認を終了する期限（UTC）", "Stop checking at (UTC)"),
        exact: true,
      })
      .count()
      .then(async (count) => {
        // datetime-local has no implicit textbox role in every browser.
        if (count)
          await page
            .getByRole("textbox", {
              name: text("確認を終了する期限（UTC）", "Stop checking at (UTC)"),
              exact: true,
            })
            .fill("2026-10-16T10:00");
        else
          await page
            .getByLabel(
              text("確認を終了する期限（UTC）", "Stop checking at (UTC)"),
              { exact: true },
            )
            .fill("2026-10-16T10:00");
      });
    const condition = page.getByRole("combobox", {
      name: text(
        "読み取り後に確かめる条件",
        "Condition checked after each read",
      ),
      exact: true,
    });
    await condition.selectOption("true");
    await page
      .getByRole("button", {
        name: text("下書きを保存", "Save draft"),
        exact: true,
      })
      .click();
    await expect.poll(() => Boolean(saved)).toBe(true);
    const statement = saved!.body[0];
    if (statement?.kind !== "poll") throw Error("POLL");
    expect(statement.ticket).toEqual({
      kind: "variable",
      type: "TicketRef",
      variableId: "event.ticket",
    });
    expect(statement.maxAttempts).toEqual({
      kind: "literal",
      type: "Number",
      value: 2,
    });
    expect(statement.interval).toEqual({
      kind: "literal",
      type: "Duration",
      value: 10,
    });
    expect(statement.until).toEqual({
      kind: "literal",
      type: "Instant",
      value: "2026-10-16T10:00:00.000Z",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/alpha15-editor/${locale}-bounded-ticket-320.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

  test(`trusted ticket update wait uses explicit states and deadline at 320px (${locale})`, async ({
    page,
  }) => {
    const flow = bridgeFlow([
      {
        id: "await-ticket",
        kind: "awaitEvent",
        event: "ticketUpdated",
        ticket: {
          kind: "variable",
          type: "TicketRef",
          variableId: "event.ticket",
        },
        states: [],
        until: { kind: "missing", type: "Instant" },
        output: {
          id: "await-result",
          name: "Matched ticket",
          type: { kind: "Record", schemaId: "nexus.ticket.status.v1" },
        },
        matched: [],
        timedOut: [],
      },
    ]);
    flow.trigger = {
      kind: "internal",
      event: "ticketCreated",
      inputs: [{ id: "event.ticket", name: "Ticket", type: "TicketRef" }],
    };
    let saved: FlowDefinition | undefined;
    await page.route("**/api/automation/flows/bridge-flow/draft", (route) => {
      saved = route.request().postDataJSON().definition;
      return route.fulfill({
        json: {
          id: flow.id,
          definition: saved,
          draftRevision: 3,
          state: "DRAFT",
          validation: { valid: true, complete: true, issues: [] },
        },
      });
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await openDefinition(page, flow, locale);
    await expect(
      page.getByRole("heading", {
        name: text(
          "同じ受付の更新が一致したとき",
          "When this ticket update matches",
        ),
        exact: true,
      }),
    ).toBeVisible();
    await page.locator(".automation-block-title").click();
    const panel = page.locator(".automation-bounded-wait");
    await expect(panel.getByRole("checkbox")).toHaveCount(6);
    await expect(
      panel.getByRole("checkbox", {
        name: text("解決済み", "Resolved"),
        exact: true,
      }),
    ).not.toBeChecked();
    await panel
      .getByRole("checkbox", {
        name: text("解決済み", "Resolved"),
        exact: true,
      })
      .check();
    await panel
      .getByRole("checkbox", {
        name: text("対応不要", "Dismissed"),
        exact: true,
      })
      .check();
    await panel
      .getByRole("checkbox", {
        name: text("対応不要", "Dismissed"),
        exact: true,
      })
      .uncheck();
    await page
      .getByLabel(text("確認を終了する期限（UTC）", "Stop checking at (UTC)"), {
        exact: true,
      })
      .fill("2026-10-16T11:00");
    await page
      .getByRole("button", {
        name: text("下書きを保存", "Save draft"),
        exact: true,
      })
      .dblclick();
    await expect.poll(() => Boolean(saved)).toBe(true);
    const statement = saved!.body[0];
    if (statement?.kind !== "awaitEvent") throw Error("AWAIT_EVENT");
    expect(statement.states).toEqual(["RESOLVED"]);
    expect(statement.until).toEqual({
      kind: "literal",
      type: "Instant",
      value: "2026-10-16T11:00:00.000Z",
    });
    expect(statement.event).toBe("ticketUpdated");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/alpha15-editor/${locale}-await-ticket-320.png`,
      fullPage: true,
    });
  });
}

for (const locale of ["ja", "en"] as const) {
  test(`registered mixed pairs use typed list slots and fit 320px (${locale})`, async ({
    page,
  }) => {
    const flow = bridgeFlow([
      {
        id: "paired",
        kind: "declare",
        variable: { id: "pairs", name: "Pairs", type: "Number" },
        value: { kind: "literal", type: "Number", value: 0 },
      },
    ]);
    let saved: FlowDefinition | undefined;
    await page.route("**/api/automation/flows/bridge-flow/draft", (route) => {
      saved = route.request().postDataJSON().definition;
      return route.fulfill({
        json: {
          id: flow.id,
          definition: saved,
          draftRevision: 3,
          state: "DRAFT",
          validation: { valid: true, complete: true, issues: [] },
        },
      });
    });
    await page.setViewportSize({ width: 320, height: 1000 });
    await openDefinition(page, flow, locale);
    await page.locator(".automation-block-title").click();
    const details = page.locator(".automation-details");
    const type = locale === "ja" ? "型" : "Type";
    await details
      .getByRole("combobox", { name: type, exact: true })
      .first()
      .selectOption("list-wrapper");
    await details
      .getByRole("combobox", { name: type, exact: true })
      .nth(1)
      .selectOption("pair-wrapper");
    await details
      .getByRole("combobox", {
        name: locale === "ja" ? "二つ目の値の種類" : "Second value type",
        exact: true,
      })
      .selectOption({label:"PlainText"});
    const slot = details.locator("fieldset.automation-slot").first();
    await slot
      .getByRole("button", {
        name: locale === "ja" ? "計算ブロック" : "Calculation",
        exact: true,
      })
      .first()
      .click();
    const selected = slot.locator(":scope > .automation-expression > select");
    await expect(selected.locator("option:checked")).toContainText(
      locale === "ja"
        ? "二つの一覧を順番で組にする"
        : "Pair two lists by position",
    );
    const inputs = slot.locator(
      ":scope > .automation-expression > fieldset.automation-slot",
    );
    await expect(inputs).toHaveCount(2);
    await expect(inputs.nth(0).locator("legend").first()).toContainText(
      "List<Number>",
    );
    await expect(inputs.nth(1).locator("legend").first()).toContainText(
      "List<PlainText>",
    );
    for (const input of [inputs.nth(0), inputs.nth(1)])
      await input
        .getByRole("button", {
          name: locale === "ja" ? "空の一覧を確定" : "Use an empty list",
          exact: true,
        })
        .click();
    await page
      .getByRole("button", {
        name: locale === "ja" ? "下書きを保存" : "Save draft",
        exact: true,
      })
      .click();
    await expect.poll(() => Boolean(saved)).toBe(true);
    const statement = saved!.body[0];
    if (statement?.kind !== "declare") throw new Error("DECLARE");
    expect(statement.variable.type).toEqual({
      kind: "List",
      element: { kind: "Record", schemaId: "nexus.pair.Number.PlainText.v1" },
    });
    expect(statement.value).toMatchObject({
      kind: "expression",
      expression: {
        operator: "list.zip",
        args: [
          {
            kind: "literal",
            type: { kind: "List", element: "Number" },
            value: [],
          },
          {
            kind: "literal",
            type: { kind: "List", element: "PlainText" },
            value: [],
          },
        ],
      },
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/alpha15-editor/${locale}-registered-pairs-320.png`,
      fullPage: true,
    });
  });
}

test("structured Legacy parts retain an explicit AST and save no mention grant or example text", async ({
  page,
}) => {
  const flow = bridgeFlow([
    {
      id: "post",
      kind: "action",
      operation: "discord.sendMessage",
      inputs: {
        channel: {
          kind: "literal",
          type: "ChannelRef",
          value: { id: "621111111111111111", guildId: "321111111111111111" },
        },
        content: { kind: "missing", type: "PlainText" },
      },
    },
  ]);
  let saved: FlowDefinition | undefined;
  await page.route("**/api/automation/flows/bridge-flow/draft", (route) => {
    saved = route.request().postDataJSON().definition;
    return route.fulfill({
      json: {
        id: flow.id,
        definition: saved,
        draftRevision: 3,
        state: "DRAFT",
        validation: { valid: true, complete: true, issues: [] },
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openDefinition(page, flow);
  await page.locator(".automation-block-title").first().click();
  await page
    .getByRole("combobox", { name: "Message authoring mode", exact: true })
    .selectOption("structured");
  await page
    .getByRole("button", { name: "Add a text part", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill("Hello *team*");
  const rootParts = page.locator(
    ".automation-message-builder > .automation-rich-parts",
  );
  await rootParts.locator(":scope > label select").selectOption("bold");
  await rootParts.locator(":scope > button").click();
  await page
    .getByRole("button", { name: "Add a text part", exact: true })
    .nth(0)
    .click();
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .nth(1)
    .fill("Ready");
  await page
    .getByRole("button", { name: "Add an embed card", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Status");
  await expect(
    page.locator(".automation-message-preview").first(),
  ).toContainText("Hello \\*team\\***Ready**");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => Boolean(saved)).toBe(true);
  const post = saved!.body[0];
  expect(post?.kind).toBe("action");
  if (post?.kind !== "action") return;
  expect(post.inputs.content).toBeUndefined();
  expect(post.inputs.messageSpec?.kind).toBe("literal");
  if (post.inputs.messageSpec?.kind === "literal")
    expect(post.inputs.messageSpec.value).toEqual({
      kind: "legacy",
      richText: [
        { kind: "text", text: "Hello *team*" },
        { kind: "bold", children: [{ kind: "text", text: "Ready" }] },
      ],
      embeds: [{ title: "Status" }],
    });
  await page.screenshot({
    path: ".local/alpha15-editor/en-message-builder.png",
    fullPage: true,
  });
});

test("parallel branch outputs bind typed parent locals and verified run states remain distinct", async ({
  page,
}) => {
  const flow = bridgeFlow([
    {
      id: "parent",
      kind: "declare",
      variable: { id: "total", name: "Total", type: "Number" },
      value: { kind: "literal", type: "Number", value: 0 },
    },
    {
      id: "parallel",
      kind: "parallel",
      branches: [
        {
          id: "a",
          name: "First branch",
          body: [],
          outputs: { result: { kind: "literal", type: "Number", value: 3 } },
        },
        { id: "b", name: "Second branch", body: [] },
      ],
    },
  ]);
  await page.route("**/api/automation/overview", (route) =>
    route.fulfill({
      json: {
        runs: [
          {
            id: "parallel-run",
            flowId: flow.id,
            state: "WAITING",
            startedAt: "2026-10-15T00:00:00Z",
            endedAt: null,
            dueAt: null,
          },
        ],
        nextOccurrences: [],
        usage: {
          limit: 10,
          consumed: 1,
          reserved: 0,
          compensated: 0,
          remaining: 9,
          updatedAt: "2026-10-15T00:00:00Z",
        },
        status: "AVAILABLE",
      },
    }),
  );
  await page.route("**/api/automation/runs/parallel-run", (route) =>
    route.fulfill({
      json: {
        id: "parallel-run",
        flowId: flow.id,
        revision: 2,
        state: "WAITING",
        startedAt: "2026-10-15T00:00:00Z",
        endedAt: null,
        dueAt: null,
        reason: null,
        events: [],
        parallel: {
          identity: "opaque",
          join: "ALL",
          branches: [
            { id: "a", state: "COMPLETED" },
            {
              id: "b",
              state: "WAITING_APPROVAL",
              parallel: {
                identity: "nested",
                join: "ALL",
                branches: [
                  { id: "c", state: "WAITING", dueAt: "2026-10-15T01:00:00Z" },
                ],
              },
            },
          ],
        },
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openDefinition(page, flow);
  await page.locator(".automation-block-title").nth(1).click();
  await page
    .getByRole("combobox", {
      name: "Parent local receiving this result",
      exact: true,
    })
    .selectOption("total");
  await expect(
    page.getByRole("combobox", {
      name: "Parent local receiving this result",
      exact: true,
    }),
  ).toHaveValue("total");
  await page
    .getByRole("button", { name: "Add a parallel branch", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add a parallel branch", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: /Branch \d name/ }),
  ).toHaveCount(3);
  await page
    .getByRole("button", {
      name: "Load branch states and run details",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".automation-parallel-status").first(),
  ).toContainText("Completed");
  await expect(
    page.locator(".automation-parallel-status").first(),
  ).toContainText("Awaiting approval");
  await expect(
    page.locator(".automation-parallel-status").first(),
  ).toContainText("Waiting");
  await expect(
    page.locator(".automation-parallel-status").first(),
  ).not.toContainText("First branch"); // Unsaved edits cannot label a different fixed revision.
});

test("manual declarations and metadata-only event mappings use stable typed IDs; rejected events have no retry", async ({
  page,
}) => {
  let saved: FlowDefinition | undefined;
  const flow = bridgeFlow();
  await page.route("**/api/automation/flows/bridge-flow/draft", (route) => {
    saved = route.request().postDataJSON().definition;
    return route.fulfill({
      json: {
        id: flow.id,
        definition: saved,
        draftRevision: 3,
        state: "DRAFT",
        validation: { valid: true, complete: true, issues: [] },
      },
    });
  });
  await page.route(
    "**/api/automation/event-receipts?flowId=bridge-flow",
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              source: "INTERNAL",
              eventId: "opaque-event",
              flowId: flow.id,
              revision: 2,
              state: "SKIPPED",
              reason: "AUTHORITY_CHANGED",
              runId: null,
              occurredAt: "2026-10-15T00:00:00Z",
            },
          ],
        },
      }),
  );
  await page.setViewportSize({ width: 320, height: 1000 });
  await openDefinition(page, flow);
  await page
    .getByRole("button", { name: "Add a typed input", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Input name", exact: true })
    .fill("How many");
  await page
    .getByRole("combobox", { name: "Input type", exact: true })
    .selectOption(JSON.stringify("Number"));
  await page
    .getByRole("combobox", { name: "Start method", exact: true })
    .selectOption("internal");
  await page.getByRole("checkbox", { name: /Ticket version/ }).check();
  await page
    .getByRole("textbox", { name: "Value display name", exact: true })
    .fill("Request version");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => saved?.trigger.kind).toBe("internal");
  if (saved?.trigger.kind === "internal")
    expect(saved.trigger.inputs).toEqual([
      { id: "event.version", name: "Request version", type: "Number" },
    ]);
  await page
    .getByText("Event admission and start results", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Load event admissions", exact: true })
    .click();
  await expect(page.locator(".automation-event-receipts")).toContainText(
    "Not started",
  );
  await expect(page.locator(".automation-event-receipts")).toContainText(
    "AUTHORITY_CHANGED",
  );
  await expect(page.locator(".automation-event-receipts button")).toHaveCount(
    1,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("typed service-result mock fields and explicit UTC clock remain simulation-only", async ({
  page,
}) => {
  const record = {
    kind: "Record" as const,
    schemaId: "nexus.ticket.status.v1",
  };
  const flow = bridgeFlow([
    {
      id: "read",
      kind: "action",
      operation: "nexus.readTicket",
      inputs: {
        ticket: {
          kind: "literal",
          type: "TicketRef",
          value: {
            id: "intake:12345678-1234-1234-1234-123456789abc",
            guildId: "321111111111111111",
          },
        },
      },
      output: { id: "state", name: "Request state and version", type: record },
    },
  ]);
  let simulation: unknown;
  await page.route("**/api/automation/flows/bridge-flow/test", (route) => {
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
  await openDefinition(page, flow);
  await page
    .getByText("Mock inputs used only for simulation", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Mock outcome", exact: true })
    .selectOption("SUCCEEDED");
  await page
    .getByRole("combobox", { name: "Mock ticket state", exact: true })
    .selectOption("SNOOZED");
  await page
    .locator("fieldset.automation-slot")
    .filter({
      has: page.locator("legend").filter({ hasText: "Mock ticket version" }),
    })
    .last()
    .locator("input")
    .fill("3");
  await page
    .getByLabel("Simulation clock (UTC, optional)", { exact: true })
    .fill("2026-10-15T10:00");
  await page
    .getByRole("button", { name: "Test without sending", exact: true })
    .click();
  await expect.poll(() => Boolean(simulation)).toBe(true);
  expect(simulation).toEqual({
    values: {},
    outputs: {
      read: { type: record, value: { state: "SNOOZED", version: 3 } },
    },
    outcomes: { read: "SUCCEEDED" },
    clock: "2026-10-15T10:00:00.000Z",
  });
});

test("typed message calculations bind a start variable without interpolating or executing it while editing", async ({
  page,
}) => {
  const flow = bridgeFlow([
    {
      id: "post",
      kind: "action",
      operation: "discord.sendMessage",
      inputs: {
        channel: {
          kind: "literal",
          type: "ChannelRef",
          value: { id: "621111111111111111", guildId: "321111111111111111" },
        },
        content: { kind: "missing", type: "PlainText" },
      },
    },
  ]);
  flow.trigger = {
    kind: "manual",
    inputs: [{ id: "notice", name: "Notice", type: "PlainText" }],
  };
  let saved: FlowDefinition | undefined;
  await page.route("**/api/automation/flows/bridge-flow/draft", (route) => {
    saved = route.request().postDataJSON().definition;
    return route.fulfill({
      json: {
        id: flow.id,
        definition: saved,
        draftRevision: 3,
        state: "DRAFT",
        validation: { valid: true, complete: true, issues: [] },
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openDefinition(page, flow);
  await page.locator(".automation-block-title").click();
  await page
    .getByRole("combobox", { name: "Message authoring mode", exact: true })
    .selectOption("structured");
  const message = page
    .locator(".automation-details fieldset.automation-slot")
    .filter({ has: page.getByText("Structured message", { exact: true }) })
    .first();
  await message
    .getByRole("button", { name: "Calculation", exact: true })
    .first()
    .click();
  const choose = async (
    select: ReturnType<Page["locator"]>,
    operator: string,
  ) => {
    const option = await select
      .locator("option")
      .evaluateAll(
        (options, op) =>
          (options as HTMLOptionElement[]).find((option) =>
            option.value.startsWith(op + ":"),
          )?.value,
        operator,
      );
    expect(option).toBeTruthy();
    await select.selectOption(option!);
  };
  await choose(
    message.locator(":scope > .automation-expression > select"),
    "message.legacy",
  );
  const args = message.locator(
    ":scope > .automation-expression > fieldset.automation-slot",
  );
  const rich = args.nth(0);
  await rich
    .getByRole("button", { name: "Calculation", exact: true })
    .first()
    .click();
  await choose(
    rich.locator(":scope > .automation-expression > select"),
    "rich.text",
  );
  const text = rich
    .locator(":scope > .automation-expression > fieldset.automation-slot")
    .first();
  await text.getByRole("button", { name: "Variable", exact: true }).click();
  await text.locator("select").selectOption("notice");
  await args
    .nth(1)
    .getByRole("button", { name: "Use an empty list", exact: true })
    .click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => Boolean(saved)).toBe(true);
  const statement = saved!.body[0];
  if (statement?.kind !== "action") throw Error("ACTION");
  const input = statement.inputs.messageSpec;
  expect(input?.kind).toBe("expression");
  if (input?.kind !== "expression") throw Error("EXPRESSION");
  expect(input.expression.operator).toBe("message.legacy");
  expect(input.expression.args[0]).toEqual({
    kind: "expression",
    type: "RichTextSpec",
    expression: {
      operator: "rich.text",
      args: [{ kind: "variable", type: "PlainText", variableId: "notice" }],
    },
  });
});

test("unverified role permission changes block approval while rejection stays available", async ({
  page,
}) => {
  await page.route("**/api/automation/approvals", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "unverified-approval",
            runId: "role-run",
            revision: 2,
            operation: "discord.addRole",
            fingerprint: "f".repeat(64),
            policyUnavailableReason: "ROLE_POLICY_UNAVAILABLE",
            inputs: {
              role: { id: "721111111111111111", guildId: "321111111111111111" },
            },
            expiresAt: "2026-10-16T00:00:00Z",
          },
        ],
      },
    }),
  );
  await openDefinition(page, bridgeFlow());
  await page.getByText("Pending formal approvals", { exact: true }).click();
  await page
    .getByRole("button", { name: "Load pending approvals", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review and approve", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Reject", exact: true }),
  ).toBeEnabled();
});

test("await simulation needs an explicit complete synthetic event and never writes it into the saved definition", async ({
  page,
}) => {
  const flow = bridgeFlow([
    {
      id: "await-ticket",
      kind: "awaitEvent",
      event: "ticketUpdated",
      ticket: {
        kind: "variable",
        type: "TicketRef",
        variableId: "event.ticket",
      },
      states: ["RESOLVED"],
      until: {
        kind: "literal",
        type: "Instant",
        value: "2026-10-16T10:00:00.000Z",
      },
      output: {
        id: "await-result",
        name: "Matched ticket",
        type: { kind: "Record", schemaId: "nexus.ticket.status.v1" },
      },
      matched: [],
      timedOut: [],
    },
  ]);
  flow.trigger = {
    kind: "internal",
    event: "ticketCreated",
    inputs: [{ id: "event.ticket", name: "Ticket", type: "TicketRef" }],
  };
  const simulations: Record<string, unknown>[] = [];
  await page.route("**/api/automation/flows/bridge-flow/test", (route) => {
    simulations.push(route.request().postDataJSON().simulation);
    return route.fulfill({
      json: {
        revision: 2,
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
  let saved: FlowDefinition | undefined;
  await page.route("**/api/automation/flows/bridge-flow/draft", (route) => {
    saved = route.request().postDataJSON().definition;
    return route.fulfill({
      json: {
        id: flow.id,
        definition: saved,
        draftRevision: 3,
        state: "DRAFT",
        validation: { valid: true, complete: true, issues: [] },
      },
    });
  });
  await openDefinition(page, flow);
  await page
    .getByText("Mock inputs used only for simulation", { exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Use a synthetic ticket reference",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Simulation clock (UTC, optional)", { exact: true })
    .fill("2026-10-15T10:00");
  const event = page.locator(".automation-await-event-mock");
  await event
    .getByRole("combobox", { name: "Mock wait result", exact: true })
    .selectOption("MATCHED");
  await page
    .getByRole("button", { name: "Test without sending", exact: true })
    .click();
  await expect.poll(() => simulations.length).toBe(1);
  expect(simulations[0]?.awaitEvents).toEqual({});
  await event
    .getByRole("combobox", { name: "Mock ticket state", exact: true })
    .selectOption("RESOLVED");
  await event
    .getByRole("textbox", { name: "Mock ticket version", exact: true })
    .fill("4");
  await event
    .getByLabel("Mock event time (UTC)", { exact: true })
    .fill("2026-10-15T10:05");
  await page
    .getByRole("button", { name: "Test without sending", exact: true })
    .click();
  await expect.poll(() => simulations.length).toBe(2);
  expect(simulations[1]?.awaitEvents).toEqual({
    "await-ticket": {
      state: "MATCHED",
      value: { state: "RESOLVED", version: 4 },
      occurredAt: "2026-10-15T10:05:00.000Z",
    },
  });
  const values = simulations[1]?.values as Record<
    string,
    { type: string; value: { id: string; guildId: string } }
  >;
  expect(values["event.ticket"]?.value.id).toMatch(/^intake:[0-9a-f-]{36}$/);
  expect(values["event.ticket"]?.value.guildId).toBe(flow.guildId);
  await page
    .getByLabel("Automation name", { exact: true })
    .fill("Changed only to save");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => Boolean(saved)).toBe(true);
  expect(saved?.trigger).toEqual(flow.trigger);
  expect(saved?.body).toEqual(flow.body);
  expect(JSON.stringify(saved)).not.toContain(values["event.ticket"]!.value.id);
});
