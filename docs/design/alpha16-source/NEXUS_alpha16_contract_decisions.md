# NEXUS alpha16 契約の優先訂正と統合正本

更新：2026-10-16。対象：実装担当・レビュー担当。設計成果物であり、実装・設定・試験の実施記録ではない。

## 1. この文書の使い方

実装計画は [移行と実装計画](NEXUS_alpha16_migration_plan.md)、承認・未決・停止条件は [判断とゲート](NEXUS_alpha16_decision_gate.md)、参照付録は [索引](NEXUS_alpha16_design_index.md) にまとめる。

正本の優先順位は、最新の利用者決定 → この統合訂正文書と移行計画の明示訂正 → 該当分野の後続補遺 → 個別契約 → 基本仕様 → 初期比較案。後から書かれた文でも、利用者決定や安全不変条件を暗黙に上書きしない。通常チャット原文は出典として保持するが、失効行を実装へ転記しない。

## 2. 配置・工程・機能範囲

|項目|採用する契約|失効・採用しない解釈|
|---|---|---|
|A配置|静的公式Webはお名前.com。Dashboardを含むNext/BFF、API、全業務処理、Rule、Runtime、DBはPC。Browserからapp同一originのBFFへ入りTunnelを通す|Dashboardも静的お名前.comへ置くB案、Browserから内部APIへの直接CORS接続|
|既存DB処理|PC内Next server-side DB処理は維持できる。必要な接続差分のみ追加|初期監査の全DB処理API橋渡しを、A配置でも必須とする結論|
|Operator|独立loopback、公開Tunnel・公開BFFからproxyしない。最小運営UIと削除機能|公開Operationsと同一管理境界、localという理由だけで認証不要とする解釈|
|Discord|PCから直接outbound。Gatewayと署名HTTP callbackを区別|Tunnel断単独でDiscord作用をUNKNOWNにする列挙|
|工程|alpha16で構造・機能を実装し、全実装完了後のN16-15/G5で一括試験・集約修正・再確認。alpha17で実PC設定・適合調整・実環境受入|VI末尾の「alpha16はG4まで」という省略。今回の設計確定を実装承認とみなす解釈|
|全機能|IA/追補と移行計画§4.2の全行を保持。13Rule・20事例は追加catalog|分析・automationだけで全NEXUS対応完了とする解釈|

一般利用者Webからの新たなself-service削除範囲は未確定。追加要望は現時点ではlocal Operatorの削除UIとして計画する。NEXUS保存データ削除と、第三者のDiscordメッセージ削除は別操作である。

## 3. 評価・Fact・Suggestion

|論点|統合契約|主な出典|
|---|---|---|
|評価時刻|初めて受理したenqueue transactionでserverがevaluationAsOfを生成。SEALED Fact集合、source-health観測ID/版集合、全入力hash、Rule/config/engine/catalog等の版と同時固定。retry/resume/reclaimで更新しない|IC1、II0、VI。VAの「初回server評価時」は失効|
|入力再現|source-healthのhashだけでなくID/版集合を保持。Factはmetric/dimensionだけでなくperiod role/windowを区別|IC4、II0、VI|
|型と品質|valueとquality、正常なUNCLASSIFIED/UNASSESSED等を別fieldにする。source不存在を0やFALSEにしない。型・単位・期間・cohort比較可能性をregistryで確認|II0、IV0、VA/VB|
|cohort|同じmetric/cohort定義版/比較可能なcampaign class/成熟offset/windowで比較。current/priorのcohort IDやjoin区間は異なり得る|VB A-02|
|不完了評価|budget/deadline/cancel/tombstone/必須入力不完了時は通常Suggestionをpublishしない。partialは内部diagnosticのみ|VB A-03|
|COMMの部分coverage|許容された部分coverageを持つ完了評価だけREVIEW_ONLY summaryにできる。不完了評価と区別|VA/VB|
|DATA-001|正常に確認されたsource health、最終成功時刻、coverage、neverSucceededを入力とする。業務source欠測の警告を業務Fact成功要求で自己抑止しない。health観測自体がなければUNKNOWN|IC4、IV0|
|generic target|targetType/targetId/liveVersionが全Suggestionの基本型。CASE09のtargetRequestIdはCOMMUNITY_REQUEST subtypeのprojectionのみ|VB A-01|
|版|live版、draft版、immutable draft revision/hash、Suggestion版を分離。draft作成でlive版を変えず、元Suggestionを自動失効させない。Applyは承認したdraft内容を固定|IC1、IC2、IB補正|
|状態|共有ACTIVE/REJECTED/EXPIRED/INVALIDATED/CONSUMEDと、個人view/dismiss/saveを分離。CONSUMEDは適用成功確定時。DB-onlyはdomain transaction成功、外部作用は確認済み成功|ID、VB|
|scope|SHARED_REJECTはguild必須・user NULL、PER_USER_DISMISSはguild/user必須。それぞれのscopeでuniqueを定義|ID、VB A-06|
|dedupe/抑止|Rule/config/engine等の版、target/window、入力hashの変更と同一問題lineageを区別。新snapshotや新版だけで共有Reject・個人dismiss・cooldownを迂回しない|IC2/4、IV0、VA|
|期限|actionableUntilは必要根拠の最短期限を超えない。historyExpiresAtは別。48h Factと14d履歴等は未承認候補|IC4、VA|
|FKとpurge|evidence削除時はnon-actionable化と参照切離し、承認された最小履歴への移行または同時削除を行う。INVALIDATED表示だけで期限切れ根拠を保持しない|IC4|

