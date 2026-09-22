# Live acceptance — 未実施

2026-09-22時点、ローカル`.env`はなく、実Discordへログイン・登録・送信していません。以下は受け入れ準備であり、PASS記録ではありません。

## 準備

テストDiscord app、Native有効guildと無効guild、管理者と一般メンバー2名以上、Botより下の専用テストrole、スタッフ通知チャンネル、HTTPS interaction endpointを用意します。`.env.example`に従いローカルでcredentialを設定します。管理対象roleは既存の手動roleと区別します。決済credentialは不要です。

ローカル基盤を起動して`pnpm migrate`、`pnpm register`、`pnpm dev`を実行します。Webは`pnpm build`後に`pnpm web`。GuildMembers privileged intentだけを有効にし、BotのAdministratorは要求しません。

## チェック記録

各行に日時、guild、実行者、観測結果、証拠を追記してください。user IDや秘密情報を報告書に載せないでください。

| 検証 | 期待する結果 | 状態 |
| --- | --- | --- |
| Install Bot | 最小権限でcommand/panelが利用できる | 未実施 |
| Capability detection | features、Native、permissionsを実状態と照合 | 未実施 |
| Native Guild | autoがnative、既存設定を書き換えない | 未実施 |
| Non-Native Guild | autoがfallback、取得不能を明示 | 未実施 |
| Fallback flow | 分岐、再開、Preference、既存版互換 | 未実施 |
| Hybrid flow | Nativeと重複するprompt拒否、after-native gating | 未実施 |
| Role select | allowlist外拒否、手動roleを保持 | 未実施 |
| Channel select | allowlistと不可視channelを確認 | 未実施 |
| Activation | pinned版で成立、新版が過去を書き換えない | 未実施 |
| Direct reply | 明示返信のlatency、self/bot除外 | 未実施 |
| Voice | 既知区間だけ、切断中の時間を推定しない | 未実施 |
| Reaction | 本文を保存せず活動を記録 | 未実施 |
| Scheduled event subscription | subscribeを記録、参加と混同しない | 未実施 |
| Staff intervention | Suggest未送信→承認→1回配送 | 未実施 |
| Experiment control | 無介入、割付は残る、曝露なし | 未実施 |
| Experiment treatment | 成功後のみ曝露、失敗もITT分母に残る | 未実施 |
| Guardrails / stop | 超過pause、stop後の新配送停止 | 未実施 |
| Discord API failure | 429待機、403抑制、曖昧失敗UNKNOWN | 未実施 |
| Role hierarchy failure | 送信前に拒否、所有権を捏造しない | 未実施 |
| Bot restart | durable job / snapshot lease / UNKNOWN回復 | 未実施 |
| Redis restart | PG ingestから再送、重複effectなし | 未実施 |
| Postgres persistence | 再起動後も版・割付・設定を保持 | 未実施 |
| Privacy deletion | DB cascade、stream scrub、再取り込み抑止 | 未実施 |
| Uninstall | Native設定と手動roleを壊さずDiscordを利用できる | 未実施 |

短時間の動作試験で統計的改善を証明できません。最低sample、成熟window、time-blockの必要数を満たす実験は別途期間を確保します。実環境が準備できるまでは、この表を完了扱いにしません。
