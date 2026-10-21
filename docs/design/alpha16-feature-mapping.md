# alpha16 全機能の実コード対応（G2）

後続実装の更新: 個別Interventionは `intervention-control.ts` の未送信取消をWeb request/If-Matchへ接続済み（開始済み・attempt済み・UNKNOWNは取消不可）。Org解除は070の既存行DETACHED停止と明示再認可へ具体化し、権限記録を保持してfallback復活を防ぐ。これらは実行未検証。下記の履歴的「契約なし／未接続」はこの追記と各最新evidenceを優先する。

2026-10-16。基点 `35b0d22398c1463e2c88d7f49d960fa8a065002a`、`codex/alpha16-rule-platform` の作業中ソースを静的に照合した。後続実装で行番号は移動し得る。正式37原文は不変。本書は [入口台帳](alpha16-entry-ledger.md) の「流用」を具体化し、[移行計画§4.2](alpha16-source/NEXUS_alpha16_migration_plan.md)、I-A、I-A追補の全機能を追跡する。後続ユーザー指示で一括検証は承認済みだが、本書はソース対応表であり実行結果の正本ではない。最新の試験・型・lint・build等は [検証台帳](alpha16-validation-status.md) を参照し、コードの存在を受入合格に数えない。

配置Aは、公式HTML/CSS/JSのみお名前.com、全Next/BFF/API/DB/Rule/worker/SchedulerはWindows PC、Operatorは別loopback。以下の `Web→BFF→domain→PG` はPC上の既存server-side DB処理であり、内部API移管を要求しない。`Web→BFF→API` の内部hopだけを署名する。Browserへ内部token/URL/DB接続情報を出さない。Discord Gateway/RESTはPC outboundでTunnel非経由。

判定は **接続あり（静的）**、**追加実装中**、**部分接続**、**外部条件待ち**、**未確認** を区別する。追加実装中の他担当コードは所有担当の最終報告と後日の試験で確定する。存在しないmethod/table/稼働profileを補って完成としない。

## 認証・共通permission・保存境界

|機能|配信／実行／保存／通信|実コード・permission|判定と境界|
|---|---|---|---|
|AUTH-01 session/login/logout/期限|PC Next／PC OAuth+session domain／`public_oauth_sessions`／Browser→Tunnel→Next→Discord|`app/auth/session.ts:29,49,189`、`security/public-sessions.ts`。opaque cookieとDB有効状態を照合、OAuth本人確認。logout/disconnectは確認GET→POST|接続あり（静的）。実OAuth/HTTPS/cookieは未確認|
|AUTH-02 guild一覧・切替|PC Next `/servers`,`/auth/select`／現在本人+guild／DB session+selected cookie／same-origin|`app/auth/select/route.ts`、`operations/context.ts:8`。guild assertionを現在選択と照合、切替mutationはPOST|接続あり。別tab/戻るの古いguildは409。cookieのguild IDだけでは認可しない|
|AUTH-03 現在権限|PC BFF／Discord authority+既存policy／既存guild/member/bindings／PC→Discord read|`operations/context.ts:8` のlive snapshot（10秒以内）、接続VERIFIED、`operations/policy.ts:64,101` の `READ/ANALYZE/OPERATE/CONFIGURE/GOVERN`|接続あり。READを表示前承認に置換しない。role/feature/削除/失効はdomain内でも再検査|
|Host/route/CSRF/callback|PC proxy／PC Next／session-bound cookie／Browser→same-origin|`apps/web/proxy.ts`、`auth/public-boundary.ts:37`、`auth/csrf.ts`。default-deny、canonical Host、Origin、signed double-submit。OAuth GET/Stripe POSTのexact callbackは独自検証|接続あり。callback allowlistはcallback認証成功を意味しない。Tunnel ingress実設定は外部条件待ち|
|内部API署名|PC BFF→PC API／security／既存session `proof_nonces`／loopback/internal|`security/public-api.ts`、`auth/api-proof.ts`。v2のみ、method/path/query/body hash/actor/guild/session/nonce/30秒期限。既存session行でnonce一度消費・prune|接続あり。旧scoped bearer GETは内部互換面のまま、公開Tunnel routeへ入れない|

以後のパスは `apps/web/app/`、domainは `packages/` を基準とする。全guild mutationで現在scope/permission/版/状態のdomain検査を維持する。新規静的棚卸しだけを根拠に旧機能を有効化しない。

## 全機能のroute → domain → table → 操作

