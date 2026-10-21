# NEXUS alpha16 移行と実装計画

更新日：2026年10月16日。対象読者：alpha16の実装担当者と受入担当者。版：V-A、V-B、VIと末尾の統合訂正を反映した設計統合版。

**現在は計画だけである。NEXUSのコード実装、migration適用、設定変更、試験、利用者PCの操作は行っていない。大型アップデートの実装開始には、利用者の別途承認が必要である。**

本書は、alpha15の未確認残件を取りこぼさず、alpha16の構造・機能を組み立て、全実装完了後の一括受入と修正を経て、alpha17の実運用PC設定・適合調整へ引き渡すための作業順を示す。保存済み設計資料と過去の読取監査を根拠にした計画であり、現リポジトリ、現DB、現在の配備状態を確認した結果ではない。文書の統合完了と、コード照合・policy承認・実装・受入・配備の完了を区別する。

## 1 判断区分と実装開始のゲート

### 1.1 区分

|区分|本書での意味|
|---|---|
|確定|利用者決定、または後続補正を含め維持すべき安全・責務境界。A配置の承認と実装開始承認は別|
|候補|数値、運用方針、未統合の設計案。担当者が稼働値や承認済み仕様へ昇格させない|
|コード照合待ち|保存済み監査の対応箇所はあるが、現在の実route、table、型、permission、adapter、画面との対応が未確認|
|過去報告|以前の進捗として引き継ぐ情報。現在の完了・稼働・commit状態を証明しない|

以降のN16-*、N17-*は、この計画の作業IDであり、既存コードの識別子ではない。付録のC-A16-*、M-A16-*、D16-*、RT-*等も設計上の契約・作業IDとして扱う。URL、logical table、feature flagの例を実在する設定や実装と混同しない。

### 1.2 維持する確定事項

- 公式Webはお名前.comの静的配信物。DashboardとBFFを含む全Next.js、API、分析、Rule、Worker、Scheduler、DB等の業務処理はPC側。
- Browser → app hostname → Tunnel → same-origin Next BFFを基本経路とする。BrowserからPC内部API・DBへ直接接続させない。
- PC内Nextのserver-side DB処理は維持できる。初期監査の「全Next DB処理をAPI橋渡しへ移す」はA配置では失効しており、全面rewriteの理由にしない。
- guild、現在権限、対象scope、版、削除状態をserver側で確認する。Tunnelは認証の代替ではない。
- Operatorは別loopback listenerで非公開。Tunnel、公開BFF、公開Webへのproxyを設けない。
- Discord Gateway/RESTはPCから直接outbound。Tunnel断だけをDiscord外部作用の結果不明の原因にしない。
- RESULT_UNKNOWNの同一外部作用は自動再送しない。照合はread-only。照合不能ならUNKNOWNを維持する。人の新規操作でも元UNKNOWNを消さない。
- Run終端後の最小状態は7日以内に削除し、backup保持は7日。別tableへの複製による延命は禁止。他分類を一律7日にしない。
- Ruleは非学習・決定論。raw投稿、DM、不要な個人ID、個人score、心理・属性・人間関係の推測を新規入力にしない。
- Suggestionは人が確認する提案。自動適用、activation、投稿、課金、権限変更を行わない。
- alpha16で構造・機能を確定して実装する。全実装完了後に全体試験、問題の集約、修正、全体再確認を行う。実運用PCの設定・調整と実環境試験はalpha17。
- 13基礎Ruleと20事例は初期catalog。あらゆるDiscord運営状況の完全網羅とはしない。

根拠：[索引](NEXUS_alpha16_design_index.md)、[基本仕様](alpha16-normal-chat-A-approved-final-specification.txt)、[I-A追補](alpha16-normal-chat-annex-IA-supplement.txt)、[III-B](alpha16-normal-chat-annex-IIIB-operator-minimal-ui.txt)。旧基本仕様§51のDeployment Foundationを、実環境設定までalpha16で行う指示としては採用しない。

### 1.3 ゲート一覧

|ゲート|通過条件|未通過時の扱い|
|---|---|---|
|G0 設計の統合|V-A/V-B/VIと本書§12の訂正を一つの契約として扱う。本書で文書統合済み|G1以降の完了を意味しない。コード照合・未承認policyを推測で埋めない|
|G1 実装開始承認|この計画の対象、未決、alpha16/17境界を示したうえで、利用者が大型更新の実装開始を明示承認|コード、migration、設定、試験へ着手しない|
|G2 現コード対応表|現baseline、alpha15残件、実route/table/type/permission/source/target/action/writer/readerと契約の対応を記録するCODE_SCHEMA照合|該当機能の有効化不可。ENVIRONMENT照合やG6通過とは別。新設と流用を推測しない|
|G3 永続化と評価と外部作用の有効化|保持class（TARGET_LIVE_SAFETYを含む）、対象・閲覧範囲、承認config、認可済みsource、安全状態の保存契約が揃う|未承認classの永続Fact/Suggestion生成、未承認Rule、保持・安全状態が未成立の外部作用を有効化しない|
|G4 機能組立と契約固定|全機能の実装差分、互換処理、UI、受入仕様、無効化理由が揃いcanonical contractをfreeze|一部機能を全実装完了と呼ばない。G4後に型/状態/lock/保持/action意味が変わればN16-14へ戻る|
|G5 alpha16一括受入|全実装完了後の全体試験と集約修正・全体再確認が完了。未実行をpassにしない|alpha17へ不具合を黙って転送せず、残件・影響・解除条件を明記|
|G6 alpha17実運用移行|実PC、DNS、Tunnel、OAuth、外部接続、backup、静的公開等を設定し実環境で確認|構造完成を本番稼働可能とは表示しない|

G2は将来のコード照合作業の条件である。本書作成中にコード照合を実施したという意味ではない。機能を安全に無効のまま組み立てることはできるが、必要な保持・設定が未決なら「全機能が使用可能」「受入完了」とはしない。

## 2 alpha15を入口にした残件台帳

|入口情報|今回の扱い|alpha16への作業|完了証拠|
|---|---|---|---|
|alpha15の実装報告あり|過去報告。現コードを再確認していない|N16-00で報告対象commit、現在branch、差分、関連文書を照合|報告と現baselineの差分一覧|
|日時対応は完了報告あり|現在の回帰結果ではない|IANA timezone、UTC半開区間、経過時間と暦日、DST、Scheduler/Waitとの接続を契約照合|日時変更の所在と後日受入への対応|
|最後の変更は未commitとの報告|現状未確認。勝手にcommit済みとしない|利用者変更と既存未commit差分を識別し、上書きしない変更方針を決める|baselineと作業差分の保存・説明|
|Scratch受入192項目中188済、3部分、1未実行|古い受入報告。現コードの188件合格を再保証しない|192項目の正本を回収し、部分3件・未実行1件のIDと不足を確定。alpha16で影響を受ける既済項目も回帰対象化|全192項目の旧結果、新規影響、alpha16受入IDの対応|
|実Discord確認なし|実環境の未確認を維持|模擬/契約受入と実Discord受入を分離し、後者はalpha17へ明示移管|Gateway/interaction/REST/権限/送信結果の実環境checklist|
|既存固定閾値診断あり|alpha16 Rule Engine完成を意味しない|既存diagnosesと新Fact/Rule/Suggestionの責務を分け、重複提案・二重正本を防ぐ|流用handler、廃止対象、互換adapterの対応表|

未回収のalpha15受入IDや未commit内容は、本書で創作しない。alpha15残件を独立した追加開発へ広げず、alpha16の関連taskへ吸収し、旧IDを追跡可能にする。既存ブロックや外部HTTP機能の未対応部分を、既存Operations Webhookがあることだけで実装済みとしない。

## 3 実装順と依存関係

### 3.1 全体順序

1. N16-00〜02で現baselineと契約差分を固定する。
2. N16-03でWeb/Auth/Operatorの境界を先に固定し、N16-04でexpand-firstの永続化互換層を作る。
3. N16-05〜06でRuntimeと削除・保持の安全境界を組み合わせる。
4. N16-07で既存全機能のA配置対応を揃える。独立domainは並行できる。
5. N16-08〜11でFact → Rule → 事例分岐 → Suggestion → Draft/Applyを組み立てる。
6. N16-12〜13で静的公開と最小Operator UIを接続する。
7. N16-14で互換・移行・無効化・rollbackを統合し、G4を確認する。
8. N16-15で初めて全体試験を行い、問題を集約して修正し全体を再確認する。
9. N16-16の引継ぎ資料を基に、alpha17で実PC設定と実環境適合を行う。

Operator非公開、tombstone優先、送信admission、保持とUNKNOWNの扱いは後付けにしない。UIを先行する場合も、未成立の権限・版・sourceを成功値にする仮実装を設けない。

### 3.2 実装作業表

以下は承認後に実施する計画であり、実行済みの作業一覧ではない。「完了条件」は実装成果物の条件で、合格判定はN16-15以降に行う。

