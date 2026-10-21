import { createRoot } from "../../apps/web/node_modules/react-dom/client";
import { AutomationWorkspace } from "../../apps/web/app/automation/workspace";
import type { FlowDefinition } from "../../packages/automation/src/types";

const query = new URLSearchParams(location.search);
const definition: FlowDefinition = {
  schemaVersion: 1,
  id: "a15-ui-flow",
  guildId: "321111111111111111",
  name: "Synthetic editor flow",
  trigger: { kind: "manual", inputs: [] },
  variables: [],
  body: [
    {
      id: "a15-repeat",
      kind: "repeat",
      count: { kind: "missing", type: "Number" },
      itemVariable: { id: "a15-item", name: "Current item", type: "Number" },
      body: [],
    },
  ],
  detached: [],
};
createRoot(document.getElementById("root")!).render(
  <AutomationWorkspace
    locale={query.get("locale") === "ja" ? "ja" : "en"}
    guildId={definition.guildId}
    guildName="Synthetic Community"
    readOnly={query.get("readonly") === "1"}
    initialDefinition={
      query.get("empty") === "1" || query.has("flow") ? undefined : definition
    }
    initialFlowId={query.get("flow") ?? undefined}
    initialRunId={query.get("run") ?? undefined}
    targets={{
      available: true,
      channels: [
        { id: "621111111111111111", name: "announcements", type: 0 },
        { id: "621111111111111112", name: "support", type: 4 },
      ],
      roles: [{ id: "721111111111111111", name: "Participant" }],
    }}
  />,
);
