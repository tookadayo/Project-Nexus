import {expect, test, type Page} from "./alpha16-browser-fixture";
import {createRequire} from "node:module";
import {dirname, resolve} from "node:path";
async function withViewportFailureDiagnostics(
  page: Page,
  assertWidth: () => Promise<void>,
) {
  try {
    await assertWidth();
  } catch (error) {
    const matcherResult =
      error && typeof error === "object" && "matcherResult" in error
        ? (error as {
            matcherResult?: { name?: unknown; actual?: unknown; expected?: unknown };
          }).matcherResult
        : null;
    if (
      process.env.CI === "true" &&
      matcherResult?.name === "toBe" &&
      matcherResult.actual === false &&
      matcherResult.expected === true
    ) {
      try {
        const metrics = await page.evaluate(() => {
          const root = document.documentElement;
          const classes = [
            "case-context-workspace", "case-context-grid", "case-context-tools",
            "case-context-warning", "case-context-confirm",
          ];
          const tags = new Set([
            "section", "header", "div", "aside", "form", "fieldset", "legend",
            "label", "input", "select", "option", "button", "p", "span", "a",
            "h1", "h2", "h3", "ul", "li", "details", "summary", "table",
            "thead", "tbody", "tr", "th", "td", "code", "time",
          ]);
          const number = (value: string) => {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : null;
          };
          const elements = Array.from(
            document.querySelectorAll(".case-context-workspace, .case-context-workspace *"),
          );
          const overflowing = elements.flatMap((element, elementIndex) => {
            if (!element.getClientRects().length) return [];
            const rect = element.getBoundingClientRect();
            const outsideViewport = rect.right > innerWidth + 1 || rect.left < -1;
            const internalOverflow = element.scrollWidth > element.clientWidth + 1;
            if (!outsideViewport && !internalOverflow) return [];
            const css = getComputedStyle(element);
            return [{
              elementIndex,
              tag: tags.has(element.localName) ? element.localName : "other",
              classes: classes.filter((name) => element.classList.contains(name)),
              inputType: element instanceof HTMLInputElement &&
                ["text", "number", "checkbox", "datetime-local"].includes(element.type)
                ? element.type : null,
              outsideViewport, internalOverflow,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
              clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
              css: {
                width: number(css.width), minWidth: number(css.minWidth),
                minWidthAuto: css.minWidth === "auto", maxWidth: number(css.maxWidth),
                maxWidthNone: css.maxWidth === "none", fontSize: number(css.fontSize),
                lineHeight: number(css.lineHeight),
                paddingLeft: number(css.paddingLeft), paddingRight: number(css.paddingRight),
                borderLeftWidth: number(css.borderLeftWidth), borderRightWidth: number(css.borderRightWidth),
                gridTrackWidths: css.gridTemplateColumns.split(" ").map(number).filter((n) => n !== null),
                display: ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "none", "table", "table-cell"].includes(css.display) ? css.display : "other",
                boxSizing: css.boxSizing === "border-box" ? "border-box" : "content-box",
                overflowX: ["visible", "hidden", "clip", "scroll", "auto"].includes(css.overflowX) ? css.overflowX : "other",
              },
            }];
          });
          return {
            innerWidth, innerHeight, devicePixelRatio,
            documentClientWidth: root.clientWidth, documentScrollWidth: root.scrollWidth,
            bodyClientWidth: document.body.clientWidth, bodyScrollWidth: document.body.scrollWidth,
            rootFontSize: number(getComputedStyle(root).fontSize),
            fontsLoaded: document.fonts.status === "loaded", elementCount: elements.length,
            overflowCandidateCount: overflowing.length, overflowCandidates: overflowing.slice(0, 32),
          };
        });
        console.log("ALPHA16_VIEWPORT_FAILURE_METRICS " + JSON.stringify(metrics));
      } catch {
        console.log("ALPHA16_VIEWPORT_FAILURE_METRICS_UNAVAILABLE");
      }
    }
    throw error;
  }
}

