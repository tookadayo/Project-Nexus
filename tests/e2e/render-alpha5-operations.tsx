import { createRequire } from "node:module";
import { alpha5Visual, visualStates } from "../fixtures/alpha5-visual";
import { representativeProfiles } from "../fixtures/community-profiles";
import {
  AdaptiveCommunity,
  CommunityModelEditor,
} from "../../apps/web/app/community-model";
import { OperationsView, JourneysView } from "../../apps/web/app/operations-ui";
import { Attention } from "../../apps/web/app/attention";
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
for (const locale of ["ja", "en"] as const) {
  previews[`saved-attention-${locale}`] = {
    state: "INTENT_UNAVAILABLE",
    html: renderToStaticMarkup(
      createElement(Attention, {
        ready: false,
        items: [
          {
            channelId: "333333333333333333",
            messageId: "444444444444444444",
            url: "https://discord.com/channels/111111111111111111/333333333333333333/444444444444444444",
            waitingMinutes: 42,
            status: "OPEN",
            surface: "TEXT",
            purpose: "GENERAL_CONVERSATION",
          },
        ],
        locale,
        channels: [{ id: "333333333333333333", label: "#general" }],
        minutes: 30,
        onChange: () => {},
        onSnooze: () => {},
        onRefresh: () => {},
        onRules: () => {},
      }),
    ),
  };
}
process.stdout.write(JSON.stringify(previews));
