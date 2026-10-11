export function attentionReason(
  surface: string | undefined,
  purpose: string | undefined,
  locale: "ja" | "en",
) {
  if (purpose === "LFG" && ["THREAD", "FORUM_POST"].includes(surface ?? ""))
    return locale === "ja"
      ? "対象条件に合う募集投稿で、他の人の参加を確認できていません。"
      : "No participation by another person was detected for this eligible LFG post.";
  if (
    ["SUPPORT", "BUG_REPORT"].includes(purpose ?? "") &&
    surface === "FORUM_POST"
  )
    return locale === "ja"
      ? "対象条件に合う相談投稿で、他の人の返信・参加を確認できていません。"
      : "No response or participation by another person was detected for this eligible support post.";
  return locale === "ja"
    ? "対象条件に合う投稿で、他の人からの直接返信を確認できていません。"
    : "No direct reply from another person was detected for this eligible post.";
}