|契約・機能|利用者入口・通信|PC domain／保存正本／permission|CRUD・実行対応／判定|
|---|---|---|---|
|公式トップ・製品・デモ・言語・版|静的生成→公式hosting。app loginへのHTTPS linkのみ|`presentation/src/alpha16-publication.ts` `buildOfficialStatic`、`scripts/build-official-static.ts`。公開JSON入力のみ、認証/DB依存なし|日英top/product/demo/pricing、announcement、status、承認Legal、Contact unavailable、`version.json`を書込済み。合成demoの7/30日切替・リセットにAPI/保存なし。公開説明の版と承認release入力を分離。実公開は外部条件待ち|
|招待・Bot導入・初期設定|`/setup`,`/servers`,`/data/setup/[...operation]`→内部署名API→domain|`operations/web-setup.ts:100,180,216,390,504`、`web_setup_requests/drafts/verification`等既存正本。現在本人/対象guild/導入確認/CONFIGURE|招待→権限/Bot確認→設定、status/verify/draft/apply/complete。既存設定維持、link必須なし。**接続あり**。実Discord導入は未確認|
|ANL-01 Home/Community/Journey/Basic|`/dashboard`,`/data/{community,journey,attention,results}`→既存v3 API|`api/src/v03.ts:62,63,79,87`、`presentation/service.ts`、`analytics`、`daily_guild_metrics`/lifecycle rollups等。現在guild READと既存plan|期間・対象・閲覧、欠測≠0。既存接続あり。観測/稼働は未確認|
|ANL-02 Detailed Analysis|新`/analysis`、`GET /api/analysis/{menu,history,runs/:id,runs/:id/compare}`、`POST preview/runs/runs/:id/cancel`→PC domain直接|`analysis/src/index.ts:405,420,473,634,734,765,799`。`analysis_runs/results/grants/reservations/usage_ledger/history_cursors`。READ閲覧/preview、ANALYZE開始、取消は本人ANALYZEまたはOPERATE|**追加接続を書込済み**。7種分析、preview fingerprint、caller intent key、既存dedupe/利用枠/immutable結果/期限/結果visibilityを流用。DTOはlease・actor hash・ciphertext・request key・target IDsを除去。queuedのみ取消、compare eligibilityはdomain。旧Detailed保持を新48hへ変更しない|
|EXP-01 Explore graph/CSV/PNG|`/explore`,`/explore/data`→PC `ExploreService`直接|`analytics/explore.ts:61,342,372,403,422`、`saved_metric_views`,`operational_segments`、既存metric/source。READはBFF現在認可、export/advanced/compareはfeature gate|graph/対象/期間/比較/保存graph適用、CSV/Discord共通PNG。**接続あり**、実結果は未確認|
|EXP-02 view/segment CRUD|同BFF POST `saveView/saveSegment/deleteView/deleteSegment`|`analytics/explore.ts` `save/saveSegment/removeView/removeSegment`。ANALYZE＋`surface_breakdowns`、scope advisory lock、row lock/CAS|**不足分を書込済み**。segment更新UI、版付きdelete、report参照view削除409、view所有segmentの変更/削除409。FK cascadeでreport定義を無断変更しない。観測元データは削除しない|
|既存診断・改善機会・非表示理由|`/dashboard`→v3 `/opportunities`、`/control feedback_dismiss`|`analytics/diagnoses.ts`、`presentation.opportunities`、`suggestion_feedback`。guild READ/既存mutation権限|固定閾値診断と新Ruleは別正本。互換/二重提案抑止はRule担当の追加対象。固定診断があることを汎用Rule完成としない|
|OPS-01 attention|`/operations?view=attention`,`/operations/data` GET/POST attention|`operations/inbox.ts:18,24,85`、`attention_items`、`operations_team_bindings`。READ/OPERATE＋既存feature、version/対象状態|一覧・項目表示・状態変更・team assignmentは接続あり。詳細が一覧item内で完結する既存表示を架空の専用routeに置換しない|
|OPS-02 intake|同`view=intake`、GET/POST intake/publish/read/disable＋maintenance状態/削除|`operations/intake.ts`、`operations_intake_panels/fields/requests`、`attention_items`。CONFIGURE作成/公開、OPERATE本文read、READ一覧|構造化受付/一覧/詳細/無効化と後続request状態/削除adapterを接続済み（静的）。受付本文とoutcomeを混同しない。削除をDiscord投稿削除に拡張しない|
|OPS-03 events|同`view=events`、POST event、GET calendar＋maintenance削除|`operations/events.ts`、`event_operation_templates`。CONFIGURE＋event feature、READ閲覧|作成/版付き変更/一覧/ICSと後続removeを接続済み（静的）。実Discord eventの削除ではなくNEXUS定義が対象|
|OPS-04 playbook|同`view=playbooks`、POST playbook/playbookTransition/dryRun|`operations/playbooks.ts:132,208,270,280`、`playbooks/revisions`、`playbook_executions`等。CONFIGURE、承認GOVERN＋independent actor、preview ANALYZE|作成/改訂/遷移/承認/実行設定/模擬は既存。ARCHIVED終端あり。正式削除契約への対応は終端/参照保護を明示して確定し、実行履歴をcascadeする広いDELETEは不可。**部分接続**|
|既存Action/承認/送信|`/control action_template/action_preflight/action_test`→v3 actions|`api/src/v03.ts:133,141,142`、lifecycle Action/intervention、既存outbox/approvals。CONFIGURE/現在Discord対象権限|通常運用入口維持。`actions/test`は実Discordへ`[TEST]`投稿する既存操作なので、ADD09の無副作用previewとは別。新Suggestionから自動送信しない|
|OPS-05 Experiments|`/control experiment_draft`、内部v02 `configuration` action `experiment_control`、新`/experiments[/data]`|`lifecycle/experiments.ts`、`guild_config_revisions/heads`,`experiment_assignments/controls/outcomes/metric_results`。既存admin/feature/状態遷移|Web一覧/改訂/preview/publish/end/結果接続はowner source完成（未実行）。GETは保存snapshot読取、`result()`の集計保存/guardrail pauseは明示POSTへ分離。保存profile未設定mutationはgate維持|
|OPS-05 Lifecycle Intervention|内部v02 configuration draft/publish/approve、Discordパネル、新`/lifecycle-interventions[/data]`|`lifecycle/interventions.ts` `propose/approve`、`guild_config_revisions`,`intervention_runs`、既存outbox。admin/feature/許可role・対象等|Web既存revision編集/停止/Run結果はowner source完成（未実行）。UNKNOWN/頻度制限/approval/runtimeを保持。個別未送信取消は既存intervention-control境界へ接続、開始済み/UNKNOWNは取消不可。下記改善追跡と別domain|
|OPS-05 改善追跡/measurement|`/operations?view=improvements` POST intervention、GET一覧＋maintenance変更/終了/比較|`operations/intervention-review.ts`、`operations_interventions/reviews`。OPERATE＋improvement_tracking、READ結果|baseline保存→測定→reviewと後続update/end/結果比較chartを接続済み（静的）。既存比較品質・保持フィルタを維持し、効果/因果を断定しない|
|OPS-06 Reports|`/operations?view=reports`、maintenance既存管理、`/reports/definitions` と専用 `/api/report-definitions/...`|`operations/reports.ts`、`report_templates/template_views/schedules/runs`＋071 immutable definition revisions/drafts、worker report delivery。READ閲覧、CONFIGURE＋scheduled_reports編集、currentproof/CAS|手動生成/結果/削除・既存定期管理と、定義draft作成/改訂/preview/明示commit/cancelを接続済み（静的）。draft/edit/previewはactive不変、commitもschedule/run/deliveryを起動しない。生成/配信と新manual保持・admission・UNKNOWNは独立gate。全試験は未実行|
|週次・Helper|dashboard設定、既存Discord運用→PCworker→Discord outbound|`apps/worker/src/reports.ts`、`weekly_summary_deliveries`,`helper_alerts`、既存settings/outbox。管理設定とruntime現在権限|生成/送信/履歴を維持。DB保存成功と外部delivery成功は分離。新Factへの長期複製なし。実送信未確認|
|OPS-07 Organization/member/team|`/operations?view=organization`、既存管理＋maintenance rename/close/unlink/team変更削除|`operations/organization.ts`、`operations_organizations/org_guilds/org_members/role_bindings/teams/team_members/team_bindings`。GOVERN＋multi_guild/rbac/team_assignment|既存作成/link/member管理と後続team update/delete・org rename/close・guild unlinkを接続済み（静的）。owner/他guild現在認可・credential/member tombstone・参照整合を維持。org全scope coverage/実profileは独立gate|
|OPS-07 notification destination|`/operations?view=integrations`既存管理＋maintenance変更/削除|`operations/destinations.ts`、`integration_destinations`。CONFIGURE＋kind別feature、Discord read preflight|作成/一覧/無効/再開と後続name/target update/removeを接続済み（静的）。playbook/report/intake/TEAM参照や未確定deliveryを先に確認|
|OPS-08 API credentials|同integrations既存管理＋maintenance変更/rotation|`operations/credentials.ts`、`api_credentials`/usage、token hash正本。CONFIGURE＋api/advanced_api、current member revocation|作成（new secret一度だけ）/失効/再開/一覧と後続native rotate/編集adapterを接続済み（静的）。旧tokenを残す疑似rotationで埋めない。資格情報の実生成/実変更は行っていない|
|OPS-08 既存Webhook|同integrations既存管理＋maintenance変更/削除|`operations/webhooks.ts`、`webhook_endpoints/secrets/deliveries`、domain events。CONFIGURE＋webhooks、SSRF URL policy、delivery fence|create/secret rotate/enable/disable/listと後続endpoint name/url/events update/removeを接続済み（静的）。既存Webhookを新ブロックHTTP機能と混同しない。未確定delivery自動再送禁止|
|AUTO-01 editor/draft|`/automation`,`/api/automation/[...path]`→署名API→AutomationService|`automation/service.ts:74,88,101,276`、`automation_flows/revisions`等、CONFIGURE＋既存limits|一覧/作成/型付き編集/保存/無効/論理削除、版CAS、旧catalog/日時/固定乱数の意味を維持。新source未承認のblockを追加しない|
|AUTO-02 immutable revision|同flows/:id、revisions/:revision、validate/test/impact/enable|`automation/service.ts:94,173,215`、immutable `automation_revisions`とactive pointer、CONFIGURE/GOVERN|履歴選択/比較/検査/新immutable revision/承認/有効化。過去Runの版不変。Rollback差分はADD10|
|AUTO-03/04 Run/Wait|同runs start/status/cancel、PCworker/scheduler内部resume|`automation/service.ts:295,313,389`、runtime/run/step/wait/attempt/lease等PG正本。OPERATEとadmission再認可|開始/状態/取消意図/有限Wait/再開、UNKNOWN・lease/fence・7日終端保持を維持。公開の任意resume APIを捏造しない。runtime強化は担当追加中|
|AUTO-05 Scheduler/internal events|editor trigger設定、overview/schedule状態、PCscheduler→Run|`apps/worker/src/alpha15-automation.ts`、`automation/schedule*.ts`、予約定義・planned fire・occurrence/Run|作成/変更/停止/再開はflow新revision/live切替に束縛。missed SKIP、固定occurrence、無断backfillなし。日時確定値と未評価Intl演算の限界は入口台帳を維持|
|Discord panel/command/button|PC Gateway/REST、HTTP interaction方式は専用署名検証|`apps/worker/src/interactions.ts`、`apps/interaction/src/server.ts`、`discord-panels`、既存component/session/outbox|既存操作を保持。GatewayをTunnel必須にしない。公開Nextのgeneric callback allowlistで署名を代替しない。実運用方式はalpha17未確認|
|PLAN-01/BETA-01|billing/servers/setupと別loopback Operator admission|`security/hosted-beta.ts:46,76,111,163`、entitlement、`beta_invitations/admission/usage`等既存正本|現在plan/枠/admission判定とOperator申請判断を維持。UI表示とserver entitlementを分離しない。新具体capacityは測定・設定待ち、有料価格確定なし|
|BILL-01/02/03 checkout/payment/promotion|PC `/pricing`,`/billing/*`,`/checkout/*`、Stripe専用callback|`app/billing/catalog.ts:32`、settings/billing domain、`billing_offerings/operations/subscriptions/authorizations/external_steps/events`|catalogはDB正本のpublic DTO、未公開/停止時に暫定価格fallbackなし。checkout/契約/支払/promotion既存domain。callback重複/状態照会維持。実販売開始/実資格は外部条件待ち|
|静的価格と動的canonical|公式static→PC価格/checkout正本|`billing/catalog.ts:32` のenabled mapping一意性、provider mapping非公開。`presentation/alpha16-publication.ts` 公開pricing schema|static snapshot版/観測/期限・日英表示を書込済み。価格は公開catalog projection JSONだけ、重複mapping/候補source拒否。未来/期限外は価格payloadコピーなし、JS無効でも価格非表示。PC canonicalへの通常linkのみ、実価格/販売有効化なし|
|Discord native billing|PC billing provider→Discord outbound/events|`settings/billing/providers/discord.ts`、同一entitlement正本|既存providerの存在のみ確認。実資格・商用有効化・provider callback運用は未確認。別billing正本を作らない|
|FACT-01/RULE-01/02|`/rules`,`/api/rules/catalog/config/config/history/rule-evaluations/fact-snapshots/:id`等→PCdomain直接|`rules/service.ts`、fact/source adapters、migration060。`rule_configs/versions/evaluations/fact_snapshots/...`、READ/ANALYZE/CONFIGURE|共通実装を保存。request-keyはserver発行専用route、初回enqueueで評価入力/asOf/版/hash固定。未登録sourceはdisabled。config有効化と推奨表示前承認を混同しない|
|SUG-01/02/HIST-01|同suggestions一覧/詳細/history、view/dismiss/save/reject|`rules/service.ts:135,163`、canonical suggestion/evidence/user state/history/suppression、READとshared mutation専用権限|root追加中。現在READへ直接「推奨される対応」、表示前承認なし。sharedとper-user分離、期限後の根拠再露出/保存による延命禁止|
|SUG-03/04 draft/apply/operation|同suggestion draft/apply、operations/:id read|`rules/service.ts`、`rules/typed-drafts.ts` のnative typed target registry＋immutable draft/link、runtime safety/intent/reservation|EXPERIMENT/ONBOARDING/AUTOMATION/AUTOMATION_FLOW/PLAYBOOKに加えREPORT/REPORT_DEFINITION/ONBOARDING_FLOWのnative draft＋Web/BFFを接続済み（静的）。対象の明示commit/publishは元domainのcurrentproof/CAS/plan/保持境界へ戻す。初期actionはREVIEW_ONLY、対象writer・保持・照合の条件が揃うまでCREATE_DRAFT/外部Applyは許可しない。現在READへの推奨表示は外部Apply条件で止めない。新Suggestion/draft/版変更でUNKNOWNを解除しない|
|ANN-01 announcement|別loopback Operator preview/step-up→PC source→public artifact|`operations/publication.ts:182,286,293,402`、`operations/alpha16-publication.ts`、`official_publications/revisions`＋063 head/manifest|draft改訂/破棄/nativeTx CAS、staging/admission/hash/generation/withdraw構造あり。実publisherなしでpublish/withdrawは503。外部反映不明を成功にしない。**外部条件待ち**|
|LEGAL-01/運営者情報/CONTACT-01|承認済public JSON→公式static、Operator legal preview/change|`presentation/alpha16-publication.ts`、`operations/publication.ts:544,579`、legal文書候補/設定正本|APPROVED_PUBLICだけ公開。文面/運営者/受付先/運用未成立は非公開・Contact unavailable。送信form成功を捏造しない。**外部条件待ち**|
|STATUS-01|PC public snapshot→公式static status + expiry script|`presentation/alpha16-publication.ts` `publicStatusSnapshotSchema/effectivePublicStatus`|PC/Tunnel/Worker/outbound別観測、generatedAt/validUntil、未来/欠測/stale/期限切れ/JS無効はUNKNOWN。実probe/publisher確認は外部条件待ち|
|PRIV-01/02/03|既存privacy＋Operator preview/step-up/receipt status／PCmaintenance|`security/privacy.ts:21,31,378`、既存deletion/tombstone/job/session＋061拡張。専用GUILD/GLOBAL等権限|privacy担当追加中。一般Web削除scopeの拡大なし。受付とpurge/backup完了を分離。restore/停止中独立期限強制はalpha17未確認|
|OP-01/02 Operator|PC別loopback `/operator/alpha16`,`/operator/v1/*`|`apps/operator/src/server.ts:25,56,141`、`security/operator-auth.ts:137,225,291`、既存session＋062 preview/challenge/receipt/audit|local session/Host/Origin/CSRF/permission/step-up、旧dangerous writer迂回を閉鎖。公開Operationsと別。実bind/ACL/Tunnel除外はalpha17確認|