|作業ID|作業と成果物|依存|実装完了条件|後日受入と出典|
|---|---|---|---|---|
|N16-00|alpha15報告・192項目・現baseline・未commit差分を照合し移行台帳を作る|G1と許可された作業環境|旧報告と現在事実を分け、利用者変更を保護。3部分・1未実行の内容を特定|alpha15受入の再対応、[監査](alpha16-readonly-code-audit.txt)|
|N16-01|全機能の画面→route→domain→正本→permission→受入対応を実コードで埋める|N16-00|本書§4の全行を流用/差分追加/新設/blockedに分類。route名・実table・ID型を記録|I-A、I-A追補、I-B、監査|
|N16-02|型registry、評価結果、error、idempotency、保持、lock順と旧新mappingを一本化する|G0、N16-01|旧仕様の有効/失効を明示。未解決はissueと無効化gateに紐付く|I-C群、II-0、IV-0、契約レビュー|
|N16-03|A配置のWeb/Auth/BFF/内部API/Operator境界を実装する|N16-02|host-only cookie、CSRF、guild/permission再検査、署名、callback別認証、default-deny allowlistを構造化。Operator公開経路なし|AUTH-*、PUB-01/07、OP境界、I-B/I-D/III-B|
|N16-04|既存schemaへexpand-firstで論理差分を対応させる。compatibility adapterとmigration仕様を用意|N16-02/03|複合scope、immutable版、CAS、unique、削除依存、expiryとnullable FKの整合。物理table重複を作らない|A16-DB-01〜05、RET-*、I-C2〜4|
|N16-05|Runtime/Schedulerへintent、attempt、lease/fence、outbox、send admission、UNKNOWNを統合|N16-04|PG正本、単一lock順、target-side safety、queue再構成、旧Worker拒否、Run revision固定、無断backfill禁止|ACC-RT-01〜08、AUTO-01〜05、I-C3、VI|
|N16-06|保持・削除・receipt・restore遮断を各domainへ通す|N16-04/05|tombstone優先、Run終端後7日以内削除、backup7日。target safetyとRun lifecycleを分離。未承認保持classに依存する生成/外部作用は無効|RET-01〜09、A16-DEL-01〜08、I-C4/III-A/B、VI|
|N16-07|Analytics/Explore/Operations/Lifecycle/Plan/Billing等、既存全機能をA配置と新安全境界へ接続|N16-03/04、外部作用はN16-05/06|§4の操作集合と既存domain invariantを維持。必要なDetailed HTTP接続だけ追加し、不要な全API橋渡しはしない|I-A各機能、ADD-01〜10、PUB-02〜05|
|N16-08|認可済みsource adapter、metric registry、Fact snapshot、source-health、評価入力固定を実装|N16-02/04/06、関連N16-07|初回受付enqueue transactionでasOf/入力版/hashを封印。型/単位/window/cohort/品質を固定。欠測の本文補完なし、長期aggregate実在を確認|FACT-01、DB-01/02、RET-04、II-0、IV-0、VI|
|N16-09|13基礎Ruleとversioned config、bounded evaluator、依存DAGを実装|N16-08|enqueueで封印した同一入力・版・asOfで決定論。未承認configはDISABLED。不完了の部分結果を通常publishしない|RULE-01/02、13個票のfixture、II-0〜II-E、VI|
|N16-10|20事例のContextGate、三値分岐、Action/Explanation/provenance registryを実装|N16-08/09の共通engine、必要なRuleResult、G0の訂正確定|各caseの登録RootTrigger、branch順・unknownNext・完全fixtureを一本化。全caseにRule FIREを強制しない。初期actionはREVIEW_ONLY|IV-0〜IV-E、契約レビュー、最終整合補遺|
|N16-11|Suggestion一覧・詳細・履歴・個人状態・共有Reject・Draft/Applyを実装|N16-05/06/08〜10、target editorはN16-07|全target、lineage、版/hash/safetyEpoch、現在権限、Run削除後も迂回できないguard。typed editor成立時だけCREATE_DRAFT|SUG-01〜04/HIST-01、DB-03/04、RET-03/05、I-B/I-C/I-D、VI|
|N16-12|公開static build分離、Announcement publication、Status snapshot、Legal/Contactの状態を実装|N16-03/04/06|公開field allowlist、世代/hash/manifest、withdraw保護、expired status=UNKNOWN。実publish adapter未確認ならpublish無効|ANN/LEGAL/CONTACT/STATUS、PUB-06、I-D|
|N16-13|最小Operator UIを既存正本へ接続|N16-03/05/06/07/12|privacy、health、admission、停止再開、お知らせ、backup readiness、audit/config healthを実装。step-up未成立なら危険操作無効|OP UI、A16-DEL-01〜08、III-A/B|
|N16-14|互換・移行・feature gate・rollback・受入仕様とcanonical contractを統合固定|N16-00〜13|旧新writer、全機能mapping、単一lock順、UNKNOWN/Run削除後の安全状態、blockedを固定。G4未充足を隠さない|INT-01、ACC-ALL、I-D、VI|
|N16-15|alpha16後段で全実装完了後、一括検証→全領域の問題集約→修正→全体再確認|G4|版/結果/証拠付き台帳。未実行をpassにしない。契約変更が必要ならN16-14へ戻して影響範囲を再確定|本書§8。実環境専用だけalpha17|
|N16-16|alpha17へ配備契約と受入結果を引き渡す|N16-15|本書§9の全項目、未決の解除条件、公開・外部作用開始条件を担当者が追える|G5、N17-01〜07|

N16-07のdomainごとの作業とN16-12の静的artifact生成部分は、共通境界とschemaが固定した後に並行できる。Rule/事例を先に文章として揃えても、N16-08の入力契約がない状態で正常評価とはしない。

### 3.3 旧移行taskとの対応

I-DのD16-*を別の並行計画として実施せず、次へ対応させる。

|I-D原task|本計画への対応|
|---|---|
|D16-01 Auth/Web boundary|N16-01〜03|
|D16-02 Analytics/Fact|N16-07/08|
|D16-03 Explore、D16-04 Operations|N16-07|
|D16-05 Runtime/Scheduler|N16-04〜06|
|D16-06 Plan/Beta/Billing|N16-03/07|
|D16-07 Rule/Suggestion|N16-08〜11|
|D16-08 Announcement|N16-12|
|D16-09 Privacy|N16-06/13|
|D16-10 Operator|境界はN16-03、画面はN16-13|
|D16-11 Compatibility|N16-14|
|D16-12 受入準備|仕様準備はN16-14、試験実行は全実装完了後のN16-15|

I-AのM-A16-*と追補T-A16-ADD-*は§4.2の機能行に紐付ける。I-C3のRT-01〜08はN16-05、I-C2のT1〜T5はN16-04/06/08/11の該当transactionへ紐付ける。原IDを消さず、新taskとの対応を受入台帳へ残す。

## 4 既存code pathと全機能の対応

### 4.1 保存済み監査にあるコードの入口

次のpathは[読取監査](alpha16-readonly-code-audit.txt)が示した `D:/Project Nexus/` 以下の相対pathである。**このworkspace内にコードがある、現在も同じ行にある、実機で稼働している、という意味ではない。** 実装担当はN16-01で現在の所在と呼出関係を確認する。

|過去監査の入口|対応契約・機能|alpha16で行う照合|
|---|---|---|
|apps/web/app/layout.tsx|公開WebとDashboardの分離|cookies/headers依存を公式static側へ持ち込まず、全Next DashboardはPCへ残す|
|apps/web/app/auth/public-session-store.ts、auth/server-access.ts、auth/session.ts、auth/origin.ts|AUTH、session、guild、Origin、URL設定|実route、session lifecycle、Host/CSRF、現在権限、署名済みcallerに対応|
|packages/operations/src/web-setup.ts|招待、Bot導入、初期設定|web_setup_*等の既存正本とOAuth/guild境界。`/nexus link`を必須化しない|
|apps/api/src/v03.ts|Home/Community/Journey、Basic Analytics、実験結果、Action API|既存v3のDTO/permissionと新Fact/target契約の対応|
|packages/analysis/src/index.ts|Detailed Analysisの生成・保存・結果取得|保存正本を複製せず、必要なWeb向けHTTP入口を追加|
|apps/web/app/explore/data/route.ts|Explore、graph、view、segment、CSV/PNG|A配置のPC内server-side DB処理を保持しscope/版/出力権限を確認|
|apps/web/app/operations/data/route.ts|attention/intake/events/playbook/experiments/reports/orgteams/webhookcredentials等|各CRUDと実行・承認・宛先・資格情報のdomain service対応|
|packages/onboarding/src/index.ts|Onboarding flow/session/events|Lifecycle/First Responseとの責務重複防止、revision固定|
|apps/worker/src/reports.ts|定期レポート、週次、Helper、delivery|生成・送信・履歴、外部作用の安全契約、再送/UNKNOWN|
|apps/web/app/api/automation/[...path]/route.ts|ブロックeditor、模擬/本実行のBFF|same-origin、署名、draft/revision/Run/previewの分離|
|apps/worker/src/alpha15-automation.ts、packages/automation/src/admission.ts|Scheduler、Wait、内部イベント、利用制限|永続状態、予約、plan、cancel、再開、日時対応、Run制限|
|apps/interaction/src/server.ts|Discordパネル、command、button、interaction受付|Gateway方式と署名HTTP方式を実構成で区別。token/receipt/log最小化|
|packages/analytics/src/diagnoses.ts|既存固定閾値診断|新Ruleへの吸収・互換mapping。既存診断をalpha16完成としない|
|packages/security/src/hosted-beta.ts|Beta、招待、admission、entitlement|表示Planとserver gateの整合、Rule機能利用権との対応|
|apps/web/app/billing/catalog.ts、billing/webhooks/stripe/route.ts|価格catalog、Stripe Checkout/Webhook等|PC Nextを維持し、公開static価格表示と動的正本、callback認証を分離|
|packages/settings/src/billing/providers/discord.ts|Discord native課金|存在するproviderと有効設定・提供条件を区別。新規販売開始を含めない|
|apps/web/app/publication-data.ts|公式お知らせ|PC正本→公開artifactへの置換と撤回追従|
|apps/web/app/legal/status-view.tsx、support/contact-form.tsx|Legal、運営者情報、Contact|過去監査の未公開/無効状態を現コードで確認。承認文面・受付運用がないものは完成扱いしない|
|packages/security/src/privacy.ts|保持、削除、tombstone、復元時削除反映|全保存先、session、cache、queue、derived data、backupへの削除mapping|
|apps/operator/src/server.ts|別loopback Operator|bind、認証、step-up、権限、proxy非公開、最小UIとの接続|

### 4.2 全機能の移行と完了条件

各行の「契約」は機能IDを表す。I-Aの行は対応するC-A16-* API契約、M-A16-*移行、A16-*受入へ接続する。ADD行はI-A追補のT-A16-ADD-*、A16-ADD-*に接続する。専用route/tableの存在が未確認の機能は、必要なdomain差分を確定してから追加する。

