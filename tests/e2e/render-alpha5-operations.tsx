import { createRequire } from "node:module";
import { alpha5Visual, visualStates } from "../fixtures/alpha5-visual";
import { representativeProfiles } from "../fixtures/community-profiles";
import {
  AdaptiveCommunity,
  CommunityModelEditor,
} from "../../apps/web/app/community-model";
import { OperationsView, JourneysView } from "../../apps/web/app/operations-ui";
const require = createRequire(import.meta.url);
const { createElement } =
  require("../../apps/web/node_modules/react/index.js") as typeof import("react");
const { renderToStaticMarkup } =
  require("../../apps/web/node_modules/react-dom/server.node.js") as typeof import("react-dom/server");
const previews: Record<string, { html: string; state: string }> = {};
for (const [index, profile] of representativeProfiles.entries())
  for (const state of visualStates) {
    const { model, community } = alpha5Visual(index, state);
    const component = createElement(AdaptiveCommunity, {
      model,
      locale: "ja",
      view: 0,
      operations: community.operations,
      attention: {
        ready: community.daily.ready,
        total: community.daily.attentionCount,
        items: community.attention,
      },
    });
    previews[`${profile.name}-${state}`] = {
      html: renderToStaticMarkup(component),
      state,
    };
  }
for (const view of [1, 5, 9, 10, 11, 12, 13, 14])
  for (const locale of ["ja", "en"] as const) {
    const { model, community } = alpha5Visual(4, "ATTENTION");
    const component =
      view === 10
        ? createElement(JourneysView, { model, locale })
        : view === 11
          ? createElement(CommunityModelEditor, {
              initial: model.profile,
              snapshot: model.capabilities,
              locale,
              channels: [],
              onSave: async () => true,
              onRefresh: async () => true,
            })
          : view >= 12
            ? createElement(OperationsView, { model, locale, view })
            : createElement(AdaptiveCommunity, {
                model,
                locale,
                view,
                operations: community.operations,
              });
    previews[`operations-${locale}-${view}`] = {
      html: renderToStaticMarkup(component),
      state: "HEALTHY",
    };
  }
process.stdout.write(JSON.stringify(previews));