## I-A追補 ADD の固有対応

|追補|route／domain／table／permission|対応・残件|
|---|---|---|
|ADD-01 Control/Settings|`/dashboard?view=4`,`POST /control` (`control/route.ts:8,58`)→v3 typed設定 (`api/src/v03.ts:89–127`)→`SettingsService`/`guild_settings`/audit、CONFIGURE・revision CAS|許可fieldのみ保存。設定保存とDiscord送信承認は別。旧設定の任意JSON一括書換を追加しない。接続あり|
|ADD-02 Lifecycle/Onboarding/First Response/Retention|`/onboarding-flows[/data]`→native config authoring＋元 `onboarding/src/index.ts` flow publish/start/answer/rollback、072 workspace/draft/publication＋元`flow_versions/sessions`、worker/native runtime|Web list/detail/published/options/preview/request-status、typed SAVE/DELETE/PUBLISHを接続済み（静的）。MAIN/HYBRID current flow/settings seal・immutable revision・currentproof/READ/CONFIGURE＋fallback/hybrid feature・CAS。draft保存でsettings/session無変更、明示publishのみ元native境界。既存request保持policy未設定はwrite gate、Run/Sessionは元版を保持。Retention＝継続参加、privacy保持とは別。第二Runtimeなし|
|ADD-03 Templates|新`/templates`,`/templates/data`→`operations/alpha16-personalization.ts`→065 template definitions/immutable revisions/minimal requests。READ閲覧、CONFIGURE管理|owner source完成（未実行）。一覧/閲覧/作成/変更/複製/削除/新draft。`AutomationService.save`で新DRAFTのみ、active/Run無変更。固有保存profile未設定で初期無効|
|ADD-04 Preference Center|新`/preferences`,`/preferences/data`→同domain `preferences:113`、actor_hash/guild scoped `personal_preferences`|現在READ本人のみ、入力userId/actorHash/guildId拒否、If-Matchとserver発行key。guild設定/Suggestion user-stateとは別。固有保持未確定で保存無効、consumer/privacy接続はroot担当|
|ADD-05 Managed Role Grants|`/automation/managed-roles`、`/api/automation/managed-roles` の既存bounded BFF→`api/alpha16-managed-roles.ts`→`automation/managed-roles.ts`、元automation_flows/revisions/operations/runs|固定role・GRANT/REVOKE・manual member ref・approvalRequiredに限定した通常FlowDefinition policy CRUD/checkと履歴を接続。draft/active/generation CASと現在権限を保持。専用enable/direct RunはMANAGED_ROLE_G3_NOT_READY、既存実行境界へ新しい迂回dispatchを作らない。詳細はmanaged-roles-evidence|
|ADD-06/07/08 Readiness/Data/Permission Health|`/health`、`GET/HEAD /api/health/overview`→`HealthWorkspaceService`、既存setup/aggregate health、capability/collection/guild snapshots|統合Web/current READ/削除/expiry/neverSucceeded/元source-healthを接続済み（静的）。必要権限registry未成立や不足sourceはUNKNOWN、実際権限をstaff手入力で補完しない。元native health readonly observations境界も追加、値未確認から正常Factを作らない|
|ADD-09 Test/Preview|`POST /api/automation/flows/:id/{validate,test,impact}`→既存Automation preview/check正本。`GET /api/health/lifecycle-preview?revision=UUID[&asOf=ISO&sourceHash=hash]`→RevisionService.preview＋`presentation/lifecycle-preview.ts`→既存pure lifecycle/experiment engines|設定比較に加え、現在認可/既存ANALYZE/plan/削除/可視scope/元の詳細保持内で保存済みPRODUCTION入力を最大25対象・各200factで事前評価。Run/割当/結果/利用枠/外部操作は書込なし。既存割当固定、missing/unknown/disabled/truncated/入力変更/再現限界を日英UIへ。統計的支持・実配信安全・過去全状態再現は未保証。legacy実投稿 `/actions/test` は別。試験自体は未実行|
|ADD-10 Flow Rollback|新`GET /flows/:id/rollback-history`、`POST rollback-draft/rollback`→`automation/service.ts:148,155,160`、`automation/rollback.ts:15,20`、067 journal|schedule担当コード準備済み（未実行）。履歴選択→新draft→preview→enable同一TXのdraft/active/generation CAS。CONFIGURE/plan/capability/host/現targetSafetyを再検査、旧Run不変。14日journalにRun/actor/payloadコピーなし。rollbackAudit/purgeReady/safety未設定はdisabled|