|機能と契約|主task|保持する操作と完了条件|
|---|---|---|
|公式トップ・製品紹介・デモ・言語表示|03/12|静的公開物として生成。Dashboardのsession/DB依存を持ち込まない。公開価格/文面の版を表示|
|AUTH-01/02/03|03|login/logout/expiry、guild一覧/切替、現在権限。別guild拒否と認可情報不明時fail-closed|
|招待・Bot導入・初期設定|03/07|既存導入経路を維持。招待、接続、設定の状態とpermissionを揃える|
|Home/Community/Journey、ANL-01/02|07/08|Basic閲覧、期間変更、Detailed生成・保存・履歴・結果取得。空、欠測、stale、重複生成を区別|
|EXP-01/02 Explore|07|graph一覧/閲覧、view/segment作成・変更・削除・適用、保存graph、CSV/PNG。server-side scope/版/出力権限を維持|
|既存診断・改善機会・非表示理由|07/09/11|現diagnosesと新Rule/Suggestionの対応。非表示理由の説明、同一問題の二重生成防止|
|OPS-01 attention|07|一覧、詳細、状態変更。guild境界、version、対象状態を再検証|
|OPS-02 intake|07|受付、一覧、詳細、状態変更、削除。構造化response/outcomeを混同しない|
|OPS-03 events|07|作成、変更、削除、閲覧。参加関連Factは認可済み既存sourceだけを利用|
|OPS-04 playbook、既存Action・承認|05/07/11|一覧、draft、revision、編集、削除、実行設定、承認・実行。AI提案から直接実行しない|
|OPS-05 experiments、intervention、measurement|07/08|作成、変更、終了、結果閲覧、改善追跡。観測値から効果や因果を断定しない|
|OPS-06 reports、週次・Helper|05/07/08|一覧、生成、定期管理、閲覧、削除、delivery状態。保存と外部送信を分離|
|OPS-07 org/teams、権限・宛先|07|一覧、作成、変更、削除。org/guild境界と参照整合性、明示操作を維持|
|OPS-08 API資格情報・既存Webhook|03/07|作成、rotation、失効、一覧、状態。secret露出防止。ブロック外部HTTP機能と混同しない|
|AUTO-01/02 editor/draft/revision|05/07|一覧、作成、編集、削除、比較、選択、immutable revision。既存block catalogと日時対応を保持|
|AUTO-03/04 Run/Wait|05|開始、状態、cancel、期限付きWait/resume、有限繰返し・固定乱数等の既存意味論。旧Workerと二重resumeを拒否|
|AUTO-05 Scheduler/内部イベント|05|予定の作成/変更/停止/再開、due、planned fireとmaterialized Runの区別。無断backfillなし|
|Discord panel/command/button/interaction|03/05/07|既存入口と応答処理。署名HTTP callbackとGatewayを別扱い。outboundはTunnelを通さない|
|PLAN-01/BETA-01|07/13|現在Plan、回数/並行実行/保存量、申請、招待、承認/拒否、利用枠。entitlementはserver正本|
|BILL-01/02/03、契約変更・支払管理・promotion|03/07|catalog、Checkout、契約/支払導線、Webhook。署名・重複event・状態照会。新規課金開始は別承認|
|Discord native billing|07|既存providerの統合と状態表示。実資格・有効化状態はalpha17で確認|
|FACT-01/RULE-01/02|08/09|snapshot、freshness、config版、評価enqueue/status/cancel。入力と版を固定し、未承認をDISABLED|
|SUG-01/02/03/04、HIST-01|10/11|一覧/詳細、view/dismiss/save、shared reject、draft、明示Apply、結果履歴、失効・抑止。全target対応|
|ANN-01|12/13|draft作成/編集、publish/update/withdraw、公開閲覧。正本/公開世代/hash/sync状態を追跡|
|LEGAL-01、運営者情報、CONTACT-01|12|承認済み文書だけ公開。未完成文書と無効Contactを明示。受信先・保持・運用の未決を隠さない|
|STATUS-01|12/13|static snapshotとDashboard状態。generatedAt/validUntil、PC/Tunnel/Worker/outbound/応答喪失を分離|
|PRIV-01/02/03|06/13|削除要求・限定status、保持purge、backup7日・restore遮断。一般利用者scopeは既存権限より拡張しない|
|OP-01/02|03/13|loopback境界、local session、運営操作。公開Operationsとは別の管理層|
|ADD-01 Control Panel/Settings|07|許可fieldだけ閲覧/変更/保存。設定保存を外部操作承認に代用しない|
|ADD-02 Lifecycle/Onboarding/First Response/Retention|05/07/08|実行は既存Runtime、受付はOperations、傾向はAnalytics/Factに委譲。独自の第二Runtimeを作らない|
|ADD-03 Templates|07/11|一覧/閲覧/作成/編集/複製/削除、templateから新draft/revision。liveを直接変更しない|
|ADD-04 Preference Center|07/11|本人の許可設定の閲覧/変更/初期化。個人設定、per-user Suggestion状態、guild設定を分離|
|ADD-05 Managed Role Grants|05/07|policy/versionと適用履歴、明示grant/revokeを既存operation安全契約へ接続。AI直接実行なし|
|ADD-06/07/08 Readiness/Data Health/Permission Health|07/08/13|認可済み観測の集約。source鮮度・coverage・neverSucceeded、必要/観測権限、UNKNOWNを区別|
|ADD-09 Test/Preview|07/11|製品機能としての副作用なしpreview。revision/input固定、live/通常Runと分離。今ここで試験を実行する意味ではない|
|ADD-10 Flow Rollback|05/07|履歴から新revisionを作りlive pointerをCAS更新。既存Runのrevisionと過去結果は不変|

共通UIはloading、success、empty、stale、conflict、unavailable、unknownを区別する。最終観測時刻を表示し、部分取得や古い値を現在値・正常値に見せない。操作ボタンの表示を認可に代用しない。PC停止ではDashboard自体が表示できないA配置の制約を、独立したoffline Dashboardがあるかのように隠さない。

## 5 APIとDBの実装契約

### 5.1 API対応の固定点

すべてのpathはI-B/I-D/III-Bが示す**提案path**であり、既存routeの実在主張ではない。実routeとのmapping、互換routeを残す期間、責務分担はN16-01/02で確定する。

一般利用者Webからの新たなself-service削除範囲は未確定であり、本計画だけで追加を約束しない。既存privacy権限・契約を保持し、今回の追加要望はlocal Operatorの削除UIとして扱う。NEXUS保存データの削除と、第三者のDiscordメッセージ削除は別操作である。

|契約|提案入口|実装で外せない条件|
|---|---|---|
|C-A16-SUG-01/02|`/api/v1/guilds/{guildId}/suggestions`、detail、view/dismiss/save/reject|一覧cursorのscope/filter/sort束縛、現在認可、shared/per-user分離、削除済みresponse非再露出|
|C-A16-SUG-03|同suggestion配下の`/draft`|Suggestion版、liveTargetVersion、変更可能field、現在権限を確認。新immutable draft/link/historyをatomic作成|
|C-A16-SUG-04|同suggestion配下の`/apply`、`/operations/{operationId}`|Suggestion版・live版・draftId・immutableDraftRevisionId・draftContentHashを分離して固定。予約/intentを同transactionへ|
|C-A16-RULE-01|`/rules/config`、`/rules/config/revisions`、`/rules/config/history`|immutable版、承認済みconfigのみACTIVE。旧結果を新閾値で書き換えない|
|C-A16-RULE-02|`/rule-evaluations`、detail、cancel|初回enqueueでasOf/input集合/版/hashを固定。queue重複から新評価を作らない|
|C-A16-FACT-01|`/fact-snapshots/{snapshotId}`、status|非公開scope、source/品質/期限、削除・欠測、snapshotの不変性|
|C-A16-AUTO-03/04|`/runs/{runId}`、cancel、read-only reconcile|cancel受付と外部取消成功を分離。reconcileから副作用を送信しない|
|C-A16-ANN-01|非公開`/__internal/v1/publications/announcements/...`|local Operator権限とpublication世代を接続。公開Browser routeにしない|
|C-A16-STATUS-01|static `status.json`、BFF status|公開allowlist、生成時刻/期限。polling正本、SSEは補助|
|C-A16-PRIV-01|`/api/v1/privacy/deletion-requests`とstatus|既存scopeを勝手に拡大しない。tombstone/session失効/job/receiptをatomic確定|
|Operator privacy|`/operator/v1/privacy/deletions/preview`、confirm、receipt status|Discord ID完全一致、専用GUILD/GLOBAL権限、server step-up、scope/plan/hash/expiry再検証|
|既存AUTH/ANL/EXP/OPS/AUTO/PLAN/BETA/BILL等|実route照合待ち|domainを保ったまま共通error/permission/version/CSRFへ接続。単に全routeを新namespaceへ複製しない|

共通条件：

- 認証・CSRF/OAuth state、guild所属、permission、対象scope、tombstone、版、状態、domain invariantをserver側で確認する。認可情報が確認できない場合は許可しない。
- 428はprecondition欠落、412は版不一致、409はdomain状態競合。別guildの存在は安定したNot Found応答で隠す。詳細error名の旧新衝突はN16-02で一本化する。
- 内部署名はmethod/path/query/body hash/timestamp/nonce/caller/actor/guild等を結び付ける。鍵や内部URLをBrowserへ返さない。provider callbackはsession/CSRFで代替しない。
- timeoutは未処理の証明ではない。status照会を優先し、未知の外部作用へblind retryしない。
- 同一intentのreplayでも現在scope、権限、tombstoneを再検査し、古いresponse本文を無条件返却しない。intent削除後のtokenを新規操作へ昇格させない。
- Idempotency-Keyは通信要求とfingerprintの同一性照合だけ。server operation tokenはtarget/live版、action、Suggestion/Draft版/hash、approval、safetyEpoch、期限へ束縛するadmission資格。deletion receiptは削除status照会だけ。この3者を相互の認可・UNKNOWN解除・新intent生成に使わない。
- 署名付き/opaque等のwire・保存実装は操作classと既存機構へG2で対応させ、上記責務を変えない。期限切れ・消失は新規操作にならない。無期限墓標を作ってRun保持を延ばさない。

### 5.2 DBの移行単位

以下は提案logical entity。既存正本で満たせるものは差分追加とし、同じデータを別の新tableへ複製しない。

