# Privacy and retention

メッセージ本文、添付、embed、sticker、poll本文、DM内容、ユーザー名、メールは収集しません。永続化前のstrict schemaで未知fieldを拒否します。DiscordユーザーIDはguild限定HMAC lookupとAES-256-GCM vaultで扱います。分析はmembership episode UUIDを使用します。

## 保持カテゴリー

| データ | 保持 |
| --- | --- |
| 詳細signal、正規化ingest、Native snapshot、通常施策履歴、監査、flow回答、role所有権証跡 | 既定30日、選択7/14/30日 |
| Interaction job/token | 15分 |
| Redisの正規化stream、返信照合用receipt | 24時間 |
| 匿名日次指標・D30加入日counter・実験集計snapshot | 既定24か月、選択3/12/24か月 |
| MTMのguild限定HMAC | 当該UTC請求月。翌月purge |
| 現在のmembership routing、固定Activation版/成否、Native初回観測状態 | 在籍中。退会後は詳細保持日数で削除 |
| 実験assignment・成否・紐づく配送証跡 | 観測窓終了後90日まで。membership削除時はそれ以前でもcascade |
| 公開設定・flow版 | 設定履歴として保持。guild削除時に削除 |

30日はすべてのDB行の一律TTLではありません。運用上必要な在籍状態、実験状態、請求期間、匿名集計を別カテゴリーにしています。7/14日を選ぶと長い観測窓の詳細証拠は不足し得るため、Coverageを落とし、否定条件で未観測を成功にしません。

初回返信の照合にmessage IDを使いますが、返信者IDの長期保存やユーザー間の社会関係グラフは作りません。24時間のreply receiptは相互返信の照合用で、返信者IDを持ちません。

## 削除

`/nexus privacy`から個人削除、管理者はguild削除を実行できます。削除は配送・Gateway書き込みと排他し、PostgreSQLの個人行をcascade削除し、Redis streamもscrubします。Redis削除失敗は成功として握りつぶさずretry可能なエラーにします。個人削除後は再取り込み防止用のguild限定HMAC tombstoneを保持します。

匿名cohort件数・集計snapshotは個人削除で巻き戻しません。guild削除ではこれらも削除します。Discord上の既存roleは個人データ削除の副作用として外しません。所有権証拠が失われたroleも外しません。

worker停止中は期限処理も停止します。復旧時のpurgeを監視してください。バックアップの保持・復元時のtombstone再適用は配備先の運用責任です。実環境での削除受け入れは[live-acceptance.md](live-acceptance.md)に残しています。
