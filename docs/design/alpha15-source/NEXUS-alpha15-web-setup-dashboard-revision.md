# NEXUS alpha15：Web導入・Dashboardへの改訂差分

2026年10月14日｜設計案・未実装・実機未検証

## 0. 位置付け

alpha15は全自動化とWeb管理設定移行、alpha16はルールベースAI。Web導入3回答・監査・UX補助を照合し、既存設計のS01〜S05・S14、移行・ホーム・APIを改訂する。ブロック編集・実行契約は維持する。

- **確定要件**：Web招待後、現在資格・対象・Bot実参加・最小情報が揃えば設定へ自動進行。Discordに案内＋URLボタン。分かりやすいDashboard。既存値・履歴・利用枠を保持し不足だけ補う。
- **読取り確認済み**：非公開コードSHA `d370faaab3fb8e5c86710ee7c0699476b204b018`、alpha14。Next.js、Fastify、Gateway/worker、PostgreSQL/Kysely、Redis/BullMQ、SettingsService、revision、OAuth/state/sessionがある。稼働版は未確認。
- **提案・未検証**：本書の限定認可・状態・画面・仮API・通知台帳・移行・試験。実OAuth/Discord、Windows/HTTPS、復元、性能、操作性は未検証。

秘密・ホスト・バックアップ・内部監視・ベータ審査等の運営画面は公開Webへ移さない。大型実装着手は別途了承後。本書は実装・公開・外部採用の承認ではない。

Goals/team誤変換と資格不明での保存を訂正し、任意入力・自動進行を守る。

## 1. 一つの状態・進行契約

各判定に対象guild・確認元・時刻・確認済み／確認中／不足／確認不能を持たせる。「接続済み」で資格や稼働を一括表示しない。

| 優先・状態 | 意味と進行条件 | 利用可能範囲・次の主操作 |
|---|---|---|
| 1 W-SESSION／W-AUTH確認不能 | 本人・現在資格。失効と照会失敗を区別 | 再認証/再確認。変更不可。閲覧も独立認可の範囲のみ |
| 2 W-AUTH不足 | 対象操作の現在資格なし。未接続guildの初回接続確定のみowner/currentManageGuildを要求 | 資格のない操作を拒否。接続済みguildの既存委任は下記ポリシーで判定 |
| 3 W-BETA／利用条件不足 | ベータ対象・停止と、利用条件資格・同意を別確認 | 理由と必要な手続を表示。Bot追加だけで解除しない |
| 4 S-BOT不在 | サーバー用Bot実参加を確認できない。User Installのみもここ | 対象固定のGuild Installへ。通常guildデータ収集・実行はしない |
| 5 S-BOT／S-DATA確認中 | 実参加・対象・資格・最小情報を確認中 | 状況と再確認。全メンバー・全Intentは待たない |
| 6 W-GUILD-LINK未確定 | 対象サーバーとWeb管理の接続確認レコードが未確定 | 限定setup経路で照合後に確定。成功すれば自動的に不足設定へ |
| 7 S-SETUP未完了 | 新規・旧設定の不足・下書き・保存確認中を区別 | 不足を下書きで補い確認適用。任意の空欄は未完了に数えない |
| 8 S-SETUP完了 | 必須項目の検証と共通設定への確定適用が完了 | Dashboardへ自動進行。自動化ON・観測拡大・実送信はしない |
| 常時併記 S-CONNECTION | Web/API・DB・REST・Gateway・worker/schedulerを別表示 | Gateway停止でもRESTの現在資格確認と設定API/DBが成立すれば許された保存可 |
| 常時併記 S-DATA／S-AUTO | 機能別情報・Bot権限・版・停止理由 | 権限不足は該当機能のみ。予定系・イベント系の依存先を別判定 |

主操作は優先順で一つ示し、他の問題も残す。W-GUILD-LINKは接続レコードで、ログイン・API疎通・現在資格とは別。Discord管理資格、18歳以上かつ現地成年・契約能力等の利用条件、ベータ提供資格を混同しない。生年月日・身分証を一律追加収集しない。

