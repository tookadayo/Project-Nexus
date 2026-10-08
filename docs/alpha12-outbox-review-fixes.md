# alpha12 配送経路の限定レビュー修正

2026-10-08、Normal Development。同じMacBook、`codex/alpha12-hosted-beta`。
開始・レビュー対象SHAは `1072bdfd21b49bf4d6a3d38b86eab3cb73e16257`。
追加commitの正確なSHA、差分、時刻、ログhashはローカルの
`.local/alpha12-outbox-handoff.md` と `.local/alpha12-outbox-verification-receipt.json`
に記録する。思考量の希望は正確にmax、実設定は未確認。

## 指摘と再現

- P1: `ActionWorker.tick` がclaim前からoutbox全体へACTIVE必須の判定を適用していた。
  停止・期限切れ中にも認可される履歴、解除確認、削除の返信まで拒否していた。
- P2: 通常outboxに招待世代が保存されず、配送時にも照合されていなかった。
  PENDINGのTEST_MESSAGEがpause→resume後に配送されていた。

旧SHAの `actions.ts` を一時的に使う対照試験で、P1は `BETA_UNAVAILABLE`、
P2は送信済みの `SUCCEEDED` となり、新しい回帰assertionが両方を検出した。
対照試験は終了コード1（期待した失敗）。修正版はfinallyで同一bytesへ戻した。
サービスの直接呼出しだけを成功証拠にせず、暗号化interaction jobから
InteractionWorker、outbox、ActionWorker、合成DiscordPortまで配送した。

## 実装した判定

通常の通知・役割変更・パネル更新・新規分析は、現在のACTIVE、期限、grantに加え、
受付時の招待世代を配送直前と保存時に照合する。enqueueのdedupe再送は元の世代を
保持する。旧世代・世代なしジョブを最新世代へ書き換えて再生しない。
拒否された未実行ジョブはFAILEDにし、後ろにある正当な解除返信を塞がない。
期限切れRUNNING leaseのUNKNOWN判定や、成否不明な外部送信の再送禁止は維持する。

例外は、正常にdispatchできた読み取り・解除・削除の**返信**に限定する。
返信種別、本文、添付、暗号化返信token、interaction参照、世代を正規化して結び付け、
対象tenant/Guildに紐付く暗号化receiptで用途と主体を検証する。
任意のpayloadタグ、REPLYというkind、通常通知へのreceiptコピーだけでは許可しない。
dispatch失敗の返信に成功receiptを発行しない。

履歴は現在のREAD権限、招待の読み取り条件、既存の保持期限・削除状態が必要。
解除・Guild削除には現在の管理権限と既存のNEXUS認可を再確認する。
個人削除とプライバシー画面には現在の本人のGuild所属を確認し、Guild全体の削除権限を
付けない。完了したGuild削除・解除の最小限の確認返信だけは削除済み印で遮断しない。
保存済み履歴の復活や、他のGuildのgrant・データ変更は許可しない。

REST直前の現在権限確認はDB transaction外で一度行い、その後に状態・leaseを再確認する。
Beta/privacyの既存fenceは外部作用と保存まで維持する。パネルrefreshも同じ世代判定を使い、
別世代の待機refreshを成功としてまとめない。

receiptは14分以内に限り配送に使用できる。新しいreceiptを含むREPLY_FOLLOWUPも
既存の15分purgeに接続した。運営の定期削除処理が遅れても期限後は配送しない。
新しい収集源、データ保持期間の延長、利用枠、課金操作、DB migrationは追加していない。

## 最終差分の検証

すべて隔離した新設PostgreSQL、合成Guild・合成資格情報とFakeDiscordを使用。
`DATABASE_URL`や実サービスを使用しない。次のコマンドのprefixは
`.local/bin/pnpm --config.verify-deps-before-run=never`。bundled NodeをPATHに設定した。
対象は開始SHAに今回の未commit差分を加えたコードで、検証後にそのまま追加commitする。

| コマンド | 結果 |
| --- | --- |
| `exec vitest run --config vitest.integration.ts tests/integration/alpha12-outbox.test.ts tests/integration/alpha12-beta.test.ts tests/integration/alpha12-sessions.test.ts tests/integration/alpha11-analysis.test.ts tests/integration/analysis-stabilization.test.ts tests/integration/analysis-scope-boundaries.test.ts` | PASS・終了コード0、51件／6 files（新規配送14件＋既存37件） |
| `exec vitest run tests/unit/alpha12-configuration.test.ts tests/unit/session-lifecycle.test.ts tests/unit/auth-hardening.test.ts tests/unit/server-verification.test.ts tests/unit/v05.test.ts tests/unit/alpha11-analysis.test.ts` | PASS・終了コード0、58件／6 files |
| `typecheck` | PASS・終了コード0 |
| `lint` | PASS・終了コード0 |
| `build --concurrency=2`（`NEXT_TELEMETRY_DISABLED=1`） | PASS・終了コード0、21/21（18 valid cached、3 executed） |

新規14件は停止・期限切れの解除確認と確認後解除、履歴配送、保持猶予終了、
新規分析拒否、旧世代とdedupe、新しい通常通知、個人/Guild削除、共有パネルの私的返信、
receipt purge、現在権限喪失、招待撤回、tenant/Guild/本人境界、本文改変、
未証明の返信・通知・世代なしジョブの拒否を確認する。既存assertionやtimeoutは変更していない。

開発中の失敗もログを保持する。最初のreceiptはJSONBのキー順変化を考慮できず失敗し、
正規化で修正した。合成fixtureの同一ユーザー使い回しは既存の発行抑制に達したため、
fixtureごとに別の合成主体を使うよう直した。履歴文言のassertionは実在する
`Detailed analysis history`を正確に照合するよう修正した。

最終コードの一回の限定セットで、既存の毎分プレビュー上限テストが1件失敗した
（50/51、終了コード1）。実装が `date_trunc('minute',now())` を使用し、実行ログが
分境界を跨いでいるため、実時計の窓切替が原因候補である。未断定であり、
プレビュー実装・テスト・assertion・timeoutは変更していない。同じ限定セットの
再実行は51/51、終了コード0。失敗をPASSに読み替えず、失敗ログを別名で保持した。

## 運用互換性と未実行ゲート

Beta稼働時の旧・世代なしPENDINGジョブは拒否する。旧workerと新workerを混在させず、
更新時は旧プロセスの停止を確認してから新コードで再開する。必要な通常通知は最新状態と
権限を確認した新規要求で作成する。UNKNOWN外部作用は無条件に再送しない。
停止・期限切れでも、管理者は新しい解除確認を要求でき、適格な履歴閲覧と本人削除を利用できる。

今回の実サービス、実資格情報、全体E2E／負荷試験、Windows実機、公開経路、実backup復元、
新SHAのremote CIはNOT RUN。GUI画像の再生成は配送修正に不要なためNOT RUN。
push／PR／merge／deploy、本番DB操作は未実施。
40P01、SHOWCASE、実OAuth、最新tombstoneを含む復元と実測容量の公開前ゲートは維持する。
この検証から公開GOや実環境の配送保証は宣言しない。
