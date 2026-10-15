import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { FlowDefinition, ValueInput } from "../../packages/automation/src/types";

const requireHere = createRequire(import.meta.url);
const esbuild = createRequire(requireHere.resolve("tsx"))("esbuild") as {
  build(input: Record<string, unknown>): Promise<{ outputFiles: { path: string; text: string }[] }>;
};
let html = "";
test.beforeAll(async () => {
  const requireWeb = createRequire(resolve("apps/web/package.json"));
  const bundle = await esbuild.build({
    entryPoints: [resolve("tests/fixtures/alpha15-automation-editor.tsx")], bundle: true, platform: "browser", format: "iife", write: false, outfile: "temporal.js", jsx: "automatic",
    alias: { react: dirname(requireWeb.resolve("react/package.json")), "react-dom": dirname(requireWeb.resolve("react-dom/package.json")) },
  });
  const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await mkdir(".local/alpha15-temporal-ui", { recursive: true });
});
function initial(): FlowDefinition {
  return { schemaVersion: 1, id: "temporal-flow", guildId: "321111111111111111", name: "Typed temporal fixture", trigger: { kind: "manual", inputs: [] }, variables: [], body: [
    { id: "temporal-variable", kind: "declare", variable: { id: "value", name: "Date or time", type: "Number" }, value: { kind: "missing", type: "Number" } },
  ] };
}
function value(definition: FlowDefinition): ValueInput {
  const statement = definition.body[0]!;
  if (statement.kind !== "declare") throw new Error("Expected a declaration");
  return statement.value;
}
async function api(page: Page) {
  let saved = initial(), revision = 1, writes = 0;
  const detail = () => ({ id: saved.id, name: saved.name, state: "DRAFT", definition: saved, draftRevision: revision, activeRevision: null, validation: { valid: true, complete: value(saved).kind !== "missing", issues: [] } });
  await page.route("**/editor-fixture*", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.route("**/api/automation/flows", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/automation/overview", (route) => route.fulfill({ json: { runs: [], nextOccurrences: [], usage: { limit: 10, reserved: 0, consumed: 0, compensated: 0, remaining: 10, updatedAt: "2026-10-15T00:00:00Z" }, status: "CAPACITY_UNMEASURED" } }));
  await page.route("**/api/automation/flows/temporal-flow", (route) => route.fulfill({ json: detail() }));
  await page.route("**/api/automation/flows/temporal-flow/draft", (route) => {
    const body = route.request().postDataJSON() as { definition: FlowDefinition; expectedRevision: number };
    expect(body.expectedRevision).toBe(revision);
    saved = body.definition; revision++; writes++;
    return route.fulfill({ json: detail() });
  });
  return { saved: () => saved, writes: () => writes };
}
for (const locale of ["ja", "en"] as const) {
  test(`real type picker, DST selection and period boundaries survive save/reload at 320px (${locale})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const state = await api(page);
    const words = (ja: string, en: string) => locale === "ja" ? ja : en;
    const save = page.getByRole("button", { name: words("下書きを保存", "Save draft"), exact: true });
    const details = page.locator(".automation-details");
    const picker = details.locator(".automation-type-picker > label > select").first();
    const temporal = details.locator(".automation-temporal-input");
    const selectBlock = async () => {
      await page.getByRole("button", { name: words("手順", "Steps"), exact: true }).first().click();
      await page.locator(".automation-block-title").first().click();
    };
    const saveAndWait = async () => { const before = state.writes(); await save.click(); await expect.poll(state.writes).toBe(before + 1); };
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.goto(`/editor-fixture?locale=${locale}&flow=temporal-flow`);
    await selectBlock();
    await picker.selectOption(JSON.stringify("ZonedDateTimeSpec"));
    await expect(temporal.locator('input[type="date"]')).toHaveValue("");
    await expect(temporal.locator('input[type="time"]')).toHaveValue("");
    await expect(temporal.locator('input[type="text"]')).toHaveValue("");
    await saveAndWait();
    expect(value(state.saved())).toEqual({ kind: "missing", type: "ZonedDateTimeSpec" });
    await selectBlock();
    await temporal.locator('input[type="date"]').fill("2027-03-14");
    await temporal.locator('input[type="time"]').fill("02:30");
    await temporal.locator('input[type="text"]').fill("America/New_York");
    await expect(temporal.getByRole("alert")).toContainText("LOCAL_TIME_MISSING");
    await expect(save).toBeDisabled();
    await temporal.locator('input[type="date"]').fill("2027-11-07");
    await temporal.locator('input[type="time"]').fill("01:30");
    await expect(temporal.getByRole("alert")).toContainText("LOCAL_TIME_AMBIGUOUS");
    await temporal.getByRole("combobox").selectOption("later");
    await expect(temporal.locator("output")).toContainText("2027-11-07T06:30:00.000Z");
    await saveAndWait();
    expect(value(state.saved())).toMatchObject({ kind: "literal", type: "ZonedDateTimeSpec", value: { date: "2027-11-07", time: "01:30", timeZone: "America/New_York", occurrence: "later", instant: "2027-11-07T06:30:00.000Z", offset: "-05:00" } });
    await page.reload(); await selectBlock();
    await expect(temporal.getByRole("combobox")).toHaveValue("later");
    await expect(temporal.locator("output")).toContainText("-05:00");
    await page.screenshot({ path: `.local/alpha15-temporal-ui/${locale}-fold-320.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    await picker.selectOption(JSON.stringify("DateRange"));
    const dates = temporal.locator('input[type="date"]');
    await dates.nth(0).fill("2026-10-15"); await dates.nth(1).fill("2026-10-15");
    await temporal.locator('input[type="text"]').fill("Asia/Tokyo");
    await expect(temporal.locator("output")).toContainText("2026-10-14T15:00:00.000Z ≤ instant < 2026-10-15T15:00:00.000Z");
    await saveAndWait();
    expect(value(state.saved())).toMatchObject({ kind: "literal", type: "DateRange", value: { start: "2026-10-15", end: "2026-10-15", timeZone: "Asia/Tokyo", boundaryRule: "firstValidEarlier" } });
    await page.reload(); await selectBlock();
    await expect(dates.nth(0)).toHaveValue("2026-10-15");
    await expect(dates.nth(1)).toHaveValue("2026-10-15");
    await dates.nth(1).fill("2026-10-14");
    await expect(temporal.getByRole("alert")).toContainText("RANGE_REVERSED");
    await expect(save).toBeDisabled();
    await dates.nth(1).fill("2026-10-15");
    await page.screenshot({ path: `.local/alpha15-temporal-ui/${locale}-date-range-320.png`, fullPage: true });

    await picker.selectOption(JSON.stringify("InstantRange"));
    const instants = temporal.locator('input[type="datetime-local"]');
    await instants.nth(0).fill("2026-10-15T00:00");
    await instants.nth(1).fill("2026-10-15T00:00");
    await expect(temporal.getByRole("alert")).toContainText("RANGE_EMPTY");
    await instants.nth(1).fill("2026-10-16T00:01");
    await saveAndWait();
    expect(value(state.saved())).toEqual({ kind: "literal", type: "InstantRange", value: { start: "2026-10-15T00:00:00.000Z", end: "2026-10-16T00:01:00.000Z" } });
    await page.reload(); await selectBlock();
    await expect(instants.nth(1)).toHaveValue("2026-10-16T00:01");
    await expect(temporal.locator("small")).toContainText(words("終了を含みません", "end is excluded"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `.local/alpha15-temporal-ui/${locale}-instant-range-320.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
