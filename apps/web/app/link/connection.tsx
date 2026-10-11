"use client";
import { ConfirmationDialog } from "../confirmation-dialog";
import { connectionStateLabel } from "../../../../packages/discord-panels/src/i18n/terminology";
import { FailureNotice } from "../failure-ui";
import type { UserFailure } from "../../../../packages/shared/src/error-types";
import { useState, useRef } from "react";
export function ServerConnection({
  guildId,
  locale,
  development,
  beta = false,
}: {
  guildId: string;
  locale: "ja" | "en";
  development: boolean;
  beta?: boolean;
}) {
  const [confirmation, setConfirmation] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<UserFailure | null>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    inFlight = useRef(false);
  const c = (ja: string, en: string) => (locale === "ja" ? ja : en);
  async function disconnect() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/link/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          ...(confirmation ? { confirmation } : {}),
        }),
      });
      const result = (await response.json()) as {
        confirmation?: string;
        disconnected?: boolean;
        failure?: UserFailure;
      };
      if (!response.ok) {
        setError(
          result.failure ?? { category: "WEB_CONNECTION", effect: "UNKNOWN" },
        );
        setConfirmation(null);
        return;
      }
      if (result.disconnected) {
        window.location.assign("/servers");
      } else if (result.confirmation) setConfirmation(result.confirmation);
    } catch {
      setError({
        category: "INTERNAL",
        effect: "UNKNOWN",
        reference:
          "NXS-" +
          crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
      });
      setConfirmation(null);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="surface">
      <h2>{c("サーバー接続", "Server connection")}</h2>
      {development ? (
        <>
          <strong>DEVELOPMENT AUTH MODE</strong>
          <p>
            {c(
              "開発用の認証です。サーバーのWeb接続は検証されていません。",
              "Development authentication is active. This server has not been verified for Web access.",
            )}
          </p>
        </>
      ) : (
        <>
          <p>{connectionStateLabel(locale, "VERIFIED")}</p>
          <p>
            {beta
              ? c(
                  "解除すると新しい収集を停止し、このサーバーの利用権を失効します。分析・履歴・設定を含むデータ削除を速やかに開始します。",
                  "Unlinking stops collection, revokes this server’s access, and promptly requests deletion of analytics, history and settings.",
                )
              : c(
                  "解除してもBot、分析データ、履歴、設定は保持されます。再接続には /nexus link が必要です。",
                  "Disconnecting preserves the bot, analytics, history, and settings. Run /nexus link to reconnect.",
                )}
          </p>
          {confirmation ? (
            <ConfirmationDialog
              label={c("接続解除の確認", "Confirm disconnect")}
              busy={busy}
              returnFocus={trigger}
              onCancel={() => setConfirmation(null)}
            >
              <p>
                {beta
                  ? c(
                      "このサーバーの収集・利用権を停止し、データを削除しますか？他のサーバーには影響しません。",
                      "Stop collection and access, and delete this server’s data? Other servers are unaffected.",
                    )
                  : c(
                      "このサーバーのWeb接続を解除しますか？未使用の検証コードも無効になります。",
                      "Disconnect this server from the Web? Unused verification codes will also be revoked.",
                    )}
              </p>
              <button disabled={busy} onClick={() => void disconnect()}>
                {c("接続解除を確定", "Confirm disconnect")}
              </button>
              <button
                autoFocus
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                {c("キャンセル", "Cancel")}
              </button>
            </ConfirmationDialog>
          ) : (
            <button
              ref={trigger}
              disabled={busy}
              onClick={() => void disconnect()}
            >
              {c(
                "連携を解除（対象と影響を確認）",
                "Disconnect (review scope and impact)",
              )}
            </button>
          )}
          {error && (
            <FailureNotice
              failure={error}
              locale={locale}
              onCheck={() => window.location.reload()}
            />
          )}
        </>
      )}
    </section>
  );
}