let html = "";
test.beforeAll(async () => {const local = createRequire(import.meta.url), web = createRequire(resolve("apps/web/package.json")), esbuild = createRequire(local.resolve("tsx"))("esbuild") as {build(input: Record<string, unknown>): Promise<{outputFiles: {path: string; text: string}[]}>}; const result = await esbuild.build({stdin: {contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {OperationalContextWorkspace} from ${JSON.stringify(resolve("apps/web/app/rules/context/view.tsx"))};import ${JSON.stringify(resolve("apps/web/app/rules/context/workspace.css"))};createRoot(document.getElementById('root')).render(<OperationalContextWorkspace locale={new URLSearchParams(location.search).get('locale')==='ja'?'ja':'en'} guildId="877722222222222222"/>);`, resolveDir: resolve("."), sourcefile: "alpha16-context-fixture.tsx", loader: "tsx"}, bundle: true, platform: "browser", format: "iife", write: false, outfile: "context.js", jsx: "automatic", alias: {react: dirname(web.resolve("react/package.json")), "react-dom": dirname(web.resolve("react-dom/package.json"))}}); html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}${result.outputFiles.find((file) => file.path.endsWith(".css"))!.text}</style></head><body><div id="root"></div><script>${result.outputFiles.find((file) => file.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;});
test.beforeEach(async ({page}) => {await page.route("**/alpha16-context-fixture*", (route) => route.fulfill({contentType: "text/html", body: html})); await page.addInitScript(() => {document.cookie = "nexus_csrf=context-synthetic-only; path=/; SameSite=Strict";});});
const key = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fields = [{id: "contentChecklist", type: "enum", unit: "state", enumValues: ["IMPORTANT_IMAGE", "OTHER", "UNASSESSED"], sourceKind: "OPERATOR", editable: true}, {id: "barrierReport", type: "enum", unit: "state", enumValues: ["REPORTED", "NONE_REPORTED", "UNASSESSED"], sourceKind: "OPERATOR", editable: true}];
async function mock(page: Page, options: {permission?: boolean; status?: number; existing?: boolean; conflict?: boolean; unknown?: boolean; source?: boolean} = {}) {
  const posts: {body: Record<string, unknown>; headers: Record<string, string>}[] = [], prepared: unknown[] = [], reads: string[] = [];
  await page.route(/\/api\/rule-context(?:\?.*)?$/, async (route) => {const request = route.request(), op = new URL(request.url()).searchParams.get("op"), reply = (data: unknown, status = 200) => route.fulfill({status, contentType: "application/json", body: JSON.stringify({ok: true, data})}); if (options.status) return route.fulfill({status: options.status, contentType: "application/json", body: JSON.stringify({ok: false, error: {code: "UNAVAILABLE"}})}); if (op === "request-key") {prepared.push(request.postDataJSON()); return reply({key, expiresAt: "2026-10-16T12:05:00Z"}, 201);} if (request.method() === "POST") {posts.push({body: request.postDataJSON(), headers: request.headers()}); if (options.unknown) return route.abort("failed"); if (options.conflict) return route.fulfill({status: 412, contentType: "application/json", body: JSON.stringify({ok: false, error: {code: "CASE_CONTEXT_VERSION_MISMATCH"}})}); return reply({id, version: 1, state: "CAPTURED"});} reads.push(op ?? "catalog"); if (op === "request") return reply({state: "NOT_STARTED", result: null}); if (op === "options") return reply({channels: [], events: [], baseResults: [], guildTarget: {targetType: "GUILD", targetId: "877722222222222222", liveVersion: "1"}, roles: []}); if (op === "detail") return reply({id, caseId: "CASE18", version: 1, target: {targetType: "ACCESSIBILITY", targetId: id, liveVersion: "1"}, baseResultId: null, fields: [{fieldId: "barrierReport", value: "REPORTED", quality: "SUFFICIENT", sourceKind: "OPERATOR"}]}); return reply({items: options.existing ? [{id, caseId: "CASE18", version: 1, target: {targetType: "ACCESSIBILITY", targetId: id, liveVersion: "1"}, observedAt: "2026-10-16T12:00:00Z", expiresAt: "2026-10-18T12:00:00Z"}] : [], profiles: [], permissions: options.permission === false ? ["READ", "ANALYZE"] : ["READ", "ANALYZE", "GOVERN"], cardinality: "ONE_SELECTED_RESOURCE_PER_CASE_PER_EVALUATION", sourcePlugins: options.source ? [{id:"CASE_13_20_NATIVE",supportedFields:{CASE13:["actionableCount","noiseCount"]},editorSchema:{anyOf:[{type:"object","x-case-ids":["CASE13"],properties:{kind:{const:"QUEUE_REVIEW"},population:{const:"CURRENT_RETAINED_NATIVE_ATTENTION_V1"},itemTypes:{type:"array",minItems:1,maxItems:8,items:{type:"string",enum:["OPERATIONS_REQUEST"]}},reviews:{type:"array",maxItems:500,items:{type:"object",properties:{attentionKey:{type:"string",minLength:1},expectedVersion:{type:"integer",minimum:0},classification:{type:"string",enum:["ACTIONABLE","NOISE","UNREVIEWED"]},assignment:{type:"null"}},required:["attentionKey","expectedVersion","classification","assignment"]}}},required:["kind","population","itemTypes","reviews"]}]}}] : [], cases: [...(options.source ? [{id:"CASE13",rootTriggers:["AUTHORIZED_OPERATIONAL_CONTEXT"],targetTypes:["MODERATION_QUEUE"],audience:"RESTRICTED_STAFF",fields:[{id:"actionableCount",type:"integer",unit:"count",enumValues:null,sourceKind:"NATIVE",editable:false}],configs:[],metrics:[]}] : []), {id: "CASE18", rootTriggers: ["AUTHORIZED_OPERATIONAL_CONTEXT"], targetTypes: ["ACCESSIBILITY"], audience: "GUILD_AUTHORIZED", fields, configs: [{id: "CASE18.cooldownSeconds", unit: "seconds", minimum: 1}], metrics: []}, {id: "CASE17", rootTriggers: ["AUTHORIZED_OPERATIONAL_CONTEXT"], targetTypes: ["PERMISSION"], audience: "RESTRICTED_STAFF", fields: [{id: "reportChannel.expectedPermission", type: "enum", unit: "state", enumValues: ["RESTRICTED", "PUBLIC"], sourceKind: "OPERATOR", editable: true}, {id: "reportChannel.actualPermission", type: "enum", unit: "state", enumValues: ["RESTRICTED", "PUBLIC"], sourceKind: "UNAVAILABLE", editable: false}], configs: [], metrics: []}]});}); return {posts, prepared, reads};
}
async function newObservation(page: Page) {await page.getByRole("button", {name: "Load currently verified resources", exact: true}).click(); await page.getByRole("combobox", {name: "Resource", exact: true}).selectOption("ACCESSIBILITY"); await page.getByRole("combobox", {name: "Voluntary barrier report", exact: true}).selectOption("REPORTED"); await page.getByRole("button", {name: "Save observations", exact: true}).click();}
for (const locale of ["ja", "en"] as const) test(`empty state and explicit resource/retention limits visible at 320px ${locale}`, async ({page}) => {await page.setViewportSize({width: 320, height: 900}); await mock(page); await page.goto(`/alpha16-context-fixture?locale=${locale}`); await expect(page.getByText(locale === "ja" ? "運営状況の記録はまだありません。" : "No operational checks recorded.", {exact: true})).toBeVisible(); await expect(page.getByText(locale === "ja" ? /複数の対象を登録でき/ : /Each evaluation uses one explicitly selected resource per case/)).toBeVisible(); await withViewportFailureDiagnostics(page, async () => { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); });});
for (const status of [403, 503]) test(`loading permission/communication failure ${status}`, async ({page}) => {await mock(page, {status}); await page.goto("/alpha16-context-fixture"); await expect(page.getByRole("alert")).toContainText(status === 403 ? "Current access" : "Communication failed");});
test("current READ can inspect source limits while GOVERN writes are disabled", async ({page}) => {await mock(page, {permission: false}); await page.goto("/alpha16-context-fixture"); await expect(page.getByRole("button", {name: "Save observations", exact: true})).toBeDisabled(); await page.getByRole("combobox", {name: "Case", exact: true}).selectOption("CASE17"); await page.getByText("Native and unavailable observations", {exact: true}).click(); await expect(page.getByText("Unavailable; kept UNKNOWN", {exact: true})).toBeVisible(); await expect(page.getByRole("combobox")).toHaveCount(3);});
test("cancel configuration changes sends neither a key preparation nor mutation", async ({page}) => {const calls = await mock(page); await page.goto("/alpha16-context-fixture"); await newObservation(page); await page.getByRole("button", {name: "Cancel", exact: true}).click(); expect(calls.posts).toHaveLength(0); expect(calls.prepared).toHaveLength(0);});
test("double click uses one exact prepared operation with CSRF/guild/version headers", async ({page}) => {const calls = await mock(page); await page.goto("/alpha16-context-fixture"); await newObservation(page); await page.getByRole("button", {name: "Confirm", exact: true}).dblclick(); await expect(page.getByRole("dialog")).toHaveCount(0); expect(calls.posts).toHaveLength(1); expect(calls.posts[0]!.body).toEqual(calls.prepared[0]); expect(calls.posts[0]!.body).toMatchObject({operation: "CONTEXT_SAVE", expectedVersion: 0, caseId: "CASE18", fields: {barrierReport: "REPORTED"}}); expect(calls.posts[0]!.body.fields).not.toHaveProperty("contentChecklist"); expect(calls.posts[0]!.headers).toMatchObject({"idempotency-key": key, "if-match": '"0"', "x-nexus-guild": "877722222222222222", "x-nexus-csrf": "context-synthetic-only"});});
test("allows another explicit resource while existing records still open separately for editing or deletion", async ({page}) => {const calls = await mock(page, {existing: true}); await page.goto("/alpha16-context-fixture"); await expect(page.getByRole("button", {name: "Save observations", exact: true})).toBeEnabled(); await page.getByRole("button", {name: "CASE18 · ACCESSIBILITY · v1", exact: true}).click(); await page.getByRole("button", {name: "Delete checklist", exact: true}).click(); await page.getByRole("button", {name: "Cancel", exact: true}).click(); expect(calls.posts).toHaveLength(0);});
test("operational settings have no fixture numeric defaults and require explicit input", async ({page}) => {const calls = await mock(page); await page.goto("/alpha16-context-fixture"); await page.getByRole("button", {name: "Operational evaluation settings", exact: true}).click(); await expect(page.getByRole("checkbox", {name: "Use this profile for operational evaluation", exact: true})).not.toBeChecked(); for (const input of await page.getByRole("spinbutton").all()) await expect(input).toHaveValue(""); await page.getByRole("button", {name: "Save operational settings", exact: true}).click(); await expect(page.getByRole("dialog")).toHaveCount(0); expect(calls.posts).toHaveLength(0);});
test("profile budgets and enabled choice are explicit configuration, with no Discord operation", async ({page}) => {const calls = await mock(page); await page.goto("/alpha16-context-fixture"); await page.getByRole("button", {name: "Operational evaluation settings", exact: true}).click(); const perCase = page.getByRole("group", {name: "Per-case evaluation limits", exact: true}), all = page.getByRole("group", {name: "Overall evaluation limits", exact: true}); for (const [name, value] of [["Maximum branch depth", "16"], ["Maximum evaluated branches", "64"], ["Maximum predicate operations", "256"], ["Maximum input references", "128"]]) await perCase.getByRole("spinbutton", {name, exact: true}).fill(value!); for (const [name, value] of [["Maximum evaluated branches", "128"], ["Maximum predicate operations", "1024"], ["Maximum input references", "512"]]) await all.getByRole("spinbutton", {name, exact: true}).fill(value!); await page.getByRole("spinbutton", {name: "Repeat recommendation suppression (seconds)", exact: true}).fill("60"); await page.getByRole("checkbox", {name: "Use this profile for operational evaluation", exact: true}).check(); await page.getByRole("button", {name: "Save operational settings", exact: true}).click(); await page.getByRole("button", {name: "Confirm", exact: true}).click(); await expect(page.getByRole("dialog")).toHaveCount(0); expect(calls.posts[0]!.body).toMatchObject({operation: "PROFILE_SAVE", enabled: true, values: {"CASE18.cooldownSeconds": {value: 60, unit: "seconds"}}, metricConfigs: {}});});
test("stale source/version is shown and never retried automatically", async ({page}) => {const calls = await mock(page, {conflict: true}); await page.goto("/alpha16-context-fixture"); await newObservation(page); await page.getByRole("button", {name: "Confirm", exact: true}).click(); await expect(page.getByRole("alert")).toContainText("source or version changed"); expect(calls.posts).toHaveLength(1);});
test("unknown result uses saved-key read only without re-sending a configuration", async ({page}) => {const calls = await mock(page, {unknown: true}); await page.goto("/alpha16-context-fixture"); await newObservation(page); await page.getByRole("button", {name: "Confirm", exact: true}).click(); await page.getByRole("button", {name: "Check saved request", exact: true}).click(); await expect(page.getByRole("alert")).toContainText("No operation was resent"); expect(calls.posts).toHaveLength(1); expect(calls.prepared).toHaveLength(1); expect(calls.reads).toContain("request");});

async function chooseNativeQueue(page:Page) {
  await page.getByRole("combobox",{name:"Case",exact:true}).selectOption("CASE13");
  await page.getByRole("button",{name:"Load currently verified resources",exact:true}).click();
  await page.getByRole("combobox",{name:"Resource",exact:true}).selectOption("MODERATION_QUEUE");
  await page.getByRole("checkbox",{name:"Explicitly use this source",exact:true}).check();
  await page.getByRole("combobox",{name:"Choose an input type",exact:true}).selectOption("0");
  const items=page.getByRole("group",{name:"Native queue item types",exact:true});
  await items.getByRole("button",{name:"Add a record",exact:true}).click();
  await items.getByRole("combobox",{name:"Native queue item types",exact:true}).selectOption("OPERATIONS_REQUEST");
}
test("typed source selection binds explicit existing record definitions without direct counter or JSON input",async({page})=>{
  const calls=await mock(page,{source:true});await page.goto("/alpha16-context-fixture");await chooseNativeQueue(page);
  await page.getByRole("group",{name:"Explicitly reviewed records",exact:true}).getByRole("button",{name:"Use an empty set",exact:true}).click();
  await expect(page.locator("textarea")).toHaveCount(0);
  await page.getByRole("button",{name:"Save observations",exact:true}).click();await page.getByRole("button",{name:"Confirm",exact:true}).dblclick();
  await expect(page.getByRole("dialog")).toHaveCount(0);expect(calls.posts).toHaveLength(1);
  expect(calls.posts[0]!.body.sources).toEqual([{sourceId:"CASE_13_20_NATIVE",config:{kind:"QUEUE_REVIEW",population:"CURRENT_RETAINED_NATIVE_ATTENTION_V1",itemTypes:["OPERATIONS_REQUEST"],reviews:[]}}]);
  expect(calls.posts[0]!.body).toEqual(calls.prepared[0]);expect(calls.posts[0]!.body.fields).toEqual({});
});
test("a blank review version is never silently promoted to zero or sent for preparation",async({page})=>{
  const calls=await mock(page,{source:true});await page.goto("/alpha16-context-fixture");await chooseNativeQueue(page);
  const reviews=page.getByRole("group",{name:"Explicitly reviewed records",exact:true});await reviews.getByRole("button",{name:"Add a record",exact:true}).click();
  await reviews.getByRole("textbox",{name:"Native queue record ID",exact:true}).fill("native-record");
  await reviews.getByRole("combobox",{name:"Staff classification",exact:true}).selectOption("ACTIONABLE");
  await expect(reviews.getByRole("spinbutton",{name:"Expected current version",exact:true})).toHaveValue("");
  await page.getByRole("button",{name:"Save observations",exact:true}).click();await expect(page.getByRole("alert")).toContainText("Complete the selected source");
  expect(calls.prepared).toHaveLength(0);expect(calls.posts).toHaveLength(0);
});
test("cancel source editing removes the selection and partial UTC window without sending anything",async({page})=>{
  const calls=await mock(page,{source:true});await page.goto("/alpha16-context-fixture");await chooseNativeQueue(page);
  await page.getByLabel("Start (UTC)",{exact:true}).fill("2026-10-16T10:00");
  await page.getByRole("button",{name:"Cancel editing",exact:true}).click();
  await expect(page.getByRole("checkbox",{name:"Explicitly use this source",exact:true})).not.toBeChecked();
  await expect(page.getByLabel("Start (UTC)",{exact:true})).toHaveValue("");expect(calls.posts).toHaveLength(0);expect(calls.prepared).toHaveLength(0);
});
test("Japanese typed-source controls remain readable at 320px",async({page})=>{
  await page.setViewportSize({width:320,height:900});await mock(page,{source:true});await page.goto("/alpha16-context-fixture?locale=ja");
  await page.locator("select").first().selectOption("CASE13");
  await expect(page.getByRole("group",{name:"キュー・フィルター・投稿の情報",exact:true})).toBeVisible();
  await page.getByRole("checkbox",{name:"この情報源を明示して使う",exact:true}).check();
  await page.getByRole("combobox",{name:"入力方法を選択",exact:true}).selectOption("0");
  await expect(page.getByRole("group",{name:"確認した既存レコード",exact:true})).toBeVisible();
  await withViewportFailureDiagnostics(page, async () => { expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true); });
});

for (const locale of ["ja", "en"] as const) test(`cooldown uses an explicit positive duration with no numeric default ${locale}`, async ({page}) => {
  const calls = await mock(page); await page.goto(`/alpha16-context-fixture?locale=${locale}`);
  await page.getByRole("button", {name: locale === "ja" ? "実運用の評価設定" : "Operational evaluation settings", exact: true}).click();
  const cooldown = page.getByRole("spinbutton", {name: locale === "ja" ? "同じ推奨を抑える時間（秒）" : "Repeat recommendation suppression (seconds)", exact: true});
  await expect(cooldown).toHaveValue(""); await expect(cooldown).toHaveAttribute("min", "1");
  await cooldown.fill("0"); expect(await cooldown.evaluate((input:HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);
  expect(calls.prepared).toHaveLength(0); expect(calls.posts).toHaveLength(0);
});
