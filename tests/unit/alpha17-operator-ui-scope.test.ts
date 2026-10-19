import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
const source = readFileSync(new URL("../../apps/operator/public/operator-ui.js", import.meta.url), "utf8");
const apiSource = source.slice(source.indexOf("async function api("), source.indexOf("function state("));
const reloadSource = source.slice(source.indexOf("async function reload()"), source.indexOf("function action("));
type Node = { text: string; children: Node[]; append(...values: Node[]): void; replaceChildren(...values: Node[]): void };
function node(text = ""): Node {
  return { text, children: [], append(...values) { this.children.push(...values); },
    replaceChildren(...values) { this.children = [...values]; } };
}
function fixture(overviewStatus: number) {
  const nodes = new Map<string, Node>(), notice = vi.fn();
  const get = (id: string) => {
    let value = nodes.get(id);
    if (!value) { value = node(); nodes.set(id, value); }
    return value;
  };
  const context = {
    csrf: "synthetic-csrf", authGeneration: 1, language: "en", selected: null,
    notice, errorKey: (key: string) => key, clearPrivateState: vi.fn(),
    $: get, t: (key: string) => key, state: () => "registered", detail: vi.fn(),
    element: (_tag: string, text?: string) => node(text),
    fetch: vi.fn(async (path: string) => path === "/operator/guilds" ? {
      ok: true, status: 200, json: async () => ({
        guilds: [{ guild_id: "985170000000000001", guild_name: "ALLOWED_ONLY", status: "REGISTERED" }], maximum: 10,
      }),
    } : { ok: false, status: overviewStatus, json: async () => ({
      error: overviewStatus === 403 ? "PERMISSION_DENIED" : "OPERATOR_UNAVAILABLE",
    }) }),
  };
  return { context, get, notice };
}
describe("alpha17 legacy UI scoped read rendering", () => {
  it("renders permitted guilds and an explicit unavailable global overview without fake metrics", async () => {
    const f = fixture(403);
    await runInNewContext(apiSource + "\n" + reloadSource + "\nreload();", f.context);
    expect(JSON.stringify(f.get("guild-list"))).toContain("ALLOWED_ONLY");
    expect(JSON.stringify(f.get("overview"))).toContain("Global overview is unavailable for this grant.");
    expect(JSON.stringify(f.get("overview"))).not.toContain("capacity");
    expect(JSON.stringify(f.get("overview"))).not.toContain("waiting");
    expect(f.notice).not.toHaveBeenCalled();
  });
  it("keeps real server failures visible instead of pretending they are a permission-limited overview", async () => {
    const f = fixture(503);
    await expect(runInNewContext(apiSource + "\n" + reloadSource + "\nreload();", f.context)).rejects.toThrow("OPERATOR_UNAVAILABLE");
    expect(f.notice).toHaveBeenCalledWith("OPERATOR_UNAVAILABLE");
  });
});