接続済みguildの日常管理は既存ポリシーで現在資格を再検証する。adminRoleId/managerRoleIds所持、Administrator/ManageGuild等は原則ADMIN相当、明示組織ロールが優先、REVOKEDは拒否、staff/helperのみはREAD。初回接続条件で既存委任を一律締め出さない。新alpha15の編集・有効化・承認への権限対応は別途未決で、新操作の権限を自動付与しない。Bot権限も別に確認する。

## 2. Web完結の導入と再開

1. **ログインする / Sign in**：Discordで本人確認。ログイン成功とBot追加成功を分ける。
2. **サーバーを選ぶ / Choose a server**：対象名・アイコンを固定し、現在管理可能か確認。「このサーバーを設定する」で開始。未参加ならDiscord招待へ進む。
3. **参加を確認する / Confirm installation**：戻り先だけを信用せず、実参加・対象・現在資格・利用資格・最小情報を照合する。揃えば追加クリックなしで初期設定へ進む。
4. **不足を確認して適用する / Review and apply**：不足を下書きで補い、確認した設定を確定適用してホームへ進む。

既存Botは招待を省略、設定完了ならホームへ。通常ログインから現在資格を再確認して再開し、保存済み設定を作り直さない。

開始要求は本人・guild・request・期限・使い捨てstateを結び付け、callbackで全て照合。不一致は拒否し、重複は同じ結果参照に収束させる。state・秘密をURLボタンやログへ載せず、二重接続・通知を作らない。

既存dashboardContextのVERIFIED必須にsetupを直結すると接続前に入れない。**setup専用の限定認可**で本人・現在資格等を確認し、導入状態・最小候補・本人の下書きのみ扱う。分析・履歴・他人の申請・運営情報は開かず、接続後もAPIで現在資格と対象を検証する。

最小情報はサーバー識別・本人資格・実参加・必要対象と権限。未招待guildは許可された選択用最小一覧だけで通常収集せず、本文・添付・全メンバーを一律取得しない。

状態取得の提案は2秒→5秒、60秒後に手動再確認。保証・保持承認ではない。非表示時の抑制・照会共有・rate limit対応を行い、待機終了を失敗と断定しない。

## 3. 初期設定と既存値の移行

旧読取りはsetupSteps無しを全true、setupVersion無しを1とするが、新仕様完了とはみなさない。旧版・履歴・分析・対応・利用枠を保持し不足だけ検出する。

| 項目 | 旧値の保持 | 現在対象・型の再検証 | 追加確認と保存完了条件 |
|---|---|---|---|
| 言語 | 設定済み言語を保持 | 対応言語・形式 | 不足時だけ選択。保存版に確定 |
| タイムゾーン | 保存値と補完由来を保持 | IANA文字列、64字以内、Intl.DateTimeFormat検証 | 通常既定UTC、旧保存の欠落時のみAsia/Tokyo補完。無断リセットせず日時例で確認 |
| 管理資格・利用条件 | 過去接続／同意記録を消さない | Discord資格は現在照会、ベータ・必要同意は別確認 | 古い資格を許可証にしない。不足は該当手続へ |
| scope／分析範囲 | analysisScopeのmode:all/include/exclude、channelIds、任意excludedChannelIdsを保持 | ID配列は各1000件以内・重複不可。対象・継承・除外を検証 | 自動化の送信許可とは別。旧allを新規既定へ流用せず、保存だけで観測拡大しない |
| notifications／通知 | helperChannelId:ID/nullとhelperEnabled:booleanを保持 | 既存helperEnabledを保持。選択だけで新規有効化しない | 新通知先は任意。adminNotificationChannelId・weeklySummaryChannelIdへ一律変換しない |
| team／管理ロール | managerRoleIds:Discord Role ID配列、最大20件 | guild・現在ロール・委任資格を検証 | UserRef/MemberRefへ変換しない。付与用validateRoleを流用しない |
| goals／目標 | newMemberGoals:reply/lfg/voice/event/feedback/bug/playtestの配列、最大7件 | 新規メンバーに期待する参加行動として検証 | 数値目標・利用目的へ変換しない。別項目goalPresetとも区別 |
| 履歴・利用枠・既存稼働 | ID、版、停止、削除・復元履歴を保持 | 同じguild、参照整合、現在の安全条件 | 表示・保存だけでリセット、再送、旧稼働停止、有効化をしない |

