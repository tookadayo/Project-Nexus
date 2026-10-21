import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { FlowDefinition } from "../../packages/automation/src/types";
import { validateFlowDefinition } from "../../packages/automation/src/definition";
import { evaluateValue } from "../../packages/automation/src/expression";

let html = "";
test.beforeAll(async () => {
  const requireHere = createRequire(import.meta.url),
    requireWeb = createRequire(resolve("apps/web/package.json"));
  const esbuild = createRequire(requireHere.resolve("tsx"))("esbuild") as {
    build(
      input: Record<string, unknown>,
    ): Promise<{ outputFiles: { path: string; text: string }[] }>;
  };
  const result = await esbuild.build({
    entryPoints: [resolve("tests/fixtures/alpha15-definition-manager.tsx")],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    outfile: "manager.js",
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
  await mkdir(".local/alpha15-definition-manager", { recursive: true });
});
test.beforeEach(async ({ page }) => {
  await page.route("**/definition-manager-fixture*", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
});
const definition = async (page: Page): Promise<FlowDefinition> =>
  JSON.parse(
    (await page.getByTestId("definition").textContent()) ?? "null",
  ) as FlowDefinition;
async function open(page: Page, query = "") {
  await page.goto(`/definition-manager-fixture${query}`);
  await page.locator(".automation-definition-manager summary").click();
}
for (const locale of ["ja", "en"] as const) {
  test(`creates a typed pure definition with lexical input at 320px (${locale})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 320, height: 900 });
    await open(page, `?locale=${locale}`);
    await page
      .getByRole("button", {
        name: locale === "ja" ? "Pure値を作る" : "Create a pure value",
        exact: true,
      })
      .click();
    const edit = page.locator(".automation-definition-edit");
    await edit
      .getByRole("textbox", {
        name: locale === "ja" ? "定義の名前" : "Definition name",
        exact: true,
      })
      .fill("Identity value");
    const inputs = edit.getByRole("group", {
      name: locale === "ja" ? "入力の引数" : "Input parameters",
      exact: true,
    });
    await inputs
      .getByRole("button", {
        name: locale === "ja" ? "型付きの項目を追加" : "Add a typed parameter",
        exact: true,
      })
      .click();
    await inputs
      .getByRole("textbox", {
        name: locale === "ja" ? "名前" : "Name",
        exact: true,
      })
      .fill("Count");
    await inputs
      .locator(".automation-type-picker select")
      .first()
      .selectOption('"Number"');
    await edit
      .locator(":scope > .automation-type-picker select")
      .first()
      .selectOption('"Number"');
    const slot = edit.locator(".automation-slot").first();
    await slot
      .getByRole("button", {
        name: locale === "ja" ? "変数" : "Variable",
        exact: true,
      })
      .click();
    await slot.getByRole("combobox").selectOption({ label: "Count · Number" });
    await edit
      .getByRole("button", {
        name:
          locale === "ja"
            ? "この版を下書きへ追加"
            : "Add this version to the draft",
        exact: true,
      })
      .dblclick();
    await expect(edit).toHaveCount(0);
    await expect(page.getByTestId("changes")).toHaveText("1");
    const next = await definition(page),
      created = next.pureDefinitions!.find(
        (item) => item.name === "Identity value",
      )!;
    expect(created.value).toMatchObject({
      kind: "variable",
      variableId: created.inputs[0]!.id,
    });
    expect(
      evaluateValue(created.value, {
        guildId: next.guildId,
        variables: {
          [created.inputs[0]!.id]: {
            type: "Number",
            value: 9,
            provenance: [{ source: "input" }],
          },
        },
        pureDefinitions: next.pureDefinitions,
      }).value,
    ).toBe(9);
    expect(validateFlowDefinition(JSON.parse(JSON.stringify(next))).valid).toBe(
      true,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/alpha15-definition-manager/${locale}-pure-320.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
test("clones a procedure revision without changing callers and opens its exact step version", async ({
  page,
}) => {
  await open(page);
  const original = await definition(page);
  await page
    .getByRole("button", { name: "Echo · v1 · Shared procedure", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Edit a new version from this revision",
      exact: true,
    })
    .click();
  await expect(page.locator(".automation-definition-diff")).toContainText(
    "Behavior, parameters and results are unchanged",
  );
  await page
    .getByRole("button", { name: "Add this version to the draft", exact: true })
    .click();
  const cloned = await definition(page);
  expect(cloned.body).toEqual(original.body);
  expect(cloned.procedures![0]).toEqual(original.procedures![0]);
  expect(cloned.procedures![1]!.inputs[0]!.id).not.toBe("echo-input");
  await expect(page.getByTestId("editing")).toHaveText("echo@2");
  await page
    .getByRole("button", { name: "Echo · v1 · Shared procedure", exact: true })
    .click();
  await page
    .getByRole("combobox", {
      name: "Explicitly switch to revision",
      exact: true,
    })
    .selectOption("2");
  await page
    .getByRole("button", { name: "Review caller update", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Update selected callers", exact: true }),
  ).toBeDisabled();
  expect((await definition(page)).body).toEqual(original.body);
  await page
    .getByRole("button", { name: "Change panel display", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the callers and changes to arguments and results.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Update selected callers", exact: true })
    .click();
  const updated = await definition(page);
  expect(updated.body[0]).toMatchObject({
    revision: 2,
    outputs: {
      [updated.procedures![1]!.outputs[0]!.id]: { id: "received-result" },
    },
  });
  expect(updated.body[1]).toEqual(original.body[1]);
  expect(updated.ui).toEqual({
    selectedId: "call-double",
    collapsed: ["call-echo"],
  });
  expect(validateFlowDefinition(updated).valid).toBe(true);
});
test("shows pure changes, keeps fixed callers through cancel and updates only after review", async ({
  page,
}) => {
  await open(page);
  const original = await definition(page);
  await page
    .getByRole("button", { name: "Double · v1 · Pure value", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Edit a new version from this revision",
      exact: true,
    })
    .click();
  const edit = page.locator(".automation-definition-edit");
  await edit
    .getByRole("button", { name: "Fixed value", exact: true })
    .first()
    .click();
  await edit.locator(".automation-slot input").first().fill("99");
  await expect(edit.locator(".automation-definition-diff")).toContainText("99");
  await edit
    .getByRole("button", { name: "Add this version to the draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Double · v1 · Pure value", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Compare with revision", exact: true })
    .selectOption("2");
  await expect(page.locator(".automation-definition-diff")).toContainText("99");
  await page
    .getByRole("combobox", {
      name: "Explicitly switch to revision",
      exact: true,
    })
    .selectOption("2");
  await page
    .getByRole("button", { name: "Review caller update", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel caller update", exact: true })
    .click();
  expect((await definition(page)).body).toEqual(original.body);
  await page
    .getByRole("button", { name: "Review caller update", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the callers and changes to arguments and results.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Update selected callers", exact: true })
    .click();
  const next = await definition(page),
    statement = next.body[1];
  if (statement?.kind !== "declare") throw new Error("Wrong fixture");
  expect(
    evaluateValue(statement.value, {
      guildId: next.guildId,
      variables: {},
      pureDefinitions: next.pureDefinitions,
    }).value,
  ).toBe(99);
  expect(next.pureDefinitions![0]).toEqual(original.pureDefinitions![0]);
  expect(validateFlowDefinition(next).valid).toBe(true);
});
test("cancel leaves the definition untouched and read-only access permits inspection only", async ({
  page,
}) => {
  await open(page);
  const before = await definition(page);
  await page
    .getByRole("button", { name: "Create a shared procedure", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Definition name", exact: true })
    .fill("Cancelled procedure");
  await page
    .getByRole("button", { name: "Cancel definition edit", exact: true })
    .click();
  expect(await definition(page)).toEqual(before);
  await expect(page.getByTestId("errors")).toHaveText("{}");
  await open(page, "?readonly=1");
  await expect(
    page.getByRole("button", {
      name: "Create a shared procedure",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Echo · v1 · Shared procedure", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Edit a new version from this revision",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Remove this unused version from the draft",
      exact: true,
    }),
  ).toBeDisabled();
});