|論理領域|対象|移行・完了条件|
|---|---|---|
|Fact/source|fact_snapshot、fact_value、source_health|SEALED後不変。metric/dimension/period_role/window/source revisionを一意化。health観測ID＋版集合を固定。qualityと値型を共通registryへ|
|Rule/evaluation|rule_version、rule_config_version、evaluation_job/result|承認状態、版、asOf、入力hash、依存順、結果とreasonを別管理。旧enumを暗黙変換しない|
|Suggestion|suggestion/evidence/user_state/history/draft_link|shared 5状態、個人状態、evidence不変、live版とdraft版を分離。V-Bのscope別uniqueを適用。evaluation purgeに合わせnullable FK切離し・最小履歴化|
|Apply|apply_reservation、operation_intent/attempt/external_result|同一guild+Suggestion+immutableDraftRevisionの一意性に加え、同target/action lineageの未解決guardを保持。別draft迂回を防ぐ|
|Target安全状態|target-side safety state（実entity名はG2照合）|targetType/targetId/liveVersion/safetyEpoch/applyGateの最小制御状態。Run payload/ID/result/evidenceを複写しない。欠落/期限切れはApply不可。保持class TARGET_LIVE_SAFETYは承認待ち|
|Runtime|worker_lease、outbox、idempotency、既存Run/Step/Wait/Schedule|PG正本、CAS/fence、outbox同時commit、immutable revision。Run由来の全子状態は親の保持契約に従う|
|Privacy|tombstone、deletion_job、deletion_receipt、lineage_suppression|既存privacy正本へ接続。削除progressとbackup状態を分離。SHARED_REJECTはuserなし、PER_USER_DISMISSはuserあり|
|Publication|announcement、publication_manifest、status_snapshot|公開allowlist、source版、artifact hash、世代、active pointer、撤回世代。公開能力未確認ならpublisherを有効化しない|

固定するtransaction単位：

1. Snapshot確定：typed入力検証、集合/hash、SEALED化を一括commit。
2. Evaluation確定：入力と版の再検査、result、dedupe、Suggestion/evidence/historyを一括commit。
3. Draft作成：現在認可、Suggestion/live版、field allowlist、immutable draft/link/historyを一括commit。live版は変更しない。
4. Apply予約：現在認可と各版/hash、unique reservation、operation intentを一括commit。actorやIdempotency-Keyを変えても二重予約できない。
5. 外部送信admission：現在fence、削除、権限、対象版・状態を再検証しadmissionをcommitしてから送信。commit後に結果不明ならUNKNOWN。
6. 削除受付：対象/scope確認、tombstone、session失効、job、receiptを一括commit。その後の物理purgeに失敗しても遮断を維持。
7. 期限purge：guardのnon-actionable化、evidence/Suggestionの参照切離し、evaluation/Fact削除を整合させる。INVALIDATED表示だけで期限切れ正本を残さない。

横断transactionはVIと本書§5.4の単一lock順へ統一し、旧I-C2/3/4の局所順を別の正本にしない。実DBの型・既存制約へのmappingはG2で行う。Discord IDをUUIDへ変換すると仮定しない。

V-BのSuggestion単位uniqueと、版を跨ぐlineage_suppressionは別の識別責務である。SHARED_REJECTはguild必須/user NULL、PER_USER_DISMISSはguild/user必須とする。Suggestion単位の状態は対応するsuggestion IDで一意化し、lineage抑止をsuggestion IDや版だけのキーへ置き換えない。

### 5.3 Runtimeと保持の切替条件

- lease/fenceは旧WorkerのDB更新とadmissionを拒否する仕組み。Discord側がfenceを検証するとは仮定せず、exactly-onceを保証しない。
- admission前の無効果を確実に証明できる失敗と、admission後の応答喪失を分ける。UNKNOWNをFAILEDへ偽装しない。期限到達時もUNKNOWNのままterminal化する。
- UNKNOWNのterminal期限、lease/heartbeat/request deadlineは未承認・未検証の設定候補。期限未決または安全状態を保存できない外部作用は有効化しない。障害を理由にUNKNOWN終端を無期限延期し、Run削除の起算を遅らせる運用は禁止する。
- CONSUMEDは承認済みApplyの成功確定時だけ。DB-onlyならdomain transactionの成功、外部作用なら確認済み成功。draft作成、予約、受付、UNKNOWNはCONSUMEDではない。
- Run由来intent/result/idempotency/evidence等を別保持classへ逃がさない。Run以外のFact、source-health、evaluation、Suggestion/history、audit、suppression、receipt、公開履歴、TARGET_LIVE_SAFETYは目的別保持の承認待ち。
- 48時間、14日、各minN、freshness、cooldown、budget、TTL等の例は候補であり、稼働値にしない。旧30日/24か月保持案は復活させない。
- PC停止中に物理purgeが行われたとは表示しない。再起動時は最新tombstoneと期限purgeを通常公開・評価・送信より先に実行する設計にする。
- 再起動時purgeだけでは停止中の期限強制を証明できない。alpha17へ、live領域とbackupを分けた独立したretention enforcement、backup側の7日失効、期限切れbackupのrestore拒否を実現・確認する要件を渡す。A配置を保って成立する手段と保証範囲を照合し、必要な期限保証が成立しなければG6未通過とする。新規外部サービスの採用を本計画だけで確定しない。

### 5.4 PostgreSQLの単一lock順

PostgreSQLをtransaction/lockの唯一の正本とし、scopeの排他は**transaction-level advisory lock（pg_advisory_xact_lock）**、実在rowの排他はrow-level lock、最終競合防止はunique constraintとCASを使用する。これは本計画で採用する統合方式であり、現コードに実装済みという意味ではない。Redisを安全状態・lock・Apply権限の正本にしない。

transaction-level advisory lockはtransaction終了時に解放されるが、アプリケーション側の協調を前提とする。BFF、domain service、worker、Scheduler、purge、restore、管理command等、同じ保護対象へ書く全経路に同一scope同期を要求する。未参加writerをadvisory lockだけで防げるとは保証せず、G2のwriter台帳で欠落を確認し、未適合経路が残れば該当有効化を止める。実配備PostgreSQLの版・対応機能はG2/alpha17で照合する。方式の根拠：[PostgreSQLのadvisory lock説明](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)、[advisory lock関数](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)。

scopeLockKeyは登録scopeから決定論的にPG advisory lock IDへ写像する。transaction開始前に必要scope集合を確定し、実際のlock IDを重複除外して一意の順で取得する。同じscopeは必ず同じIDとなり、hash衝突が起きても追加の直列化にしかならず、scope認可・resource同一性・unique判定には使わない。GLOBAL/GUILD削除とApply等が競合する対象は共通のscope lockを含める。実scope型と写像はG2で固定する。

取得順は次の一つにする。同rank内もcanonical key順。新たなscope/resourceが必要なら、その場で逆順取得せずtransactionを中断しlock setを組み直す。

scope locks → tombstone → deletion job → target safety/live resource → Run → Step → Intent → Attempt → Lease → operation guard → Suggestion → Draft/Link → Evidence/History → Evaluation → Fact

- 非存在tombstoneは「削除されていない」という照合対象であり、lock取得のためACTIVE tombstoneを仮作成しない。上位scope lockが不存在確認と削除作成の競合を直列化する。ACTIVE作成は認可された削除受付transactionだけ。
- guard等の必要な新規rowは、上位scope/target lockの下でcanonical unique keyによるcreate-if-absentとrow lockを使う。check-then-insertだけに頼らない。安全状態がないからといってOPEN rowを自動作成しない。
- sealed evaluationも、その後のtombstone成立で公開・適用不可。admission直前にtombstone、target/live版、safetyEpoch、Suggestion/Draft版/hash、現在permission/approval/guardを同transactionで再検査する。
- DB transaction中にDiscord/Stripe等の外部通信を行わない。Outboxは独立したlock rankを作らずdomain状態と同transactionでcommitする。admission commit後に外部通信する。
- DB transaction retryは外部作用retryではない。admission後の応答喪失はUNKNOWN。削除やcancelは、先にcommit済みのadmissionを遡及取消ししたと扱わない。

### 5.5 UNKNOWNとRun削除後の安全状態

Run/operationの未解決guardと、target live rootの最小安全状態を二層化する。target側はtargetType、targetId、liveVersion、safetyEpoch、applyGate（OPEN / UNKNOWN_BLOCKED）を持つ論理契約とする。

UNKNOWN終端transactionではtargetをUNKNOWN_BLOCKEDへし、safetyEpochを進めることとRun終端をatomicに確定する。その後Runとその子状態はterminalAtから7日以内に削除する。target安全状態へRun ID、payload、result、evidence、operation履歴を複製して保持しない。

target安全状態の保持classはTARGET_LIVE_SAFETY。具体期間は未承認で、無期限保存の承認ではない。関連保持policy、期限強制、target安全状態の書込みが成立しない場合は該当外部作用を有効化しない。事前gateをすり抜けた保存障害はdispatch停止・復旧対象とし、合意された終端期限を無限に延長したり、terminalAtを書き直して削除起算を遅らせたりしない。期限違反・処理未完了は正常完了と偽装せず報告する。

UNKNOWN_BLOCKED中は同じ対象への通常の再提案公開・CREATE_DRAFT・Applyを安全側で抑止し、既存Suggestion/tokenもadmission時に拒否する。安全状態の欠落・期限切れもfail-closed。Runや旧guardのpurge、token期限切れ、新Suggestion、新draft、単なるliveVersion変更をOPENへの遷移根拠にしない。

target rootは未解決の安全状態を引き継ぐ。版の編集・rollbackで安全状態を初期化せず、新版の安全状態が欠けていてもOPENとみなさない。新しい人の操作を許可するのは、authoritativeな現在状態のread-only照合、現在権限確認、risk review、新しい明示承認、新intentが揃った場合だけ。その専用transactionで新liveVersion/safetyEpoch/安全状態を確定する。照合不能ならApply不可。旧UNKNOWNや期限到来から自動でこの遷移を作らず、旧UNKNOWNを成功/無効果に書き換えない。