## 初回G2不足の一括台帳と担当（履歴）

G2で判明した不足を小分けの完了扱いで隠さず、次の一群として親へ共有した当初の記録である。下表の「追加中」「未確認」は現在の未実装一覧ではなく、後続の最終照合・各evidence・検証台帳で更新する。移行計画の「全CRUD」は、各domainの終端・参照・監査・外部作用を保つ操作で満たし、任意table削除routeを追加する意味にはしない。

|優先|不足|今回の所有／扱い|
|---|---|---|
|P0|Detailed Web HTTP/UI全接続、Explore更新/削除、Rule request-key route registration|本担当、source/test fixture書込済み。未実行|
|P0|Templates/本人Preference、ManagedRole/FlowRollback|cases担当／schedule担当、コード追加中・固有保存gateあり|
|P1|events delete、intake request状態/削除、統合health/lifecycle maintenance BFF/UI|root追加担当。既存現在認可/版/UNKNOWN/保持を迂回しない|
|P1|Reports手動生成/結果/削除、team update/delete|Operator担当の追加scope、rootが接続調整|
|P1|experiment/intervention revision/end/result、org rename/close/unlink、destination update/remove、credential rotate、webhook update/remove、playbook削除終端|rootへ不足一覧を一括共有、experiment/interventionはcases担当追加。各adapter完成と受入は未確認。既存API actionがあることだけでWeb導線完成と数えない|
|P1|公式product/demo/language/価格・文面版snapshot|N16-12 source/fixture書込済み、未実行。PC dynamic価格canonical維持、公開snapshotはDB/auth非依存入力だけ。hosting実adapter/公開承認/実価格は外部条件待ち|
|GATE|publication実adapter/cache/withdraw、Legal/contact実文面/受付、OAuth/domain/Tunnel、backup/restore/PC停止中期限強制|実設定・デプロイ禁止下で未確認。disabledを維持し、成功と表示しない|

## 保持と検証の限界

[最新ユーザー差分](alpha16-spec-deltas.md) と `rules/retention-contract.ts:3` が、原文中の旧「未承認候補」記述より優先する。新Fact/evaluation/source-health/evidenceは最大48時間、最小提案履歴/操作監査/抑止/receiptは原則14日。保存・retry・コピーで起算を延長しない。これは既存Detailed、元source、日次集計、長期比較の全体を48時間へ変更する指示ではない。Run terminal後7日・backup7日は維持し、14日historyへRun payloadを複製しない。

TARGET_LIVE_SAFETY/restore tombstone/publication撤回世代は寿命・照合・復元の契約が別で、90日案を採用しない。未成立の外部Apply/publisherはdisabled、期限切れやrow欠落でUNKNOWNを解除しない。実独立期限強制は未確認。現在READ利用者への「推奨される対応」表示はこの運用gateとは独立し、表示前承認を要求しない。

