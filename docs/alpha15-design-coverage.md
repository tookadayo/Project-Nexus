# alpha15 設計・実装対応表

確認日: 2026-10-15。既存の D:\Project Nexus / codex/alpha15-web-blocks にある現在の実装を対象とする。「実装済み」は、記載した限定範囲のコードとローカル検証があるという意味であり、設計文書全体や実 Discord での受入完了を意味しない。

## 原本と承認の優先順位

6 文書・12 分割の再転送本文は [保存テキストのマニフェスト](design/alpha15-source/source-manifest.json) とともに保存されている。6 ファイルすべてについて、実ファイルのサイズ、SHA-256、UTF-8 往復一致を独立に再確認した。統合設計は 113,355 bytes / 778 行で、§1–12、IN01–48、PR01–32 がすべて存在する。editor の BEX01–21 も存在する。途中で記録した「統合設計が §2.10 で途切れている」という制限は、完成した再転送アーカイブには当てはまらない。

これは親から再転送された保存テキストの検証である。元の Library ZIP をダウンロードした、ZIP バイナリと一致した、という主張はしない。取得経緯は [実装記録](alpha15-implementation.md#source-and-authorization) を参照する。原本の未承認・未確定という記述より、本日明示された 7 点の承認を優先する。

| 原本 / 転送部分                                                                                          | 対応を確認した設計範囲                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [実用ブロック・日時の統合設計](design/alpha15-source/NEXUS-alpha15-practical-blocks-integrated.md) / 1–4 | §1–2 候補分類、§3 型と値、§4 カレンダー、§5 Scheduler/Run、§6 型付き選択、§7 文章、§8 入力支援、§9–10 利用例、§11 IN/PR 受入条件、§12 残件。                                   |
| [Web 初期設定・Dashboard 改訂](design/alpha15-source/NEXUS-alpha15-web-setup-dashboard-revision.md) / 5  | §1–4 状態・再開・既存設定・正本/保存、§5 導入案内、§6 保持、§7–8 日英 Dashboard/利用例、§9–10 公開経路と受入条件。                                                             |
| [ブロック編集改訂](design/alpha15-source/NEXUS-alpha15-block-editor-revision.md) / 6–7                   | §1–4 同じ編集構造・形・型・スコープ、§5 制御/待機/並列/共通手順、§6 正本と固定版、§7–9 未接続/Undo/予算/操作支援、§10 利用例、§11 ライブラリ候補、§12 BEX 受入条件。           |
| [ブロック拡張改訂](design/alpha15-source/NEXUS-alpha15-block-expansion-revision.md) / 8–9                | §2–4 入力/変数/純粋計算/共通手順、§5 メッセージ値と通知、§6–7 Discord 採用境界/予算/失敗、§8 利用例、§9–11 プラン/保存/Web 移行/受入条件。                                     |
| [Discord API アクションカタログ](design/alpha15-source/NEXUS-discord-api-action-catalog.md) / 10–11      | §2 A/G-P/G-D/G-O/F/X/N 分類、§3–4 メッセージ値と入力、§5–7 操作・イベント候補と制限、§8 認可/登録/結果不明、§9–11 非提供・優先順位・検証範囲。                                 |
| [プラン案](design/alpha15-source/NEXUS-automation-plan-proposal.md) / 12                                 | §1 既存提供条件、§2–4 共通文法/利用枠/変数、§5–7 実行の数え方/枠不足/利用権、§8 比較、§9 小規模 Windows 測定、§10–11 公開判断/受入条件。仮価格・仮枠を確定提供へ読み替えない。 |

状態は「実装済み」「一部実装」「未実装」「外部確認」「対象外」で区別する。同じ行に実装済みと残件がある場合、残件まで完了したとは扱わない。原本にある IN/PR/BEX 全項目の一対一の実行済み認定は、この表では行っていない。

## 現在の実装と設計の対応

| 設計項目                                                                         | 現在の実装・根拠                                                                                                                                                                                                                                                                                                                                                                        | 状態と残る境界                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web 招待 → 現在権限/Bot 確認 → Web 設定。既存値を保ち /nexus link を必須にしない | [設定 API](../apps/api/src/alpha15-setup.ts)、[設定サービス](../packages/operations/src/web-setup.ts)、[設定 UI](../apps/web/app/setup/wizard.tsx)、[統合試験](../tests/integration/alpha15-web-setup.test.ts)。既存設定を版付き下書きで見直し、適用・戻る・取消を分離する。                                                                                                            | **実装済み**のローカル経路。実 OAuth/Bot 導入・公開 HTTPS の受入は**外部確認**。                                                                                                                                                                                   |
| 公開/運営者ローカル管理、実ユーザー API 認可、設定正本/競合                      | [公開 API proof](../packages/security/src/public-api.ts)、[Web proof](../apps/web/app/auth/api-proof.ts)、[現在のサーバー認可](../packages/security/src/server-authorization.ts)。実セッション・actor・guild・method/path・origin を束縛し、API 側で現在権限を確認する。                                                                                                                | **実装済み**。旧 service Bearer の GET 互換と、実ユーザー証跡が必要な mutation を分離。実環境の公開/loopback 経路確認は残る。                                                                                                                                      |
| Discord 導入案内と Web ボタン、永続重複抑止                                      | [導入通知](../apps/gateway/src/install-notices.ts)、[handoff](../packages/discord/src/setup-handoff.ts)、[通知移行](../migrations/055_alpha15_install_notices.sql)、[統合試験](../tests/integration/alpha15-install-notices.test.ts)。既存管理通知先を優先し、承認済み既定方針では新規導入と現在の送信権限を証明できる system channel を使う。                                          | **実装済み**の許可先だけに配信。安全な宛先がない場合は Web に次の操作を示す。UNKNOWN を別宛先へ再送しない。全 guild への Discord 到達保証はしない。                                                                                                                |
| 分かりやすい日英 Dashboard、利用枠/次回/結果                                     | [Dashboard](../apps/web/app/alpha15-dashboard.tsx)、[API projection](../packages/automation/src/service.ts)、[ブラウザ試験](../tests/e2e/alpha15-dashboard-ui.spec.ts)。受付済みイベント・開始済み Run・skip・UNKNOWN を区別する。                                                                                                                                                      | **実装済み**のローカル表示。実データ・実際の読み上げ環境は**外部確認**。                                                                                                                                                                                           |
| Literal / VariableRef / Expression、空欄と不正入力、型と安定 ID                  | [型](../packages/automation/src/types.ts)、[定義検証](../packages/automation/src/definition.ts)、[評価器](../packages/automation/src/expression.ts)、[値 UI](../apps/web/app/automation/value-slot.tsx)。件数/時間の固定値・変数・型の合う計算を使い、missing を 0 や例示値に補完しない。                                                                                               | **実装済み**の共通契約。整数・有限値・型・参照範囲をサーバーで再検証する。未提供の演算を generic JSON で代替する経路はない。                                                                                                                                       |
| 正本の木、形/色/普通の言葉、Steps、未接続、Undo、版付き確認                      | [workspace](../apps/web/app/automation/workspace.tsx)、[編集モデル](../apps/web/app/automation/model.ts)、[model 試験](../tests/unit/alpha15-editor-model.test.ts)、[ブラウザ試験](../tests/e2e/alpha15-editor.spec.ts)。実際の入れ物と Steps が同じ木を編集し、表示情報は意味ハッシュから除外する。                                                                                    | **実装済み**の DOM 編集経路。Scratch/Blockly 自体の導入、全 operation の独立形状カード、専用 multi-elif UI は**未実装**。旧非対応定義の任意バージョンを完全無損失で扱う保証、実スクリーンリーダー/IME/タッチ認定は未完了。                                         |
| 日付/時刻/時点、暦日/経過時間、範囲終端、DST | [日時 helper](../packages/automation/src/datetime.ts)、[登録値・演算](../packages/automation/src/temporal-values.ts)、[日時試験](../tests/unit/alpha15-temporal-values.test.ts)、[値 UI](../apps/web/app/automation/value-slot.tsx)。型付き範囲・現地日時・曜日・表示・TZ変換を接続する。 | **実装済み**の登録型/構築/判定/入力。日付終端包含と時点半開終端、gap/fold・日跨ぎ・暦日/経過差を検証。実環境の TZ database 更新作業や全世界全履歴の受入は含まない。 |
| Scheduler、次 5 回、固定 Run、取消/変更/重複防止 | [Scheduler](../packages/automation/src/scheduler.ts)、[経過間隔](../packages/automation/src/elapsed-schedule.ts)、[TZ 意味検証](../packages/automation/src/schedule-rules.ts)、[予定 UI](../apps/web/app/automation/trigger-editor.tsx)、[統合試験](../tests/integration/alpha15-schedule-reviews.test.ts)。予約世代・発生キー・開始権を固定する。 | **実装済み**は once/daily/weekly/monthly/elapsed と TZ 意味変更時の再確認停止。Wait/Run は各最大7日、長期間隔は別Run。EventRelative の EventRef 読取・追随更新/取消・イベント別世代は**未採用**（IN30–33）。 |
| 有限反復、break/continue、共通手順、純粋値ブロック、スコープ/予算 | [compiler](../packages/automation/src/definition.ts)、[runtime](../packages/automation/src/runtime.ts)、[反復結果](../packages/automation/src/iteration-results.ts)、[定義管理](../apps/web/app/automation/definition-manager.tsx)。固定版呼出し・循環禁止・読取専用・親子共通予算を適用する。 | **実装済み**。反復出力の6状態、共通手順/Pure の版・参照・差分・選択更新を含む。純粋値内で送信・外部読取・時計取得・乱数・代入は不可。新 Scratch 配置は別。 |
| 独立した並列枝、all-join、名前付き結果                                           | [parallel](../packages/automation/src/parallel.ts)、[runtime](../packages/automation/src/runtime.ts)、[store](../packages/automation/src/store.ts)、[統合試験](../tests/integration/alpha15-runtime-parallel.test.ts)。親 snapshot は読取専用、枝 locals は独立。全枝正常終了後に宣言した名前付き出力だけを型の合う親変数へ同時反映する。                                               | **実装済み**。待機/承認中も別枝を進め、再開・共通期限/予算・取消・UNKNOWN を保持。UI は 2–3 枝/出力対応、API は値を漏らさない枝状態に対応。旧「parallel は AST のみ」という説明は現状に当てはまらない。                                                            |
| 抽選を明示操作として一度だけ確定                                                 | [runtime](../packages/automation/src/runtime.ts)、[台帳](../packages/automation/src/store.ts)、[統合試験](../tests/integration/alpha15-runtime.test.ts)。Run/固定版/動的位置を区別し、入力 fingerprint と最初の結果を保存する。                                                                                                                                                         | **実装済み**の integer/sample/shuffle。再開・送信 UNKNOWN で引き直さない。無断の候補収集や全員名簿取得はない。                                                                                                                                                     |
| 手動・予定・内部・Interaction の起点と入力                                       | [event 契約](../packages/automation/src/event-contract.ts)、[inbox](../packages/automation/src/events.ts)、[admission](../apps/worker/src/alpha15-events.ts)、[Interaction](../apps/worker/src/alpha15-interactions.ts)、[設計記録](alpha15-trusted-events.md)。内部は既存の確定済み構造化 intake、Interaction は検証済み境界と actor 束縛/単回/期限付き instance に限定する。          | **実装済み**の限定起点・入力 UI・受付証跡。一般の分析 attention、message-metadata 起点、新規 form 起点、任意 Gateway イベント全般は**未実装**。受付成功を Run 完了に見せない。                                                                                     |
| MV01–03: 文章・Embed を値として作り、送信と分ける                                | [型/helper](../packages/automation/src/message.ts)、[builder UI](../apps/web/app/automation/message-builder.tsx)、[純粋カード](../packages/automation/src/expression-cards.ts)、[固定 payload](../packages/discord/src/automation-message.ts)。RichTextSpec AST/EmbedSpec/LegacyMessageSpec、文字/装飾/join/embed/Legacy の純粋合成、投稿/同一 Run の成功済み投稿編集が接続されている。 | **実装済み**の text+embeds。PlainText は一度だけ escape、装飾は明示 AST から生成、通知メンションは無効。既存 RichText 文字列型は互換として残る。プレビューはコンパイル結果とカードで、Discord の完全な描画再現ではない。V2 helper はあっても本番輸送は**未採用**。 |
| 現在権限・許可対象・出所、固定 Discord 操作                                      | [adopted set](../packages/automation/src/admission.ts)、[adapter](../apps/worker/src/alpha15-discord.ts)、[REST wrapper](../packages/discord/src/rest.ts)。普通の投稿、同一 Run の成功証拠がある投稿編集、許可ロール付外し、category 配下 text channel、public thread、既存受付 state/version 読取に限定する。                                                                          | **実装済み**の 7 operation。flow の immutable 対象一覧と現在 actor/Bot 権限を確認。channel 作成は現在 category の overwrites/nsfw を明示コピーし直前 fingerprint を再確認。最後の GET と POST 間の外部変更を原子的に防げない Discord API の制限は残る。            |
| 正式なロール承認と現在の権限証拠 | [ロール policy](../packages/discord/src/automation-role-policy.ts)、[coverage proof](../packages/discord/src/role-coverage.ts)、[安全設計](alpha15-role-safety.md)、[CT06/C08 統合試験](../tests/integration/alpha15-iteration-approval.test.ts)。入力/Run/固定版/policy digest に束縛し現在資格を再確認する。 | **実装済み**のロール専用証跡と同じ対象を指定する CT06 カード。任意対象の承認は追加しない。完全な Gateway/REST coverage proof が得られない構成は fail closed。別プロセス間で揮発 proof を共有する基盤はない。 |
| 既存受付だけの最小状態読取                                                       | [readTicket](../packages/operations/src/automation-ticket.ts)、[adapter 試験](../tests/integration/alpha15-message-adapter.test.ts)。現在 READ/利用権・既存分析 scope・native 可視性・論理保持期限を確認し、state/version だけを返す。intake:UUID は狭い既存キー文法として扱う。                                                                                                        | **実装済み**の限定読取。本文/証拠/新しい履歴は返さず、サービス専用 Record の literal/build 偽装を拒否。受付作成/更新 DO13 は**未実装**。                                                                                                                           |
| 結果不明を止め、既知成功を維持 | [runtime](../packages/automation/src/runtime.ts)、[台帳](../packages/automation/src/store.ts)、[結果型](../packages/automation/src/results.ts)、[結果分岐試験](../tests/integration/alpha15-results.test.ts)。dispatch 前の不開始と送信後の曖昧結果を分ける。 | **実装済み**の CT14 ParseResult/OperationOutcome 分岐と実行停止。UNKNOWN 枝を表示しても後続 write を許さず、対応する証拠照合だけを許す。通常 Record の status や literal で証拠を偽造できない。 |
| Free 共通文法、有限枠、実行の数え方                                              | [quota](../packages/automation/src/quota.ts)、[admission/storage](../packages/automation/src/admission.ts)、[測定](../packages/automation/src/measurement.ts)、[記録](alpha15-implementation.md#small-local-measurement-and-technical-limits)。小さい合成測定に基づく初期技術枠と予約/消費を実装する。                                                                                  | **実装済み**の招待 Beta 共通文法。3 active flows、月 100 Run、guild/host 各 1 実行枠等は保守的 guard。実 Discord 容量試験・Hosted 負荷受入ではない。仮価格/有料販売/全候補提供は**対象外**。                                                                       |
| 最小状態・保持・削除・復元時の削除情報                                           | [retention](../packages/automation/src/retention.ts)、[tombstones](../packages/security/src/tombstones.ts)、[バックアップ運用](backup-restore-operations.md)。終了後 7 日以内の resume/draw/操作証拠削除、削除済み定義の期限、本文/変数を含めない診断、復元時 fence を実装する。                                                                                                        | **実装済み**のアプリ処理。実バックアップ最大 7 日、削除 journal 保護、実オフライン復元 drill は**外部確認**。既存分析保持/別目的監査を Run ログと混同しない。                                                                                                      |

## 残件の分類と完了判定

以下の A–D は作業の境界であり、原本の「標準候補」を一括承認へ変える分類ではない。**A の不足を未承認や新 Scratch 設計待ちと言い換えない。** 旧契約内の実装依存を解消して完成させる作業と、新しい対象・データ・権限を採用する判断を分ける。

| 分類 | 意味と進め方 |
| --- | --- |
| **A 旧承認内の実装残件** | 原本で意味が定義され、本日の保持・期限・操作境界に収まる共通機能。新しい承認は不要。型・スコープ・保存・評価・予算・UI・試験が未完なら、その実装依存を明示して残件とする。特に CT14/EX11/EX09、Optional 分岐、反復結果型を、新 Scratch の全体設計待ちへ自動的に移さない。 |
| **B 新 Scratch 表示・追加設計待ち** | 全条件/算術/値の独立した形状・配置方式、専用 multi-elif 等、親でレビュー中の追加設計。既存の木と意味を保ち、レビュー前に新文法・演算範囲を広げない。既存語彙の設定 UI 補完と区別する。 |
| **C 追加採用・認証・環境** | 未採用 Discord 操作、別入力・データ目的・権限・輸送契約、実 OAuth/HTTPS/backup/端末等。必要な対象や契約を確定してから採用・受入を行う。すべてが新しいユーザー承認を要するという意味ではなく、既存資格や実環境があれば実行できる確認も含む。 |
| **D 今回の明示対象外** | Run を越す可変変数、外部 HTTP 送信/外部イベント受信、BAN/kick/大量削除/管理者権限付与、本文の継続収集・人物評価・任意コード・無限 loop・self-bot 等。今回の不足を埋めるために追加しない。alpha16 AI と価格確定・販売も今回の対象外。 |

原本との対応は、統合設計 §2 の機能族、§2.10 の 74 形、§3 の意味、IN/PR、編集改訂 BEX を基準にする。根拠となるコードは [型と AST](../packages/automation/src/types.ts)、[catalog](../packages/automation/src/catalog.ts)、[評価器](../packages/automation/src/expression.ts)、[型別カード](../packages/automation/src/expression-cards.ts)、[runtime](../packages/automation/src/runtime.ts)、[編集 UI](../apps/web/app/automation/workspace.tsx) で確認する。登録名や helper があるだけでは本番利用可能と数えない。

### 前段補完の 5 項目の記録

この節は A19 一括補完前の検証記録である。特に atomic Pair の境界は、その後の A19 による複合型対応で拡張した。現在の完了範囲は下の機能族/具体形と A19 対応表を参照する。

以下の5項目は、記載した限定範囲の実装・ローカル検証を完了した。全alpha15単体208/208、編集ブラウザ25/25、全体型/lint/Nextビルドが成功。待機基盤16/16と実行基盤の関連43/43も成功している。全alpha15＋migration統合は初回204/206。旧試験データ2件を修正後、影響する2ファイル51/51が成功し、初回の失敗は解消した。全14ファイルを修正後に再実行したという主張ではない。[実装記録](alpha15-implementation.md#remaining-item-audit-and-selective-commit)に詳細を保存した。全候補や実Discordの受入完了ではない。

| ID | 限定した補完範囲 | 含めないもの |
| --- | --- | --- |
| **CT05** | **限定実装・検証済み**。信頼された既存 intake の ticketUpdated、同一 TicketRef・版の相関、Run 共通期限・取消・現在認可を保つ待機。一致の消費と実行位置を同時保存し、旧版Run・並列承認待ち・停止/復元も検証。 | 任意イベント、投稿本文、第三者の任意操作による再開、Run 外の新しい履歴。 |
| **CT11 / C04** | **限定実装・検証済み**。既存 readTicket の state/version だけを最大回数・正の間隔・固定期限付きで再確認。確認済み結果の再開にも現在READ/保持/可視性を再検証。 | Discord write の再試行、任意 HTTP、無限 while、追加の監視・収集。 |
| **DA03 / D05 / IN41** | **実装・検証済み**。`run.startedAt: Instant` を読取り専用で参照し、保存・再開・重複開始要求で不変。偽装/代入を拒否。 | EX10 の時計再取得や起点 occurredAt へのすり替え。 |
| **DA04 / L22** | **限定実装と局所試験成功**。16 atomic 型から有限に登録した Pair、長さ一致・全体予算を守る zip と型別 UI。関連 unit 35、JA/EN 320px browser 2、型/lint 成功の担当結果。 | 複合型/Record/service 結果/MessageSpec の Pair、任意 JSON、長さ不一致の切捨てや空補完。 |
| **EX01 / N02** | **実装・検証済み**。既存 round/floor/ceil の server `options.digits`（-8..8）を編集する入力 UI。日英320pxで保存/再読込と1.23456→1.23の評価を確認。 | 新しい算術 op・新 Scratch の形状/文法。 |

**zip の訂正**: 初回監査時の `list.zip` は演算子名の登録だけで、検証が常に `OPERATOR_UNAVAILABLE` を返していた。「server 演算は完成し UI だけがない」という以前の説明は不正確である。前段は atomic Pair の有限登録を実装し、後段 A19 では [登録 Pair](../packages/automation/src/registered-pairs.ts) と [構造型 schema](../packages/automation/src/structured-values.ts) を既存の型深度・予算・出所制約内で複合型へ拡張した。任意 JSON/schema やサービス証拠の偽造を許したものではない。

## 全 66 機能族の対応

「実装」は表に記載した限定契約を指す。「部分」はその行に残る能力を含めた全候補の完成ではない。補完前の catalog は available 39 / unavailable 27 だったが、これは利用可能な登録行数であり、**39 機能族の全能力が完成したという集計ではない**。補完中のカードや runtime の状態は下表と最終検証で判断する。

### 起点 TR01–08

| ID・原本名 | 現在の境界 | 残件分類 |
| --- | --- | --- |
| TR01 手動で開始 | 実装。保存版・本人資格・型付き入力から新規 Run。 | — |
| TR02 予定時刻に開始 | 単発、毎日/毎週/毎月、固定 anchor の正整数秒間隔、期間/TZ/次 5 回/世代を実装。TZ database と保存した現地日時/offset/instant の意味差分で将来予約を停止し、再確認・新しい有効化を要求する。既存 Run は変更しない。 | **A 完了**。**C** EventRef 読取、固定/追随の情報源と更新/取消経路、イベント別世代は未採用。IN30–33。 |
| TR03 フォームで受付 | 未提供。新規の登録フォーム起点・型付き提出・本人結果経路はない。 | **C** 項目/本人資格/用途/保持/応答契約の採用。自由文・添付は別判断。 |
| TR04 ボタン等の操作で開始 | 部分。自アプリの actor 束縛・期限/単回付き Native ボタンのみ。 | **C** 任意 command/select/ユーザー作成部品と入力 schema。 |
| TR05 NEXUS の状態変化で開始 | 部分。既存 Operations Intake の確定した作成/状態変更だけ。 | **C** 他の登録内部イベント。分析 attention や任意内部イベントは未採用。 |
| TR06 投稿イベントで開始 | 未提供。messageMetadata 型の存在は本番起動経路の完成ではない。 | **C** 許可 channel/最小項目/Intent/保持/欠落・重複の採用。本文収集の許可ではない。 |
| TR07 Discord の状態変化で開始 | 未提供。全 Gateway イベントへの接続はない。 | **C** イベント別 Intent・取得目的・欠落状態・metadata schema。 |
| TR08 集計期間終了で開始 | 未提供。 | **C** 新しい集計保持・母数・欠測設計。DA04 の Run 内一覧計算とは別。 |

### 制御 CT01–15

| ID・原本名 | 現在の境界 | 残件分類 |
| --- | --- | --- |
| CT01 条件で分ける | 実装。true/false/unknown と短絡評価。value.choose は同型の純粋値を選べる。専用 elif はない。 | **B** 全条件の独立形状・専用 elif。C09 は既存 branch/end の合成で表現可能。 |
| CT02 選択値で分ける | 登録 Enum の文 switch と、V12 の純粋 `value.lookup` を実装。固定 literal キーの重複を拒否し、同型の該当なし値を必須にする。選んだ行だけを評価する。 | **A 完了**。編集するキーは既存 scalar/Enum と native 選択できる ChannelRef/RoleRef。その他 Ref キーの既存 wire 値は保持し、未提供の native 編集を raw ID で代用しない。**B** 新しい直接配置表示。 |
| CT03 決まった回数か一覧を繰り返す | 有限回数/固定一覧、局所 item/index、共通予算と、C08/PR29 の宣言出力ごとの状態付き結果一覧を実装。成功だけに値を入れ、FAILED/NOT_STARTED/SKIPPED/CANCELLED/UNKNOWN を区別する。 | **A 完了**。途中までの確定結果を保持し、UNKNOWN を成功や未設定へ変換しない。 |
| CT04 時間を待つ | 実装。Duration/Instant、開始時固定、個別/Run 7 日、取消と再開。 | — |
| CT05 操作や状態変化を待つ | **限定実装・検証済み**。既存 intake ticketUpdated、相関・期限・取消・登録競合・再開・現在認可・原子的消費。 | 追加イベント種別は **C**。本番受入は外部確認。 |
| CT06 正式な承認を待つ | 既存の通常ロール action を直接指定する制御カード、明示期限、既存の正式承認証跡へ接続した待機を実装。Boolean/Record/模擬成功から本番承認を作れない。 | **A 完了**は同じロール対象/資格/保持の範囲。新しい承認対象・任意データは **C**。 |
| CT07 並列に進めて合流 | 実装。独立 locals、全枝 all-join、名前付き同型出力、共有期限/予算、待機/再開/取消/UNKNOWN。 | —。UI の有限 2–3 枝を任意同時送信許可へ拡張しない。 |
| CT08 共通手順を呼ぶ | 固定版・引数・本文・出力の call と、id@revision ごとの新規/複製/版追加/参照一覧/差分/選択した参照の版更新/未参照削除を実装。 | **A 完了**。**B** 新しい配置表示。 |
| CT09 手順の結果を返す | 正常経路の型付き必須戻り値と版ごとの出力編集を実装。失敗・中止・UNKNOWN から成功値を返さない。 | **A 完了**。CT08 の固定参照・差分確認と同じ管理経路。 |
| CT10 実行を終える | 実装。主 Run 終了と子 return/枝完了を区別し、既知結果と UNKNOWN を保持。 | — |
| CT11 状態を有界に再確認 | **限定実装・検証済み**。既存 readTicket、固定最大回数/正の間隔/期限、一致・回数到達・期限切れと現在認可。 | 追加readerは **C**。write の再送には使わない。 |
| CT12 同じ用途の間隔を空ける | 未提供。Run を越す可変状態を必要とする cooldown。 | **D** 今回見送り。 |
| CT13 この繰り返しを抜けるか次へ進む | 実装。直近の有限 loop の break/continue。親子/並列/待機等の境界を越えず予算を戻さない。 | — |
| CT14 結果に応じて進む | `ParseResult<T>` / `OperationOutcome<T>` と専用分岐を実装。成功値は成功枝内だけ、失敗理由は安全なコードだけを公開する。型と出所証拠を検証し、結果の literal/build 偽造を拒否する。 | **A 完了**。UNKNOWN の後続 write 停止を維持し、明示結果だけで模擬実行する。 |
| CT15 自作の値ブロックを使う | 固定 Pure 定義の新規/入力・出力・本文編集/複製/版追加/参照一覧/差分/選択参照更新/未参照削除と、依存/循環検証・call・局所 binder を実装。 | **A 完了**。**B** 新しい Scratch 表示。送信/read/時計/乱数/代入/再帰は純粋値内で禁止。 |

### 変数・一覧 DA01–07

| ID・原本名 | 現在の境界 | 残件分類 |
| --- | --- | --- |
| DA01 変数を宣言 | 実装。安定 ID・型・初期値・局所 scope。未設定を例示値で補完しない。 | 大量時の UX/実機性能は **C**。 |
| DA02 変数へ代入 | 実装。同型で書込可能な Run locals のみ。V03 増減は代入＋算術の合成で表現できる。 | **B** 増減の専用配置形。 |
| DA03 値を参照 | 実装。宣言/引数/起点/戻り値の型付き参照とD05/IN41固定Run開始時刻を提供。 | **B** 全参照の新しい表示。 |
| DA04 一覧を作るまたは加工 | 作成/件数/取得/追加削除/挿入置換/切出し連結/登録キー別重複除去・sort・集合比較/集計/range/chunk/map/filter/any/all に加え、登録 Group、位置付き find、MinMaxValue、複合型の登録 Pair zip、C08/PR29 結果一覧を実装。 | **A 完了**。List/Optional/登録 Record/MessageSpec 等も型深度・bytes・評価予算・provenance・guild 制約内で扱う。サービス専用の証拠を構築/更新で偽造できない。 |
| DA05 許可済み集計を読む | 未提供。 | **C** 既に許可された対象/集計 schema・利用資格の個別登録。新しい履歴収集を追加しない。 |
| DA06 項目をまとめた値を作るか更新 | 実装。登録された user-constructible Record だけを純粋に構築/更新。元変数は代入まで不変。 | 任意 JSON/schema、承認・外部結果・Ref ID の偽造は不可。 |
| DA07 任意項目の値を使う | Optional 値と明示 default に加え、V08 の値あり/未設定専用枝と、値あり枝だけの読取専用 T を実装。false/0/空文字も値ありとして扱う。 | **A 完了**。取得不能・権限不足・UNKNOWN を unset と扱わない。 |

### 計算・日時 EX01–12

| ID・原本名 | 現在の境界 | 残件分類 |
| --- | --- | --- |
| EX01 数値を計算 | 実装された四則/余り/min/max/abs/clamp/round/floor/ceil は有限値・0 除算等を検証。N02の既存digits編集UI・保存/再読込も検証済み。 | N03 割合は既存式の合成で表現可能。**B** 全算術の新配置形。 |
| EX02 値を比較 | 同型比較と、DateOnly/Instant に対応する `range.contains` を実装。DateRange の選択日終端は含み、InstantRange の終端は含まない。 | **A 完了**。**B** 条件表示の追加設計。 |
| EX03 条件を組み合わせる | 実装。Boolean/三値 ConditionResult、左から短絡 AND/OR/NOT。不正入力と認可を条件へ隠さない。 | **B** 全条件カードの形状/編集方式。 |
| EX04 案内文を作る | PlainText 結合等と、桁数/登録 locale を明示する `number.format` を実装。元の Number を変更せず PlainText を返す。 | **A 完了**。本文取得や暗黙型変換を追加しない。 |
| EX05 文字を調べるか加工 | 長さ/含む/先頭末尾/切出し/置換/分割結合/trim/大小文字/有限 repeat と、登録規則を明示する `text.clean` を実装。 | **A 完了**は登録した空白/改行整形。任意 regex・未登録の暗黙正規化は追加しない。 |
| EX06 時間量を作る | 実装。秒/分/時/経過日、型付き入力、利用先の期限検証。暦月へ暗黙変換しない。 | — |
| EX07 日付や時刻の値を組み立てる | DateOnly/LocalTime/ZonedDateTimeSpec の型、型付き構築・固定入力・変数/式入力を実装。DST gap を拒否し、fold は選択を明示する。 | **A 完了**。固定カレンダーだけでなく値ブロックとして検証する。 |
| EX08 日時を計算または表示 | 既存日付/経過演算に加え、登録 WeekdayEnum、明示日時 format/TZ 変換、ZonedDateTimeSpec の暦日加減を実装。Instant の秒/ミリ秒と日跨ぎを保持する。 | **A 完了**。暦 1 日を経過 24 時間へ置換せず、移動先の fold 選択を再要求する。 |
| EX09 期間を組み立てる | DateRange/InstantRange を正式 ValueType として登録し、構築/入力/判定/現地日境界から時点範囲への変換を実装。 | **A 完了**。DateRange は選択日を含み、変換した InstantRange は次の現地日境界を半開終端にする。逆順・空時点範囲・存在しない境界を拒否する。 |
| EX10 現在時刻を確認 | 実装。明示した readClock と固定結果。 | —。純粋式や再描画で時計を暗黙に読み直さない。 |
| EX11 指定形式で値を変換 | 原本 §3.4 の厳格十進 Number、実在 YYYY/MM/DD、登録 Enum への明示変換と ParseResult を実装。失敗を false/0/unset に変換しない。 | **A 完了**。Ref/承認/権限への変換は提供しない。CT14 の成功 scope と出所証拠を共有する。 |
| EX12 抽選結果を一度だけ決める | 実装。integer/sample/shuffle、動的 identity・固定候補/件数/fingerprint、原子的な最初の結果、再開で引き直さない。 | 今回の 7 日保持承認を適用済み。候補の新収集、賞金/賭け/秘密生成等を追加しない。 |

### メッセージ値 MV01–05

| ID・原本名 | 現在の境界 | 残件分類 |
| --- | --- | --- |
| MV01 装飾文を作る | 実装。登録 RichTextSpec AST、本文/装飾/リンク/日時/リスト等、PlainText escape と変数の型付き合成。 | Discord 完全描画再現ではない。輸送/実機受入は **C**。 |
| MV02 Embed を作る | 部分。題名/説明/項目/色/URL/日時/footer/author 等の登録 schema。 | **C** 画像/素材 Ref・添付の取得/輸送/保持。 |
| MV03 通常メッセージを作る | 部分。text+embeds、明示 rich parts。 | **C** ユーザー作成 button/select、添付等。Native 起動ボタン基盤があることと、この MessageSpec の部品提供は別。 |
| MV04 V2 メッセージを作る | 未採用。限定 helper はあるが本番 action の輸送採用なし。 | **C** 経路別 schema・容量・Legacy 排他/不可逆遷移・現在制限の試験。 |
| MV05 入力画面を作る | 未採用。 | **C** Modal 作成/表示/提出、登録構造化項目。自由文・ファイルは別の目的/保持判断。 |

### 読取り・操作 DO01–14

| ID・原本名 | 現在の境界 | 残件分類 |
| --- | --- | --- |
| DO01 対象の状態を読む | 部分。既存受付のサービス専用 state/version Record のみ。現在 READ/分析 scope/native 可視性/保持期限を検査。 | **C** Channel/Role/Member/Thread/Event 等の登録最小 StateRecord/List。認可用の内部 REST read はユーザー用 read ブロックではない。 |
| DO02 メッセージを送る | 部分。許可先への普通の text+embeds、メンション通知無効。 | **C** 返信モード・通知対象 policy・別形式。通常送信の採用から一括許可しない。 |
| DO03 自分の投稿を編集 | 部分。同一 Run の成功済み send の証拠がある対象だけ。 | **C** 別 Run/任意の古い自投稿の所有証明・保持・形式変換。 |
| DO04 自分のリアクションを変更 | 未採用。 | **C** 固定 MessageRef/Emoji・履歴可視性・変更/UNKNOWN 契約。 |
| DO05 許可投稿の固定を変更 | 未採用。 | **C** 対象/現行権限/固定解除の影響。 |
| DO06 スレッドを作る | 部分。許可 channel への限定 public thread 作成。 | **C** 元投稿からの作成、private、追加状態/入力等。 |
| DO07 スレッドの状態を変更 | 未採用。 | **C** 所有/管理・lock/終了/再開等の許可遷移。 |
| DO08 フォーラム投稿を作る | 未採用。 | **C** Forum/Tag/本文/返却 ThreadRef、部分成功と UNKNOWN。 |
| DO09 許可ロールを変更 | 実装した通常 role の付与/解除。固定 allowlist、正式承認、現在の双方資格/階層/全 channel coverage proof、burst guard。 | **C** 実 Discord 受入。Gateway/API/worker 別プロセスの揮発 proof 共有基盤はなく fail closed。 |
| DO10 自分の予定イベントを管理 | 未採用。 | **C** 所有/日時/公開範囲/状態遷移の固定契約。参加希望者一覧は含めない。 |
| DO11 Discord 投票を扱う | 未採用。 | **C** 作成/自投票終了/結果確定の固定契約。CT11 の有界再確認とは別。 |
| DO12 操作へ応答する | 未採用のユーザー定義 action。起動受付の ACK 基盤はある。 | **C** 初期/継続応答・編集/Modal、本人/公開・期限・token の契約。ACK 成功を処理完了にしない。 |
| DO13 受付を作るか更新 | 未採用。readTicket は書込みを含まない。 | **C** 既存の書込み資格、登録構造化入力、保持/状態遷移/失敗結果。 |
| DO14 投稿本文や履歴を取得 | 未提供。 | **D** 本文/履歴の追加継続収集は今回行わない。Intent があっても取得目的の許可ではない。 |

### 個別判断 GX01–05 と別枠構想 GX06–09

| ID・原本名 | 現在の境界 | 残件分類 |
| --- | --- | --- |
| GX01 チャンネルを管理 | 部分。許可 parent category 下に text channel を作り、現在の overwrites/nsfw を明示コピーして直前照合。 | **C** 名前/topic/並び/設定等の追加管理。権限変更/削除等の高影響操作を黙って追加しない。 |
| GX02 ロール定義を管理 | 未採用。DO09 の普通の付与/解除とは別。 | **D** 権限・特権・階層の付与/変更。名前/色等も未採用で **C**。 |
| GX03 招待を管理 | 未採用。 | **C** 公開先/有効期間/利用回数/参加経路への影響。 |
| GX04 モデレーションを実行 | 未採用。 | **D** BAN/kick/大量削除。timeout 等も承認済みではなく **C** の追加採用。 |
| GX05 メンバー一覧を取得 | 未採用。 | **C** 明示目的/必要項目/Intent/閲覧/保持。Member picker や全 channel census を名簿収集へ流用しない。 |
| GX06 Webhook で操作 | 別枠の未採用構想。 | **D** 今回見送り。秘密/接続先/送信 schema を新設しない。 |
| GX07 外部更新を受信 | 別枠の未採用構想。 | **D** 外部イベント受信は今回見送り。 |
| GX08 外部へ通知 | 別枠の未採用構想。 | **D** 外部 HTTP 送信は今回見送り。 |
| GX09 Run を越えて値を保存 | 別枠の未採用構想。 | **D** 実行間可変変数は今回見送り。 |

## 74 具体形の点検

原本 §2.10 の 74 形を以下で漏れなく照合する。**「演算あり」は型別 selector 等から既存の意味を使えるという記録であり、全形が独立した Scratch カードとして直接配置できるという意味ではない。** 全形の新表示は B。74 を完成数や配置上限へ読み替えない。

### 変数・型 12 形

| ID | 名前 | 対応と残件 |
| --- | --- | --- |
| V01 | 変数を作る | DA01 の宣言あり。 |
| V02 | 変数に入れる | DA02 の代入あり。 |
| V03 | 変数を増減する | 代入＋EX01 の合成で表現可能。専用配置形は未提供（B）。 |
| V04 | 変数の値 | 型付き参照あり。 |
| V05 | まとまった値の項目 | 登録 Record の field 参照あり。 |
| V06 | 項目をまとめる | user-constructible 登録 Record の構築あり。 |
| V07 | 項目を変えた値を作る | 純粋 Record update あり。 |
| V08 | 値があれば使う | Optional 専用の present/unset 枝と、present 枝だけの読取専用値を実装。default と区別する。 |
| V09 | 未設定ならこの値 | optional.default あり。false/0/空文字は値ありのまま。 |
| V10 | 形式を指定して変換 | 厳格 decimal/dateSlash/登録 Enum と ParseResult の値カード・専用分岐あり。 |
| V11 | 条件で値を選ぶ | value.choose あり。ConditionResult では不明の同型値も必要。 |
| V12 | 対応表から選ぶ | 固定 literal キーの `value.lookup`、重複拒否・明示該当なし・行編集あり。新規キーは scalar/Enum/ChannelRef/RoleRef の既存入力から選ぶ。その他 Ref の保存済み wire 値は読取専用で保持する。文 switch と区別する。 |

### 数値 7 形

| ID | 名前 | 対応と残件 |
| --- | --- | --- |
| N01 | 数値を計算 | 四則/余り等の既存演算あり。 |
| N02 | 数値を丸める | round/floor/ceil、server digitsと入力UIあり。**日英320pxの保存/再読込・評価まで検証済み**。 |
| N03 | 割合を計算 | 乗除の合成で表現可能。専用配置形は未提供（B）。 |
| N04 | 絶対値 | number.abs あり。 |
| N05 | 範囲に収める | number.clamp あり。入力検証の無言補正には使わない。 |
| N06 | 数値を読みやすく表示 | `number.format`、型付き桁数・登録 locale の明示入力あり。 |
| N07 | 番号一覧を作る | 有限 list.range あり。step=0 等を拒否。 |

### 文字 10 形

| ID | 名前 | 対応と残件 |
| --- | --- | --- |
| T01 | 文字をつなぐ | text.join あり。 |
| T02 | 文字の長さ | text.length あり。 |
| T03 | 文字を含むか | text.contains あり。 |
| T04 | 先頭や末尾を調べる | startsWith/endsWith あり。 |
| T05 | 文字を切り出す | text.slice あり。 |
| T06 | 文字を置き換える | 登録 text.replace あり。任意 regex なし。 |
| T07 | 文字を分ける | text.split あり。 |
| T08 | 一覧を文章にする | text.joinList あり。 |
| T09 | 文字の余分を整える | 前後 trim と、登録した空白/改行規則を明示する `text.clean` あり。 |
| T10 | 文字を繰り返す | 有限 text.repeat と出力予算あり。 |

### 一覧 25 形

| ID | 名前 | 対応と残件 |
| --- | --- | --- |
| L01 | 一覧を作る | 同型有限 List 構築あり。 |
| L02 | 項目を足した一覧 | append あり。元一覧は不変。 |
| L03 | 項目を除いた一覧 | remove あり。 |
| L04 | 途中に項目を入れる | insert あり。 |
| L05 | 項目を置き換える | replace あり。 |
| L06 | 一覧の何番目 | item あり。範囲外を空成功にしない。 |
| L07 | 一覧の件数 | length あり。 |
| L08 | 最初の該当項目 | `list.findResult` が `Optional<FindMatch<T>>` で最初の item と 1 始まり position を返し、該当なしを明示する。旧 find も互換維持。 |
| L09 | 一覧の一部分 | slice あり。 |
| L10 | 一覧をつなぐ | concat あり。 |
| L11 | 重複を除く | unique と登録 field ごとの型別カードあり。最初の要素と入力順を保持する。登録集合比較も同じキー選択を使える。 |
| L12 | 順番を整える | 安定 sort、原子値/登録順序 field のカードあり。 |
| L13 | 条件に合うものだけ | 純粋 filter、本文局所 item binder あり。 |
| L14 | 各項目から値を作る | 純粋 map、局所 binder あり。 |
| L15 | 数値の合計 | sum あり。空は 0、欠値や非有限値を補完しない。 |
| L16 | 数値の平均 | AverageValue（Optional 値＋使用件数）あり。 |
| L17 | 一覧の最大と最小 | `list.minMax` と登録 MinMaxValue `{minimum:Optional<Number>,maximum:Optional<Number>}` あり。空は両方 unset。旧 min/max も互換維持。 |
| L18 | 同じ項目ごとにまとめる | `list.group` と登録 Group<K,T> あり。最初のキー順・各グループ内の入力順を保持し、キー欠損をエラーにする。 |
| L19 | 両方にある項目 | intersection あり。登録順序/キーを保つ。 |
| L20 | 片方だけの項目 | difference あり。 |
| L21 | 二つの一覧の集合 | union あり。 |
| L22 | 順番で組にする | 登録 Pair<A,B> と zip、再帰型選択あり。List/Optional/登録 Record/MessageSpec と lawful なサービス結果も既存予算・provenance 内で組にできる。長さ不一致を拒否し、サービス証拠を偽造できない。 |
| L23 | 指定件数ずつに分ける | chunk あり。件数は固定/変数/式、0 拒否、余りを保持。 |
| L24 | どれかが合う | 純粋 any あり。空は false。 |
| L25 | すべてが合う | 純粋 all あり。空は true。 |

### 抽選 3 形と日時 6 形

| ID | 名前 | 対応と残件 |
| --- | --- | --- |
| R01 | 乱数を一度決める | 明示 integer 生成と固定結果あり。 |
| R02 | 重複なしで選ぶ | sample と固定候補/件数/結果あり。 |
| R03 | 順番を混ぜる | shuffle と固定結果あり。 |
| D01 | 日付を組み立てる | DateOnly の date.compose あり。 |
| D02 | 曜日を調べる | 登録 WeekdayEnum の date.weekdayEnum/zoned.weekday あり。旧 Number 0–6 の date.weekday も互換維持。 |
| D03 | 暦で日付を動かす | DateOnly の date.addDays あり。 |
| D04 | 期間内か調べる | DateOnly/DateRange と Instant/InstantRange の型付き `range.contains`・入力/カードあり。日付終端包含と時点半開終端を区別する。 |
| D05 | 開始時刻を使う | **読取り専用run.startedAtを実装・検証済み**。保存・再開でも不変。 |
| D06 | 今の時刻を確認 | readClock あり。 |

### 制御 9 形とメッセージ 2 形

| ID | 名前 | 対応と残件 |
| --- | --- | --- |
| C01 | この繰り返しを抜ける | break あり。 |
| C02 | 次の項目へ進む | continue あり。 |
| C03 | 結果の状態で分ける | ParseResult/OperationOutcome 専用分岐あり。成功値は成功枝だけ、UNKNOWN の後続 write は停止。 |
| C04 | 条件成立まで有限に確認 | **readTicket限定CT11を実装・検証済み**。固定回数/間隔/期限、成立/回数到達/期限切れを区別。 |
| C05 | 自作の値を使う | 固定版 Pure call、定義/入力/本文/出力と独立版・参照・差分・選択更新の管理あり。 |
| C06 | 共通手順を呼ぶ | 固定版 call、独立版・参照・差分・選択更新と未参照削除の管理あり。 |
| C07 | 手順の結果を返す | 宣言した型付き出力の return あり。 |
| C08 | 項目ごとの結果一覧 | 宣言出力ごとの読取専用 List<IterationResult<T>> あり。1 始まり index と6状態を保持し、成功だけ result を設定する。 |
| C09 | 条件を確認して続ける | branch＋end の合成で表現可能。専用配置形は未提供（B）。 |
| M01 | 装飾文を作る | RichTextSpec の構築/入力/合成あり。 |
| M02 | Embed を作る | 登録 text/field/color 等の構築/入力あり。素材系は別採用（C）。 |

### A の実装依存を承認待ちへすり替えない

CT14/EX11、EX09/D04、C08、V08/V12、group、format、自作定義 UX は旧仕様内の実装依存として完了させた。結果型の出所証拠・枝内 scope・保存/再開・模擬入力・予算、範囲型の半開境界/TZ、項目別6状態をまとめて検証する。これらを新 Scratch の承認待ちへ移したり、原本から削除したりしていない。具体的な根拠は次の A19 対応表と実装記録に分けて記す。

### A19 の完了対応表

A19 は直前の表で A が残っていた17機能族と、前段で完了した DA03/EX01 の計19行である。具体形は機能族と重なるため別件として加算しない。以下は元の意味の不足を埋めた対応であり、B の新 Scratch 条件/算術表示、C の追加採用・外部受入、D の対象外を完了扱いにしない。最終的な試験回数と環境制約は [今回の検証記録](alpha15-implementation.md#a19-completion-and-current-verification) に記す。

| 機能族 | 完了した旧承認内の契約 | core / editor / 試験の根拠 |
| --- | --- | --- |
| TR02 | 固定 anchor の経過間隔、取り逃し skip、TZ 意味変更で新規開始停止・再確認。 | [elapsed](../packages/automation/src/elapsed-schedule.ts)、[schedule-rules](../packages/automation/src/schedule-rules.ts)、[trigger UI](../apps/web/app/automation/trigger-editor.tsx)、[unit](../tests/unit/alpha15-elapsed-schedule.test.ts)、[integration](../tests/integration/alpha15-schedule-reviews.test.ts)、[browser](../tests/e2e/alpha15-elapsed-schedule.spec.ts)。 |
| CT02 | 固定表の同型値選択、重複キー拒否、該当なし必須。 | [expression](../packages/automation/src/expression.ts)、[FixedLookup UI](../apps/web/app/automation/fixed-lookup-editor.tsx)、[list unit](../tests/unit/alpha15-list-completion.test.ts)、[A19 browser](../tests/e2e/alpha15-a19-editor.spec.ts)。 |
| CT03 | 項目別出力、6状態、成功だけの payload、再開時に確定結果を維持。 | [iteration schema](../packages/automation/src/iteration-results.ts)、[runtime](../packages/automation/src/runtime.ts)、[statement UI](../apps/web/app/automation/workspace.tsx)、[helper unit](../tests/unit/alpha15-iteration-results.test.ts)、[integration](../tests/integration/alpha15-iteration-approval.test.ts)。 |
| CT06 | 同じ通常ロール action の正式承認待ち、期限・現在資格・証跡束縛。 | [runtime](../packages/automation/src/runtime.ts)、[role policy](../packages/discord/src/automation-role-policy.ts)、[statement UI](../apps/web/app/automation/workspace.tsx)、[integration](../tests/integration/alpha15-iteration-approval.test.ts)、[A19 browser](../tests/e2e/alpha15-a19-editor.spec.ts)。 |
| CT08 | 固定版共通手順、独立版・参照・差分・選択更新・未参照削除。 | [management](../apps/web/app/automation/definition-management.ts)、[manager UI](../apps/web/app/automation/definition-manager.tsx)、[unit](../tests/unit/alpha15-definition-management.test.ts)、[browser](../tests/e2e/alpha15-definition-manager.spec.ts)。 |
| CT09 | 固定版の型付き出力編集と正常 return、旧参照を無断更新しない。 | CT08 の管理経路、[compiler](../packages/automation/src/definition.ts)、[runtime](../packages/automation/src/runtime.ts)、[management unit](../tests/unit/alpha15-definition-management.test.ts)。 |
| CT14 | ParseResult/OperationOutcome 分岐、成功値 scope、偽造拒否、UNKNOWN write 停止。 | [results](../packages/automation/src/results.ts)、[runtime](../packages/automation/src/runtime.ts)、[UI model](../apps/web/app/automation/model.ts)、[unit](../tests/unit/alpha15-results.test.ts)、[integration](../tests/integration/alpha15-results.test.ts)、[A19 browser](../tests/e2e/alpha15-a19-editor.spec.ts)。 |
| CT15 | Pure 定義/引数/出力/本文の編集と固定版・参照・差分管理。 | CT08 と同じ管理経路、[pure cards](../packages/automation/src/expression-cards.ts)、[management unit](../tests/unit/alpha15-definition-management.test.ts)、[browser](../tests/e2e/alpha15-definition-manager.spec.ts)。 |
| DA03 | 型付き参照・変数使用範囲表示と固定 `run.startedAt`。 | [builtins](../packages/automation/src/builtins.ts)、[model](../apps/web/app/automation/model.ts)、[metadata unit](../tests/unit/alpha15-run-metadata.test.ts)、[editor browser](../tests/e2e/alpha15-editor.spec.ts)。 |
| DA04 | Group/位置付き find/MinMax/登録キー/複合 Pair と状態付き反復結果。 | [structured schemas](../packages/automation/src/structured-values.ts)、[Pair](../packages/automation/src/registered-pairs.ts)、[cards](../packages/automation/src/expression-cards.ts)、[recursive type UI](../apps/web/app/automation/type-picker.tsx)、[list unit](../tests/unit/alpha15-list-completion.test.ts)、[list browser](../tests/e2e/alpha15-list-editor.spec.ts)。 |
| DA07 | Optional の present/unset 専用枝、present だけの読取専用値。 | [compiler](../packages/automation/src/definition.ts)、[runtime](../packages/automation/src/runtime.ts)、[model](../apps/web/app/automation/model.ts)、[results unit](../tests/unit/alpha15-results.test.ts)、[editor unit](../tests/unit/alpha15-a19-editor.test.ts)、[A19 browser](../tests/e2e/alpha15-a19-editor.spec.ts)。 |
| EX01 | 既存 round/floor/ceil の digits 編集・保存/再読込。 | [value UI](../apps/web/app/automation/value-slot.tsx)、[cards](../packages/automation/src/expression-cards.ts)、[editor browser](../tests/e2e/alpha15-editor.spec.ts)。 |
| EX02 | DateRange/InstantRange の型付き範囲判定。 | [temporal values](../packages/automation/src/temporal-values.ts)、[cards](../packages/automation/src/temporal-cards.ts)、[unit](../tests/unit/alpha15-temporal-values.test.ts)、[browser](../tests/e2e/alpha15-temporal-editor.spec.ts)。 |
| EX04 | 有限 Number の明示桁数/locale format。 | [temporal values](../packages/automation/src/temporal-values.ts)、[cards](../packages/automation/src/temporal-cards.ts)、[unit](../tests/unit/alpha15-temporal-values.test.ts)、[browser](../tests/e2e/alpha15-temporal-editor.spec.ts)。 |
| EX05 | 登録された空白/改行整形規則の明示選択。 | [temporal values](../packages/automation/src/temporal-values.ts)、[cards](../packages/automation/src/temporal-cards.ts)、[unit](../tests/unit/alpha15-temporal-values.test.ts)、[browser](../tests/e2e/alpha15-temporal-editor.spec.ts)。 |
| EX07 | LocalTime/ZonedDateTimeSpec の型付き構築と DST gap/fold 入力。 | [temporal values](../packages/automation/src/temporal-values.ts)、[value UI](../apps/web/app/automation/value-slot.tsx)、[unit](../tests/unit/alpha15-temporal-values.test.ts)、[browser](../tests/e2e/alpha15-temporal-editor.spec.ts)。 |
| EX08 | WeekdayEnum、明示日時表示/TZ変換、現地暦日移動。 | [temporal values](../packages/automation/src/temporal-values.ts)、[cards](../packages/automation/src/temporal-cards.ts)、[unit](../tests/unit/alpha15-temporal-values.test.ts)、[browser](../tests/e2e/alpha15-temporal-editor.spec.ts)。 |
| EX09 | DateRange/InstantRange の正式型・構築・変換・終端検証。 | EX02/EX07 と同じ型・値・UI 経路、[unit](../tests/unit/alpha15-temporal-values.test.ts)、[browser](../tests/e2e/alpha15-temporal-editor.spec.ts)。 |
| EX11 | 厳格 decimal / YYYY/MM/DD / 登録 Enum 変換、ParseResult。 | [results](../packages/automation/src/results.ts)、[expression](../packages/automation/src/expression.ts)、[cards](../packages/automation/src/expression-cards.ts)、[unit](../tests/unit/alpha15-results.test.ts)、[integration](../tests/integration/alpha15-results.test.ts)、[A19 browser](../tests/e2e/alpha15-a19-editor.spec.ts)。 |

## Discord API 調査表に残る未採用ファミリー

[Discord 原本](design/alpha15-source/NEXUS-discord-api-action-catalog.md) §5–6 の全 API 調査範囲は、66 機能族や採用済み 7 operation より広い。A（採用候補）も採用承認ではない。以下は未採用部分の一覧であり、全部を実装する約束ではない。G-P/G-D/G-O/F/X/N の境界を generic JSON/任意 route で迂回しない。

| 調査ファミリー | 本番ユーザー定義ブロックへ未採用の範囲 | 分類 |
| --- | --- | --- |
| 投稿/返信/リアクション/投票 | 返信、任意の古い自己投稿編集、自己/他人投稿削除、crosspost、pin、reaction、反応一覧、投稿履歴/検索/転送、theme共有、TTS/音声投稿、Poll作成/終了/結果/投票者一覧。 | 通常候補は **C**。大量削除/継続本文収集は **D**。Apps の投票は原本で **X**。 |
| Interaction/command | ユーザー定義初期/継続応答、元応答更新/削除、componentによる投稿更新、Modal/構造化回答、autocomplete、flow からの command登録/権限変更、Activity起動。 | **C**。既存管理基盤や ACK があることと、flow action 採用は別。 |
| channel/thread/forum | category作成、channel設定/VC設定/配置/権限変更/削除、元投稿からのthread/private、forum/media投稿、thread設定/参加者操作/終了再開/削除、announcement follow、入力中表示、VC status。 | **C**。権限変更/削除は追加の影響判断。限定 text channel/public thread 作成だけは採用済み。 |
| role/member/moderation | role情報/人数のユーザー用read、role定義/順序/権限/削除、特定member最小read/一覧検索、nickname、timeout、kick/BAN/prune、OAuth加入、VC移動/mute、AutoMod。 | 通常の候補も **C**。特権付与・BAN/kick/大量削除は **D**。普通のallowlist role付外しだけは採用済み。 |
| event/invite/guild | scheduled event作成/read/list/変更/遷移/削除/参加希望者、invite管理、guild概要/概数、guild設定/Welcome/Onboarding/Widget/Vanity/incident、Integration/template、audit log のユーザー用取得。 | **C**。概数を実数・名簿にしない。自操作照合用の内部取得を一般readの採用としない。 |
| Webhook | 作成/read/list/変更/削除、送信/投稿操作、GitHub/Slack互換。 | **D** 今回未採用。秘密・外部接続の別契約を追加しない。 |
| 絵文字/stamp/soundboard | guild/app絵文字のread/利用/管理、stamp利用/管理、soundboard read/再生/管理。 | **C**。app全体資産の管理権をguild編集者へ渡さない。 |
| Stage/voice | Stage作成/read/更新/終了・発言要求/抑制、VC参加/退出/音声送信・最小VoiceStateのユーザー用read。 | **C**。通常音声/DM内容分析・人物評価は **D**。 |
| app/Bot自身 | app設定・Bot名/画像/presence等。 | **C/F** 運営者専用領域。 |
| User OAuth/DM/Group DM | 本人接続情報/member、guild加入退出、DM/Group DM。 | **C** 本人別認証・目的が必要。一斉/無断DMとself-botは **D**。 |
| Linked Roles/Premium Apps | role接続metadata/本人値、SKU/subscription/entitlement等。 | **C/F**。有料価格/販売/購入操作は今回 **D**。 |
| Lobby/Social SDK/Activities/表示連携 | Lobby/member/link channel、Rich Presence、Link Preview/Application Identity Profile等。 | **C/F** 別領域の採用。通常メッセージ装飾と同一視しない。 |
| Gateway起点群 | 投稿/反応/pin、channel/thread/role、member/BAN/audit、VC、scheduled event/参加希望、Poll、invite/Webhook/Integration/表現資産、AutoMod、presence/activity。 | **C** イベント別のIntent/欠落/目的/最小schema。現在採用は既存intakeと検証済みNative Interactionだけ。 |

### 現在の if / elif と最小表示案

現在の branch は then / otherwise / unknown の三経路を持つ。false 側に別の branch を入れると、最初に合致した枝だけを実行する順序付き else-if と最後の else を表現できる。専用 elif AST と平坦な multi-elif 編集 UI はない。Boolean と三値 ConditionResult は区別し、短絡 AND/OR/NOT を維持する。不明な条件・入力エラー・外部 write の UNKNOWN もそれぞれ別である。

**B の未実装表示案**: false 側が単一の branch だけである既存の木に限り、「もし / そうでなければもし / それ以外」と平坦に表示し、各条件の「確認できないとき」を別に残す。兄弟処理を含む木を勝手に平坦化せず、ID・scope・固定版・意味ハッシュを保つ。条件/演算の Scratch 風全体設計と専用 elif は親での追加設計レビューを待つ。この案を実装済み・承認済みの新文法とは扱わない。

## 7 点の承認との照合

| 最新の承認                                                                                     | 現在の対応                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. 個別 Wait と Run 全体を最大 7 日。長期繰返しは別 Scheduler                                  | [定数](../packages/automation/src/types.ts)、compiler/runtime/service で制限。子・枝・Wait 連結で期限や予算を延長しない。原本の Run 全体期限「未承認」は上書きされる。                                       |
| 2. 最小状態/抽選結果を終了後 7 日以内に削除。本文/変数を診断へ入れない。定義/backup/復元も制限 | retention と tombstone fence は実装済み。実 backup 期限/削除 journal/オフライン復元は外部受入事項。匿名月次 quota aggregate は実行記録と分け、実行削除による枠復活を防ぐ。既存別目的監査の期間を流用しない。 |
| 3. Run をまたぐ可変変数を見送る                                                                | Run locals/readonly 起点/引数/枝出力だけを採用。共有可変 DB、CT12 cooldown、新しい集計履歴は提供しない。                                                                                                     |
| 4. 外部 HTTP 送信/外部イベント受信を見送る                                                     | 固定 wrapper と検証済みの既存 intake/Discord Interaction 境界だけ。任意 URL/route/webhook 入力はない。                                                                                                       |
| 5. 通常投稿/許可ロール/限定 channel・thread。対象/権限/連続実行を制限                          | 7 operation と対象 policy、正式なロール証拠・承認、直前再認可、Run 予算/追加 burst guard を適用。BAN/kick/大量削除/管理者付与/任意コード/self-bot は対象外。                                                 |
| 6. Free 招待 Beta 共通文法。測定後の有限枠。有料価格未確定                                     | 対象 Windows PC の小さい合成測定と保守的初期 admission/storage 枠を記録。既存分析プラン差と自動化文法を混同せず、プラン案の仮数値や価格は採用しない。                                                        |
| 7. 外部結果不明は自動反復せず停止。照合できる場合だけ確認                                      | 操作 claim/台帳と UNKNOWN fence を実装。対応する自己投稿/状態証拠だけを照合し、同じ操作を盲目的に再送しない。                                                                                                |

## 66 機能族 / 74 具体形の扱い

統合設計 §2.8 と PR01 は **標準 55 + 条件付き 11 = 66 機能族**、未採用 4 概念は別枠、と整理する。74 具体形は **37 具体化 + 25 能力追加 + 12 新群形**であり、配置数・実行上限・無料/有料の境界ではない。検索別名をカード件数へ足さず、同じ入力欄の「3 件」「5 件ずつ」「10 分」を固定の製品制限にしない。

[現在の catalog](../packages/automation/src/catalog.ts) は採用済みと利用不可を理由付きで分け、[adopted set](../packages/automation/src/admission.ts) は本番 action の実際のゲートである。API カタログの A も候補であり、全件の採用承認を意味しない。G-P/G-D/G-O/F/X/N の整理を迂回する generic Discord JSON は提供しない。本文の継続収集/保存、人物評価、外部 HTTP、新しい全員名簿、無限 loop は追加しない。alpha16 のルールベース AI は対象外を維持する。

## 実装記録の残件との整合

[実装記録の残件](alpha15-implementation.md#remaining-work-and-release-gates) とこの表を一緒に更新する。CT05/CT11 の限定補完に続き、下記 A19 の旧承認内の不足を完了した。複合 Pair を atomic だけへ縮めず、型付き結果分岐/厳格変換、範囲型/判定、Optional 枝、固定対応表、group/反復結果、format、Pure 管理 UX と予定の経過間隔/TZ 差分を含む。new-form/message-metadata 起点、EventRelative の情報源/追随、追加 Discord 群、実環境受入は C、専用 multi-elif と新 Scratch 全体表示は B として分ける。

parallel、限定 internal/interaction 起点、Legacy の text+embeds、同一 Run 投稿編集、readTicket、証拠の揃う構成でのロール変更は実装されている。「parallel は AST のみ」「RichText/Embed は helper のみ」「ロールは全面停止」という以前の説明へ戻さない。同時に、`list.zip` の名前や範囲 helper の存在を本番ブロックの完成とした以前の説明は訂正する。

全機能を有効化したとまとめず、完了判定は各経路の source・保存/再開・サーバー検証・テスト・UI で行う。年齢/契約能力/利用規約同意は別の運営判断であり、新しい個人申告や保持目的をここで創作しない。

## 外部受入の全領域

詳細と必要入力の正本は [外部確認事項](alpha15-external-validation.md)。以下を「未実装ブロック」と混同しない。認証情報を報告へ貼らず、実環境の準備や確認権限が得られるまでは合格と扱わない。

| 領域 | 必要な入力・環境と未確認事項 |
| --- | --- |
| Discord/OAuth | 認可された使い捨て guild、同意済み担当者、既存 app ID/登録 origin/callback。Guild/User Install、現在資格、state 再利用、Bot 実参加、旧設定保持、導入案内を実確認。 |
| 普通のロール | 明示した test role/target allowlist、既存 Bot/requester/approver 階層、同一プロセスの完全 coverage proof。review→approval→dispatch の権限変化、不可視 channel、deny 解除、失効/429/UNKNOWN を確認。別プロセスは fail closed。 |
| 公開 Web/お名前.com | 既存の regular HTTPS、reverse proxy、Windows の動的 Web/API 経路。deep link/OAuth 復帰、Cookie/Origin/Host、loopback 運営者画面分離、再起動と再接続。静的ページの表示だけで設定保存を証明しない。 |
| backup/削除 | 既存暗号化 backup の実一覧/期限、最新 tombstone、対応 key 版、隔離 offline 復元先。最大 7 日、migration 059 までの適用と削除情報の再反映、旧 session/Run/wait/event/button 再生防止を確認。 |
| 利用条件/規約 | 既存 eligibility 手続と承認された versioned terms 同意設計。招待・Discord 管理資格を年齢/現地成年/契約能力の証明にしない。新しい生年月日・ID・個人申告を収集していない。 |
| accessibility/容量 | 実 Windows screen reader、IME/touch、200% 倍率、長い JA/EN、有限 guard 内の代表 synthetic burst/復旧。ローカル算術 probe とブラウザ fixture は実機支援技術や実 Discord 容量を保証しない。 |
| credential ACL | 現 Windows PowerShell policy で正式に動く検証経路。実 owner-private regular file の受入は未確認。[Windows 記録](alpha15-windows-verification.md) の代替試験は ACL 適用/実受入の代用ではない。policy 回避・ACL 変更はしていない。 |

## 検証証拠と外部受入

- 今回の文書点検では、原本の 66 機能族＋別枠 4 構想に対して **70 ID/70 ID、74 具体形に対して 74 ID/74 ID、欠落・重複なし**を静的照合した。ローカル 91 リンクの解決、UTF-8 往復一致、対象文書の `git diff --check` も成功した。これはカタログ対応漏れの点検であり、70/74 件の実行試験合格を意味しない。
- 最終更新では、6 原本のサイズ/SHA-256/UTF-8 と統合設計の全節・IN/PR、editor の BEX の存在を再確認した。原本の全利用例が完走したという証拠ではない。
- 先行スライスの [値カード試験](../tests/unit/alpha15-expression-cards.test.ts) と [editor bridge 試験](../tests/unit/alpha15-editor-bridge.test.ts) は **20/20 成功**（カード 15、bridge 5）。型/局所 binder/service-only Record 偽装拒否/固定 pure 版/ブラウザ bundle/5 種のメッセージ合成/一度だけの escape/provenance を含む。これは後続補完前の局所記録である。
- 先行 editor スライスは **ブラウザ 16/16、関連 unit 4 ファイル 41/41、全体 TypeScript と対象 lint 成功**。fixture のローカル確認であり、実 Discord/OAuth の受入に置き換えない。
- 同一 Run 投稿編集/readTicket の読取 review では、厳格 payload、channel/Run/成功証拠、現在認可、本文/証拠を返さない境界を確認した。未掃除 intake の論理保持期限不足は担当が修正した。transport/helper 関連 **65/65 成功**はその時点の局所結果であり、後続コードを含む全体 integration の結果ではない。
- 全体の型/lint/build/unit/integration、環境制約、追加スライスの結果は親の [検証記録](alpha15-implementation.md#validation-record) と .local/alpha15-* を正本とする。この文書更新のために全 suite を再実行したとは主張しない。

実 OAuth/Discord、公開 HTTPS、実スクリーンリーダー・IME・タッチ機器、お名前.com への配置、Hosted 負荷、実 backup 最大 7 日と削除情報を使うオフライン復元 drill は外部確認が残る。Windows 11 の既存構成維持と、実配置受入の通過は分ける。購入・認証情報生成・セキュリティ設定変更・本番データ変更・デプロイ・マージはこの対応表の作業では行っていない。
