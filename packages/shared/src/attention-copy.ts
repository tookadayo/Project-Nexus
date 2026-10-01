export function attentionReason(
  surface: string | undefined,
  purpose: string | undefined,
  locale: "ja" | "en",
) {
  if (purpose === "LFG" && ["THREAD", "FORUM_POST"].includes(surface ?? ""))
    return locale === "ja"
      ? "募集の投稿に他の人の参加をまだ確認できません。"
      : "No other-human participation has been observed in this LFG post.";
  if (purpose === "SUPPORT" && surface === "FORUM_POST")
    return locale === "ja"
      ? "質問の投稿に他の人の応答をまだ確認できません。"
      : "No other-human response has been observed in this support post.";
  return locale === "ja"
    ? "設定した時間内に、他の人からの直接返信をまだ確認できません。"
    : "A direct reply from another human has not been confirmed within the configured time.";
}
