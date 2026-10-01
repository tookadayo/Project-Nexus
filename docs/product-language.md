# NEXUS product language — JA / EN

管理画面は、確認できた事実と次にできる操作を短く伝える。Landing は利用目的を説明し、管理画面は実際の集計を説明する。未実装機能や例示を現在の機能・実測値として表示しない。

## Writing rules

- 会話で理解できる単語と具体的な動詞を使う。抽象的な「旅」「温度」「可能性を解き放つ」や、主体の曖昧な「NEXUSから」を避ける。
- 見出しは対象を示す。数字には人数・件数・時間・割合、対象期間、分母を付ける。
- Button は結果を示す。「保存」「投稿を開く」「接続を解除」「30分後に再確認」などを使う。
- 内部名はコードと開発文書に残す。Signal / Cohort / Activation / Eligibility / Maturity / Intervention / Retention / Experiment を一般向けのラベルにしない。
- JA と EN で対象、条件、期間、確実性を一致させる。単語単位の置換後にも文全体を読み直す。
- 原因を確認できないエラーでは推測を列挙しない。送信・保存の結果が不明なら「変更なし」と断定しない。

## Shared terminology

実装の共通辞書は `packages/discord-panels/src/i18n/{ja,en,web}.ts`。動的期間・返信分母・測定状態は `i18n/terminology.ts`、エラーは `i18n/errors.ts` をDiscord / Webで共有する。

| Concept | JA | EN | Definition |
|---|---|---|---|
| Home | サーバー概要 | Server overview | 今日の人数と対応、完了した観測期間の比較 |
| First connection | 最初の交流 | First connection | 参加後3日以内の他者からの直接返信、目的が合う投稿への最初の応答、または設定時間以上のボイス同席。リアクションだけでは成立しない |
| First activity goal | 最初に確認する活動 | First activity to observe | 保存した定義で選択した投稿・直接返信・イベント参加登録。イベントへの実参加ではない |
| Reply waiting | 返信待ち | Waiting for reply | 設定された時間を超え、観測した直接返信がない対象投稿 |
| Reply average | 初回返信の平均時間 | Average time to first reply | 返信を受けた対象者だけの平均。返信あり人数 / 観測完了対象者数を併記 |
| Configured later activity | 参加後7〜14日目の活動（設定に応じて変更） | Activity 7–14 days after joining | 開始以上、終了未満。参加後の経過時間で判定し、日付の境界とは区別する |
| Canonical D7 activity | 参加7日後の活動 | Activity 7 days after joining | 詳細指標の固定 `[7,8)` 日。設定可能な活動期間と同一視しない |
| Continuing member | 以前から参加しているメンバー | Existing members with recent activity | 設定の初期活動期間を過ぎ、直近の設定期間に必要活動日数を満たした人 |
| Below recent activity threshold | 活動日数が基準未満 | Below the recent activity threshold | 活動ゼロとは限らない。期間と必要日数を計測方法に表示 |
| Analysis scope | 分析するチャンネル | Channels to analyze | 集計に含める・除外するチャンネル |
| Helper destination | 通知先 | Notification channel | スタッフ向け通知の送信先 |
| Manager role | NEXUSを管理できるロール | NEXUS manager role | 現在のサーバー設定で管理を許可したロール |

## States and numbers

| State | JA / EN | Display rule |
|---|---|---|
| ZERO | 0人・0件・0% / 0 members, posts, percent | 観測と必要サンプルが成立して結果がゼロの場合だけ |
| NO_ELIGIBLE_MEMBERS | 対象者なし / No eligible members | その集計の対象者がいない。今日の参加ゼロは「今日参加したメンバーはいません」 |
| COLLECTING | 測定中 / Measuring | 対象者の観測期間が未完了。必要期間を併記 |
| INSUFFICIENT_SAMPLE | まだ比較できません / Not enough observations | 比較に必要な人数未満。返信平均では追加で返信を受けた対象者が必要と伝える |
| UNAVAILABLE | データを取得できませんでした / Could not retrieve data | 取得失敗・収集停止・観測欠損。ゼロに置き換えない |