固定SHAの型追補を反映した。旧段階名はnoticesではなくnotifications。scopeは親/category継承、明示除外、STAFF・閲覧不可・private thread除外を保持する。Wizardのcategory選択は子channelへ展開し、all選択も取得済み対象のinclude集合へ変換する。goalPreset(multiplayer/early_access/live_service/null)はnewMemberGoalsと別。読めない旧値は原形保持＋要確認とする。

設定は①言語・日時、②範囲、③通知・管理ロール・目標・資格、④確認適用の4区分。任意項目の省略を許し、通信に架空の進捗率を付けない。機能の必要情報・保存目的・閲覧者・Bot権限を示し、選択だけで稼働させない。

旧Discord設定は読取り・Web案内へ移行し、残す書込みは同じSettingsService・本人・認可・revisionを使う。画面移行だけで旧稼働を停止しない。資格喪失・停止指示等の独立した安全条件は維持する。

## 4. 設定正本・仮API・保存の契約

実効設定の正本はSettingsServiceが管理するguild_settings＋revision。設定下書きは候補であり正本ではない。下書き保存・差分確認・確定適用を分け、未完成下書きで現行設定や実行を変えない。以下は仮API。

| 仮操作 | 入力・確認 | 成功と禁止事項 |
|---|---|---|
| POST setup/requests | 本人・guild・現在資格・CSRF/Origin・一意キー | 導入要求だけ作成。保護データを返さない |
| GET setup/status | 本人・対象・閲覧認可・確認元 | 最小状態、確認時刻、次の操作。未取得を成功にしない |
| POST setup/verify | 要求・本人資格・対象・実参加・利用資格・最小情報 | 接続レコードを一意確定。URLや旧接続だけで許可しない |
| GET settings | 本人、現在の閲覧資格、guild一致 | 共通設定とrevision。不正guildの名称・件数も漏らさない |
| PATCH settings/draft | expectedDraftRevision・一意キー・型付き差分・現在編集資格 | 下書き版だけ保存。未完成は明示、不正型は拒否。実効設定を変えない |
| POST settings/apply | draftRevision・expectedSettingsRevision・現在資格・差分/必要な影響確認 | CASで確認済み項目を実効設定へ適用。確認外の変更はしない |
| POST setup/complete | 確定適用済み設定版・必須検証・現在資格 | 同じ版の設定完了を記録。有効化・実送信なし |
| POST automation/validate・test | 保存版・認可・型・範囲・保持条件 | 送信なしの検証・模擬結果。本番Runと承認消費を作らない |
| POST automation/enable | 確認版・有効化資格・影響確認・機能条件 | 明示した版のみ新規実行へ。保存と別操作 |
| GET my/results/{id} | 本人＝申請者・現在閲覧資格・対象 | 本人の結果のみ。管理者権限不要でもURLだけのアクセス不可 |

全更新でsession・Origin/CSRF・現在操作資格を確認。本人ID・対象・目的を信頼できるWeb→API→サービス層へ引き継ぐ。クライアントのactor・権限・検証済みフラグや、既存の固定web-admin／permissions=32を個人の認可根拠にしない。

URL、session/request、画面、設定行、参照先の対象を照合する。同じrevisionの同時編集は一方のみ確定し、他方は変更比較へ。自動マージしない。同じ一意キー・同じ内容は同じ結果、別内容は拒否する。

確定適用と対応する進行更新は同一DBトランザクションで整合させる。下書き版と実効設定版を別表示し、結果不明は要求IDで照合して新規再保存しない。Bot/API/workerは確定版のみ読む。

確定適用は、確認した言語・日時・既存設定等を実際に更新する。観測範囲拡大、通知機能ON、自動化有効化・停止等は別の影響確認・操作を要し、通常保存に含めない。対象外の既存稼働は維持し、別タブ・サーバーの結果を混ぜない。

## 5. Discord導入案内と永続重複抑止