本担当の追加受入コードは `tests/unit/alpha16-analysis-bff.test.ts`（route登録、同一guild、Origin、private DTO、preview/start分離、intent/dup、期限/権限、null/比較）と `tests/integration/alpha16-explore-crud.test.ts`（CAS、別guild、plan/権限、report参照、hidden segment保護）。既存publication境界試験も維持。コード準備時点はすべて未実行で、後続の一括検証結果は検証台帳を参照する。新integration fixtureは既存DBを参照せず、専用private clusterだけを作るコードである。

`apps/web/next-env.d.ts` の保護SHA256は `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000`。ソース原典37ファイル・本番データ・資格情報・ネット設定・配置・mergeには変更を行っていない。

## 最終追加照合（上表の作業中表示より優先）

本節は同日後続コードの静的読取に基づく。受入合格には更新しない。

- rootの `/operations/maintenance` と `/api/operations-maintenance/[...path]` が、events削除、intake状態/削除、Reports生成/結果/削除、team変更/削除、org rename/close/unlink、改善追跡変更/終了/比較、destination変更/削除、credential変更/rotation、webhook変更/削除へ接続された。各domainのscope/version/permission/reference/UNKNOWN検査を保つ。UIのReports chart・改善前後chart・organization操作の欠落は追加済みと静読確認した。org close/unlinkのscope coverage、manual Reportsの固有保持/authority/runtime等は依然activation gateであり、route未接続とは区別する。
- manual Reports結果の現在source可視性不足は担当が補強した。`operations/reports.ts:133` `resultDetail` はlive maintenance proofと現在source fingerprintを再検証し、不一致はartifactを返さず `REPORT_SOURCE_VISIBILITY_CHANGED`。request/completeもsettings/analysis-scope/visible surfaces/measurement-recipeのsource fenceへ束縛する。実行・運用profile未設定のdisabledは維持する。
- `/health`、`GET /api/health/overview` と `/api/health/lifecycle-preview?revision=UUID` は `presentation/health-workspace.ts` `HealthWorkspaceService` に接続。現READ/削除/版/observedAt/expiry/neverSucceeded/元source-healthを使う。必要権限registry未確認を正常扱いしない。ADD09の後続実装で、設定比較に加え既存ANALYZE権限に基づく保存済み入力のbounded read-only評価を追加した（本表ADD09およびhealth証跡参照）。通常Run/割当/結果/利用枠の保存や外部操作は行わず、過去全状態の完全再現は保証しない。POST/refresh jobはない。exact三経路を公開境界へ登録した。
- `packages/db/src/index.ts` へ060〜082の登録を静読確認。071 Report drafts、072 onboarding drafts、073 cohort config、074 independent safety、075 runtime/permissions、076 issue census、077 operational contexts、078 operating profiles、079 representative-role observations、080 CASE native observations、081 prospective metadata protocol、082 CASE metric observationsを含む。migrationの作用は未実行。
- N16-14で旧署名試験とAPI fixtureのbody/full-query bindingを更新。`v02.test.ts` は同じpayloadからproofとinjectを構成し、別コピーのずれを防ぐ。v1正常MAC拒否・query順/繰返し値・本文改変・nonce replayも試験コードへ追加した。GET導入前statusの同request二度consumeはhandler-local validated identityで解消し、再request/別guild/権限喪失/session失効の回帰fixtureを追加した。共通nonce再消費例外・identity共有cache・v1 fallbackはない。

残るものを二分類する。

|分類|具体的な残り|
|---|---|
|真正なsemantic／観測不足|14 native descriptorのreader/dispatch、073 typed config、075 runtime/permission観測、071 Report定義binding、076 issue census、077 context authoring/sealing、079/080/081/082 CASE source接続はソースを保存済み。HELPはeligible intake denominatorまで接続したが、request-bound first_response_at/explicit STALLEDという分子観測が存在しない。CASEのsubject-specific no-contact、asker outcome、opt-in/preferred format、active platform alert、aggregate viewingも正規sourceがなくUNKNOWN。ACK/IN_PROGRESS・staff意見・投稿・incident時刻を代用しない。exactな不足は [source gaps](alpha16-source-gaps.md) と下表を参照。role/member overwrite、historical staff role、legacy protocol、forum thread census、保持外の比較期間はreader実装後のcoverage条件であり、未実装readerとは数えない。試験未実行|
|code接続済み・activation条件待ち|固有保持class/運用profile、org close/unlink coverage、manual Reportの保持/予算/source authority、Template/本人Preference保持、Rollback安全設定、実publisher能力、Legal/Contact公開運用、実domain/OAuth/Tunnel/PC停止時保持/backup/restore。承認が必要な未知sourceを架空データで埋めず、disabledの理由を表示する|

## 17作業の静的対応状況

|作業|ソース上の対応と現在の判定|
|---|---|
|N16-00|入口台帳・旧192項目対応・未commit保護あり。旧188/3/1を現在PASSへ繰り越さない|
|N16-01|本書で§4.2/I-A/追補を実route/domain/table/permission/操作へ対応。未成立source/能力を明示|
|N16-02|typed registry、canonical値/版、通信key、操作token、scope locks、保持class差分あり。稼働profile/未確定安全classはgate|
|N16-03|Host/default-deny/session/CSRF/内部v2/独自callback/別loopback Operatorの構造コードあり。新接続route登録済み、実公開面未確認|
|N16-04|060〜082 expand差分の登録を静読。079 role metadata、080 CASE native、081 source protocol、082 CASE metric observationsも含む。schema適用/実DB整合は未実行|
|N16-05|PG intent/attempt/lease/outbox/admission/UNKNOWN/safetyと既存Run連携のコードあり。未成立target/保持/独立enforcementは外部作用disabled|
|N16-06|privacy/tombstone/receipt/purge/restore-gateと各新domain hookのコードあり。actor削除では依存native snapshotを無効化し、同guildのactor非保持BOT/WEBHOOK返信referenceも既存scrub callback内で保守的Redis xdel。HUMAN既存判定・別scopeを維持。GLOBAL writer coverage、実停止中消去/backup/restoreは未確認|
|N16-07|Detailed/Explore、追加CRUD、Templates/Preferences、health/lifecycle、Rollback等を接続。固有profile gateと観測semantic/coverageの不足を上記二分類で維持。readerの存在を実データの完全性と混同しない|
|N16-08|Fact/scalar storage/sealing/health/adapter契約とfixture、14 descriptor/14 source catalog、current native reader/dispatchを保存済み。HELP分子と真正な未収集fieldはsource gapsへ分離。Report生成と配信、実験/Playbook census、075 heartbeat/permissionも独立した由来/期限で照合。14種native health/手動評価Web接続、current binding/保持/coverage/G3不成立はUNKNOWNのまま。実行検証なし|
|N16-09|13 Rule/versioned config/bounded engine/DAG/fixtureあり。保存済み版/hashとnative head CASでactivate/retireするWebを接続、任意のprofile/承認は入力しない。source/config/profile未成立でDISABLED、正常評価完成とはしない|
|N16-10|20case三値分岐/説明/registry/provenance、077 typed authoring/current binding/root sealing、079/080/082の3 server source pluginを保存済み。同Case複数resourceを保持し、評価はrequestedContextIds明示選択で同Case1件・最大20件。requestedCaseIds併用は交差、Case IDだけで複数候補ならAMBIGUOUS。UIはcatalog ID/版/target/観測/期限を表示し、context-only inputs:[]も同bodyでkey準備→enqueue。CASE03/04はpolicy→個別issueの正規関係がなく `CASE_ISSUE_TARGET_SOURCE_UNAVAILABLE` でprofile有効化/active評価を閉じ、disabled draft/現在READ/他Caseとは分離。raw観測/承認は送らず、未収集field/coverage不十分/実profile未設定はUNKNOWNまたはclosed|
|N16-11|Suggestion read/history/user/shared state、通信key、typed Draft/Apply安全契約あり。現在READへ推奨を直接表示。既存typed targetに加えREPORT/REPORT_DEFINITION/ONBOARDING_FLOWのnative authoring/Web/BFFを接続済み（静的）。課題census/source設定UIも追加。初期REVIEW_ONLY、editor接続と外部ApplyのG3条件を区別|
|N16-12|公式static日英/product/demo/価格/版、source/head/manifest/CAS/hash/withdraw、期限Status、Legal/Contact状態のコードとfixtureあり。実publisher/公開運用はgate|
|N16-13|Operator最小UI/preview/step-up/nativeTxと旧迂回閉鎖のコードあり。危険専用権限/実factor/profile未成立はdisabled|
|N16-14|互換台帳/全機能mapping/gates/旧proof fixture差分を追加。reader実装と真正なsource semantic不足・実coverage・運用gateを分類。ソース接続を根拠にG4通過や全体検証完了と宣言しない|
|N16-15|後続ユーザー指示による一括検証承認を受領。root統括で型/lint/unitと各owner修正・対象再確認へ進み、結果は検証台帳で管理する。本書はsource対応を記録し、Web/UI/buildはrootの段階別許可と保護確認に従う。承認だけでPASSへ変更しない|
|N16-16|alpha17環境gateを各evidenceと本書に記録。統合した配備・受入引継ぎの最終確定はN16-15結果待ち|