後日受入には、削除とApplyの競合、Run purge後の新Suggestion/draft迂回、単なる新版作成/Flow Rollback、target safety欠落/期限切れ、旧token replay、新intentの承認不足を含める。

## 6 Ruleと事例を実装へ渡す条件

### 6.1 入力から説明までの境界

Fact系の処理は、認可済みsource → immutable Fact/source-health → 基礎Ruleとする。事例層の入口は、RuleResultまたは認可済みOperationalContext → ContextGate → DecisionBranch → ActionCandidate → ExplanationPlan → Suggestionである。すべてのcaseへ13RuleのFIREを必須にする意味ではない。EXP/PLAY/COMMを含む循環依存と自己入力は禁止する。

各登録には、metric定義/単位、分子・分母、cohort、成熟期間、比較window、sourceと認可、target版、quality、missing policy、threshold config、branch revision、action/explanation版、provenanceを必要とする。存在しないsource adapterは本文読取や個人データ新収集で補完しない。

数値判定は丸め前で行い、表示丸め、percent、percentage pointを分離する。分母0は0%ではない。比較期間とcohortの違う値を同一推移にしない。暦日と経過時間は区別し、評価時刻asOfはretryで更新しない。

三値評価はbranchに必要な入力だけを対象にする。FALSE AND UNKNOWNはFALSE、TRUE OR UNKNOWNはTRUE。前枝のUNKNOWNをFALSEとして後枝へ飛ばさず、unknownNextを明記する。診断表示と改善提案FIREは別に記録する。

初期actionはREVIEW_ONLY。CREATE_DRAFTは対象のtyped editor、field allowlist、権限、live/draft版、Apply再検証が実コードで成立した範囲だけにする。提案文章が具体的であることを、操作権限が存在する根拠にしない。

fixtureは完全baseline＋差分、config revision、asOf、window、source quality、target版、期待path/result/reason/actionを保存する。未指定必須入力を既知と仮定した例や、条件に一致しない期待pathを正本にしない。

### 6.2 catalogを完了とする条件

13Ruleと20caseの個別実装には、共通型、source mapping、訂正済みbranch、正常・境界・UNKNOWN・権限失効・削除・予算超過の受入仕様が必要である。個票を収集しただけでは実装準備完了ではない。catalog外の状況には未評価/対象外を表示し、網羅率や品質の保証を創作しない。

lineage抑止はsnapshot/window/evidence hashやengine/config版変更だけで解除しない。十分な品質で確認された解消、明示再検討、承認された抑止期限到来を区別する。観測不能を解消とみなさない。

Source provenanceは実事例、公式運用ルール、公式機能説明、NEXUS向け設計推論を区別し、URL・確認日・報告施策・効果測定有無を紐付ける。事例の成功割合をNEXUSの候補閾値に転用しない。

### 6.3 13基礎Ruleの対応

表中fixtureは受入素材であり、実行済みの試験ではない。共通契約と後続訂正を反映した完全baselineへ正規化してから使用する。case接続は関連mappingを示すもので、逆向き参照や実行DAGの循環を許可する意味ではない。

|Rule|入力依存と実装完了条件|case接続と後日受入素材|
|---|---|---|
|ONB-001|完了観測済みcohortのonboarding/first-action aggregate。成熟期間・除外・dedupeを固定|01/02/05。ONB-F01〜07、II-A|
|HELP-001|SLA到達済みintake、first-response/STALLED構造化状態。本文推定なし|03/04。HELP-F01〜07、II-A|
|RET-001|同じ定義のcohortと継続者の集合比較。source側overlap集計。長期比較は認可済みaggregateが必要|02/05/08。RET-F01〜07、II-A。CASE11への閾値流用は禁止|
|ENG-001|channel/guild参加aggregate、同一定義のcurrent/prior、source側重複除外|02/08。ENG-F01〜08、II-B|
|EVENT-001|同event・confirmed RSVP母集団のmatched attendance。比較metric/窓を固定|06/07/08。EVENT-F01〜08、II-B。submissionへの流用は禁止|
|REPORT-001|生成due/成功観測とdelivery SUCCESS/FAILURE/UNKNOWNを別評価|明示case接続なし。REPORT-F01〜10、II-B。観測不能からPC/Tunnel障害を断定しない|
|AUTO-001|同Automation live revisionのRun outcome、attempt重複除外、UNKNOWN別集計|明示case接続なし。II-C-AUTO001-F01〜07。REVIEW_ONLY|
|AUTO-002|due/deadline/heartbeat/leaseと新鮮なRuntime観測|06と関連するが直接Rule出力を入力するとは限らない。II-C-AUTO002-F01〜08。将来Wait/Tunnel断を滞留異常にしない|
|PERM-001|requirement registryとALLOW/DENY/UNKNOWN観測、scopeを照合|01/06。II-C-PERM001-F01〜08。確認DENYだけ不足、REVIEW_ONLY|
|EXP-001|allowlistの基礎issueとactive experiment registry、隣接period反復、coverage|07の後段候補。II-D-EXP001-F01〜07。非隣接/active/UNKNOWNを分離|
|PLAY-001|基礎issueと明示playbook mapping registry。意味類似で補完しない|03/04の手順候補。II-D-PLAY001-F01〜07|
|DATA-001|health品質/観測時刻と業務lastSuccessfulIngestAt/neverSucceeded/coverageを分離|01/03/04の品質確認。II-D-DATA001-F01〜08をIV-0/V-Aに合わせ訂正|
|COMM-001|allowlist基礎Rule、8domain、固定requestedRuleSlots。同guild/evaluation context内でも各target/window/版を保持|01〜05等の後段集約。COMM-F01〜06を訂正。旧ENGAGEMENTを使わず、旧F03のcoverage不足を正常全体評価にしない|

### 6.4 20事例catalogの対応

CASE09〜20には、保存済み個票で13Ruleへの明示mappingがない。認可済みOperationalContext入口を利用できる設計として扱い、入口・source・target・action registryを確定する。架空のRule接続を追加して「対応済み」にしない。

統合案として、登録入口を `RootTrigger = BASE_RULE_RESULT | AUTHORIZED_OPERATIONAL_CONTEXT` とし、各入口のdomain mapping、typed input、取得権限、scope、source revision/expiryを必須にする。未登録入口はDISABLED。20caseすべてを13RuleのFIREがないだけで隠さず、かつ新しい自由文・機微データ収集で入口を補完しない。この登録名は本計画の推奨であり、現コードの実在型ではない。

|case|入口と主要依存|実装完了と後日受入の重点|
|---|---|---|
|01 Onboarding迷子|ONB/PERM/DATA|IV-B訂正。destinationCount/mandatoryQuestionMaxを廃止、VISIBLE_TO_EXISTINGと構造化friction確認。access先行|
|02 初投稿への反応なし|ENG/RET/ONB|quiet/no-contact→coverage外→bot-only→general human-gap→nextDestination。bot-onlyはwelcome.botReplyCount>0かつwelcome.humanStaffReplyCount=0、generalは両方0。両枝ともcoverage IN。optional紹介だけで抑止しない|
|03 未回答|HELP/PLAY/DATA|SOLVED→NEEDS_DETAILS→OUTSIDE_COVERAGE→SPECIALIST/GENERAL。outcome未確認とsource欠測を分離|
|04 返信後停滞|HELP/PLAY/DATA|UNCLEAR→既知不足→guide gap→正常観測のoutcome未確認。source欠落から改善FIREを作らない|
|05 急成長と参加希薄化|ONB/RET、cohort aggregate|newCurrent/newPrior/establishedCurrent/establishedPriorの各分子分母・成熟期間を固定。campaign分離。異なる期間のjoin cohort IDを無理に同一化しない|
|06 event運営負荷|EVENT/PERM/AUTO-002関連、構造化運営context|capacity不足、限定spam、人triageを分離。自動処罰・強制resumeなし|
|07 event形式|EVENT関連、比較状態/poll/capacity/logistics|初期版は管理者確認enum。submissionへRSVP閾値を流用しない。代替形式、現形式、希望なし、未評価を分離|
|08 release間隔|ENG/RET/EVENT、error/interest/capacity|integration errorを新施策より優先。interest UNKNOWNを需要なしにしない。長期sourceなしはblocked|
|09 community request追跡|構造化request registry|request stateとSuggestion shared stateを別型。request自身のIDとduplicate先refを分離。request対象のSuggestion subtypeだけtargetRequestIdを持つ|
|10 channel分散|metadata、認可aggregate、期待権限|UNCLASSIFIEDとsource UNKNOWNを分離。protected用途を一律障害としない。diagnosticと改善FIREを分離|
|11 event評価|event/RSVP/attendance、任意feedback|access障害先行。repeat参加は専用cohort/window/source。RET閾値流用と誤った60/100の説明を廃止|
|12 告知とping|announcement/publication構造化状態|訂正、routine mass mention、参照導線、外部公開範囲を分離。本文理解・自動publishなし|
|13 noisy log|restricted queue、権限者の構造化確認|同queueのactionable/noise混在を確認。rule ambiguityで代用しない。restricted audience限定|
|14 volunteer負荷|明示availability/rota、queue aggregate|role/duty bucket単位の偏り。最大個人割当率・個人ランキング・健康/オンライン時間/能力評価を使わない|
|15 filter誤検出|同review集合、trigger集合、機能確認|IV-D source.mdの式を正本にし、trigger集合1と2以上を分離。FP率は候補config。ゼロ分母/未reviewを区別|
|16 join burst|campaign、staff incident、platform alert|ACTIVE確認→未審査restricted確認→RESOLVEDかつ制限残存のrecovery→campaign監視。通常capacity枝はno-alert=NONEを明示。旧F16-04を訂正。alertだけでraid確定しない|
|17 透明性とprivacy|期待/実permission、権限者privacy確認|restricted経路、公開summary、広範log、公開feedback経路を区別。個別reportを一般画面へ露出しない|
|18 画像と音声のbarrier|管理者checklist、任意barrier report|essentialInfoTextEquivalentStateを別field化。description存在だけで同等textとしない。具体的barrierを一般枝より優先|
|19 quiet reader|明示用途、認可閲覧aggregate、task clarity|urgent task clarityをRESOURCE維持より優先。source不存在の診断と閲覧ゼロを分離|
|20 forumと古い投稿|channel metadata、明示tag/outcome|pilot入口はTEXT_CHAT＋複数helpの埋没確認。すでにFORUMを入口にしない。古い/archive/lockを解決済みとしない|