Guild/User Installを区別し、OAuthのguild_idを実参加証拠にしない。raw GUILD_CREATEは初期同期・復帰・参加で生じるが、discord.js 14.27.0は既存guildの復帰をGuildAvailableへ分離し、未キャッシュguildかつReady時にGuildCreateを出す。「再接続ごとに発火」と断定せず、ready時・導入確認時の所属照合で停止中追加も拾う。[導入区分](https://docs.discord.com/developers/resources/application#installation-context)、[OAuth](https://docs.discord.com/developers/topics/oauth2#advanced-bot-authorization)、[rawイベント](https://docs.discord.com/developers/events/gateway-events#guild-create)、[SDK公式処理](https://github.com/discordjs/discord.js/blob/14.27.0/packages/discord.js/src/client/websocket/handlers/GUILD_CREATE.js)

実参加・対象・利用可否・Bot権限・未送信証拠を確認。宛先は①既知の管理通知先、②投稿を許可したsystem channel、③Webのみを提案。存在だけで投稿許可とせず、最初のchannel・DMへ切り替えない。確実な未送信なら次の許可先を検討できるが、**結果不明は宛先を変えても再送しない**。

案内文案：

&gt; NEXUSの設定はWebで行います。サーバーを管理できる方は、下のボタンからログインして初期設定を進めてください。
&gt;
&gt; Set up NEXUS on the web. If you manage this server, use the button below to sign in and finish setup.

ボタン：「Webで設定する / Open Web Setup」、設定済みは「ダッシュボードを開く / Open Dashboard」。正規URLと対象候補だけで、認証・権限を代用しない。URLボタンはinteractionを生まず、Bot追加にephemeral応答はない。許可チャンネルへ通常投稿する。[Components](https://docs.discord.com/developers/components/reference)、[通常投稿](https://docs.discord.com/developers/resources/message#create-message)

通知はguild＋導入世代＋種別を一意とし、未送信／送信中／成功／確実な失敗／結果不明／Webのみを記録。世代をイベント回数で増やさず、再起動・重複・再接続を永続台帳へ収束させる。既存設定済みを初回扱いせず、再追加でも停止・履歴・証拠を保持する。

旧バックアップで台帳がなくても未送信としない。復元世代を隔離し、所属・停止・設定・通知証拠の照合まで新規通知と旧実行再生を止める。確認不能はWeb表示のみ。永久exactly-onceは保証しない。

## 6. 最小記録と保持の境界

| 目的 | 必要最小限の案 | 持ち込まないもの |
|---|---|---|
| 導入要求 | request ID、本人ID、対象guild、stateの安全な照合情報、期限、処理状態 | 生の認証秘密、投稿本文、全メンバー一覧 |
| 接続・移行 | guild、接続確認世代・時刻、設定schema/revision、不足項目、移行結果 | 永続的な「権限あり」の許可証、別正本 |
| 通知抑止 | guild、導入世代、案内種別・版、許可宛先、試行ID、状態、時刻、確認できたmessage ID | メッセージ本文の複製、token、無期限の詳細ログ |
| 本人結果 | 申請ID、申請者、対象、固定版、必要結果・閲覧条件 | 他人の回答、自由文、期限切れinteraction token |

保存承認ではない。目的、閲覧者、主系・ログ・バックアップ、削除条件・期間の確定まで該当提供を有効化しない。既存値の維持を新目的の保存了承に置き換えない。

## 7. Dashboardと日英文言

主ナビ：ホーム/Home、自動化/Automation、分析/Analytics、対応/Tasks、履歴/History、設定/Settings。通知・チーム・目標はカードと設定から到達。Goalsは「参加の目標/Participation goals」、Teamは管理ロールを示す。利用枠・料金/利用権・プライバシー・停止・ヘルプも残す。

PCは左ナビ、上部にサーバー・検索・言語。ホームは①必要な操作、②状態・機能カード、③最近の実行・次の予定。理由・対象・次の操作を示し、承認期限、結果不明、接続・資格問題を区別する。

機能カードは予定通知・申請と承認・受付対応・ボタン案内。説明一文、未設定／利用可能／有効／停止／権限不足、自動化数、主ボタンを表示。同じ編集基盤へ「例から作る」「設定を続ける」「一覧を見る」で誘導する。

履歴は完了・一部完了・待機・失敗・中止・結果不明を文字で区別し、予定にTZを付ける。未取得を0件・問題なしにしない。検索は現在guildの閲覧可能項目だけ。権限外の名前・件数を漏らさず実行もしない。

| 状況 | 日本語 | English |
|---|---|---|
| 確認中 | サーバー情報を確認しています | Checking server information |
| 権限不足確定 | このサーバーを設定する権限がありません | You do not have permission to configure this server |
| 資格照会失敗 | 管理権限を確認できません。もう一度確認してください | Could not verify permissions. Try again |
| 一部通信停止 | 接続の一部を確認できません。利用できる設定を表示しています | Some connections are unavailable. Available settings are shown |
| 既存移行 | 既存の設定があります。不足している項目だけ確認してください | Existing settings found. Review missing items only |
| 保存不明 | 保存結果を確認できません。再保存せず、状態を確認してください | Save result unknown. Check before saving again |
| 競合 | 別の画面で変更されています。内容を確認してください | Settings changed elsewhere. Review the changes |
| 空 | 自動化はまだありません | No automations yet |
| 通知不明 | 送信結果を確認できないため、再送していません | Send result unknown. Not sent again |

スマートフォンはメニューと1列カード、必要な操作を最上部へ。同じ親・枝・順番の手順一覧と個別設定を使い、ドラッグ不要で編集できる設計。320 CSS px、200%拡大、長いJA/EN、IME、タッチ、キーボード、読み上げは実機検証待ち。MEE6画面の複製・実測ではない。

## 8. 四つの利用例と本人への結果

全例は「未有効下書き→編集→送信なし試運転→影響・保存確認→有効化」。例で能力を限定しない。ブロック自由度・プランは別添[ブロック拡張設計](NEXUS-alpha15-block-expansion-revision.md)を参照。既存25回等は再評価する技術案で、最終制限ではない。

1. **申請→承認→限定ロール→本人が結果を見る**：申請者を認証から固定し、承認を対象・ロール・版へ結び付ける。直前に現在メンバー・承認者資格・MANAGE_ROLES・階層・許可ロール・channel上書きによる機密アクセスを検査。拒否・期限・不明は成功にしない。本人ページも本人＝申請者を検証しURLだけでは読ませない。
2. **毎週金曜18時→3チャンネルforeach案内**：タイムゾーンと次の日時を表示し、許可した3対象を固定。試運転は予定送信3件・実送信0件。途中失敗や不明で成功済みを再送せず、全件成功と表示しない。
3. **受付作成→24時間待機→未解決→担当の許可チャンネルへ通知**：再開時に受付を読み直し、対象・権限・中止を再確認。解決済みは送信0件、読取不能も勝手に未解決と扱わない。待機終了と受付解決を分け、担当DMを追加しない。
4. **ボタン→選択→新interaction→本人向け説明**：選択を元の本人・対象・期限と照合し、新しい操作への有効な応答として説明。期限後は再操作を案内する。長期待機はDBの状態で管理し、古いtokenを再利用しない。

初回interactionは3秒以内、tokenは15分有効。長期待機後は新しい操作や本人ページを使い、期限切れをDM・公開投稿へ代替しない。新目的の結果保持が未承認なら提供しない。[応答期限](https://docs.discord.com/developers/interactions/receiving-and-responding)、[ロールと権限](https://docs.discord.com/developers/topics/permissions)

## 9. 公開経路とDiscord制約

Windowsの動的Web/APIと静的案内を分離し、正規HTTPS origin・callback・Cookie・Origin/Host・直接URL・Discord復帰を検証。静的表示を保存成功としない。operatorのloopback・別認証・転送ヘッダー拒否を維持しTunnelへ公開しない。DB/Redis・内部API・interaction受信も境界確認する。

channel一覧を全体と扱わず、欠落で削除・範囲変更しない。実装時に仕様更新を再確認。rate limit・Retry-Afterを守り、書込み結果不明を再試行しない。[公式更新](https://docs.discord.com/developers/change-log)、[Rate limits](https://docs.discord.com/developers/topics/rate-limits)

## 10. 受入試験と残件

全て未実施。既存の実行・編集・停止・削除・保持試験に追加。

| ID | 入力・障害 | 合格条件 |
|---|---|---|
| W01 | 新規Web招待から実参加・最小情報到着 | 現在資格等の確認後に設定へ自動進行。Discord接続コードを必須にしない |
| W02 | OAuth成功のみ／User Installのみ／Bot不在 | 導入・設定完了にしない |
| W03 | state改変・期限切れ・別本人・別guild・二重callback | 不正接続0。重複は同一結果、通知増加0 |
| W04 | 別タブ・戻る・更新・サーバー切替・取消 | 対象混在0、保存済み状態から再開 |
| W05 | 未接続初回、接続済み委任、組織ロール、REVOKED、一般メンバー | 初回と既存資格を分け、委任を一律拒否せず、新操作へ無断拡張しない |
| W06 | 18歳等の利用条件不足・対象外ベータ・停止中 | Discord管理権限で迂回できない |
| W07 | Gateway停止、REST可／不可、API・DB停止 | 現在資格と書込み基盤成立時のみ保存。失敗を成功表示しない |
| W08 | 特定Bot権限・情報のみ不足 | 該当機能だけ停止、無関係設定を一律遮断しない |
| W09 | setup限定APIから通常履歴・他guildへアクセス | 保護データ漏えい・変更0 |
| W10 | 旧値、setupSteps/Version欠落、任意通知先空欄 | 意味・履歴・利用枠保持。不足だけ要求、空欄の任意項目で阻害0 |
| W11 | team/goalsの誤変換、旧all、既存有効版 | 無断変換・範囲拡大・停止・有効化0 |
| W12 | 未完成下書き、確定適用、二管理者、旧パネル | 下書きの実効変更0。適用は確認項目のみ、共通CASで競合検出 |
| W13 | 保存確定後応答消失・DB失敗 | 同じ要求を照合し、二重更新・偽完了0 |
| W14 | Bot停止中の追加、ready同期、再接続・再追加 | 所属照合で回復。永続重複抑止と停止履歴保持 |
| W15 | 許可宛先なし・送信不能・送信結果不明 | Webへ継続。勝手なDM/他channel・不明再送0 |
| W16 | 古いバックアップ復元・通知記録欠落 | 初回扱い・通知再送・旧実行再生0 |
| W17 | 本人結果URL共有、他人のID、ログアウト | 本人以外の結果閲覧0。管理画面へ昇格しない |
| W18 | 4例の承認失効・一部成功・解決済み・期限切れ | 各例の否定/不明経路どおり。本番試運転変更0 |
| W19 | 古いinteraction token・別人の選択 | 期限外送信0、公開投稿/DM代替0 |
| W20 | 未取得件数、権限外検索、JA/EN・狭画面 | 0件誤表示・情報漏えい0、キーボード等で完結 |
| W21 | 実HTTPS、Windows再起動、DB/Redis/Tunnel復帰 | 深いURL・OAuth復帰・保存整合・旧新worker分離を確認 |
| W22 | 10サーバー・複数タブの状態照会 | 有界な更新、rate limit対応、測定した応答時間を記録 |
| W23 | 公開URL・検索からoperatorへアクセス | ホスト・秘密・バックアップ・審査情報の露出0 |

実装前に型移行・認可・origin・通知先・DB移行・旧新混在防止・復元を確定し、実Discord/HTTPSで検証する。

未承認：外部A/B、新目的の保存範囲・期間、結果不明を照合不能なら即時・可能でも最大24時間で自動終了するQ-RET-03。再送禁止は維持し、自動終了時刻は未決。個別待機7日以内の了承は保持期間・実行全体期限を含まない。ブロック自由度・プランは別添のブロック拡張設計とプラン案を参照。

## 参照の範囲

公開仕様は監査の一次資料。非公開型は固定SHAのsettings/index.ts、setup-wizard.ts、channel-scope.ts、policy.ts、security/index.tsの読取り照合に基づく。