比較は直近の完了した参加期間と、その前の同じ長さの期間を使う。「今週」「先週」はカレンダー週の集計だけに使う。今回のHomeは移動する7日間の参加期間であり、観測完了までの待ち時間を引いた期間を表示する。

Staff exclusion は計測方法に載せ、主要KPIにしない。分析の参加数・退出数は直近の期間、活動割合は観測を完了した参加期間であるため、各カードに期間を載せる。

## Connection and action states

| State | JA | EN |
|---|---|---|
| VERIFIED | 接続済み | Connected |
| INSTALLED_NOT_VERIFIED | NEXUS導入済み・Web未接続 | NEXUS installed · Web not connected |
| VERIFICATION_PENDING | 接続コード発行済み | Connection code issued |
| NOT_INSTALLED | NEXUS未導入 | NEXUS not installed |
| ACKNOWLEDGED | スタッフ確認済み | Staff checked |
| SNOOZED | 後で再確認 | Check later |
| RESOLVED | 対応済み | Resolved |

接続済みはWeb接続状態であり、Bot導入・現在の権限と別に確認する。サーバーごとの取得失敗には確認不能を表示し、未接続と断定しない。

## Errors

共通分類は PERMISSION、CHANNEL_PERMISSION、REVISION_CONFLICT、COMPONENT_EXPIRED、DISCORD_TIMEOUT、DISCORD_RATE_LIMIT、DISCORD_UNAVAILABLE、DATABASE_FAILURE、VALIDATION、ENTITLEMENT、WEB_CONNECTION、AUTH_SESSION、VERIFICATION、INTERNAL。

何が失敗したか、確認できた内容、変更処理を開始したか・結果が不明か、次の操作を伝える。内部・保存・Discord通信・Web接続の不明な失敗には秘密を含まない `NXS-` 参照IDを付け、サーバーログと対応させる。クライアント側の通信失敗で生成した参照IDはサーバーログとの対応を保証できない。

読み込みだけなら再試行できる。結果が不明な保存・送信・接続解除は最新状態の確認を案内する。同じ書き込みを直接再実行するボタンは付けない。戻り先は元の画面、期限切れの操作は最新パネル。接続コードの無効・期限切れ・使用済み・発行者不一致は外部に同じ説明を返す。

## Regression checks

`tests/unit/quality-hardening.test.ts` で禁止表現・内部用語・エラー分類・分母と測定状態を検査する。`quality.spec.ts` と `discord-panels.spec.ts` でJA/ENとdesktop/mobileを確認する。新しい文言は辞書だけでなく、表示するbackend条件と一緒にレビューする。技術者向けCLIと開発文書では必要な技術用語を使用してよい。

## Adaptive community language

複数の運営目的と明示したチャンネル用途に合う指標だけを表示する。構造の検出結果は候補で、名前から用途・タグの意味を決めない。数値には観測対象、件数と人数の区別、期間、分母、権限による範囲を付ける。応答時間は中央値・p75・p90を正しく表示する。Screening待ちとGuestは通常の活動から分け、Onboarding完了を活動の必須条件にしない。

「ボイスで会話した」「参加登録したから出席した」「リアクションで交流が成立した」「アーカイブされたから解決した」「投票が特定の意見を示した」とは表現しない。公開APIで観測できた同席、登録、応答、対応付け済みタグ、投票参加をそれぞれ説明する。Server Guideの設定、外部イベント出席、private/archived Thread全体、過去の投票・リアクション履歴は未確認であることを明示する。

共通辞書は `packages/shared/src/community-copy.ts`。7つの代表ProfileとJA/ENのWeb・Discord表示をテストする。Discord画像はComponents V2のレイアウト近似であり、実クライアント受け入れの証明ではない。