### 6.5 最終補遺の採用と失効

[V-A](alpha16-normal-chat-annex-VA-contract-corrections.md)、[V-B](alpha16-normal-chat-annex-VB-final-corrections.md)、[VI](alpha16-normal-chat-annex-VI-migration-review.md)を読み取り・統合した。採用と失効は[契約訂正の正本](NEXUS_alpha16_contract_decisions.md)と本書§12に従う。次を旧定義と併用しない。

- Observationの業務valueとqualityを分離。qualityはSUFFICIENT/PARTIAL/STALE/MISSING/SUPPRESSED/UNKNOWN。UNCLASSIFIED/UNASSESSED等はdomain値。
- COMMの8domain、requested/evaluated Rule slot、target/window compatibility allowlist。欠測slotをNO_FIREへ変換しない。
- case予算と全評価aggregate予算、catalog静的node総数と実行stepを分離。数値は未承認候補。
- historyExpiresAtとactionableUntilを分離。後者は必要根拠の最短期限を超えない。
- CASE05の4値比較、CASE07の初期enum、CASE11のaccess先行とevent専用metric、CASE09のregistry分離。
- CASE05の比較可能性はsame metric/cohortDefinitionVersion/campaignClass/maturityOffset/compatible declared windowで判定し、current/priorのcohortIdやjoin区間が異なること自体は拒否しない。
- CASE09のtargetRequestIdはCOMMUNITY_REQUESTのtyped projection/referenceだけ。全Suggestionのcanonical targetはtargetType/targetId/liveVersion。
- 不完了評価のpartialは内部diagnosticのみ。契約で許可されたpartial coverageを持つ完了COMM評価のREVIEW_ONLY summaryとは区別する。
- privacy警告はexpectedPermission=RESTRICTEDとactualPermission=PUBLICの差分等を根拠にする。PUBLICであることだけを問題にしない。
- CASE10/13〜16/18〜20のfield・順序・条件をV-Bへ置換。CASE15のminN/FP率は未承認候補。NEXUSが非学習であることをDiscord AutoModの方式の断定へ広げない。
- catalog activationでは、未定義field/enum、未登録source/target/action、unit不一致、到達不能leaf、unknownNext欠落、fixture path不一致、重複branchId、DAG違反、schema/type不一致を拒否する。runtime warningだけで通さない。
- Operator受入はA16-OP-BASE-*とA16-OP-UI-*へ正規化し、提案pathは/operator/v1/...へ揃える。実route実在は引き続き照合待ち。

VIと本書の統合訂正により、次を正本として固定する。

1. V-B CASE02の「bot-only human gap (botCount=0)」は失効。正本fieldはwelcome.botReplyCountとwelcome.humanStaffReplyCount。quiet/no-contact→coverage OUT→BOT_ONLY（coverage IN、humanStaffReplyCount=0、botReplyCount>0）→GENERAL_HUMAN_GAP（coverage IN、両count=0）→nextDestination（coverage IN、humanStaffReplyCount>0）の順とする。未知sourceはunknownNext。optional intro単独で抑止せず、action未登録なら該当枝はDISABLED。
2. V-Aの「最初のserver評価時」は失効。first accepted enqueue transactionでserver生成asOf、job/dedupe、input hash、SEALED Fact/source-health ID＋版集合、period/window、rule/config/engine/catalog/schema/branch/action/explanation版をatomicに封印する。retry/resume/reclaimは再生成しない。
3. V-A.7、VIのF02〜06、旧caseの合成fixtureは受入素材。完全baseline/config/source quality/期待pathを揃えた受入仕様へ実装担当が正規化する。資料の取得だけでfixture実装や試験が完了したとはしない。
4. VIの単一lock順、token3種の分離、target側安全状態を採用し、§5.4/5.5でscope lock実機構、tombstone不存在、単なる版変更による迂回、終端無期限延期禁止を補う。

[契約訂正の正本](NEXUS_alpha16_contract_decisions.md)で旧条項との対応を追跡する。コード・schema・source・運用値の未確認はG2/G3/G6へ残し、文書上の訂正と混同しない。

## 7 移行とrollbackの安全条件

### 7.1 変更の入れ方

1. 現baselineと利用者差分を固定し、実schema・writer・readerの対応表を作る。
2. 必要な列・制約・adapterをexpand-firstで追加する。新Runtime/Rule/publicationは初期無効とし、既存正本を即時破壊しない。
3. 既存データの変換は、出所、型、期限、意味が確定したものだけを対象にする。過去Runから未承認の長期Fact/historyを生成しない。現在値から過去evidenceを捏造しない。
4. Runtime切替時の旧新writer、claim/admission gate、既存Runの担当、queue再構成を明記する。同じintentを旧新workerがそれぞれ実行する二重運転を作らない。
5. 新機能を旧domainへ接続し、全機能の組立を完了する。ここまでは試験を実施せず、契約・実装差分・受入仕様を揃える。
6. G4確認後、alpha16後段の一括試験結果に基づき修正し、最終code/schema/config版を固定して再確認する。型・状態・lock順・保持・action意味等の契約変更が必要ならN16-14へ戻し、影響範囲と受入を再確定する。
7. alpha17では実配置と実credentials等を設定し、実際の到達性・復旧・外部作用を別途確認する。

feature flag名は提案に留め、設定registryとの照合後に確定する。flagでOperator公開、tombstone無効化、UNKNOWN再送、保持延長を許可する逃げ道を設けない。

### 7.2 rollbackと障害復帰

- Rule/Suggestion生成を停止しても、既存operation、UNKNOWN、削除job、抑止記録を消去しない。
- Runtimeの旧版へ戻す場合は、現在のschemaと実行中stateを旧版が安全に扱えるかを確認する。単に「全flag OFFで旧経路へ戻る」と保証しない。
- Flow Rollbackは過去revisionを元にした新revisionを作成する。実行中Runのrevision、過去Run結果、元evidenceは書き換えない。
- publisher停止は新規公開を止める操作。古いACTIVE世代へ勝手に戻さず、withdraw済み世代を復活させない。
- backup restoreは、最初にbackupの期限を検査し、期限切れbackupを復元対象として拒否する。有効なbackupのみ隔離した復元先で最新tombstoneを独立取得し、適用・purgeしてからcache/queueを再構成し、通常公開を許可する。最新tombstone取得不能ならrestore後の通常起動を許可しない。
- backupから復元されたOPENを現在の安全状態とみなさない。通常dispatch開始前にtarget rootの最新safetyEpoch・未解決状態を照合し、最新版を確認できない対象はfail-closedとする。UNKNOWN前のbackupや古い安全状態から、§5.5の専用遷移を満たさず外部作用を再開しない。最新状態を保証する復旧方式は保持class・実保存先とともにG2/G3/alpha17で対応させ、Run履歴の延命や新サービスの暗黙採用で補わない。
- 削除はbackupで取り消す操作ではない。部分削除、live完了、backup期限切れ、UNKNOWNを別状態で示す。

## 8 実装後の全体受入計画

### 8.1 実行時期と結果台帳

現在は受入仕様の定義のみ。N16-15はalpha16全実装完了後に行う。実装途中や設計完了時点で試験・build・動作確認を実行したとは記録しない。実環境に依存する到達性・外部連携・常駐・実backupはalpha17の実環境受入へ分ける。

VI末尾の「alpha16はG4まで」という省略は採用しない。N16-15/G5の一括試験・集約修正・全体再確認までalpha16の後段として維持する。G4後の修正は原則として実装不具合の修正であり、契約自体を変える場合はN16-14へ戻す。

受入台帳の必須項目：正規ID、元付録ID、機能/契約/実path、baseline/commit/schema/config版、入力fixture、実行条件、期待結果、実結果、証拠、PASS/FAIL/PARTIAL/BLOCKED/NOT_RUN、修正task、再確認結果。

alpha15の192項目は旧結果を上書きせず別列で保持する。合格件数だけで完了判定せず、権限、削除、UNKNOWN、外部副作用の安全不変条件に未解決がないことを確認する。

### 8.2 受入IDの正規化

|正規ID|原ID|対象|
|---|---|---|
|A16-OP-BASE-01|I-A A16-OP-01 / C-A16-OP-01|Operatorへ外部interface/Tunnelから到達不可|
|A16-OP-BASE-02|I-A A16-OP-02 / C-A16-OP-02|運営操作の非公開境界と履歴|
|A16-OP-UI-01|III-B A16-OP-01|6系統healthの分離表示|
|A16-OP-UI-02|III-B A16-OP-02|admission状態変更から課金・外部招待を暗黙実行しない|
|A16-OP-UI-03|III-B A16-OP-03|scope別停止再開とUNKNOWN非再送|
|A16-OP-UI-05〜07|III-B A16-OP-05〜07|お知らせ、backup readiness、audit/config health|
|A16-DEL-01〜08|III-A同ID|privacy UI/API。便宜的なOP-04を新設して件数を水増ししない|

V-B C-02のcanonical mappingを採用する。旧IDは出典付きaliasだけとして保持し、新規canonical参照にしない。原III-Bに明示されたOP-04受入行はないため、privacyのA16-DEL-*を勝手にUI-04へ改番しない。その他の原IDは付録namespaceを併記して保持する。RuleのRET-001と保持受入RET-01、RuleのEXP-001とExplore機能EXP-01等も同一IDに正規化しない。

### 8.3 一括受入の検証集合