この表はG2のsource棚卸しであり、G4/G5/G6合格・販売開始・実設定有効化・公開配置・旧受入再保証ではない。

### N16-06 最終補足: 独立publication履歴purge

063の `official_static_publication_manifests` に独立期限purge APIとworker global tickの接続を追加した。後続074では `PUBLICATION_HISTORY` と独立 `PUBLICATION_WITHDRAWAL` の有限期限を分離し、`purgeExpiredStaticPublicationManifests` はpublication専用lock下で最大200件ずつのhead閉鎖・manifest履歴削除・期限安全root削除を行う。generation/withdrawn/active/pendingは独立期限内だけ必要最小限を保持し、期限で物理消去する。欠落/期限切れ境界をgeneration0やOPENへ戻さず、独立最新sourceだけが再初期化できる。旧PCニュース読取もSTATIC分類とhead/active manifestの期限・確定版を検証し、root物理消去後のlegacy再露出を防ぐ。

`cleanupComplete` はlocal期限処理だけを表し、`ready` / `externalPublicationReady` は常にfalseとする。root物理消去batchの `withdrawalRequirements` はtransientな照合要求であり、次tickで空でも外部不在・撤回成功と判断しない。052 source本文は削除対象外。unit/integration fixtureは有限root・新独立gateへ追随しただけで未実行。worker profileは既定無効で、policy/writer coverage/startup reconciliation/bounded batchが必要。独立reader/writer/purge/restoreの構造があっても、実source provider・具体寿命承認・publisher/cache期限内撤回・PC停止中の保持強制はactivation blockerであり、N16-06/G4の検証完了とは表明しない。

### 継続実装: native authoring とWeb入口の統合

REPORT定義およびONBOARDING_FLOWの担当者と次のexact route/methodを合意し、`auth/public-boundary.ts` のdefault-deny registryへ追加した。handler/domain本体の完成状況と実行検証は別に追跡する。callback認証や全API prefixを緩和しない。

|機能|Web／BFF境界|native責務／現在の接続状態|
|---|---|---|
|REPORT/REPORT_DEFINITION authoring|page `GET/HEAD /reports/definitions`。`GET/HEAD /api/report-definitions/templates`、`templates/:uuid`、`drafts/:uuid`、`drafts/:uuid/preview`。`POST /api/report-definitions/drafts`、`drafts/:uuid/revisions`、`drafts/:uuid/commit`、`drafts/:uuid/cancel`|071 additive draft/revision＋元Reports domainへ接続済み（静的）。READ metadata/定義、CONFIGURE＋scheduled_reports保存/変更/確定、現在proof前後/同一guild/削除/IfMatch/CAS/scope lock。catalogはtemplates/drafts/views/permissions/canConfigure、previewはdraft/current/changedFields/blockers/canCommit/confirmationHash。draft/edit/previewでactive不変、明示commitもschedule/run/delivery無変更、cancelはDRAFTを物理削除。元config目的/template lifetimeを維持、新生成source metadataだけ≤48hかつ元result期限へclamp。試験未実行|
|ONBOARDING_FLOW authoring|page `GET/HEAD /onboarding-flows`。`GET/HEAD/POST /onboarding-flows/data`|072 workspace/draft/publication＋元native publishへ接続済み（静的）。READ一覧/preview/published/options/request-status、CONFIGURE＋fallback/hybrid featureでstrict SAVE/DELETE/PUBLISH、UUID request-key/If-Match。10秒proof/native locks/CAS、MAIN/HYBRID current flow/settings seal。draft保存でsettings/session無変更、明示PUBLISHのみ元publish境界。通信identityは既存LIFECYCLE_WEB_REQUESTのconfig authoring目的を利用し、未設定policyのwrite gateを維持。試験未実行|
|Managed Role入口|page `GET/HEAD /automation/managed-roles`。既存bounded `/api/automation/...` proxy|専用pageをexact登録済み。`managed-role-policies` とhistory/detail/check/enable/prepare-run/runsは既存1～5segment/既存method境界内であり、新API prefixや直接Discord例外を増やさない。G3未成立は実行側で閉じ、既存policy READを止めない|

共有 `OperationsNavigation` とdashboard sidebarへ既知の独立画面入口を統合した。Detailed Analysis、Rule提案、Templates/本人Preference、health、保存済み運用maintenance、実験、参加支援、上記native authoringを通常linkで到達可能にし、Operatorへの公開link/通信routeは追加しない。現在guildは既存cookie/contextで解決し、各BFFの表示guild assertion・現在permissionを維持する。現在READの推奨表示を、未確定の外部Apply保持・publisher・対象安全状態で遮断しない。

ADD09の介入previewは、保存projectionに正規originがない限り肯定しない。条件falseだけfalse、観測trigger成立でも `UNKNOWN_TRIGGER_ORIGIN`、その他の条件/trigger欠損・待機も原因別UNKNOWNとし、WOULD_QUEUE/承認/提案を返さない。単なる説明文だけでunknownをmemberに補完しない。

境界fixtureにはexact route/methodと未知action拒否を追加し、古い `/health` 拒否の期待を現登録へ合わせた。本節は試験コード準備時点の静的記録であり、後続の一括検証結果は検証台帳へ分離する。原文37ファイルと `next-env.d.ts` の既存SHA保護を維持する。

