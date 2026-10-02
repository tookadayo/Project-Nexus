> Historical release evidence. Preserved from its original release; current contracts are indexed in [Documentation](../../README.md) and [Stripe readiness](../../billing/stripe-readiness.md).

# NEXUS v0.5.3 Implementation Report

## 実装したもの

- Discord の Control Panel を 1 メッセージ内の 9 ページに統合し、初回設定を 4 段階に整理。設定変更は Owner、Administrator、指定した運営ロールに制限し、公開チャンネルへの設置前に警告します。
- Interaction を ACK 後に DB へ保存して対象 Guild の Worker を即時起動。定期回復処理とコマンド登録の自動再試行を維持・追加しました。
- 対応待ち、チャンネルのページ送りと移動、改善、結果、診断、通知と週次まとめのテスト送信を追加。Web と Discord の主要ページ名と日英の表示文言を共通 i18n に整理しました。
- Windows の複数親を持つ孤立 PostgreSQL worker を安全に判定し、再現テストを追加。性能テストのデータと判定基準を更新しました。

## 主要変更ファイル

`packages/discord-panels/src/views/control.ts`、`packages/discord-panels/src/i18n/`、`apps/worker/src/interactions.ts`、`apps/interaction/src/server.ts`、`packages/settings/src/index.ts`、`apps/web/app/console.tsx`、`scripts/dev.ts`、`scripts/command-retry.ts`、`runtime-common.ps1`、関連テスト。

## Migration

DB スキーマ変更はありません。v0.5.2 の設定 JSON は既定値で読み込み、既存 Guild の初回設定 4 段階は完了扱いにします。パッケージのバージョンは 0.5.3 です。

## Test 結果

- `pnpm check`（lint、typecheck、unit 113 件）、`pnpm build`、integration 54 件、E2E 8 件、performance 2 件、Windows runtime：すべて成功。
- [実装コミットの GitHub Actions CI](https://github.com/tookadayo/Project-Nexus/actions/runs/36374264590)：`verify`、`windows-runtime` ともに成功。

## 実 Discord 確認結果

未確認。Test Server 用の Discord 認証情報と Guild ID がこの環境にないため、`/nexus panel`、各画面、通知、再起動後の既存 Panel を実サーバーでは検証できていません。

## 未解決事項

実 Discord での動作確認が残っています。ローカルおよび CI のテストで確認できる範囲では、既知の失敗はありません。
