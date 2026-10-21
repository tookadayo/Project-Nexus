import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const web = createRequire(resolve("apps/web/package.json"));
const esbuild = createRequire(createRequire(import.meta.url).resolve("tsx"))(
  "esbuild",
) as {
  build(
    input: Record<string, unknown>,
  ): Promise<{ outputFiles: { text: string }[] }>;
};
let html = "";
test.beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [resolve("tests/fixtures/alpha15-datetime-controls.tsx")],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    jsx: "automatic",
    alias: {
      react: dirname(web.resolve("react/package.json")),
      "react-dom": dirname(web.resolve("react-dom/package.json")),
    },
  });
  html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:8px;font-family:sans-serif}input,select{box-sizing:border-box;max-width:100%}label,small{display:block}button{min-height:32px}section{margin-bottom:2rem}output{overflow-wrap:anywhere;display:block}</style><div id="root"></div><script>${result.outputFiles[0]!.text.replaceAll("</script", "<\\/script")}</script>`;
  await mkdir(".local/alpha15-datetime-20261016/controls", { recursive: true });
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    route.fulfill({ status: 404, body: "SYNTHETIC_ONLY" }),
  );
  await page.route("**/datetime-controls*", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
});
for (const locale of ["ja", "en"] as const) {
  test(`${locale}: strict ISO, keyboard calendar, year/month/today, save/reload and Undo`, async ({
    page,
  }) => {
    await page.goto(`/datetime-controls?locale=${locale}`);
    const controls = page.getByRole("region", {
      name: "Controls",
      exact: true,
    });
    const date = controls.getByRole("textbox", { name: "Date", exact: true });
    await date.fill("03/04");
    await expect(date).toHaveAttribute("aria-invalid", "true");
    await expect(
      controls.getByRole("button", { name: "Save controls" }),
    ).toBeDisabled();
    await date.fill("2025-02-29");
    await expect(date).toHaveAttribute("aria-invalid", "true");
    await date.fill("2024-02-29");
    await controls
      .getByRole("button", {
        name: locale === "ja" ? "カレンダーを開く" : "Open calendar",
      })
      .click();
    const day = controls.getByRole("button", {
      name: "2024-02-29",
      exact: true,
    });
    await expect(day).toBeFocused();
    await day.press("ArrowRight");
    await expect(
      controls.getByRole("button", { name: "2024-03-01", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(date).toHaveValue("2024-03-01");
    await controls.getByRole("button", { name: "Save controls" }).click();
    await controls.getByRole("button", { name: "Undo controls" }).click();
    await expect(date).toHaveValue("2024-02-29");
    await controls.getByRole("button", { name: "Reload controls" }).click();
    await expect(date).toHaveValue("2024-03-01");
    await controls
      .getByRole("button", {
        name: locale === "ja" ? "カレンダーを開く" : "Open calendar",
      })
      .click();
    await controls
      .getByRole("button", {
        name: locale === "ja" ? "翌年" : "Next year",
        exact: true,
      })
      .click();
    await expect(
      controls.getByRole("button", { name: "2025-03-01", exact: true }),
    ).toBeFocused();
    await controls
      .getByRole("button", {
        name: locale === "ja" ? "今日へ戻る" : "Go to today",
      })
      .click();
    await expect(
      controls.getByRole("button", { name: "2026-10-16", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(date).toHaveValue("2024-03-01");
  });
  test(`${locale}: minute/second meanings, no new milliseconds, precise value replacement/cancel`, async ({
    page,
  }) => {
    await page.goto(`/datetime-controls?locale=${locale}`);
    const controls = page.getByRole("region", {
      name: "Controls",
      exact: true,
    });
    await expect(
      controls.getByLabel("Minute", { exact: true }),
    ).toHaveAttribute("step", "60");
    await expect(
      controls.getByLabel("Second", { exact: true }),
    ).toHaveAttribute("step", "1");
    await controls.getByLabel("Minute", { exact: true }).fill("18:30:42");
    await expect(
      controls.getByRole("button", { name: "Save controls" }),
    ).toBeDisabled();
    await controls.getByLabel("Minute", { exact: true }).fill("18:31");
    await controls.getByLabel("Second", { exact: true }).fill("18:30:42.123");
    await expect(
      controls.getByRole("button", { name: "Save controls" }),
    ).toBeDisabled();
    await controls.getByLabel("Second", { exact: true }).fill("18:31:43");
    await controls.getByLabel("Second", { exact: true }).fill("18:32:00");
    await expect(page.getByTestId("controls-value")).toContainText(
      '"second":"18:32:00"',
    );
    await controls
      .getByLabel("Ordinary", { exact: true })
      .fill("2026-10-16T18:30:42.123");
    await expect(
      controls.getByRole("button", { name: "Save controls" }),
    ).toBeDisabled();
    await expect(page.getByTestId("controls-value")).toContainText(
      '"ordinary":"2026-10-16T18:30:42.000Z"',
    );
    await controls
      .getByLabel("Ordinary", { exact: true })
      .fill("2026-10-16T19:00");
    await expect(page.getByTestId("controls-value")).toContainText(
      '"ordinary":"2026-10-16T19:00:00.000Z"',
    );
    await expect(controls.getByLabel("Precise", { exact: true })).toHaveValue(
      "2026-10-16T18:30:42.123Z",
    );
    await controls
      .getByRole("button", {
        name:
          locale === "ja"
            ? "日時を明示的に置き換える"
            : "Explicitly replace date and time",
      })
      .click();
    await expect(
      controls.getByRole("button", { name: "Save controls" }),
    ).toBeDisabled();
    await controls
      .getByRole("button", {
        name: locale === "ja" ? "置換を取り消す" : "Cancel replacement",
      })
      .click();
    await expect(controls.getByLabel("Precise", { exact: true })).toHaveValue(
      "2026-10-16T18:30:42.123Z",
    );
    await expect(
      controls.getByRole("button", { name: "Save controls" }),
    ).toBeEnabled();
  });
  test(`${locale}: message and simulation preserve complete timestamps and block invalid new precision`, async ({
    page,
  }) => {
    await page.goto(`/datetime-controls?locale=${locale}`);
    const message = page.getByRole("region", { name: "Message", exact: true });
    await expect(message.locator("input[readonly]")).toHaveCount(2);
    await expect(message.locator("input[readonly]").first()).toHaveValue(
      "2026-10-16T18:30:42.123Z",
    );
    await message
      .getByRole("textbox", {
        name: locale === "ja" ? "タイトル" : "Title",
        exact: true,
      })
      .fill("Changed title");
    await expect(page.getByTestId("message-value")).toContainText(
      '"timestamp":"2026-10-16T18:30:42.123Z"',
    );
    await expect(page.getByTestId("message-value")).toContainText(
      '"instant":"2026-10-16T18:30:42.123Z"',
    );
    await message
      .getByRole("button", {
        name:
          locale === "ja"
            ? "日時を明示的に置き換える"
            : "Explicitly replace date and time",
      })
      .first()
      .click();
    await message
      .locator('input[type="datetime-local"]')
      .fill("2026-10-16T18:30:42.456");
    await expect(
      message.getByRole("button", { name: "Save message" }),
    ).toBeDisabled();
    await message
      .getByRole("textbox", {
        name: locale === "ja" ? "タイトル" : "Title",
        exact: true,
      })
      .fill("Another title");
    await expect(
      message.getByRole("button", { name: "Save message" }),
    ).toBeDisabled();
    await message
      .getByRole("button", {
        name: locale === "ja" ? "置換を取り消す" : "Cancel replacement",
      })
      .click();
    await expect(
      message.getByRole("button", { name: "Save message" }),
    ).toBeEnabled();
    const simulation = page.getByRole("region", {
      name: "Simulation",
      exact: true,
    });
    await simulation.locator("summary").click();
    await expect(simulation.locator("input[readonly]")).toHaveValue(
      "2026-10-16T18:30:42.123Z",
    );
    await simulation
      .getByRole("button", {
        name:
          locale === "ja"
            ? "日時を明示的に置き換える"
            : "Explicitly replace date and time",
      })
      .click();
    await simulation
      .locator('input[type="datetime-local"]')
      .first()
      .fill("2026-10-16T18:30:42.456");
    await expect(
      simulation.getByRole("button", { name: "Run simulation" }),
    ).toBeDisabled();
    await expect(page.getByTestId("simulation-value")).toContainText(
      '"clock":"2026-10-16T18:30:42.123Z"',
    );
    await simulation
      .getByRole("button", {
        name: locale === "ja" ? "置換を取り消す" : "Cancel replacement",
      })
      .click();
    await expect(
      simulation.getByRole("button", { name: "Run simulation" }),
    ).toBeEnabled();
    await simulation
      .getByLabel("Mock instant", { exact: true })
      .fill("2026-10-16T18:30:42.456");
    await expect(
      simulation.getByRole("button", { name: "Run simulation" }),
    ).toBeDisabled();
    await simulation
      .getByLabel("Mock instant", { exact: true })
      .fill("2026-10-16T18:30:43");
    await expect(
      simulation.getByRole("button", { name: "Run simulation" }),
    ).toBeEnabled();
    await expect(page.getByTestId("simulation-value")).toContainText(
      '"simulation-instant":{"type":"Instant","value":"2026-10-16T18:30:43.000Z"}',
    );
  });
  test(`${locale}: narrow keyboard calendar supports forced colors without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(`/datetime-controls?locale=${locale}`);
    const controls = page.getByRole("region", {
      name: "Controls",
      exact: true,
    });
    await controls
      .getByRole("button", {
        name: locale === "ja" ? "カレンダーを開く" : "Open calendar",
      })
      .click();
    await page.keyboard.press("PageUp");
    await expect(
      controls.getByRole("button", { name: "2024-01-29", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+PageDown");
    await expect(
      controls.getByRole("button", { name: "2025-01-29", exact: true }),
    ).toBeFocused();
    await expect(page.locator('table[role="grid"]')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/alpha15-datetime-20261016/controls/calendar-${locale}-320-forced-colors.png`,
    });
  });
}
