"use client";
import { useState } from "react";
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
}) {
  const ja = locale === "ja",
    title =
      view === 1
        ? ja
          ? "新規メンバーの歩み"
          : "New member progress"
        : view === 5
          ? ja
            ? "運営目的に合わせた分析"
            : "Analysis for your community"
          : view === 9
            ? ja
              ? "目標と計測のルール"
              : "Goals and measurement rules"
            : ja
              ? "コミュニティの状況"
              : "Community overview";
  return (
    <section
      className="surface adaptive-community"
      data-testid="adaptive-community"
    >
      <h1>{title}</h1>
      <p>
        {model.profile.modes.map((m) => modeNames[m][ja ? 0 : 1]).join(" · ") ||
          (ja
            ? "運営目的を設定で選んでください。"
            : "Choose your community purposes in Settings.")}
      </p>
      {!model.profile.confirmed && (
        <p>
          {ja
            ? "検出結果は候補です。管理者の確認後に目的ごとの指標を表示します。"
            : "Detected structure suggests possibilities; an administrator confirms the purposes."}
        </p>
      )}
      <p>
        {model.volume === "LOW_VOLUME"
          ? ja
            ? "人数を中心に表示しています。"
            : "Showing counts for a small observed sample."
          : model.volume === "HIGH_VOLUME"
            ? ja
              ? "対応の優先順と集計を中心に表示しています。"
              : "Showing a priority queue and aggregate bottlenecks."
            : ja
              ? "活動と応答を集計しています。"
              : "Showing activity and responses."}
      </p>
      {view === 0 && attention && (
        <section className="priority-attention">
          <h2>{ja ? "応答待ちの優先確認" : "Priority response queue"}</h2>
          <p>
            {attention.ready
              ? `${attention.total ?? 0} ${ja ? "件" : "posts"}`
              : ja
                ? "観測状況を確認中"
                : "Observation status unknown"}
          </p>
          {attention.items
            .slice(0, model.volume === "HIGH_VOLUME" ? 5 : 3)
            .map((item) => (
              <p key={item.url}>
                <a href={item.url} target="_blank" rel="noreferrer">
                  {ja ? "投稿を開く" : "Open post"}
                </a>{" "}
                · {item.waitingMinutes} {ja ? "分待ち" : "minutes waiting"}
              </p>
            ))}
        </section>
      )}
      {view === 5 && analysisView === "channels" && (
        <section>
          <h2>
            {ja
              ? "管理者が確認したチャンネル目的"
              : "Administrator-confirmed channel purposes"}
          </h2>
          {model.profile.channels.length ? (
            model.profile.channels.map((ch) => (
              <p key={ch.channelId}>
                {channels.find((c) => c.id === ch.channelId)?.label ??
                  `#${ch.channelId}`}{" "}
                · {purposeNames[ch.purpose][ja ? 0 : 1]}
              </p>
            ))
          ) : (
            <p>
              {ja
                ? "設定で目的を対応付けると、場所ごとの応答を確認できます。"
                : "Map channel purposes in Settings to review responses by place."}
            </p>
          )}
        </section>
      )}
      <div className="cards">
        <article>
          <h2>{ja ? "観測対象" : "Eligible members"}</h2>
          <strong>{model.eligible.toLocaleString(locale)}</strong>
        </article>
        <article>
          <h2>{ja ? "ルール確認待ち" : "Screening pending"}</h2>
          <strong>{model.pending}</strong>
        </article>
        <article>
          <h2>Guest</h2>
          <strong>{model.guests}</strong>
          <p>
            {ja
              ? "通常の継続率の対象外"
              : "Excluded from regular member follow-up"}
          </p>
        </article>
      </div>
      {model.progress && (view === 0 || view === 1 || view === 9) && (
        <section className="member-progress">
          <h2>{ja ? "新規メンバーの参加状況" : "New member participation"}</h2>
          <p>
            {ja ? "参加期間" : "Joined period"}:{" "}
            {model.progress.from.slice(0, 10)} –{" "}
            {model.progress.through.slice(0, 10)} ·{" "}
            {ja ? "観測期間" : "Observation period"}{" "}
            {model.progress.observationDays}
            {ja ? "日" : " days"}
          </p>
          <div className="cards">
            {(
              [
                [ja ? "参加" : "Joined", model.progress.eligible],
                [
                  ja ? "目的に合う最初の活動" : "First relevant activity",
                  model.progress.first,
                ],
                [
                  ja
                    ? "応答・一定時間の同席"
                    : "Response or sustained co-presence",
                  model.progress.connected,
                ],
                [
                  ja ? "複数日に参加" : "Participation on multiple days",
                  model.progress.repeated,
                ],
                [
                  ja ? "後日の参加" : "Later participation",
                  model.progress.retained,
                ],
              ] as const
            ).map(([label, count]) => (
              <article key={label}>
                <h3>{label}</h3>
                <strong>
                  {count} / {model.progress!.eligible}
                </strong>
              </article>
            ))}
          </div>
          <p>
            {ja ? "観測途中" : "Still observing"} {model.progress.pending} ·{" "}
            {ja ? "観測不足" : "Insufficient coverage"}{" "}
            {model.progress.insufficient}.{" "}
            {ja ? "複数日の参加" : "Repeated participation"}:{" "}
            {model.progress.repeatDays}
            {ja ? "日以上" : " or more days"}.{" "}
            {ja ? "後日の参加" : "Later participation"}:{" "}
            {model.progress.returnFromDay}–{model.progress.returnThroughDay}
            {ja ? "日目" : " days after joining"}.
          </p>
          <p>
            {ja
              ? "上段の各人数は、十分な期間を観測できた同じ対象者です。目的に合う活動を確認し、その後に応答・同席、複数日、後日の参加を順に確認します。ルール確認待ち・Guest・スタッフは含みません。"
              : "Each step uses the same members with a complete observation period. Relevant activity is followed by a response or sustained co-presence, participation on multiple days, and later participation. Screening pending, guests and staff are excluded."}
          </p>
        </section>
      )}
      {view === 1 &&
        (model.journey.onboardingStarted > 0 ||
          model.journey.guideStarted > 0 ||
          model.capabilities?.capabilities.onboarding?.status ===
            "ENABLED") && (
          <div className="cards">
            <article>
              <h2>{ja ? "Discordの参加案内" : "Discord Onboarding"}</h2>
              <p>
                {ja ? "開始" : "Started"} {model.journey.onboardingStarted} ·{" "}
                {ja ? "完了" : "Completed"} {model.journey.onboardingCompleted}
              </p>
            </article>
            <article>
              <h2>{ja ? "サーバーガイド" : "Server Guide"}</h2>
              <p>
                {ja ? "開始" : "Started"} {model.journey.guideStarted} ·{" "}
                {ja ? "完了" : "Completed"} {model.journey.guideCompleted}
              </p>
            </article>
          </div>
        )}
      <div className="cards">
        {model.metrics
          .filter((metric) =>
            view !== 5 ||
            analysisView === "overall" ||
            analysisView === "channels"
              ? view !== 5 ||
                analysisView !== "channels" ||
                Boolean(metric.surface)
              : ![
                  "resolvedPosts",
                  "supportPosts",
                  "lfgPosts",
                  "feedbackPosts",
                  "showcasePosts",
                  "postsAwaitingResponse",
                ].includes(metric.key),
          )
          .map((metric, i) => {
            const copy = metricCopy(metric, locale);
            return (
              <article key={metric.key + ":" + i} data-metric={metric.key}>
                <h2>{copy.label}</h2>
                <strong>
                  {metric.count === null
                    ? ja
                      ? "未確認"
                      : "Unknown"
                    : metric.count.toLocaleString(locale)}
                </strong>
                {metric.medianMinutes != null && (
                  <p>
                    {ja ? "応答時間の中央値" : "Median response time"}:{" "}
                    {Math.round(metric.medianMinutes)} {ja ? "分" : "min"}
                  </p>
                )}
                {model.volume === "HIGH_VOLUME" &&
                  metric.p75Minutes != null && (
                    <p>
                      p75 {Math.round(metric.p75Minutes)} / p90{" "}
                      {Math.round(metric.p90Minutes ?? 0)} {ja ? "分" : "min"}
                    </p>
                  )}
                <p>{copy.definition}</p>
                <p>
                  {ja ? "観測人数・件数" : "Observed sample"}: {metric.sample}
                  {metric.denominator !== null
                    ? ` / ${metric.denominator}`
                    : ""}{" "}
                  ·{" "}
                  {metric.state === "PARTIAL"
                    ? ja
                      ? "一部のみ観測"
                      : "Partial observation"
                    : metric.state === "PENDING"
                      ? ja
                        ? "観測待ち"
                        : "Awaiting observations"
                      : metric.state === "UNKNOWN"
                        ? ja
                          ? "未確認"
                          : "Unknown"
                        : ja
                          ? "観測済み"
                          : "Observed"}
                </p>
                {metric.purpose && (
                  <p>
                    {
                      purposeNames[
                        metric.purpose as keyof typeof purposeNames
                      ]?.[ja ? 0 : 1]
                    }
                  </p>
                )}
              </article>
            );
          })}
      </div>
      <p>
        {ja ? "対象チャンネル" : "Channel coverage"}:{" "}
        {model.coverage.observableChannels} /{" "}
        {model.coverage.totalRelevantChannels} ·{" "}
        {model.coverage.partial
          ? ja
            ? "観測範囲は一部です。サーバー全体の状態とは限りません。"
            : "Coverage is partial; these results may not represent the entire server."
          : ja
            ? "対象を観測"
            : "Relevant channels observable"}
      </p>
      <p>
        {ja ? "集計期間" : "Observation window"}:{" "}
        {model.window.from.slice(0, 10)} — {model.window.through.slice(0, 10)}
      </p>
      {(model.profile.modes.includes("VOICE") ||
        model.profile.modes.includes("LFG_PLAY")) && (
        <p>
          {ja ? "ボイス同席の基準" : "Voice co-presence threshold"}:{" "}
          {model.profile.voiceThresholdSeconds / 60} {ja ? "分" : "minutes"}
        </p>
      )}
      {model.capabilities &&
        Object.values(model.capabilities.incidents).some(Boolean) && (
          <p>
            {ja
              ? "Discordの安全性に関する状況を検出しています。期間比較の解釈には確認が必要です。"
              : "A Discord safety context was detected; review it when comparing periods."}
          </p>
        )}
      <p>
        {ja
          ? "本文・画像・音声・投票の意味は収集しません。案内完了は交流の条件ではありません。"
          : "No message body, images, audio or poll meaning is collected. Onboarding completion is not an engagement requirement."}
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
                  profile.channels.find((p) => p.channelId === c.id)?.purpose ??
                  "OTHER"
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
      <h3>{ja ? "検出されたDiscord機能" : "Detected Discord capabilities"}</h3>
      {snapshot ? (
        <>
          <p>
            {ja ? "観測できるチャンネル" : "Observable channels"}{" "}
            {snapshot.coverage.observableChannels} /{" "}
            {snapshot.coverage.totalRelevantChannels}
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
    </section>
  );
}
