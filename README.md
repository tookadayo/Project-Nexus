# NEXUS v0.5 — Actionable Newcomer Growth

NEXUS は Discord の新規メンバーについて、最初の成功、返信、7日後の活動を測定し、安全な改善策とその結果を示します。メッセージ本文、添付、DM は保存しません。

## ローカル起動（Windows PowerShell 5.1）

Node.js 24、pnpm、ngrok と、`.env.example` から作成した `.env` が必要です。開発環境では `NEXUS_WEB_AUTH_MODE=development` と16文字以上の `NEXUS_WEB_PASSWORD` を明示します。Redis の Windows バイナリがない場合は `powershell -File scripts/setup-native-redis.ps1` を実行してください。

- `START NEXUS.cmd` — PostgreSQL、Redis、API/Discord、Web、ngrok を順に起動
- `STOP NEXUS.cmd` — `.local/runtime/runtime.json` に記録されたプロセスだけを停止
- `RESTART NEXUS.cmd` — STOP の後に START を実行

同等のスクリプトは `start-nexus.ps1`、`stop-nexus.ps1`、`restart-nexus.ps1` です。START は失敗時にその試行で起動したプロセスを片付けます。既存の関係ないポート使用者は停止しません。

| サービス | ポート |
| --- | ---: |
| Web | 3100 |
| API | 3001 |
| Discord interaction | 3002 |
| PostgreSQL | 55432 |
| Redis | 56379 |

初回のコマンド登録は `pnpm register` で行います。Discord Developer Portal では Server Members Intent を有効化し、Message Content Intent は不要です。

## 管理者の流れ

1. Bot をサーバーに追加すると、設定前でも基本的な活動測定が始まります。
2. Home で「最初の成功」を選びます。歓迎フローの設定は任意です。
3. Newcomers で到達点と、十分な件数があるチャンネル別の集計を見ます。
4. Improve で改善策を選び、流れと送信先を確認します。機能に必要な権限を検査し、集計に影響しないテスト通知を送れます。
5. Results で改善前後を比較します。十分な活動、権限、プランがある場合はより正確な比較を選べます。
6. Settings から週1回の短いスタッフ向けサマリーを任意で有効にできます。

通常の改善メニューは、返信待ちのスタッフ通知、参加後のスタッフ通知、チャンネル案内、利用可能なイベントの案内に限定します。DM を使う追跡は初期状態で無効です。

## 本番 Web 認証

本番では `NEXUS_WEB_AUTH_MODE=oauth`（既定）を使用します。`.env` に `DISCORD_APPLICATION_ID`、`DISCORD_CLIENT_SECRET`、32文字以上のランダムな `NEXUS_SESSION_SECRET`、`API_KEY`、`NEXUS_WEB_URL` を設定し、Discord OAuth の redirect URI に `${NEXUS_WEB_URL}/auth/callback` を登録します。OAuth は `identify guilds` を要求します。暗号化された HttpOnly セッションを使い、各読み書き時に Discord で管理権限を再確認します。開発用パスワード方式は `NEXUS_WEB_AUTH_MODE=development` のときだけ使います。本番公開には HTTPS を使ってください。

## 検証

```powershell
pnpm check
pnpm test:integration
pnpm --filter @nexus/web build
pnpm test:e2e
pnpm test:runtime
```

`test:runtime` は Windows PowerShell 5.1 と偽のローカルサービスを使用し、既存の NEXUS プロセスに触れずに起動・停止・再起動を確認します。統合テストは埋め込み PostgreSQL とローカル Redis を使い、Discord REST は偽物で検証します。

## データの境界

- 個人識別子はサーバーごとに保護され、管理画面には集計だけを表示します。少数のチャンネルは非表示にします。
- 観測できなかった期間と、まだ7日・30日の窓が終わっていないメンバーは、ゼロや失敗として扱いません。
- テスト通知は Bot から直接送信し、メンバー活動、改善策の配信、結果比較、割付、利用量に記録しません。
- 改善策の自動実行は暗黙に有効にしません。送信時も権限と連絡上限を再確認します。
- 個人またはサーバーの削除後は再取り込みを防ぐ停止状態を残します。

[Architecture](docs/architecture/vertical-slice.md) / [計測定義](docs/architecture/metrics.md) / [検証結果](docs/validation.md)
