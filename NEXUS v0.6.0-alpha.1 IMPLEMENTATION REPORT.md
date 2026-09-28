# NEXUS v0.6.0-alpha.1 Implementation Report

## Version / Build

- Version: `0.6.0-alpha.1`（Alpha）。ルートの `package.json` を版番号の基準とし、全ワークスペースの版を一致させました。
- Build: 実行時に Git HEAD の短縮 SHA を取得します。配布環境では `NEXUS_BUILD_SHA` を使用でき、無効または未設定なら Git にフォールバックします。Git が使えない場合は `unknown` と表示します。
- Version / Build / Channel を `/nexus status`、Discord 診断、Windows STATUS / DOCTOR、Web footer、起動ログに表示します。作業開始時の基点は `978d13f` でした。最終コミットの Build 値はそのコミットを起動した時に決まります。

## Implemented / UX changes

- Discord Control Panel の上位導線を Home / New Members / Attention / Analysis / Results / Settings の6系統に整理しました。Analysis は Overall / Channels / Behavior、Settings は基本から詳細設定までの9項目に整理しました。
- Home に今日の参加・交流・対応待ちを先に表示し、対応、参加の流れ、気になる箇所へ進めるようにしました。改善策は Home または Analysis の問題箇所から開き、プレビュー、確認、有効化の順にしました。
- Unicode 絵文字は上位導線と主要操作に限定し、Discord Component の emoji field を使用しました。文字ラベルを併記し、ja/en で同じ意味にしています。
- 初回 Setup は分析範囲、運営、通知、目標の4項目を管理者の選択として記録します。追加管理ロールなし、通知なし、目標は後で、を正式な完了選択肢にしました。既存 Guild は `setupVersion: 1` として一度だけ更新案内を表示し、現在の設定を維持できます。既存 timezone は維持し、新規 Guild は UTC です。
- Manager Role の変更は確認後に保存します。Manager / Helper Role を空配列へ戻せます。週次まとめの timezone 候補を増やしました。

## Discord Control Panel / Attention workflow

- Attention に OPEN / ACKNOWLEDGED / SNOOZED / RESOLVED を追加しました。30分、1時間、今日中の再確認が可能です。Snooze 中と解決済みの項目は再通知せず、期限切れの Snooze は再表示します。
- Attention の保存項目は Guild、Channel ID、Message ID、検出時刻、状態、再確認・解決時刻のみです。メッセージ本文は保存しません。
- `/nexus panel` を別チャンネルで実行した場合と Settings の Panel から移動確認へ進めます。新チャンネルの権限と公開範囲を確認し、新パネル作成後に設定を切り替えます。作成に失敗した場合は旧設定を維持します。切替後の旧パネル操作は無効にし、旧メッセージ削除を試みます。
- 公開判定は `everyone_visible` / `restricted` / `unknown` を区別します。スタッフロールだけが閲覧できるチャンネルを公開と誤判定しません。

## Public beta preparation

- Discord OAuth Install URL の生成コマンドを追加しました。基本スコープは `bot applications.commands`、権限は View Channel、Send Messages、Embed Links、Read Message History で、Administrator は要求しません。
- コマンド定義を起動時と定期的に Discord API と照合し、欠落・不一致時に既存の再試行方式で登録します。`NEXUS_COMMAND_SCOPE=guild|global` を解析しますが、この Alpha での登録は Guild 単位です。
- Web では管理可能な Guild を導入済みと未導入に分け、未導入 Guild へ Install URL を表示します。未導入 Guild では Dashboard を開けません。OAuth 期限切れ画面と再ログイン導線を追加し、可能な場合は以前の Guild 選択を維持します。
- `/privacy`、`/terms`、`/support` を追加しました。Settings の問題報告・意見送信リンクと、秘密情報を含まない診断情報のコピーを追加しました。

## Privacy / telemetry / migrations

- Product telemetry をコミュニティ分析から分離し、固定イベント名、HMAC による Guild ハッシュ、必要な処理時間だけを保存します。Raw user ID、ユーザー名、本文、トークン、DM 内容は保存しません。90日で削除し、Guild データ削除にも連動します。
- `022_attention_items` と `023_product_telemetry` を追加しました。既存テーブルを削除する migration はありません。既存のローカル DB で `corepack pnpm migrate` が成功しました。
- Privacy ページに収集対象、保存しない情報、保持期間、削除方法、製品利用状況の記録を説明しました。公開 Beta 前の方針文書の法的レビューを README で推奨しています。

## Major files changed

- Version / runtime: `packages/shared/src/version.ts`、`runtime-info.ts`、`runtime-common.ps1`、`status-nexus.ps1`、`doctor-nexus.ps1`
- Discord UI / worker: `packages/discord-panels/src/views/control.ts`、ja/en 辞書、`apps/worker/src/interactions.ts`、`actions.ts`、`helpers.ts`
- Data / privacy: `packages/settings/src/index.ts`、`packages/presentation/src/community.ts`、`packages/security/src/privacy.ts`、migrations 022/023
- Install / Web: `packages/discord/src/install.ts`、`rest.ts`、`scripts/dev.ts`、`scripts/install-url.ts`、`apps/web/app/auth`、`apps/web/app/console.tsx`、公開ページ
- Docs / tests: `README.md`、`.env.example`、unit / integration / E2E / performance tests

## Tests / CI / runtime

| Check | Result |
| --- | --- |
| Lint / typecheck / unit | PASS。単体 121 件 |
| Integration | PASS。58 件。Setup、Role、Panel 移動、Attention、改善の確認を含む |
| Web E2E | PASS。8 件。6ページ導線と ja/en を確認 |
| Build | PASS。18 ワークスペース |
| Windows Runtime | PASS。起動・停止・再起動と PostgreSQL orphan 回帰を含む |
| Performance | PASS。10k: 941 ms、50k: 1,455 ms（最終ローカル測定の API 応答時間。fixture 準備を含むテスト全体は約93秒） |
| Migration | PASS。既存ローカル DB へ追加 migration を適用 |

上記はローカルで実行した CI 相当の結果です。GitHub Actions の実行結果は、このレポート作成時点では未確認です。Windows STATUS では DB、Redis、API、Web、Bot 接続を確認しましたが、既に稼働中のプロセスを本コミットへ再起動していないため、実Discordの新UI動作確認には該当しません。

## Real Discord acceptance

**NOT VERIFIED IN REAL DISCORD**

実Discordのログイン済み操作画面がこの作業環境にありません。Install から Setup、Panel 移動、Attention、改善、再起動、Web OAuth までの26項目は実操作で確認できていません。Bot 接続の状態確認と自動テスト結果を実Discord受け入れテストの成功として扱いません。

## Known limitations / Beta blockers remaining

- Hosted Beta の実ホスティング、OAuth 設定、フィードバック先 URL とサポート運用、法的レビューは未完了です。
- OAuth refresh token の自動更新は実装していません。期限切れ時は再ログインします。
- 実Discordでの26項目の受け入れテストと、更新後プロセスの再起動確認が必要です。
- 旧パネルメッセージの削除が Discord API で失敗すると旧メッセージは残る場合があります。切替後の操作は無効化されます。
- 実環境の p50 < 1秒、p95 < 3秒は目標であり、Hosted Beta での達成を計測していません。
