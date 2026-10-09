/** Never render untrusted API / transport messages as user-facing copy. */
export function safeError(code: string, locale: "ja" | "en"): string {
  const ja = locale === "ja";
  if (code === "SESSION_EXPIRED")
    return ja
      ? "ログインの有効期限が切れました。もう一度ログインしてください。"
      : "Your session has expired. Sign in again.";
  if (["ADMIN_REQUIRED", "NEXUS_ROLE_REQUIRED", "FORBIDDEN"].includes(code))
    return ja
      ? "この操作を行う権限がありません。"
      : "You do not have permission to perform this action.";
  if (code === "INVALID_PNG_LOGO")
    return ja ? "PNG形式の画像を選んでください。" : "Choose a PNG image.";
  return ja
    ? "処理を完了できませんでした。最新の状態を確認してください。"
    : "The operation could not be completed. Check the current state.";
}
