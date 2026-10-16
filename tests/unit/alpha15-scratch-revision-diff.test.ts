import { describe, expect, it } from "vitest";
import {
  createDraft,
  flowDefinitionDifferences,
} from "../../apps/web/app/automation/model";
import type {
  FlowDefinition,
  Statement,
} from "../../packages/automation/src/types";

describe("saved Scratch configuration differences", () => {
  it("shows changed order, unknown edges and stable IDs without changing either snapshot", () => {
    const before = createDraft("321111111111111111", "en");
    const step = (id: string): Statement => ({
      id,
      kind: "branch",
      condition: { kind: "literal", type: "Boolean", value: false },
      then: [],
      otherwise: [],
      unknown: [
        {
          id: `${id}-unknown`,
          kind: "wait",
          duration: { kind: "literal", type: "Duration", value: 0 },
        },
      ],
    });
    before.body = [step("a"), step("b")];
    const after = structuredClone(before);
    after.body.reverse();
    const original = structuredClone({ before, after });
    const result = flowDefinitionDifferences(before, after);
    expect(result.changes).toContainEqual({
      path: "body.0.id",
      before: '"a"',
      after: '"b"',
    });
    expect(result.changes).toContainEqual({
      path: "body.0.unknown.0.id",
      before: '"a-unknown"',
      after: '"b-unknown"',
    });
    expect(result.omitted).toBe(false);
    expect({ before, after }).toEqual(original);
  });
  it("compares authoring metadata as well as the compiled tree and preserves literal contents", () => {
    const before = createDraft("321111111111111111", "en"),
      after = structuredClone(before);
    after.body = [
      {
        id: "text",
        kind: "declare",
        variable: { id: "v", name: "Text", type: "PlainText" },
        value: {
          kind: "literal",
          type: "PlainText",
          value: "<script>not executed</script>",
        },
      },
    ];
    const result = flowDefinitionDifferences(before, after);
    expect(
      result.changes.some((change) =>
        change.after.includes("<script>not executed</script>"),
      ),
    ).toBe(true);
    const withMetadata = {
      ...after,
      scratchAuthoring: { version: 1, chains: [] },
    } as FlowDefinition;
    expect(
      flowDefinitionDifferences(after, withMetadata).changes,
    ).toContainEqual({
      path: "scratchAuthoring",
      before: "—",
      after: '{"version":1,"chains":[]}',
    });
  });
  it("ignores object property ordering and identifies identical content", () => {
    const before = createDraft("321111111111111111", "en");
    const after = Object.fromEntries(
      Object.entries(before).reverse(),
    ) as unknown as FlowDefinition;
    expect(flowDefinitionDifferences(before, after)).toEqual({
      changes: [],
      omitted: false,
    });
  });
  it("bounds displayed content to 100 changes and 300 characters per value", () => {
    const before = createDraft("321111111111111111", "en"),
      after = structuredClone(before);
    before.variables = Array.from({ length: 101 }, (_, i) => ({
      id: `v${i}`,
      name: "Before",
      type: "Number",
    }));
    after.variables = before.variables.map((item) => ({
      ...item,
      name: "X".repeat(400),
    }));
    const result = flowDefinitionDifferences(before, after);
    expect(result.changes).toHaveLength(100);
    expect(result.omitted).toBe(true);
    expect(result.changes.every((change) => change.after.length <= 300)).toBe(
      true,
    );
  });
});