## 4. Runtime・削除・公開

- PGをtransaction、lease/fence、intent、guardの正本とし、queue/outboxを再構成可能にする。Redisは安全状態の正本にしない。
- Applyの同一Suggestion＋immutable draft一意性だけでは不十分。同じtarget/live版の未解決作用guardを維持し、別actor/key/Suggestion/draftからの二重予約を防ぐ。
- send admission前の確実な無効果と、admission後の不明を分離する。admission後のcrash/応答喪失はUNKNOWN。DB transaction再試行を外部作用の再送へ変換しない。旧Workerはadmissionでfenceする。
- RESULT_UNKNOWNの同一外部作用は再送しない。read-only reconciliationで確定できなければ不明のまま。人の明示的新intentは現在状態・権限・リスク・新承認を必要とし、旧UNKNOWNの書換えや単純retryではない。
- cancelは受付と外部取消成功を区別。admission済みの作用を遡及して取り消したと表示しない。missed scheduleは無断backfillしない。
- Run終端後の最小状態を7日以内に削除し、backupは7日。payload/result/Run ID/evidence/intentを別tableへ複製して延命しない。期限到来を成功・無効果へ変換しない。
- VIで採用したtarget-side safety state/epochは独立の安全制御classであり、Run履歴の複製ではない。具体保持・削除条件は承認が必要。欠落/期限切れはfail-closed。単なる新draft/live版でOPENへ戻さない。承認・永続化条件が未成立なら関連する外部作用を有効化しない。
- UNKNOWN終端を無期限に延期してRun保持規則を逃れることは認めない。書込み障害時は新規admissionを止め、未確定の永続化障害として復旧対象にする。停止中に物理purge済みとは表示しない。
- scope排他はPostgreSQL transaction-level advisory lock（pg_advisory_xact_lock）、実rowはrow lock、unique/CASを併用する設計を採用する。必要scope集合を事前確定し、写像後の実lock IDを重複除外して一定順に取得する。全writerに同じ同期契約を要求する。advisory lockの取得はアプリ側の責任で、未参加writerを自動的に防ぐ仕組みではない。[PG公式のlock説明](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)、[関数仕様](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)（2026-10-16確認。実配備版は別途照合）。
- 単一lock orderとscope同期機構は移行計画§5.4を正本とする。非存在tombstone/guardのcheck-then-insert競合を防ぎ、active tombstoneをlock用の仮行として作らない。外部通信中にDB transaction/lockを保持しない。
- Idempotency-Key、server operation token、deletion receiptは別物。Replayも現在scope/権限/tombstoneを検査する。期限切れ・削除済みtoken/recordを新intentへ昇格させない。
- 削除受付でtombstone/session失効/job/限定receiptをatomicに確定。Receiptは削除statusだけで通常権限を復活させない。Operator削除は対象ID・scope・preview・step-up・hash/版・最終確認を必須とする。
- UNKNOWN前のbackupにあるOPENを現在の安全状態として復活させない。最新target safety epoch/gateを確認できなければfail-closedとし、tombstoneだけを適用して外部作用を再開しない。UNKNOWNとtarget安全状態の正本は移行計画§5.5。
- Backupの物理失効とlive purgeは別。最新tombstoneを古いbackupの外から取得し、隔離restoreの前後に適用。期限切れbackupは復元拒否。停止中の期限保証が実現しなければalpha17稼働gateは通過しない。
- Announcementは世代/hash/manifestとpublish/update/withdrawを接続し、撤回した世代を再公開しない。Statusは最終生成時刻と期限を持ち、期限切れをUNKNOWNとする。Legal/Contactの未完成を隠さない。

## 5. 20事例の採用差分

