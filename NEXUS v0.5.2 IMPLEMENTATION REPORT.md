# NEXUS v0.5.2 Implementation Report

作成日: 2026-09-25（JST）

## Implemented

- `/nexus panel` から、1サーバー1件の固定 Control Panel を表示します。概要、新しいメンバー、コミュニティ、チャンネル、改善、結果、設定、診断の8ページを同じメッセージで更新します。
- 返信待ちの新規投稿、前日参加者、交流できた人をスタッフ向けに表示します。メッセージ本文は保存・表示しません。
- 任意の Helper 通知を追加しました。通知先チャンネルとロール、返信待ち時間、通知間隔を設定できます。同じ投稿への再通知を避け、最大6件/日です。
- LFG、意見、不具合報告、試遊、交流の重要なチャンネルと、ゲームコミュニティ向け重点プリセットを設定できます。
- 返信までの時間を6時間帯ごとに集計します。個人別スタッフ順位は作りません。
- 管理者の設定変更履歴を Web に表示します。Discord 操作者 ID は暗号化して保存し、変更前後の設定値は監査 API から返しません。

## Fixed

- Gateway は通常コマンド・コンポーネントに対して DB 処理前に初回 ACK を返します。Webhook は署名検証後、通常操作に先に Deferred ACK を返します。モーダルだけ期限付きで直接応答します。
- Interaction の受信、ACK、応答完了または失敗を匿名化した診断データとして保存します。`/health`、STATUS、DOCTOR で受信方式、コマンド登録、最終操作を確認できます。
- 7日表示の参加期間と、その後14日間の確認期間を分けました。確認が終わらない人を失敗扱いにしません。
- チャンネル別返信は返信イベントのチャンネルを一致させ、ほかのチャンネルへの移動は対象チャンネルより後の活動だけを数えます。
- 退会済みメンバーを継続参加者から除外しました。交流相手の異なる人数を、暗号化した利用者 ID に対応する匿名 pair で数えます。
- Weekly Summary は `preparing → ready → sending → sent` に分けました。送信前の失敗は再試行でき、送信開始後の結果不明だけを `unknown` とします。
- Windows で PostgreSQL 親プロセスが消えた場合、ポート所有 PID が取得できなくても、NEXUS のデータ領域と同梱実行ファイルで確認できる worker だけを回収します。
- 開発環境の再 Setup で既存 Web パスワードを表示します。Setup は Bot 接続、操作ハンドラー、コマンド登録の準備も確認します。

## UI changes

- 主要な Discord 操作を固定 Panel に集め、通常の `/nexus` サブコマンドを4件に整理しました。
- Web ホームは参加期間と確認日数を明示します。旧「成功した新規メンバー」をホームの KPI 列から外しました。
- Web の設定画面に Helper 通知、重要なチャンネル、監査履歴を追加しました。
- [Dyno の設定とログ](https://docs.dyno.gg/en/dashboard/settings)、[Dyno の診断](https://docs.dyno.gg/faq)、[MEE6 のサポート構成](https://help.mee6.xyz/) を、導線・状態表示・診断の参考として確認しました。画面や文言は複製していません。

## Copy changes

- Panel の日英メッセージを i18n に追加し、返信待ち・期間・不足データ・権限エラーを短い行動指示で表示します。通常の設定ミスには内部エラー参照 ID を表示しません。
- Web の主要ページ名を Panel と揃え、通常画面で旧専門用語が再表示されないよう E2E で確認します。

## Discord Control Panel

固定メッセージの ID を `settings_panels` に保持し、選択・更新では `PANEL_UPSERT` が編集します。同じサーバーの別チャンネルから `/nexus panel` を実行しても、既存 Panel のチャンネルを更新対象にします。削除されていた場合だけ再作成します。古い Panel のコンポーネントは保存済みメッセージ ID と照合します。設定変更・改善の有効化・データ削除は管理権限を再確認します。

## New features

- Newcomer Attention Queue、任意の Helper 通知、6時間帯ごとの Helper Coverage、前日の参加と交流をまとめる Daily Staff Summary を追加しました。
- LFG・意見・不具合報告・試遊・交流の重要なチャンネルと、ゲームコミュニティ向け重点プリセットを設定できます。
- 設定変更の監査履歴を Web に表示します。

## Database migrations

- `017_interaction_health`: Interaction 診断
- `018_interaction_pairs`: 匿名の交流相手
- `019_weekly_phases`: 週次送信の状態
- `020_audit_actor`: 暗号化した Discord 操作者 ID
- `021_helper_alerts`: Helper 通知の重複防止・上限管理

データ削除と保持期間処理を新規テーブルに適用しました。

## Performance

同日・同チャンネル・同種の活動は SQL で最初と最後に集約してから Node に渡します。チャンネル集計の人数二乗の照合を集合照合に変更しました。隔離した Windows 環境で、合成データの API 読取は10,000人で193ms、50,000人で920msでした。これは合成データでの測定であり、実サーバーの遅延保証ではありません。

## Tests

| 検証 | 結果 |
| --- | --- |
| lint / typecheck | ローカル通過 |
| Unit | 101件通過 |
| Integration | 53件通過 |
| Build | 18パッケージ通過 |
| Web E2E | 8件通過 |
| Windows Runtime | 通過 |
| 10,000 / 50,000人の性能テスト | 2件通過 |

初回 ACK、DB 遅延、権限、古いコンポーネント、チャンネル帰属、退会者、期間、異なる交流相手、週次送信の失敗、パネル移動、孤児 PostgreSQL worker を回帰テストに含めています。

## CI result

Linux の `@embedded-postgres/linux-x64` を pnpm の build 許可に追加し、性能テストを GitHub Actions に追加しました。[commit `21b5beb` の Actions 実行](https://github.com/tookadayo/Project-Nexus/actions/runs/36122705737) では、Linux の lint、typecheck、Unit、Build、Web E2E、Integration、Performance と Windows Runtime がすべて通過しました。

## Discord acceptance result

実 Discord Test Server での `/nexus panel`、ページ移動、再起動後の Panel、3秒以内の ACK は未確認です。ローカルの `start-nexus.ps1` は起動し、STATUS は Gateway 接続、ハンドラー登録、Slash Command 登録を正常と表示しました。一方、最後の Interaction 受信・ACK・応答完了は未観測です。Bot Token と Application ID の一致は確認しましたが、Discord Guild API は `40333 internal network error` を返しました。Guild 権限不足か接続経路の問題かは確定できていません。操作用ブラウザーは Discord に未ログインのため、コマンドを実行できませんでした。

## Known limitations

- Discord Developer Portal の Interactions Endpoint URL は API から確認できません。Gateway 方式では空欄にする必要があり、DOCTOR は確認手順を表示します。
- Web の共有管理者認証で変更した履歴は「Web 管理者」と表示します。個々の Web 操作者までは区別しません。
- 旧詳細設定と旧分析画面には、専門用語や長い説明が一部残っています。主要な固定 Panel と通常の Web 画面を優先して改善しました。
- 実 Discord での受入確認が完了するまで、v0.5.2 の完成条件を満たしたとは扱いません。