### 追加Web統合: 課題対応表とsource設定

|機能|入口→domain→保存／permission|接続と限界|
|---|---|---|
|課題→施策対応と明示census|`GET/HEAD /rules/issues`、`GET/HEAD/POST /api/rule-issues`→`RuleIssueRegistry`→076 `rule_issue_registry`＋既存最小操作audit。READ一覧、CONFIGURE＋experiment/playbook feature保存、current maintenance proof/CAS|日英typed editor、元の保持期限内SUCCEEDED base-result候補とnative ID/version/stateを選択。表示時inventory hash両方を必須送信し、保存時変化は409。空未宣言≠ABSENT、期限≤48h、body/個人/SQL/Fact値/approval入力なし。新実験やPlaybookは実行せず、対応表が因果効果を保証しない。Root所有のnative reader/bridge最終接続は別に照合する|
|Native cohort source設定|`GET/HEAD /rules/sources`、`GET/HEAD /api/rules/source-config[/options|/:uuid]`、`POST /revisions`・`/:uuid/disable`→`native-cohort-config.ts`／RulePlatform→073 immutable revisions/heads。READ一覧、CONFIGURE編集/currentproof/CONFIG保持gate|5kindの保存済み候補・channel/event・数値秒・timezone・設定版sealを日英UIへ。Idempotency-Key=revisionId、If-Match=baseVersion。未入力数値/候補欠落/設定版不一致は保存不可。無効/empty/unknown/expiry/通信/取消/戻る/連打を区別。設定有効≠運用承認、未知sourceを正常化せず、新収集・任意コード・保持延長なし|
|Rule稼働設定の有効化/停止|`GET/HEAD /rules/config`→既存config/history/readiness、`POST /api/rules/config/activate`・`/retire`→RulePlatform native methods。既存CONFIG保存＋通信request、GOVERN/currentproof/CAS|保存済みDRAFT/ACTIVEの版とhashを確認し、serverのcurrentVersion/個別readiness/測定profile/現在source認可/保持を照合。ブラウザからprofileや承認を注入しない。通信keyはCONFIG_ACTIVATE/CONFIG_RETIREを区別、If-Matchはnative head。provider等未設定はclosed、推奨READと外部Applyは独立。新任意profile編集・実運用有効化を完了とは表明しない|
|Case運営context入力|`GET/HEAD /rules/context`、`GET/HEAD/POST /api/rule-context`→077 `OperationalCaseContexts`＋079/080/082 source plugins|typed catalog/options/detail/request-statusとcurrent binding/sealingを保存済み。現在READ/GOVERN/ANALYZE、10秒proof/CSRF/IfMatch/表示guild/server key、元起算≤48h。同Case複数resourceを保管し、評価側はcatalog UUIDを明示選択、同Case1件。本文/個人/実権限/元cohort手入力は禁止。source/版/権限/期限の不足をUNKNOWNとして保持し、境界登録を運用有効・実行合格とは表明しない|
|Rule手動評価/native health/ジョブ|`GET/HEAD /rules/evaluations`→既存Rule BFF evaluation-request-key/rule-evaluations/:id/cancel/source-health observations＋狭い `POST /api/rules/evaluation-request-status`。評価/health/取消/受付照合ANALYZE、job READ、native current authority/communication dedupe/internal row_version CAS|全14closed native kind、元source head/flow/report schedule/issue候補、UTC期間/比較role/3期間、必要なimmutable UUID/revision参照を接続。Case catalogは `GET /api/rule-context` の現在READ metadata、resourceはrequestedContextIdsで明示選択し同Case1件・最大20件、Case ID併用は交差。context-only inputs:[]もkey準備とenqueueへ同一serialized body、raw観測/approvalなし。transient healthは保存せずbusiness gateと独立。受付ID喪失時も元wireをcomponent memoryだけに保持して明示照合、same actor/tenant/EVALUATE/keyhash/HMAC/元期限を検証し、DONEのみ同Tx内元job metadata回収。PREPAREDは未実行と断定せず、expired/missingは送信停止＋operator照合。新保持/期限延長/消費/再enqueueなし。権限registry版候補APIはないため既存版の入力のみ。実行検証なし|

追加pageと専用/narrow BFFをexact公開境界へ登録し、共有navとdashboard入口に接続した。現在READの提案閲覧には外部Apply保持gateを追加しない。詳細は [Web authoring evidence](alpha16-web-authoring-evidence.md)。追加fixtureは準備のみであり、実行・受入合格の証拠ではない。

元native healthの `POST /api/rules/source-health/observations` もexact登録した。1〜20件のstrict typed request、current ANALYZE/currentproofで既存のunknown/partial観測を返すread-only処理であり、Fact生成・永続観測・実行や新保持を作らない。business Fact batchのgateと元health表示を混同しない。観測・評価・受付照合UIを `/rules/evaluations` へ接続済みである（静的、未実行）。

### N16-08/10 最終source対応表

以下はソースの接続を示す。14 descriptorと14 source catalog entryの存在は、実観測が完全・承認済み・期限内であることを証明しない。共通入口は `POST /api/rules/source-health/observations` の非保存ANALYZE観測、および `POST /api/rules/evaluation-request-key` → `rule-evaluations` の同一内容・一度だけの入力封印である。新Fact/healthは060正本と元source期限、source定義は073 CONFIG、Report/issueはそれぞれ071/076 native正本を使い、別の実データ収集先を作らない。詳細なclocks・SQL集団・health契約は [native source evidence](alpha16-native-source-evidence.md) を参照する。

|Descriptor|実reader／正本への接続（ソース）|UNKNOWNとなる正確な条件|
|---|---|---|
|ONBOARDING_FIRST_ACTION|`native-cohort-projections`、元flow sessionとpinned activation completionの同じcase・maturity AND|必要なhistorical REST/role条件・元期間・gateway coverage未観測はUNKNOWN。現在roleを過去absenceにしない|
|HELP_BACKLOG_COHORT|同reader、元intake/panel/SLA版・eligible denominator SQL|request-bound actual first_response_at/explicit STALLED分子が存在しない。ACK/IN_PROGRESS・別Discord返信・経過時間は代用不可|
|ENGAGEMENT_CONTINUATION_COHORT|同reader、元の許可された参加signalでprevious unique集団とcurrentのSQL intersection|暦日timezone/DST・保持内連続期間・現scope/coverageが必要。新規参加者をprevious denominatorへ加えない|
|CHANNEL_PARTICIPATION_COHORT|同reader、同guild/channel populationのunique参加、immutable capability snapshot＋channel hash|旧source ordinalを対象版にしない。非観測surface/保持外期間/不完全populationはUNKNOWN|
|EVENT_RSVP_ATTENDANCE_COHORT|同reader、event開始時の同event subscriptionとobservable voice/stage attendanceのintersection|cancel/maturity/元metadata・保持が必要。previous28dに56d詳細が要る場合は既存保持外ならUNKNOWN|
|AUTO_RUN_OUTCOMES|`native-projections`、元Run/revision/generation・terminal outcomeを一Run一回|UNKNOWN/承認待ち/取消/期限切れを失敗や成功へ補完せず、元Run期限とterminal後7日を維持|
|AUTO_EXECUTION_OBSERVATION|`native-execution-permission-projections`、075 due/deadline/terminal/明示worker heartbeat|承認grace・実census・新観測が必要。legacy観測欠落やlease/updated_atをheartbeatにしない|
|PERMISSION_REQUIREMENTS|同reader、075 current requirement epoch＋同epoch後capability observation|未収集overwrite/hierarchy/ownershipはUNKNOWN。未知をDENYにしない、現version/失効/元expiryを照合|
|REPORT_DELIVERY|`native-report-projections`、071 template/definition binding＋元confirmed outbox/webhook|元template/content/reference版とoutbound結果期限を照合。生成失敗を配信失敗にしない|
|REPORT_GENERATION_STATE|同reader、元generated_at/source expiry/immutable definition/content/reference|legacy/missing/期限切れprovenanceはUNKNOWN。next_at/completed_atを成功生成時刻にしない|
|STRUCTURED_ISSUE_PERIODS|`issue-registry`、076明示base issue/targetと保持中の3期間base Rule result|版/実結果/期間/元refs/expiryが必要。Suggestion数や空履歴で代用しない|
|EXPERIMENT_STATE|同registry、issue対応表＋元experiment control/census|明示complete censusとnative版が必要。無関係/空の行だけでABSENTにしない|
|PLAYBOOK_STATE|同registry、issue対応表＋元playbook状態/census|課題への明示coverageが必要。無関係の有効playbookを対応済みとしない|
|DATA_SOURCE_HEALTH|既存immutable health ID/revision/hash/effective expiryのexact参照|missing/expiredはUNKNOWN。healthの存在からbusiness Fact値を作らない|

