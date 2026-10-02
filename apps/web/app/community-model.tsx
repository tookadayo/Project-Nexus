"use client";
import { useState } from "react";
import {
  EvidenceDetails,
  IntegrationWarning,
  JourneysView,
  TeamQueue,
  RecommendationsView,
} from "./operations-ui";
import {
  evidenceValue,
  evidenceFraction,
  evidenceNote,
} from "../../../packages/shared/src/measurement-view";
import { recipeNames } from "../../../packages/shared/src/operations-copy";
import type { TeamOperations } from "../../../packages/operations/src/attention";
import { RecipeWizard } from "./recipe-wizard";
import {
  communityModes,
  channelPurposes,
  tagMeanings,
  type CommunityModel,
  type CapabilitySnapshot,
} from "../../../packages/shared/src/community-model";
import {
  modeNames,
  purposeNames,
  statusNames,
  featureNames,
  metricCopy,
} from "../../../packages/shared/src/community-copy";
import type { AdaptivePresentation } from "../../../packages/presentation/src/adaptive";
export function AdaptiveCommunity({
  model,
  locale,
  view,
  analysisView = "overall",
  attention,
  channels = [],
  operations,
  onSettings,
}: {
  model: AdaptivePresentation;
  locale: "ja" | "en";
  view: number;
  analysisView?: "overall" | "channels" | "behavior";
  attention?: {
    ready: boolean;
    total: number | null;
    items: { url: string; waitingMinutes: number }[];
  };
  channels?: { id: string; label: string }[];
  operations?: TeamOperations;
  onSettings?: () => void;
}) {
  const ja = locale === "ja",
    large = model.volume === "HIGH_VOLUME",
    healthy =
      model.integration?.intents.members === "AVAILABLE" &&
      model.integration.gateway === "CONNECTED";
  const title =
    view === 1
      ? ja
        ? "新しいメンバー"
        : "New members"
      : view === 5
        ? ja
          ? "分析"
          : "Insights"
        : view === 9
          ? ja
            ? "目標と計測のルール"
            : "Goals and measurement rules"
          : ja
            ? "サーバー概要"
            : "Server overview";
  const metrics = model.metrics
      .filter(
        (m) => view !== 5 || analysisView !== "channels" || Boolean(m.surface),
      )
      .slice(0, view === 0 ? (large ? 3 : 2) : 20),
    coverage = model.capabilities?.coverage;
  return (
    <section
      className={`surface adaptive-community ${large ? "large-community" : "small-community"}`}
      data-testid="adaptive-community"
    >
      <h1>{title}</h1>
      <p>
        {model.recipe?.definition
          ? recipeNames[model.recipe.definition.preset][ja ? 0 : 1]
          : model.profile.modes
              .map((m) => modeNames[m][ja ? 0 : 1])
              .join(" · ")}
      </p>
      <IntegrationWarning health={model.integration} locale={locale} />
      <p>
        {ja ? "集計期間" : "Observation window"}:{" "}
        {model.window.from.slice(0, 10)} — {model.window.through.slice(0, 10)}
      </p>
      {!model.profile.confirmed && (
        <p>
          {ja
            ? "機能や利用状況は目的の候補です。Community Modelで運営目的を確認してください。"
            : "Features and observed usage suggest candidates. Confirm the purpose in Community Model."}
        </p>
      )}
      {view === 0 && attention && (
        <section className="priority-attention">
          <h2>{ja ? "対応待ち" : "Attention"}</h2>
          <strong>
            {attention.ready && attention.total !== null
              ? `${attention.total} ${ja ? "件" : "items"}`
              : ja
                ? "新しい対応対象を確認できません"
                : "New attention items cannot be observed"}
          </strong>
          {attention.items.slice(0, large ? 5 : 1).map((item) => (
            <p key={item.url}>
              <a href={item.url} target="_blank" rel="noreferrer">
                {ja ? "投稿を開く" : "Open post"}
              </a>{" "}
              · {item.waitingMinutes} {ja ? "分待ち" : "minutes waiting"}
            </p>
          ))}
        </section>
      )}
      {view === 0 && large && (
        <TeamQueue operations={operations} locale={locale} />
      )}
      {view !== 5 && (
        <div className="cards member-summary">
          <article>
            <h2>{ja ? "確認できた対象者" : "Observed eligible members"}</h2>
            <strong>
              {healthy
                ? model.eligible.toLocaleString(locale)
                : ja
                  ? "確認できません"
                  : "Unknown"}
            </strong>
          </article>
          {!large && (
            <article>
              <h2>{ja ? "ルール確認待ち" : "Screening pending"}</h2>
              <strong>
                {healthy ? model.pending : ja ? "確認できません" : "Unknown"}
              </strong>
            </article>
          )}
        </div>
      )}
      {view === 1 && <JourneysView model={model} locale={locale} compact />}
      {view === 5 && analysisView === "channels" && (
        <section>
          <h2>
            {ja ? "管理者が確認した用途" : "Administrator-confirmed purposes"}
          </h2>
          {model.profile.channels.map((ch) => (
            <p key={ch.channelId}>
              {channels.find((c) => c.id === ch.channelId)?.label ??
                (ja ? "対象チャンネル" : "Selected channel")}{" "}
              · {purposeNames[ch.purpose][ja ? 0 : 1]}
            </p>
          ))}
        </section>
      )}
      <div className="cards metric-cards">
        {metrics.map((metric, i) => {
          const copy = metricCopy(metric, locale),
            ready =
              (metric.evidence?.sampleSize ?? 0) >= 5 &&
              metric.evidence?.observationState === "OBSERVED";
          return (
            <article key={metric.key + ":" + i} data-metric={metric.key}>
              <h2>{copy.label}</h2>
              <strong>
                {((large || view === 1 || view === 5) &&
                ["directReplies", "postResponse"].includes(metric.key)
                  ? evidenceFraction(metric.evidence, locale)
                  : undefined) ?? evidenceValue(metric.evidence, locale)}
                {metric.evidence?.value !== null &&
                metric.evidence?.value !== undefined
                  ? copy.unit
                  : ""}
              </strong>
              {ready &&
                metric.medianMinutes !== null &&
                metric.medianMinutes !== undefined && (
                  <p>
                    {ja ? "中央値" : "Median"}:{" "}
                    {Math.round(metric.medianMinutes)} {ja ? "分" : "min"}
                    {large &&
                    metric.p75Minutes !== null &&
                    metric.p75Minutes !== undefined
                      ? ` · p75 ${Math.round(metric.p75Minutes)} min`
                      : ""}
                  </p>
                )}
              <p>{copy.definition}</p>
              <p>{evidenceNote(metric.evidence, locale)}</p>
              <EvidenceDetails
                evidence={metric.evidence}
                locale={locale}
                definition={copy.definition}
              />
            </article>
          );
        })}
      </div>
      {view === 5 && (
        <RecommendationsView
          model={model}
          locale={locale}
          onSettings={onSettings}
        />
      )}
      {view === 9 && (
        <>
          <h2>{ja ? "確認する内容" : "What is measured"}</h2>
          <p>
            {ja
              ? "目的に合う活動、応答、参加後の変化を、現在の計測方法の定義で確認します。"
              : "Relevant activity, responses, and participation transitions follow the current recipe definition."}
          </p>
          <p>
            {ja ? "他のメンバーと" : "With other eligible members"}{" "}
            {model.profile.voiceThresholdSeconds / 60}{" "}
            {ja
              ? "分以上、同じVoice Channelに参加。音声や会話内容は確認しません。"
              : "minutes or longer in the same Voice channel. No audio or conversation content is observed."}
          </p>
        </>
      )}
      <p>
        {ja ? "NEXUSが確認できるチャンネル" : "Channels NEXUS can observe"}:{" "}
        {coverage?.observableChannels ?? (ja ? "未確認" : "Unknown")} ·{" "}
        {ja ? "サーバー全体のチャンネル数" : "Server-wide total"}:{" "}
        {coverage?.totalState === "KNOWN"
          ? coverage.knownTotalChannels
          : ja
            ? "Discordから確認できません"
            : "Unavailable from Discord"}
      </p>
      <p>
        {ja
          ? "メッセージ本文・DM・Voice音声・オンライン状態は確認しません。"
          : "Message content, DMs, voice audio and online status are not observed."}
      </p>
    </section>
  );
}
export function CommunityModelEditor({
  initial,
  snapshot,
  locale,
  channels,
  tags = [],
  onSave,
  onRefresh,
}: {
  initial: CommunityModel;
  snapshot: CapabilitySnapshot | null;
  locale: "ja" | "en";
  channels: { id: string; label: string }[];
  tags?: { channelId: string; id: string; label: string }[];
  onSave: (profile: CommunityModel) => Promise<boolean>;
  onRefresh: () => Promise<boolean>;
}) {
  const [profile, setProfile] = useState(initial),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    ja = locale === "ja";
  const name = (id: string) =>
    channels.find((c) => c.id === id)?.label ?? `#${id}`;
  const submit = async () => {
    setBusy(true);
    try {
      if (await onSave({ ...profile, confirmed: true }))
        setNotice(
          ja
            ? "運営目的を保存しました。画面を再読み込みすると反映されます。"
            : "Community purposes saved. Reload to see adapted measurements.",
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="surface community-model"
      data-testid="community-model-settings"
    >
      <h2>{ja ? "コミュニティモデル" : "Community model"}</h2>
      <RecipeWizard
        profile={profile}
        snapshot={snapshot}
        locale={locale}
        onChange={setProfile}
        onConfirm={submit}
        busy={busy}
        channels={channels}
      />
      <details>
        <summary>
          {ja
            ? "目的・チャンネル・タグを詳しく設定"
            : "Advanced purposes, channels and tags"}
        </summary>
        <p>
          {ja
            ? "運営目的は複数選択できます。チャンネル名・タグ名だけで用途を決めません。"
            : "Choose multiple purposes. Channel and tag names never determine meaning automatically."}
        </p>
        <fieldset>
          <legend>{ja ? "運営目的" : "Community purposes"}</legend>
          {communityModes.map((mode) => (
            <label key={mode}>
              <input
                type="checkbox"
                checked={profile.modes.includes(mode)}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    modes: e.target.checked
                      ? [...profile.modes, mode]
                      : profile.modes.filter((m) => m !== mode),
                  })
                }
              />
              {modeNames[mode][ja ? 0 : 1]}
              {snapshot?.suggestions.includes(mode)
                ? ja
                  ? "（構造からの候補）"
                  : " (suggested by structure)"
                : ""}
            </label>
          ))}
        </fieldset>
        <label>
          {ja
            ? "ボイス同席の基準（分）"
            : "Voice co-presence threshold (minutes)"}
          <input
            type="number"
            min="1"
            max="60"
            value={profile.voiceThresholdSeconds / 60}
            onChange={(e) =>
              setProfile({
                ...profile,
                voiceThresholdSeconds: Number(e.target.value) * 60,
              })
            }
          />
        </label>
        <details>
          <summary>{ja ? "チャンネルの用途" : "Channel purposes"}</summary>
          {(snapshot?.channels ?? [])
            .filter((c) => [0, 2, 5, 13, 15, 16].includes(c.type))
            .map((c) => (
              <label key={c.id}>
                {name(c.id)}
                <select
                  value={
                    profile.channels.find((p) => p.channelId === c.id)
                      ?.purpose ?? "OTHER"
                  }
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      channels: [
                        ...profile.channels.filter((p) => p.channelId !== c.id),
                        {
                          channelId: c.id,
                          purpose: e.target
                            .value as (typeof channelPurposes)[number],
                        },
                      ],
                    })
                  }
                >
                  {channelPurposes.map((p) => (
                    <option key={p} value={p}>
                      {purposeNames[p][ja ? 0 : 1]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </details>
        <details>
          <summary>
            {ja ? "Forum・Mediaタグの意味" : "Forum / Media tag meanings"}
          </summary>
          <p>
            {ja
              ? "解決はここで指定したタグで判断します。アーカイブやロックでは判断しません。"
              : "Resolution requires an explicitly mapped tag; archive and lock do not imply resolution."}
          </p>
          {(snapshot?.channels ?? [])
            .filter((c) => [15, 16].includes(c.type))
            .flatMap((c) =>
              c.tagIds.map((tag) => (
                <label key={c.id + tag}>
                  {name(c.id)} ·{" "}
                  {tags.find((t) => t.channelId === c.id && t.id === tag)
                    ?.label ?? tag}
                  <select
                    value={
                      profile.forumTags.find(
                        (t) => t.channelId === c.id && t.tagId === tag,
                      )?.meaning ?? "OTHER"
                    }
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        forumTags: [
                          ...profile.forumTags.filter(
                            (t) => t.channelId !== c.id || t.tagId !== tag,
                          ),
                          {
                            channelId: c.id,
                            tagId: tag,
                            meaning: e.target
                              .value as (typeof tagMeanings)[number],
                          },
                        ],
                      })
                    }
                  >
                    {tagMeanings.map((m) => (
                      <option key={m} value={m}>
                        {m === "RESOLVED"
                          ? ja
                            ? "解決"
                            : "Resolved"
                          : m === "SUPPORT_REQUEST"
                            ? ja
                              ? "サポート依頼"
                              : "Support request"
                            : m === "OTHER"
                              ? ja
                                ? "その他・未指定"
                                : "Other"
                              : m.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              )),
            )}
        </details>
        <button disabled={busy || !profile.modes.length} onClick={submit}>
          {ja ? "目的と用途を保存" : "Save purposes and mappings"}
        </button>
      </details>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            if (await onRefresh())
              setNotice(
                ja
                  ? "再検出を予約しました。しばらくしてから再読み込みしてください。"
                  : "Rediscovery queued. Reload shortly to see the result.",
              );
          } finally {
            setBusy(false);
          }
        }}
      >
        {ja ? "再検出" : "Rediscover capabilities"}
      </button>
      <p role="status">{notice}</p>
      <details>
        <summary>
          {ja
            ? "検出されたDiscord機能の詳細"
            : "Detected Discord capability details"}
        </summary>
        {snapshot ? (
          <>
            <p>
              {ja ? "観測できるチャンネル" : "Observable channels"}{" "}
              {snapshot.coverage.observableChannels}
              {snapshot.coverage.totalState === "KNOWN"
                ? ` / ${snapshot.coverage.knownTotalChannels}`
                : ja
                  ? " · サーバー全体の数は確認できません"
                  : " · Server-wide total unavailable"}
            </p>
            <ul>
              {Object.entries(snapshot.capabilities).map(([feature, entry]) => (
                <li key={feature}>
                  {featureNames[feature]?.[ja ? 0 : 1] ?? feature}:{" "}
                  {statusNames[entry.status][ja ? 0 : 1]}
                  {entry.availableSince
                    ? ` · ${ja ? "観測開始" : "Collection since"} ${entry.availableSince.slice(0, 10)}`
                    : ""}
                </li>
              ))}
            </ul>
            <p>
              {ja ? "最終確認" : "Last checked"}:{" "}
              {snapshot.checkedAt.slice(0, 16).replace("T", " ")} UTC
            </p>
            <p>
              {ja ? "チャンネル構成" : "Channel counts"}:{" "}
              {Object.entries(snapshot.channelTypeCounts)
                .map(
                  ([type, count]) =>
                    `${({ 0: ja ? "テキスト" : "Text", 2: "Voice", 5: "Announcement", 13: "Stage", 15: "Forum", 16: "Media" } as Record<string, string>)[type] ?? type} ${count}`,
                )
                .join(" · ")}
            </p>
            {snapshot.threadCounts && (
              <p>
                {ja ? "閲覧できる活動中のThread" : "Accessible active threads"}:{" "}
                {snapshot.threadCounts.active ?? (ja ? "未確認" : "Unknown")}
              </p>
            )}
            {snapshot.onboarding && (
              <p>
                Discord Onboarding ·{" "}
                {ja ? "既定のチャンネル" : "Default channels"}{" "}
                {snapshot.onboarding.defaultChannelIds.length} ·{" "}
                {ja ? "必須の質問" : "Required questions"}{" "}
                {snapshot.onboarding.prompts.filter((p) => p.required).length}.{" "}
                {ja
                  ? "同じ質問をNEXUSで作り直す必要はありません。"
                  : "You do not need to recreate these questions in NEXUS."}
              </p>
            )}
            {snapshot.coverage.blindSpots.length > 0 && (
              <p>
                {ja
                  ? "閲覧権限がないチャンネル"
                  : "Missing View Channel permission"}
                :{" "}
                {snapshot.coverage.blindSpots
                  .map((c) => name(c.channelId))
                  .join(", ")}
              </p>
            )}
            <p>
              {ja
                ? "非公開・アーカイブ済みThreadの総数と履歴は把握できません。外部イベントの出席、会話内容、投票の意味は観測できません。"
                : "Private/archived thread totals and history are unknown. External attendance, conversation and poll meaning are not observable."}
            </p>
          </>
        ) : (
          <p>
            {ja
              ? "機能検出を待っています。再検出で確認できます。"
              : "Awaiting capability discovery. Use Rediscover to request it."}
          </p>
        )}
      </details>
    </section>
  );
}
