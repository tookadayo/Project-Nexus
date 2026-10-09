import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Attention, type AttentionPost } from "../../apps/web/app/attention";
import {
  AdaptiveCommunity,
  CommunityModelEditor,
} from "../../apps/web/app/community-model";
import {
  controlPanel,
  type ControlData,
} from "../../packages/discord-panels/src/views/control";
import {
  representativeProfiles,
  representativeUi,
} from "../fixtures/community-profiles";
export async function renderPreviews() {
  const previews: Record<
    string,
    { html: string; discord: unknown; expected: string[] }
  > = {};
  for (const [index, fixture] of representativeProfiles.entries())
    for (const locale of ["ja", "en"] as const)
      for (const [view, page] of [
        [0, "overview"],
        [1, "newMembers"],
        [8, "attention"],
        [5, "analysis"],
        [4, "settings"],
        [9, "community"],
      ] as const) {
        const adaptive = representativeUi(index),
          section = view === 4 ? "model" : "main";
        const html = renderToStaticMarkup(
          view === 4
            ? createElement(CommunityModelEditor, {
                initial: adaptive.profile,
                snapshot: adaptive.capabilities,
                locale,
                channels: adaptive.capabilities!.channels.map((c) => ({
                  id: c.id,
                  label: "#fixture-" + c.type,
                })),
                onSave: async () => true,
                onRefresh: async () => true,
              })
            : view === 8
              ? createElement(Attention, {
                  ready: true,
                  items: (fixture.modes.some(
                    (m) => m === "SOCIAL" || m === "SUPPORT_QA",
                  )
                    ? [
                        {
                          channelId: "944444444444444445",
                          messageId: "944444444444444446",
                          url: "https://discord.com/channels/911111111111111111/944444444444444445/944444444444444446",
                          waitingMinutes: 45,
                          status: "OPEN",
                          surface: fixture.modes.some((m) => m === "SUPPORT_QA")
                            ? "FORUM_POST"
                            : "TEXT",
                          purpose: fixture.modes.some((m) => m === "SUPPORT_QA")
                            ? "SUPPORT"
                            : "GENERAL_CONVERSATION",
                        },
                      ]
                    : []) as AttentionPost[],
                  locale,
                  channels: [
                    {
                      id: "944444444444444445",
                      label: fixture.modes.some((m) => m === "SUPPORT_QA")
                        ? "#fixture-support-post"
                        : "#fixture-conversation",
                    },
                  ],
                  minutes: 20,
                  onChange: () => {},
                  onSnooze: () => {},
                  onRefresh: () => {},
                  onRules: () => {},
                })
              : createElement(AdaptiveCommunity, {
                  model: adaptive,
                  locale,
                  view,
                }),
        );
        const community = {
          adaptive,
          daily: { ready: true, attentionCount: 0 },
          attention: [],
          outcomes: { retained: 0, notRetained: 0, pending: 3 },
          analysis: {
            retention: { value: null, state: "PENDING" },
            rules: { retainedFromDay: 7, retainedThroughDay: 14 },
          },
          weekly: {},
          compare: { available: false },
          channels: [],
          arrivalCount: 3,
          eligibleMembers: adaptive.eligible,
          stages: [],
          dataReady: false,
          cohortWindow: {
            joinedFrom: adaptive.window.from,
            joinedThrough: adaptive.window.through,
            observedThroughDays: 14,
          },
          classification: {
            new: 3,
            continuing: 0,
            inactive: 0,
            exited: 0,
            staffExcluded: 0,
          },
          reactionsReceived: 0,
          range: 30,
        } as unknown as ControlData["community"];
        const discord = await controlPanel(
          async () => "signed-fixture",
          page,
          {
            community,
            model: {
              profile: adaptive.profile,
              capabilities: adaptive.capabilities,
              revision: 1,
            },
            updatedAt: new Date(adaptive.window.through),
          },
          locale,
          section,
        );
        previews[`${fixture.name}-${locale}-${view}`] = {
          html,
          discord,
          expected: [...fixture.metricKeys].slice(
            0,
            view === 0 ? (adaptive.volume === "HIGH_VOLUME" ? 3 : 2) : 20,
          ),
        };
      }
  return previews;
}
