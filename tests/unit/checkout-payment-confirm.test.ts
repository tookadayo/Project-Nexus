import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Exercise the embedded browser SDK function itself, rather than copying it.
const spec = ts.createSourceFile("checkout.spec.ts", readFileSync(resolve("tests/e2e/checkout.spec.ts"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const initializers: string[] = [];
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(spec) === "initCheckoutElementsSdk" && ts.isArrowFunction(node.initializer))
    initializers.push(node.initializer.getText(spec));
  ts.forEachChild(node, visit);
}
visit(spec);
if (initializers.length !== 1) throw new Error("TEST_PAYMENT_MOCK_INITIALIZER_NOT_UNIQUE");
const executable = ts.transpileModule(`globalThis.syntheticSdkFactory = (${initializers[0]});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText;
type Initializer = (options: { clientSecret: unknown }) => {
  loadActions: () => Promise<{ actions: { confirm: () => Promise<{ type: string }> } }>;
};
const secret = "cs_fixture_contract_secret_fixture", canary = "PAYMENT_PRIVATE_CANARY";
function response(status = 200, body: unknown = { ok: true }) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn(async () => body) };
}
async function confirm(clientSecret: unknown, send: (...args: unknown[]) => Promise<unknown>) {
  const sandbox: { fixtureUrl: string; fetch: typeof send; syntheticSdkFactory?: Initializer } = {
    fixtureUrl: "http://127.0.0.1:3161", fetch: send,
  };
  vm.createContext(sandbox); new vm.Script(executable).runInContext(sandbox);
  if (!sandbox.syntheticSdkFactory) throw new Error("TEST_PAYMENT_MOCK_INITIALIZER_MISSING");
  const actions = await sandbox.syntheticSdkFactory({ clientSecret }).loadActions();
  return actions.actions.confirm();
}
async function rejection(pending: Promise<unknown>) {
  try { await pending; return "UNEXPECTED_SUCCESS"; }
  catch (error) {
    return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "UNCLASSIFIED_ERROR";
  }
}

describe("embedded Stripe fixture confirmation reports actual payment acceptance", () => {
  it("returns success only after the exact synthetic POST is accepted", async () => {
    const accepted = response(), send = vi.fn(async (..._args: unknown[]) => accepted);
    expect((await confirm(secret, send)).type).toBe("success");
    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0]!, init = call[1] as RequestInit;
    expect(call[0]).toBe("http://127.0.0.1:3161/fixture/payment");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    const body: unknown = JSON.parse(String(init.body));
    expect(Boolean(body && typeof body === "object" && "clientSecret" in body && body.clientSecret === secret)).toBe(true);
    expect(accepted.json).toHaveBeenCalledTimes(1);
  });
  it.each([
    { name: "missing", value: undefined }, { name: "null", value: null },
    { name: "number", value: 42 }, { name: "empty", value: "" },
    { name: "promise instead of the app's string contract", value: Promise.resolve(secret) },
  ])("rejects $name clientSecret before any request", async ({ value }) => {
    const send = vi.fn(async (..._args: unknown[]) => response());
    expect(await rejection(confirm(value, send))).toBe("TEST_PAYMENT_SECRET_REQUIRED");
    expect(send).not.toHaveBeenCalled();
  });
  it.each([400, 403, 404, 500, 503])("keeps HTTP %s as failure without reading or exposing its body", async status => {
    const failed = response(status, { private: canary }), send = vi.fn(async (..._args: unknown[]) => failed);
    const message = await rejection(confirm(secret, send));
    expect(message).toBe(`TEST_PAYMENT_HTTP_FAILED status=${status}`);
    expect(message.includes(canary)).toBe(false); expect(message.includes(secret)).toBe(false);
    expect(failed.json).not.toHaveBeenCalled();
  });
  it.each([
    { name: "null", body: null }, { name: "boolean", body: true }, { name: "empty object", body: {} },
    { name: "explicit rejection", body: { ok: false } }, { name: "string flag", body: { ok: "true" } },
    { name: "array", body: [{ ok: true }] },
  ])("rejects a 2xx $name body instead of claiming payment success", async ({ body }) => {
    const send = vi.fn(async (..._args: unknown[]) => response(200, body));
    expect(await rejection(confirm(secret, send))).toBe("TEST_PAYMENT_RESPONSE_INVALID status=200");
  });
  it("classifies malformed JSON without exposing its parse error", async () => {
    const failed = response(); failed.json.mockRejectedValueOnce(new Error(canary));
    const message = await rejection(confirm(secret, vi.fn(async (..._args: unknown[]) => failed)));
    expect(message).toBe("TEST_PAYMENT_RESPONSE_INVALID status=200"); expect(message.includes(canary)).toBe(false);
  });
  it("classifies transport rejection without exposing its raw error", async () => {
    const send = vi.fn(async (..._args: unknown[]) => { throw new Error(canary + secret); });
    const message = await rejection(confirm(secret, send));
    expect(message).toBe("TEST_PAYMENT_TRANSPORT_FAILED"); expect(message.includes(canary)).toBe(false); expect(message.includes(secret)).toBe(false);
  });
});
