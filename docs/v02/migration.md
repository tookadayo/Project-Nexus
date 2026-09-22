# v0.1 → v0.2 migration

既存のidentity、tenant、flow version/session、role所有権、outboxを再利用します。公開済み定義や既存データを作り直しません。現在の作業treeには元からcommitがなく、今回も自動commitしていません。

| Migration | 追加内容 |
| --- | --- |
| 005 | Native capabilities、設定revision/head、snapshot queue/state、既存guildのfallback明示 |
| 006 | Activation版固定、role/voice観測状態 |
| 007 | Intervention、assignment/exposure、プラン・使用量 |
| 008 | 返信照合receipt、実験control |
| 009 | 公平なepisode巡回 |
| 010 | Redis前のdurable ingest |
| 011 | 旧開始チャンネルActivationの公開版・既存episode pin backfill |
| 012 | 匿名D30加入日counter、二重加算防止 |
| 013 | 成熟実験成否の保存 |

## 配備順

1. PostgreSQLバックアップと復元先を準備し、既存設定・件数を記録します。
2. 同じlockfileで依存を入れ、`pnpm check` / `pnpm test:integration` / `pnpm build` / `pnpm test:e2e`を実施します。
3. v0.1 workerを止め、対象の`DATABASE_URL`を明示して`pnpm migrate`します。scriptのローカル既定接続を本番と取り違えないでください。
4. 001–013の適用履歴、backfill、guild別のfallback設定を確認します。
5. 新workerを起動し、既存Fallbackの完了とrole reconciliationを確認します。
6. `/nexus setup`から能力確認、必要なmodeのpreview/publishを行います。新flagsは既定offです。
7. テストguildだけでrolloutをconfirmし、Activationを定義してから新規cohortを観測します。Suggestから始めます。
8. [実Discordチェックリスト](live-acceptance.md)が通ったguildへ段階展開します。

既存flow/セッションは自動で新しい質問内容へ変わりません。新定義は新session・新episode向けです。既存の開始チャンネルActivationは011で互換版に固定します。

## 戻す場合

設定のRollbackは旧公開版を新draftとしてpreview/publishします。緊急時はNEXUSをdisabledにし、実験をstopします。schema downはテスト用で、データを含む本番に無条件で適用しません。011のdownは過去の計測証拠を消さない設計です。旧バイナリへの復帰は新signals/TTLへの互換性確認とバックアップ復元計画が必要です。

本セッションはfixture DBで移行を確認しています。実運用DBの移行・外部公開・Discordコマンドの実登録は行っていません。ソース配布にnode_modules、.next、.local、Redisバイナリ、test-results、cacheを含めないでください。
