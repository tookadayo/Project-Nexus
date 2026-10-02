"use client";
import { useState } from "react";
import type {
  CommunityModel,
  CapabilitySnapshot,
} from "../../../packages/shared/src/community-model";
import {
  recipePresets,
  presetDefinitions,
  presetForProfile,
  operationsContextSchema,
  recipeCandidates,
  entryModes,
} from "../../../packages/shared/src/measurement-recipes";
import { recipeNames } from "../../../packages/shared/src/operations-copy";
import {
  metricCopy,
  featureNames,
} from "../../../packages/shared/src/community-copy";
export function RecipeWizard({
  profile,
  snapshot,
  locale,
  onChange,
  onConfirm,
  busy,
  channels,
}: {
  profile: CommunityModel;
  snapshot: CapabilitySnapshot | null;
  locale: "ja" | "en";
  onChange: (profile: CommunityModel) => void;
  onConfirm: () => Promise<void>;
  busy: boolean;
  channels: { id: string; label: string }[];
}) {
  const [step, setStep] = useState(0),
    ja = locale === "ja",
    preset = presetForProfile(profile),
    definition = presetDefinitions[preset],
    context = operationsContextSchema.parse(profile.operations ?? {}),
    candidates = recipeCandidates(
      snapshot,
      snapshot?.memberCount && snapshot.memberCount >= 10000
        ? "HIGH_VOLUME"
        : "STANDARD",
    );
  const headings = ja
    ? [
        "Discord機能を確認",
        "利用状況を確認",
        "運営目的を選ぶ",
        "測定内容を確認",
      ]
    : [
        "Check Discord features",
        "Check observed usage",
        "Choose your purpose",
        "Review measurements",
      ];
  return (
    <section className="recipe-wizard" data-testid="recipe-wizard">
      <h3>
        {ja ? "このサーバーで確認すること" : "What NEXUS will measure here"}
      </h3>
      <p>
        {step + 1} / 4 · {headings[step]}
      </p>
      {step === 0 && (
        <>
          <p>
            {ja
              ? "利用できる機能を確認します。用途は次の手順で管理者が選びます。"
              : "Review available features. You choose their purpose in the next steps."}
          </p>
          {snapshot ? (
            <ul>
              {Object.entries(snapshot.capabilities)
                .filter(([, c]) =>
                  ["AVAILABLE", "ENABLED", "OBSERVED", "CONFIGURED"].includes(
                    c.status,
                  ),
                )
                .map(([key]) => (
                  <li key={key}>{featureNames[key]?.[ja ? 0 : 1] ?? key}</li>
                ))}
            </ul>
          ) : (
            <p>
              {ja
                ? "Discord機能の検出を待っています。目的は手動でも選べます。"
                : "Awaiting discovery. You can still choose your purpose manually."}
            </p>
          )}
        </>
      )}
      {step === 1 && (
        <>
          <p>
            {ja
              ? "NEXUSが受信した利用状況です。未観測は未使用を意味しません。"
              : "These uses were observed by NEXUS. Unobserved does not mean unused."}
          </p>
          {snapshot && Object.keys(snapshot.observedUsage).length ? (
            <ul>
              {Object.entries(snapshot.observedUsage).map(([key, count]) => (
                <li key={key}>
                  {featureNames[key]?.[ja ? 0 : 1] ?? key}:{" "}
                  {count.toLocaleString(locale)}{" "}
                  {ja ? "件の観測" : "observations"}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {ja
                ? "利用状況はまだ確認できていません。"
                : "Usage has not yet been established."}
            </p>
          )}
        </>
      )}
      {step === 2 && (
        <>
          <label>
            {ja ? "運営目的" : "Community purpose"}
            <select
              value={preset}
              onChange={(e) => {
                const next = e.target.value as typeof preset;
                onChange({
                  ...profile,
                  recipePreset: next,
                  modes: [...presetDefinitions[next].modes],
                });
              }}
            >
              {recipePresets.map((p) => (
                <option key={p} value={p}>
                  {recipeNames[p][ja ? 0 : 1]}
                </option>
              ))}
            </select>
          </label>
          <p>
            {ja
              ? "候補は確認のための参考です。自動で用途を確定しません。"
              : "Candidates help you decide. They do not automatically establish purpose."}
          </p>
          <ul>
            {candidates.map((c) => (
              <li key={c.preset}>
                {recipeNames[c.preset][ja ? 0 : 1]} ·{" "}
                {c.source === "CAPABILITY"
                  ? ja
                    ? "利用できる機能からの候補"
                    : "Available feature"
                  : c.source === "OBSERVED_USAGE"
                    ? ja
                      ? "利用を観測"
                      : "Observed usage"
                    : ja
                      ? "規模からの候補"
                      : "Observed scale"}
              </li>
            ))}
          </ul>
          {["LFG_GAMING", "SUPPORT_FORUM"].includes(preset) && (
            <label>
              {ja ? "対象チャンネル" : "Target channel"}
              <select
                value={
                  profile.channels.find(
                    (c) =>
                      c.purpose ===
                      (preset === "LFG_GAMING" ? "LFG" : "SUPPORT"),
                  )?.channelId ?? ""
                }
                onChange={(e) => {
                  const channelId = e.target.value,
                    purpose =
                      preset === "LFG_GAMING"
                        ? ("LFG" as const)
                        : ("SUPPORT" as const);
                  onChange({
                    ...profile,
                    channels: [
                      ...profile.channels.filter(
                        (c) =>
                          c.purpose !== purpose && c.channelId !== channelId,
                      ),
                      ...(channelId ? [{ channelId, purpose }] : []),
                    ],
                  });
                }}
              >
                <option value="">
                  {ja
                    ? "用途を確認して選択"
                    : "Choose after confirming its purpose"}
                </option>
                {(snapshot?.channels ?? [])
                  .filter((c) => c.observable && [0, 15].includes(c.type))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {channels.find((ch) => ch.id === c.id)?.label ??
                        `#${c.id}`}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            {ja ? "参加方法" : "Entry mode"}
            <select
              value={context.entryMode}
              onChange={(e) =>
                onChange({
                  ...profile,
                  operations: {
                    ...context,
                    entryMode: e.target.value as typeof context.entryMode,
                  },
                })
              }
            >
              {entryModes.map((mode) => (
                <option key={mode} value={mode}>
                  {
                    {
                      INVITE: ja ? "招待" : "Invite",
                      APPLY_TO_JOIN: "Apply to Join",
                      DISCOVERY: "Discovery",
                      UNKNOWN: ja ? "未指定" : "Unknown",
                    }[mode]
                  }
                </option>
              ))}
            </select>
          </label>
          {context.entryMode === "APPLY_TO_JOIN" && (
            <p>
              {ja
                ? "計測はDiscordで参加が承認された後から始まります。申請数・却下数・承認率は確認できません。"
                : "Measurement starts after Discord approves membership. Applications, rejections and approval rates are not observable."}
            </p>
          )}
          {context.entryMode === "DISCOVERY" && (
            <p>
              {ja
                ? "参加前の閲覧数や閲覧から参加への割合は確認できません。"
                : "Pre-join views and view-to-join conversion are not observable."}
            </p>
          )}
        </>
      )}
      {step === 3 && (
        <>
          <h4>{recipeNames[preset][ja ? 0 : 1]}</h4>
          <ul>
            {definition.metrics.map((key) => (
              <li key={key}>
                ✓{" "}
                {key === "laterActivity"
                  ? ja
                    ? "参加後7〜14日目にも活動"
                    : "Activity on days 7–14 after joining"
                  : metricCopy(
                      {
                        key,
                        count: null,
                        sample: 0,
                        denominator: null,
                        definition: "",
                        state: "UNKNOWN",
                      },
                      locale,
                    ).label}
              </li>
            ))}
          </ul>
          <p>
            {ja
              ? "Voiceは他のメンバーと同じチャンネルに一定時間参加した事実を確認します。会話内容は確認しません。"
              : "Voice measures sustained co-presence with other members. Conversation content is not observed."}
          </p>
          <h4>{ja ? "確認しないもの" : "Excluded data"}</h4>
          <p>
            {ja
              ? "メッセージ本文 · DM · Voice音声 · オンライン状態"
              : "Message content · DMs · Voice audio · Online presence"}
          </p>
          <p>
            {ja
              ? "保存した測定方法は版として保持されます。変更前後で方法が異なる期間は直接比較しません。"
              : "Saved measurements are versioned. Periods with different definitions are not directly compared."}
          </p>
          <button
            disabled={busy || !profile.modes.length}
            onClick={() => void onConfirm()}
          >
            {ja ? "この測定方法を保存" : "Save this measurement recipe"}
          </button>
        </>
      )}
      <div className="actions">
        {step > 0 && (
          <button disabled={busy} onClick={() => setStep(step - 1)}>
            {ja ? "戻る" : "Back"}
          </button>
        )}
        {step < 3 && (
          <button disabled={busy} onClick={() => setStep(step + 1)}>
            {ja ? "次へ" : "Next"}
          </button>
        )}
      </div>
    </section>
  );
}