077 CASE contextは現在READ catalog metadataから最大100 resourceを取得し、同Case複数resourceを保持できる。評価UIは保存済みUUID・版・target・observedAt/expiresAtだけを候補にし、`requestedContextIds` 最大20・一Case一resourceを明示する。`requestedCaseIds` 併用は集合の交差であり、Case IDだけで複数resourceなら `CASE_CONTEXT_AMBIGUOUS`。リソース不存在・権限失効・期限切れを自動で別resourceへ置換しない。prepare/enqueueは同一selectorsをhash/descriptorへ束縛し、workerも封印済みcontextとの集合一致を検証する。context-onlyは `inputs:[]` とcontext selectorだけでも成立するが、元profile/base result/source条件は受付時に再検証する。

|CASE source plugin|実接続／保存／境界|残る観測条件|
|---|---|---|
|`createRoleAccessSourcePlugin`|`operational-context-plugins.ts` closed registry→079 role-only metadata。CASE01/10/17の既存channel/flow/report bindingと明示representative roles|個人のrole構成を推測しない。member overwriteの影響・metadata現在性が証明できなければUNKNOWN|
|`createCase01To12SourcePlugin`|同registry→`operational-case-01-12-sources.ts`＋082 observations。元reply/issue/cohort/event/integration metadataをtyped descriptorでcapture/validate|実reply protocol/保持/集団・historical staff roleを照合。CASE03/04のintake policy UUIDとnative issue snowflakeを結ぶsourceがなく値はUNKNOWN、さらに有効化/active評価も明示停止してstaff-only枝からの偽issue提案を防ぐ|
|`createOperationalNativeContextPlugin`|同registry→080 finite native snapshots。CASE13/14/15/17/19/20の元attention/queue/AutoMod/role/post/thread等|個人評価や本文読取を追加しない。forum-container thread census不完全なら最新返信を断定しない。投稿は閲覧ではなく、既存incident時刻はactive alert classではない|

077/080/082は元のfirst-capture最大48hと早いsource期限、079はさらにcapability由来の最大1hを優先する。読取/改訂/再試行で延命しない。CASE06/07の実targetはnative EVENT id/versionであり、rootのEVENT_PROGRAM設定locatorとは分離して照合する。CASE17のPERMISSION targetは現在native channelへの明示aliasであり、staff入力permission値ではない。

081は新BOT/WEBHOOK直接返信reference・mass-mention target数・scheduled-event timeのprospective protocol stampであり、旧queue/rowをbackfillしない。新producer/projector実継続coverageと元gateway epoch/gap/intentsを照合するreaderは存在し、legacy/missing stampを正常なゼロにしない。actor削除ではnative sourceを先に無効化し、既存privacy callbackで同guildのidentityを持たないBOT/WEBHOOK reference付きRedis envelopeを保守的にxdelする。requeue/xaddや新個人IDは追加しない。HUMANの既存target/owner/mention/encrypted identity判定と別guild/organization境界を維持する。

真正な未収集fieldと承認が必要な収集/意味の変更は [source gaps](alpha16-source-gaps.md)、CASE authoring/sealing/expiry/privacy契約は [operational context evidence](alpha16-operational-context-evidence.md)、旧protocolと現coverageの区別は [source metadata evidence](alpha16-source-metadata-evidence.md) を正本参照とする。role coverage、legacy stamp、過去保持外期間を「reader未実装」に戻さない。本節は静的なsource照合記録であり、rootの一括検証結果は検証台帳へ委ねる。G4/G5/G6・本番設定・運用有効化を主張しない。

### 一括検証開始時のsource再照合

正式正本§6.1/6.3/6.4、統合訂正§5、II-AおよびV-B CASE03/04の契約と、最新spec-deltas/source-gaps/validation-statusを照合した。48h/14dの採用と推奨READ表示前承認の廃止は後続ユーザー指示を優先し、Run/backup7日と元sourceの早い期限を維持する。source欠如を通常outcome未確認に変換する許可ではない。

`operational-context-contract.ts:49` のsource readiness、`operational-context.ts:153` のenabled PROFILE_SAVE拒否、`:206` のreadStored検査、`:236/238/239` のactive profile除外が03/04を閉じる。catalog/draft/statusや他Caseは従来permissionで扱い、現在READの他推奨表示へこのsource gateを拡大しない。disabled draftや合成fixtureの存在も運用sourceの存在証明にはしない。

`native-projections.ts:171–193` の14 descriptor実dispatchと `operational-context-plugins.ts` の3 plugin登録、および各所有者の最終報告は一致し、この限定照合で新たな通常reader/source-form未実装は特定しなかった。`BLOCKED_NATIVE_SOURCE_CONTRACTS` はtyped bindingがないcaller向け互換diagnosticであり、名称だけで7 reader未実装とは数えない。unsupported CREATE_DRAFT targetのREVIEW_ONLY fallbackはaction capability制限であって、必要metricを架空に補完したりREADを停止したりする理由ではない。真正なsource semantic不足、実coverage、G3運用条件、検証結果を別分類のまま引き継ぐ。

一括検証で判明したCASE profileのcooldown入力未接続は、source欠如とは別の通常実装不備として補正した。既存engineがACTION前に要求する `<CASE>.cooldownSeconds` をprofile metadataへunit `seconds`・minimum 1で登録し、そのCase専用の正のsafeintegerをvalidator/UIへ接続する。有効profileでは必須、無効draftでは省略可能。基礎Ruleの7暦日等を経過秒へ自動変換せず、実設定やdefault値は作らない。合成fixtureの60秒は検証専用であり、稼働承認・G3成立を意味しない。CASE03/04のsource-readiness停止は別に維持する。
