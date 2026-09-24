# NEXUS v0.5.1 IMPLEMENTATION REPORT

## 実装内容

- 参加後の5段階（参加、最初の活動、交流、別の日の活動、7〜14日後の活動）を、観測期間が完了した新規メンバーで集計。次に進まなかった人数が最大の段階を表示する。観測不足・判定前は失敗に含めない。
- 既存メンバーを参加時期と最近の活動日数で分類。Bot を取り込まず、管理者・モデレーター権限を持つロールと設定されたスタッフロールを比較から除外。新規と継続メンバーを、同じ3日間の返信、活動日数、チャンネル数、Voice、イベント操作で比較する。
- 導入後に入ったメンバーを、後日の活動が確認できた人、確認できなかった人、判定前、データ不足に分ける。最初の3日間の行動を比較し、相関を原因として表示しない。
- 同じ Voice チャンネルへの同時参加を交流シグナルとして記録。返信の記録を新規メンバー以外にも拡張。メッセージ本文は保存しない。
- 分析範囲をサーバー全体、指定チャンネル、指定チャンネル除外から選べるようにした。名前からスタッフ・Bot・ログ用らしいチャンネルを選択候補として提示し、管理者が確認して保存する。チャンネルごとの新規参加・返信・他チャンネルへの移動・後日の活動を表示し、再参加を同一人物として数え、異なる3人未満の詳細は隠す。
- 既存の改善策と比較機能を維持し、返信待ち時間の差が観測されたときのみスタッフ通知案を追加。Web と Discord の主要な専門用語・エラー文言を簡単な表現に修正。
- Gateway Interaction を標準にし、Webhook はオプション化。コマンド定義のハッシュが変わった場合だけギルドコマンドを登録する。通常起動から ngrok を削除。
- `NEXUS SETUP.cmd`、`NEXUS STATUS.cmd`、`NEXUS DOCTOR.cmd` を追加。初回セットアップで Web もビルドし、入力した Discord サーバー ID をローカル Web に渡す。起動・停止時は manifest の PID だけでなく、プロジェクトのデータディレクトリ・実行パス・コマンド行で確認できた残留プロセスを回収する。所属不明のプロセスは停止しない。
- 週次サマリーの送信に期限を追加。期限切れの `sending` を結果不明として表示し、自動再送しない。開発用プラン変更は `NODE_ENV=development` のときだけ有効。
- すべての workspace package を `0.5.1` に更新。GitHub Actions で lint、typecheck、単体、統合、build、Web E2E、Windows 起動停止を実行する。

## 主な変更ファイル

| 領域 | ファイル |
| --- | --- |
| 分析と設定 | `packages/presentation/src/community.ts`、`packages/presentation/src/service.ts`、`packages/settings/src/index.ts`、`packages/lifecycle/src/index.ts` |
| Discord | `apps/gateway/src/index.ts`、`apps/interaction/src/server.ts`、`scripts/dev.ts`、`packages/events/src/registry.ts` |
| API / Web / Panel | `apps/api/src/server.ts`、`apps/api/src/v03.ts`、`apps/web/app/page.tsx`、`apps/web/app/console.tsx`、`apps/web/app/control/route.ts`、`packages/discord-panels/src` |
| Windows | `runtime-common.ps1`、`start-nexus.ps1`、`stop-nexus.ps1`、`setup-nexus.ps1`、`status-nexus.ps1`、`doctor-nexus.ps1`、`scripts/web.ts` と対応する `.cmd` |
| 設定と検証 | `.env.example`、`README.md`、`package.json` と各 package、`.github/workflows/ci.yml`、`tests/` |

## Migration と互換性

`016_member_journey.sql` は既存テーブルに検索用 index、週次送信の lease / 状態説明、コマンド登録ハッシュを追加する。既存テーブルの列・データは削除しない。`016_member_journey.down.sql` も用意した。分析範囲、スタッフロール、日数閾値は既存 `guild_settings.settings` にデフォルト付きで追加し、旧 JSON 設定を読み込める。

## 検証結果

| 実行 | 結果 |
| --- | --- |
| `corepack pnpm check` | lint、typecheck、単体テスト 97 件通過 |
| `corepack pnpm install --frozen-lockfile` | 19 workspace の依存関係を変更なしで確認 |
| `corepack pnpm test:integration` | 46 件通過。旧 migration、チャンネルの異なる人数による秘匿、週次送信の結果不明、参加者比較を含む |
| `corepack pnpm build` | 18 workspace package の build 通過 |
| `corepack pnpm test:e2e` | Web 8 件通過。分析範囲の保存と比較画面を含む |
| `corepack pnpm test:runtime` | Windows の起動、再起動、停止、部分起動失敗、無関係なポート所有者の保護を確認 |
| `NEXUS DOCTOR.cmd -Repair` の相当するスクリプト | この作業環境で `.local/pg` に紐づく残留 PostgreSQL worker を検出・回収し、55432 が解放されたことを確認 |

## 残っている制限事項

- 実際の Discord サーバーへの接続、Gateway の操作受信、Command 登録はこの作業では実施していない。Developer Portal の Interactions Endpoint URL を空欄にした検証用サーバーで受入確認が必要。
- Scheduled Event は参加申込など Bot が観測できる操作を測る。実際の出席は確定できない。Voice の交流は同じチャンネルに同時にいた事実であり、会話したことを保証しない。
- 他メンバーと関わった異なる人数は、既存イベントが相手 ID を保持していないため表示しない。返信・Voice の接点、チャンネル数などで比較する。
- チャンネル名による除外候補は管理者が確認して保存する方式。名前だけでスタッフ専用と断定し、自動停止することはしない。
- データ保持期間より古い詳細イベントは復元できず、結果は「データ不足」になる。最大規模の実 Discord サーバーでの負荷試験は未実施。
- Windows の孤児プロセス回収は、十分なプロジェクト由来の証拠がある場合だけ行う。所属を確認できないプロセスがポートを使う場合は停止せず、診断結果を表示する。