|case|実装へ渡す訂正|
|---|---|
|01|access期待と実測、構造化friction、VISIBLE_TO_EXISTINGを使用。未定義destinationCount/mandatoryQuestionMaxを除去|
|02|quiet/no-contact → coverage OUT → coverage IN・humanStaffReplyCount=0・botReplyCount>0 → coverage IN・human=0・bot=0 → human>0の次の導線。optional introだけで抑止しない。VBのBOT_ONLY=bot0はVIで失効|
|03|SOLVED→NEEDS_DETAILS→OUTSIDE_COVERAGE→SPECIALIST→GENERAL。GENERALはintake READY。source欠測と正常観測のoutcome未確認を分離|
|04|明示UNCLEAR/既知不足/guide gapを先行。正常観測で未確認なら任意確認、source欠落ならINELIGIBLE|
|05|newCurrent/newPriorとestablishedCurrent/establishedPriorの4値を比較。同じ成熟度・比較可能なcohort定義を用い、異なる分母を混ぜない|
|06|event不足とmoderation capacity不足を分岐。安全・coverage不足時に投稿促進へ直行しない|
|07|submissionへRSVP/attendance閾値を流用しない。初期は管理者確認の比較可能な参加状態・明示選好を使用|
|08|更新/発売間隔と短期活動を区別。低活動から不満・離脱原因を推定しない|
|09|community requestとAI Suggestionの型/状態/registryを分離。要求自身のIDとduplicate先を分離|
|10|protected RESTRICTED自体を障害にしない。期待権限との差分だけreview。purpose未分類とsource欠測を分離。投稿数だけでchannel削除を提案しない|
|11|明示access障害を参加率より先行。event固有metricを使用。一般RET閾値流用や60/100を0.30未満とする旧例は無効|
|12|告知の対象・目的・opt-in・通知負荷を分岐。mass pingをdefaultにしない|
|13|actionableNoiseMixStateのMIX_CONFIRMED/NO_MIX_CONFIRMED/UNASSESSEDでtriage。report本文は読まない|
|14|role/duty bucket別open assignmentの最大値/全bucket合計。個人ランキングではない。分母0はUNDEFINED、欠測は別|
|15|supported・reviewed・totalReviewed>=minNを共通条件とし、単一ruleはFP比率、複数ruleは混合状況を分岐。0<=FP<=reviewed。分母0で比率比較しない。20/0.20は未検証候補|
|16|ACTIVE incident→未審査alertのrestricted確認→RESOLVEDかつ制限残存のrecovery→campaign。alert存在だけでincident断定しない。campaign通常枝はalert NONEを要求|
|17|privacy warningにはexpected RESTRICTEDとactual PUBLICの差分等の根拠を要求。公開という事実だけで違反を断定しない|
|18|descriptionの存在とessentialInfoTextEquivalentStateを分離。具体的barrier報告を装飾画像への不要追記抑止より優先|
|19|urgent task clarityをresource閲覧維持より優先。閲覧source不存在は閲覧0ではない。独立したentry barrier reviewを無関係な閲覧欠測で止めない|
|20|TEXT_CHATで複数help埋没を管理者確認した場合にforum pilot。既存FORUMはnavigation review。old/archived/lockedをsolvedにしない|

全caseは必要fieldだけを三値評価し、unknownNextを明示する。FALSE AND UNKNOWNはFALSE、TRUE OR UNKNOWNはTRUE。前枝UNKNOWNをFALSEとして飛ばさない。未登録source/target/action/RootTriggerはDISABLED。BASE_RULE_RESULTとAUTHORIZED_OPERATIONAL_CONTEXTの入口を区別し、全caseにRule FIREを強制しない。

完全fixtureはbaseline/config版/asOf/window/source quality/期待pathを含める。原文の短い例だけを受入正本にしない。未定義field/enum、単位不一致、到達不能leaf、unknownNextなし、期待path不一致、重複ID、DAG/type違反はcatalog有効化拒否とする。13Ruleと20caseであらゆる運営状況を網羅したとは表示しない。

## 6. 受入IDと出典

- IAの旧A16-OP-01/02は **A16-OP-BASE-01/02**。
- IIIBの旧A16-OP-01..07は **A16-OP-UI-01..07**。
- A16-DEL-01..08は維持。旧IDは出典付きaliasとしてだけ保持。
- Operator提案pathは `/operator/v1/...`。実routeの存在はG2照合。
- 事例の出典確認は [公開事例調査](NEXUS_discord_operating_cases_2026-10-16.md) に記録。実事例・公開運用・公式助言・NEXUS設計推論を分離。自己報告の効果を因果証明や閾値の根拠にしない。
- 初期30日/24か月保持案は失効。48h/14d、各閾値/minN/freshness/cooldown/budgetは未検証・未承認候補であり、原文中の数値をそのまま稼働値にしない。

設計と参照文書の統合は、現コード照合・実装・試験・稼働準備の完了を意味しない。該当gateが満たされない機能を使用可能と表示してはならない。