|検証集合|主な受入ID|確認内容|
|---|---|---|
|既存全機能とalpha15回帰|I-A各A16-*、ADD-01〜10、alpha15原ID|一覧だけでなく作成/変更/削除/実行/停止/再開/版/公開/承認の該当操作。日時・block・保存結果・履歴|
|Auth/BFF/公開境界|AUTH-01〜03、PUB-01/03〜05/07、A16-OP-BASE-*|session失効、CSRF、Host、署名/replay/body改変、cross-guild、callback認証、Browser内部API禁止、secret非露出|
|DBの一貫性|A16-DB-01〜05|snapshot途中停止、dedupe同時競合、immutable draft、二重Apply、tombstone優先、FK purge|
|Runtime復旧|ACC-RT-01〜08、AUTO-*|intent/outbox/claim/admission/result各境界の停止、lease expiry、旧Worker、queue消失、cancel/resume、固定revision|
|外部結果とUNKNOWN|ACC-RT-02/04/05/08、SUG-04|同key/異key/別actor/別draftの再送禁止、read-only reconcile、pre-effect証明、結果不明と既知失敗の分離|
|VIの横断整合|VI F02〜06を付録namespaceで識別|CASE02、enqueue封印、削除/Apply race、scope advisory lock、非存在tombstone、Run削除後/新版/古いbackupのOPEN復元による迂回、safety state欠落/期限切れ、token3種の非混同|
|Ruleと事例|RULE-01/02、各個票fixture、CASE01〜20|決定論、比較窓/cohort、quality、分母0、境界値、三値論理、unknownNext、優先枝、予算scope、部分結果非公開|
|Suggestionと説明|SUG-01〜04、HIST-01、RET-03/05|全target、shared/per-user分離、lineage、根拠期限、版変更、typed field、成功時CONSUMED、説明とprovenance|
|保持と削除|RET-01〜09、PRIV-01〜03、A16-DEL-01〜08|親Run終端後7日以内削除、backup7日、FK切離し、コピー延命なし、対象全保存先、replay非露出、receipt限定、restore遮断|
|公開情報|ANN/LEGAL/CONTACT/STATUS、PUB-06|public allowlist、世代/hash、旧publish job拒否、withdraw、sync失敗、期限切れStatus、未公開Legal/無効Contact|
|最小Operator|A16-OP-UI-*、A16-DEL-*|step-up、scope/版/preview、6系統health、admission、停止再開、backup readiness、audit最小化、secret非表示|
|全体互換とrollback|INT-01、ACC-ALL|新機能disabledでも既存domainを失わない。旧新writer競合なし。削除やUNKNOWNを消去せず戻せる範囲を確認|

### 8.4 障害の見分け方

PC停止、Tunnel停止、Worker停止、PC outbound断、Discord応答喪失、source観測期限切れを別scenarioにする。Tunnel停止だけならPCのScheduler/Discord処理が継続し得る。観測できないときはUNKNOWNとし、停止も正常も断定しない。

alpha16の管理された検証で確認できた契約と、alpha17の実環境で初めて確認できる事実を結果台帳で分ける。模擬Discord成功を実Discord確認済みにしない。

## 9 alpha17への引継ぎ

### 9.1 引渡す成果物

- 最終commit/branch、変更差分、実schema migrationと互換条件、rollbackの可否。
- 全機能mapping、API/DB/permission/target registry、正規受入IDと証拠、alpha15残件の扱い。
- 設定項目のschema、秘密値を含まない必要項目一覧、必須/任意、未設定時のfail-closed表示。
- Rule/config/retention/catalog版と承認状態、未承認値・blocked source・無効機能の解除条件。
- componentごとの起動依存、health判定、dispatch停止、再起動、purge/restore、UNKNOWN照合の手順。
- static publication adapter要件、世代切替・cache/withdrawの保証範囲、Legal/Contact公開条件。
- 実環境だけで残る試験と、公開・課金・外部送信等の開始に必要な利用者判断。

### 9.1.1 設定契約の引継ぎ表

実名が保存済み監査にあるのは下表先頭のNEXUS_WEB_URLとNEXUS_API_URLであり、現在値・配備先は未確認。それ以外の名称はlogical settingで、実際の設定名と供給経路をG2で照合する。実domain、port、鍵、資格情報、追加の提供サービスは本書で決定しない。設定値はalpha17の配備時に決め、秘密値は引継ぎ文書へ保存しない。

|設定名またはlogical setting|用途と必須範囲|秘密性|未設定・不正時の動作|alpha17で確認すること|
|---|---|---|---|---|
|NEXUS_WEB_URL（監査に実名あり）|正式app origin/OAuth callbackの基準。認証付きWebで必須|値自体は通常非secret|認証開始・callback・mutationを許可せずconfig healthに不足を表示。request Hostから推測しない|実HTTPS origin、登録callback、cookie、CSRF/Hostとの一致|
|NEXUS_API_URL（監査に実名あり）|server側API接続先。内部APIを使うdomainで必須|credentialではないが内部値をBrowserへ返さない|依存処理をunavailableとし、別origin直結や未知endpointへfallbackしない|実listener到達性、内部認証、Browser非到達、process依存|
|Static/App origins（logical、実名G2照合）|公式staticとappの公開境界、canonical host/redirect allowlist|通常非secret|未登録host/redirectを拒否。公開先を推測して生成・送信しない|静的hosting、DNS/Tunnel、HTTPS、OAuthとの役割分離|
|Internal listeners（logical、実名G2照合）|PC API/DB/queue/Operator等のbindと信頼proxy境界。対象processごとに必須|内部構成情報|不明な公開bindやproxy信頼を許可しない。Operatorを公開fallbackしない|実interface/port、ingress allowlist、内部API・Operator非公開|
|PG/Redis接続（logical、実名G2照合）|永続正本と派生queue/cacheの接続。利用する機能で必須|credentialはsecret、接続先も非公開|正本不通時にmutation/dispatch不可。queueだけを正本に昇格しない|実保存先、接続、起動順、復旧、queue再構成|
|内部署名・OAuth・provider secrets（logical、実名G2照合）|BFF内部認証、OAuth、Discord/Stripe等の対象連携で必須|secret|署名/認証を無効化して通さず、該当連携を拒否・disabled。秘密をresponse/logへ出さない|既存保管経路、key ID/rotation、callback署名、登録scope。値の表示なし|
|Operator認証/step-up（logical、実名G2照合）|local session、専用permission、危険操作の再認証で必須|認証要素/tokenはsecret|loopback到達だけで認証しない。step-up未成立なら削除/公開/停止再開等の危険操作を無効|設定済み認証要素、server challenge、preview束縛、現在権限、失効|
|Retention policy（logical、実名G2照合）|各保持class（TARGET_LIVE_SAFETYを含む）の承認版、expiry/purge。依存する永続生成・外部作用有効化に必須|policy値は非secret|未承認classの生成/依存外部作用を無効。Run終端後7日以内/backup7日を延長せず、欠落safetyをOPENにしない|実期限強制、PC停止時保証、purge、FK、target安全状態、restore拒否|
|Rule/config/catalog registry（logical、実名G2照合）|承認版、threshold/予算、RootTrigger、source/target/action、typed editor|設定は通常非secret。scope情報は認可対象|未承認/未登録/型不整合はDISABLED。無断の既定値で評価しない|承認版の一致、利用可能sourceと権限、fixture/profileと稼働設定の分離|
|Publisher（logical、実名G2照合）|公開先、世代切替能力、artifact/hash/manifest、cache扱い。publish有効化時に必須|公開用credentialはsecret|publish無効またはsync failed。既存公開世代を成功した新世代と偽装しない|実hostingの更新/atomic相当、世代確認、withdraw、cache限界|
|Backup/tombstone（logical、実名G2照合）|backup所在/期限強制、独立した最新tombstone取得、隔離restore。復旧readyに必須|保管credential/鍵はsecret、backup/tombstoneは非公開|NOT_READY。期限切れbackup、最新tombstone不明、保持保証未成立なら該当restore/稼働gateを開かない|live/backup別の停止中保証、7日失効、期限検査、削除反映、通常起動順|
|Health/TTL（logical、実名G2照合）|componentごとの観測source/時刻/鮮度、有効期限。正常判定時に必須|statusは公開allowlist、内部詳細は非公開|観測・期限不明はUNKNOWN。TTL候補を黙って採用しない|PC/Tunnel/Worker/outbound等の別観測、generatedAt/validUntil、期限切れ表示|

### 9.2 実運用PCの設定と適合調整

|作業ID|alpha17で確かめること|完了条件|
|---|---|---|
|N17-01 PC基盤|Windows、Node/Next、API、Worker、Scheduler、PG、Redis、cloudflaredの実配置、常駐、再起動、依存順|実listenerと保存先を記録し、restart後にpurge/遮断→通常処理の順で復旧|
|N17-02 公開経路|実domain、DNS方式、Tunnel ingress、HTTPS、app origin、PC内部API/Operator非公開|実Browser経路を確認。Operator/DB/Redis/internal pathは公開不可。A配置の採否を再質問しない|
|N17-03 Authと外部サービス|OAuth callback、cookie、trusted proxy、内部鍵、Discord Gateway/interaction/REST、Stripe webhook等|実認証と署名・権限を確認。credentialsを文書/画面/logへ露出しない。外部作用は承認範囲で実施|
|N17-04 静的公開|お名前.com実契約のupload、atomic/conditional世代切替、cache、status更新、撤回|能力がない方式でatomic成功と主張しない。必要adapter調整後に実配信を確認|
|N17-05 Backupと削除|live/backup別の独立したretention enforcementと保証範囲、backup先・7日失効、独立した最新tombstone、target rootの最新安全状態、隔離restore|PC停止中の期限強制を照合し、再起動purgeだけで期限内削除を保証しない。必要保証が成立しなければG6未通過。期限切れbackupはtombstone適用可否によらずrestore拒否。最新安全状態を確認できない対象はdispatch不可。live purgeとbackup expiryを別確認|
|N17-06 実負荷と設定適合|source coverage、計測window、予算、lease、timeout、status TTL、スリープ/回線断|承認済み方針内で計測・調整し版を更新。数値変更で過去evidenceや拒否状態を改変しない|
|N17-07 実環境受入と稼働開始|実Discord、実到達性、PC/Tunnel/Worker/outbound障害、Operator、公開機能、運用手順|実環境結果と残件を報告し、必要な公開/課金/送信開始承認後に有効化|

alpha17で見つかった構造不整合を設定値だけで隠さない。A配置、認証境界、保持、UNKNOWN等を変える必要がある場合は設計差分として戻す。大型な追加実装は改めて利用者承認を得る。

