"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { recipePresets } from "../../../../packages/shared/src/measurement-recipes";
import type { RecipeVersion } from "../../../../packages/settings/src/recipes";
export function RecipeControls({
  locale,
  recipe,
}: {
  locale: "ja" | "en";
  recipe: RecipeVersion | null;
}) {
  const ja = locale === "ja",
    router = useRouter(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const strong = [
    ["reply.received", "直接返信", "Direct reply"],
    ["thread.response_received", "投稿への最初の応答", "First post response"],
    [
      "voice.connected",
      "条件を満たすボイス同席",
      "Qualified Voice co-presence",
    ],
    [
      "scheduled_event.attended",
      "観測できたイベント出席",
      "Observable Event attendance",
    ],
  ];
  const support = [
    ["message.sent", "投稿", "Post"],
    ["reaction.added", "リアクション参加", "Reaction participation"],
    ["poll.participated", "投票参加", "Poll participation"],
    ["scheduled_event.subscribed", "イベント参加登録", "Event signup"],
    ["stage.participated", "Stage参加", "Stage participation"],
    ["voice.duration", "ボイス参加時間", "Voice duration"],
    ["thread.member_added", "Thread参加", "Thread membership"],
  ];
  const names: Record<string, string[]> = {
    SOCIAL: ["会話と返信", "Replies"],
    LFG_GAMING: ["LFGとゲーム", "LFG"],
    SUPPORT_FORUM: ["サポートForum", "Support Forum"],
    CREATOR_FAN: ["クリエイター", "Creator"],
    EVENT_STAGE: ["イベントとStage", "Events / Stage"],
    VOICE_FIRST: ["ボイス中心", "Voice first"],
    LARGE_MIXED: ["複数の活動", "Mixed community"],
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/billing/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset: data.get("preset"),
          expectedHead: recipe?.id ?? null,
          ...(recipe?.customKey ? { key: recipe.customKey } : {}),
          strongSignals: data.getAll("strong"),
          supportingSignals: data.getAll("support"),
          voiceThresholdSeconds: Number(data.get("voice")) * 60,
          returnFromDay: Number(data.get("from")),
          returnThroughDay: Number(data.get("through")),
        }),
      });
      setMessage(
        response.ok
          ? ja
            ? "新しい計測方法を保存しました。過去の計測定義は保持されます。"
            : "Saved a new recipe version. Past definitions are preserved."
          : ja
            ? "保存できません。権限・プラン・入力と最新の設定を確認してください。"
            : "Could not save. Check authority, plan, input and current settings.",
      );
      if (response.ok) router.refresh();
    } catch {
      setMessage(
        ja
          ? "保存結果を確認できません。最新の設定を確認してください。"
          : "Save result is uncertain. Check current settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="billing-card">
      <h2>{ja ? "計測方法を調整" : "Customize measurement"}</h2>
      <p>
        {ja
          ? "どの観測を最初の交流とするか、同席の最低時間と参加後の活動期間を設定します。リアクションは交流の証明にしません。"
          : "Choose first connection signals, minimum co-presence time and later activity days. Reactions remain participation evidence."}
      </p>
      <form className="billing-form" onSubmit={submit}>
        <label>
          {ja ? "基本の計測方法" : "Base recipe"}
          <select name="preset" defaultValue={recipe?.preset ?? "SOCIAL"}>
            {recipePresets.map((preset) => (
              <option value={preset} key={preset}>
                {names[preset]![ja ? 0 : 1]}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>
            {ja ? "最初の交流の観測" : "First connection observations"}
          </legend>
          {strong.map(([value, jp, en]) => (
            <label key={value}>
              <input
                name="strong"
                type="checkbox"
                value={value}
                defaultChecked={recipe?.definition?.strongSignals.includes(
                  value!,
                )}
              />
              {ja ? jp : en}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{ja ? "参加の観測" : "Participation observations"}</legend>
          {support.map(([value, jp, en]) => (
            <label key={value}>
              <input
                name="support"
                type="checkbox"
                value={value}
                defaultChecked={recipe?.definition?.supportingSignals.includes(
                  value!,
                )}
              />
              {ja ? jp : en}
            </label>
          ))}
        </fieldset>
        <label>
          {ja
            ? "ボイス同席の最低時間（分）"
            : "Minimum Voice co-presence (minutes)"}
          <input
            name="voice"
            type="number"
            min={1}
            max={60}
            defaultValue={
              (recipe?.definition?.voiceThresholdSeconds ?? 300) / 60
            }
          />
        </label>
        <label>
          {ja ? "参加後の活動期間：開始日" : "Later activity: first day"}
          <input
            name="from"
            type="number"
            min={2}
            max={30}
            defaultValue={recipe?.definition?.returnFromDay ?? 7}
          />
        </label>
        <label>
          {ja
            ? "参加後の活動期間：終了日（含まない）"
            : "Later activity: last day (exclusive)"}
          <input
            name="through"
            type="number"
            min={7}
            max={60}
            defaultValue={recipe?.definition?.returnThroughDay ?? 14}
          />
        </label>
        <button className="button button-primary" disabled={busy}>
          {ja ? "新しい版として保存" : "Save new version"}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </article>
  );
}
