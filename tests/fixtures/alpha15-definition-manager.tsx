import { useCallback, useState } from "react";
import { createRoot } from "../../apps/web/node_modules/react-dom/client";
import { DefinitionManager } from "../../apps/web/app/automation/definition-manager";
import type { FlowDefinition } from "../../packages/automation/src/types";
import "../../apps/web/app/automation/workspace.css";

const initial: FlowDefinition = {
  schemaVersion: 1,
  id: "manager-fixture",
  guildId: "321111111111111111",
  name: "Definition manager fixture",
  trigger: { kind: "manual", inputs: [] },
  variables: [],
  body: [
    {
      id: "call-echo",
      kind: "call",
      procedureId: "echo",
      revision: 1,
      args: { "echo-input": { kind: "literal", type: "Number", value: 4 } },
      outputs: {
        "echo-output": {
          id: "received-result",
          name: "Received result",
          type: "Number",
        },
      },
    },
    {
      id: "call-double",
      kind: "declare",
      variable: { id: "doubled", name: "Doubled", type: "Number" },
      value: {
        kind: "expression",
        type: "Number",
        expression: {
          operator: "pure.call",
          args: [{ kind: "literal", type: "Number", value: 5 }],
          options: { definitionId: "double", revision: 1 },
        },
      },
    },
  ],
  procedures: [
    {
      id: "echo",
      revision: 1,
      name: "Echo",
      inputs: [{ id: "echo-input", name: "Count", type: "Number" }],
      outputs: [{ id: "echo-output", name: "Result", type: "Number" }],
      body: [
        {
          id: "return-echo",
          kind: "return",
          values: {
            "echo-output": {
              kind: "variable",
              type: "Number",
              variableId: "echo-input",
            },
          },
        },
      ],
    },
  ],
  pureDefinitions: [
    {
      id: "double",
      revision: 1,
      name: "Double",
      inputs: [{ id: "double-input", name: "Count", type: "Number" }],
      outputType: "Number",
      value: {
        kind: "expression",
        type: "Number",
        expression: {
          operator: "number.multiply",
          args: [
            { kind: "variable", type: "Number", variableId: "double-input" },
            { kind: "literal", type: "Number", value: 2 },
          ],
        },
      },
    },
  ],
};
const query = new URLSearchParams(location.search),
  locale = query.get("locale") === "ja" ? "ja" : "en";
function Fixture() {
  const [definition, setDefinition] = useState(initial),
    [editing, setEditing] = useState(""),
    [changes, setChanges] = useState(0),
    [errors, setErrors] = useState<Record<string, string>>({});
  const validity = useCallback(
    (path: string, message: string | null) =>
      setErrors((previous) => {
        const next = { ...previous };
        if (message) next[path] = message;
        else delete next[path];
        return next;
      }),
    [],
  );
  return (
    <main className="automation-workspace" lang={locale}>
      <button
        type="button"
        disabled={query.has("readonly")}
        onClick={() =>
          setDefinition((previous) => ({
            ...previous,
            ui: { selectedId: "call-double", collapsed: ["call-echo"] },
          }))
        }
      >
        Change panel display
      </button>
      <DefinitionManager
        definition={definition}
        locale={locale}
        targets={{ available: true, channels: [], roles: [] }}
        disabled={query.has("readonly")}
        onValidity={validity}
        onChange={(next) => {
          setDefinition(next);
          setChanges((value) => value + 1);
        }}
        onEditProcedure={(id, revision) => setEditing(`${id}@${revision}`)}
      />
      <output hidden data-testid="definition">
        {JSON.stringify(definition)}
      </output>
      <output hidden data-testid="changes">
        {changes}
      </output>
      <output hidden data-testid="editing">
        {editing}
      </output>
      <output hidden data-testid="errors">
        {JSON.stringify(errors)}
      </output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