## 10 残す判断と未決事項

### 10.1 利用者に求める実質的な判断

DB方式やroute命名を利用者に選ばせない。次のまとまりへ絞り、担当側が整合した推奨案と影響を示す。

1. **実装開始**：最終計画と未決を確認してから、alpha16大型更新の実装着手を承認する。A配置の承認だけでは代替しない。
2. **保存と見せる範囲**：Run/backup以外の目的別保持（TARGET_LIVE_SAFETYを含む）、Suggestionの閲覧対象、削除後の最小監査・receipt、抑止期間、公開履歴を一つの表で決める。履歴表示期間、action可能期間、target安全制御の期間を区別する。
3. **運用開始の方針**：承認configと評価対象scope、公開Statusの粒度、Legal/Contactの公開条件。数値を個別に丸投げせず、検証結果と未有効化機能を添えた設定案として承認を求める。

PostgreSQL単一正本/lock方式、target-side safetyの構造、G2とalpha17の既決境界を、この3束の代わりの利用者選択肢にしない。DNS方式、常駐方法、physical schema、署名/tokenの実装方式、metric registry、branch修正は担当側の照合・設計事項。料金、契約、公開開始、権限範囲等が変わる場合だけ、具体的な影響とともに利用者へ判断を求める。詳細は[判断事項とgate](NEXUS_alpha16_decision_gate.md)に整理する。

### 10.2 実装担当が閉じる未決

|未決|閉じ方|影響するゲート|
|---|---|---|
|統合契約の実コード対応とfixture|文書訂正済みのCASE02/asOf/lock/UNKNOWNを実registry/schemaへ対応し、完全fixtureを実装。原文の失効条項を復活させない|G2、N16-02/09/10/14|
|現alpha15状態と192項目の残件|実コードと報告を照合。未commit変更を保護し原受入IDを回収|G2、N16-00/01|
|実route/table/ID/permission/step-up/source|保存監査の入口から現在コードへmapping。未存在は新設範囲・無効化条件を記録|G2、N16-01〜08/13|
|token/idempotencyと削除replay|§5.1の3種責務を操作class別の実wire/保管/期限へ対応。現在権限・tombstone・消失後応答を確認|N16-02/05/06|
|lock/guard/target safetyの実装適合|§5.4/5.5の順序、scope key集合、CAS/unique、target safety継承、purgeを実schemaへ対応|G2、N16-02/04〜06/11|
|新規保持・UNKNOWN期限・threshold・budget等|TARGET_LIVE_SAFETYを含む承認policyと検証用profileを分離。未承認値に依存する生成/外部作用の有効化を防ぐ|G3/G5/G6|
|長期aggregate/source不在|Rule/case単位でblocked。Run延命・raw本文収集で補完しない|N16-08〜10|
|static publish/backupの実能力|alpha16はadapter要件・失敗動作を固定。alpha17で能力と運用を実確認|N16-12、G6|
|acceptance ID衝突と旧fixture不整合|namespace mappingと完全baselineへ正規化。旧期待値を合格根拠に使わない|N16-02/14/15|

## 11 根拠索引

本書の優先順位は、最新利用者決定 → 本書§12と契約訂正正本の統合訂正 → 該当領域の明示訂正補遺（VI/V-B/V-A） → 分野別契約 → 基本仕様 → 初期比較案。単に新しい文章であるだけでは、安全不変条件や利用者決定を上書きしない。

|資料|主な利用箇所|
|---|---|
|[設計索引](NEXUS_alpha16_design_index.md)|範囲、優先順位、確定/候補/未確認、取得状況|
|[契約訂正の正本](NEXUS_alpha16_contract_decisions.md)|採用/失効の一意な対応。CASE、型、分岐、fixture、Runtime、工程の統合訂正|
|[判断事項とgate](NEXUS_alpha16_decision_gate.md)|利用者判断3束と、未承認・未照合時に止める機能|
|[読取監査](alpha16-readonly-code-audit.txt)|過去に確認されたcode path。実稼働・現状態の証明にはしない|
|[A配置基本仕様](alpha16-normal-chat-A-approved-final-specification.txt)|全体責務。後続訂正に反する保持、UNKNOWN、工程は採用しない|
|[I-A](alpha16-normal-chat-annex-IA-feature-matrix.txt)、[I-A追補](alpha16-normal-chat-annex-IA-supplement.txt)|全機能・操作・API/DB/permission/受入、追加10機能|
|[I-B](alpha16-normal-chat-annex-IB-api-contracts.txt)|API envelope/error、提案path、版、cursor、各新規API|
|[I-C1](alpha16-normal-chat-annex-IC1-consistency.txt)、[I-C2](alpha16-normal-chat-annex-IC2-fact-suggestion-db.txt)|Apply版固定、idempotency、Fact/Suggestion DB、transaction|
|[I-C3](alpha16-normal-chat-annex-IC3-runtime.txt)、[I-C4](alpha16-normal-chat-annex-IC4-retention-privacy.txt)|Runtime/UNKNOWN、保持/FK切離し/receipt/restore|
|[I-D](alpha16-normal-chat-annex-ID-public-migration.txt)|CONSUMED補正、lineage scope、公開境界、publication、移行とrollback|
|[II-0](alpha16-normal-chat-annex-II0-rule-common.txt)、[II-A](alpha16-normal-chat-annex-IIA-onb-help-ret.txt)、[II-B](alpha16-normal-chat-annex-IIB-eng-event-report.txt)、[II-C](alpha16-normal-chat-annex-IIC-auto-perm.txt)、[II-D](alpha16-normal-chat-annex-IID-exp-play-data.txt)、[II-E](alpha16-normal-chat-annex-IIE-comm.txt)|13基礎Ruleと共通入力・数値・品質・決定論|
|[III-A](alpha16-normal-chat-annex-IIIA-operator-privacy.txt)、[III-B](alpha16-normal-chat-annex-IIIB-operator-minimal-ui.txt)|Operator削除、同一intent replay補正、最小運営UI|
|[IV-0](alpha16-normal-chat-annex-IV0-branch-common.txt)、[IV-A](alpha16-normal-chat-annex-IVA-cases-01-04.txt)、[IV-B](alpha16-normal-chat-annex-IVB-cases-05-08.txt)、[IV-C](alpha16-normal-chat-annex-IVC-cases-09-12.txt)、[IV-D正本](alpha16-normal-chat-annex-IVD-cases-13-16-source.md)、[IV-E](alpha16-normal-chat-annex-IVE-cases-17-20.md)|20事例、分岐/Action/Explanation。IV-D数式はCopy原文を使用|
|[実運営事例調査](NEXUS_discord_operating_cases_2026-10-16.md)|事例の出典と観測可能性。効果保証やadapter実在の根拠ではない|
|[V-A](alpha16-normal-chat-annex-VA-contract-corrections.md)|型・三値評価・coverage・budget/保持・CASE05/07/09/11の訂正。V-Bの明示訂正を優先|
|[V-B](alpha16-normal-chat-annex-VB-final-corrections.md)|型/partial/保持の追加補正、残りCASE、catalog activation、Operator namespace。CASE02誤記は§6.5で補正|
|[VI](alpha16-normal-chat-annex-VI-migration-review.md)|17作業のレビュー、CASE02/asOf、単一lock順/token、target-side safety。工程と判断事項の誤省略は本書§12を優先|

V-A/V-B/VIと本書の局所整合訂正まで文書統合済み。G1の実装開始承認、G2のコード照合、G3のpolicy、有効化・受入・配備は未完了である。

## 12 最後の統合訂正と原文の優先関係

元の通常チャット回答は出典として保持する。次の箇所は本書と[契約訂正の正本](NEXUS_alpha16_contract_decisions.md)の統合内容を採用し、原文の不整合を実装へ戻さない。

|原文の箇所|本計画で採用する内容|実装先|
|---|---|---|
|VI末尾「alpha16はG4まで」|失効。alpha16後段にN16-15/G5の一括試験・集約修正・全体再確認を含める。実環境専用だけalpha17|§3/8/9|
|VIの利用者判断3束|DB方式や既決境界へ置換しない。①実装開始、②TARGET_LIVE_SAFETYを含む保持/閲覧、③運用公開条件を維持|§10と判断事項文書|
|VIのscope locks機構未記載|PG transaction-level advisory lockを採用。必要scopeを事前確定、実lock IDを重複除外・一定順で取得。row lock/unique/CASを併用|§5.4|
|VIの不存在rowを一律create-if-absentと読める記述|tombstoneはACTIVE仮作成しない。不在時の競合はscope lockで直列化し、認可された削除受付だけが作成|§5.4/N16-06|
|VIのtarget/liveVersion単位guardだけでは新版へ迂回し得る点|未解決安全状態はtarget rootで継承。新draft/live版/rollback/期限切れではOPENへ戻らない。照合＋権限/risk review＋新承認＋新intentの専用遷移だけを許可|§5.5/N16-11|
|古いbackupのOPEN復元によるUNKNOWN迂回|復元OPENを最新状態とみなさず、最新safetyEpoch・未解決状態を確認できない対象はfail-closed。専用遷移なしに外部作用を再開しない|§7.2/N17-05|
|VIの安全状態確保不能時に終端を成立させない記述|無期限延期・terminalAtの再設定によるRun保持延長は禁止。関連保持classと安全保存が未成立なら外部作用を有効化しない。障害はdispatch停止/復旧・期限違反として扱う|G3/§5.5|
|V-B CASE02 bot-only=0|失効。VIの正本field・到達可能な分岐順を採用。unknown sourceはunknownNext、optional intro単独抑止なし|§6.4/6.5|
|V-A「最初のserver評価時」|失効。first accepted enqueue transactionでasOfと全入力参照/版/hashを封印|N16-08/09、§6.5|
|全付録の未承認数値とlogical name|候補/コード照合待ちのまま。一般benchmark、既存route/table、実配備値として確定しない|G2/G3/G6|

本書の作成と文書確認で行ったのは保存済み設計資料の読取りと計画文書の編集だけである。NEXUS実装、migration適用、設定変更、試験、利用者PC操作、実Discord確認は行っていない。
