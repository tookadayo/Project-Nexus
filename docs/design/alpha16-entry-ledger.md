# alpha16 実装入口・現コード対応

この文書は着手時点の対応・未確認事項を残す履歴です。後続の一括検証結果と保存対象は [検証記録](alpha16-validation-status.md) を正本とし、以下の「未実行」を現在の合否として扱いません。

2026-10-16。基点 `35b0d22398c1463e2c88d7f49d960fa8a065002a`、作業branch `codex/alpha16-rule-platform`。GPT-6.1 Sol / Ultra。別checkoutなし。

正式入力は添付 `NEXUS_alpha16_design_and_migration_plan_2026-10-16.zip`、SHA256 `47cd62d4ba7cddac2477bde8c3df18e1f4a1d3d0b27484fb88b9ead13dbde66e`。37ファイルを `alpha16-source/` に展開し、manifest 36件をZIP内と展開後で照合。原文の指示は参考資料として扱い、現在のユーザー承認・統合正本を優先する。G1は開始指示で通過。過去の「未承認・未着手」は作成時点の記述。

## 保護・試験時期

唯一の既存未commit変更 `apps/web/next-env.d.ts` を保護。SHA256 `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000`。root/`.agents/skills` の追加指示なし。Webでは `apps/web/AGENTS.md` と同梱Next docsを参照。

全実装・試験コードを先に組み立て、完了範囲を共有してから一括試験。現段階の試験・型・lint・build・migration・実機設定・実Discordは未実行。静的な読取りと差分確認は試験合格の根拠にしない。

## alpha15の引継ぎ

保存済み35b0d22と先行74b8be9が基点。旧Scratch受入は188確認/3部分/1未実行、現在の再保証ではない。正本は `alpha15-scratch-implementation-evidence.md` と関連192項目台帳。

|旧ID|現在の引継ぎ|
|---|---|
|S031|Choice ordinal残件。後続日時precision・比較対応だけで全項目完了にしない|
|T040|R02適用制約の部分確認|
|T116|未確認の組合せを維持|
|T114|正式fixture未提供・未実行。関連安全試験は代替にならない|

日時の確定Instant/offset/Run開始・Wait・occurrence/評価済み変数は固定。未評価のzoned演算・calendar/window/displayは現在Intlに依存し、旧tzdb pinは未実装。新たなTZ bundle・保持目的を暗黙追加しない。実Discord/OAuth、公開配置、復旧、ACL/backup、数値ライブラリ再リンク等の未確認も維持。

## G2 CODE_SCHEMA 対応

IDは既存 `Scope={organizationId:UUID,guildId:Discord text}`、actorはguild内IdentityVault hash。Discord IDをUUIDへ変換しない。permissionは既存 `READ/ANALYZE/OPERATE/CONFIGURE/GOVERN`。

|契約・画面|現route/domain/正本|判断|
|---|---|---|
|AUTH・招待・設定|`app/auth/*`, `auth/session.ts`, `auth/public-session-store.ts`, `operations/web-setup.ts`, `web_setup_*`|流用。現在Discord本人/所属/権限を再検査。link必須化なし|
|Basic/Community/Journey|`app/data/{community,journey,attention,results}`, `api/src/v03.ts`, `analytics`, `daily_guild_metrics`, lifecycle rollups|流用。欠測≠0|
|Detailed|`analysis/src/index.ts`, `analysis_runs/results/grants/reservations/usage_ledger`|immutable結果と使用量正本を維持。新Factへ無断長期複製なし|
|Explore|`app/explore/data`, `analytics/explore.ts`, `saved_metric_views`, `operational_segments`|PC Next DBを維持。view/segment CRUD、CSV/PNGは既存domain|
|attention/intake/events|`app/operations/data`, `operations/{inbox,intake,events}.ts`, `attention_items`, `operations_requests`, `event_operation_templates`|流用。構造化outcomeとsource欠測を分離|
|playbook/experiment/intervention|同route、`operations/playbooks.ts`, `intervention-review.ts`, `playbooks`, `operations_interventions`|流用。新提案から直接実行せずtyped draft adapterを追加|
|reports/週次/helper|同route、`operations/reports.ts`, `worker/reports.ts`, `report_templates`, `weekly_summary_deliveries`, `helper_alerts`|流用。生成とdelivery UNKNOWNを別扱い|
|org/team/destinations/credentials/webhook|同route、`operations/{organization,destinations,credentials,webhooks}.ts`|流用。secret非返却、既存Webhookをblock外部HTTPと混同しない|
|Automation/日時/Run/Wait/Scheduler|`app/api/automation/[...path]`, `api/alpha15-automation`, `automation/*`, `worker/alpha15-automation`, `automation_*`|流用。immutable revision・有限Run・固定乱数・missed SKIP。新Rule外部Applyは安全gate未成立なら拒否|
|Lifecycle/Onboarding/first-response/retention|`lifecycle`, `onboarding`, `flow_versions/sessions`, membership/cohort rollups|流用。第二Runtimeを作らない|
|Plan/Beta/Billing/native|`app/billing/*`, `checkout/*`, `security/hosted-beta.ts`, `settings/billing/*`|流用。現在entitlement正本、callbackは独自署名認証。新販売なし|
|Control/Settings/Templates/Preference|`app/control`, `data/actions`, `settings`, onboarding/automation revision|既存権限・field allowlist・revisionを維持|
|Managed roles/Preview/Rollback|`discord/automation-role-policy.ts`, worker/alpha15-discord、automation service/revisions/preview|policy流用。専用rollback/API接続はG2で不足を検出し追加実装。AI投稿/activation/role付与なし|
|Readiness/Data/Permission health|`analytics`, `analysis`, capability/collection health|既存観測を流用。neverSucceeded/UNKNOWNを区別|
|Rule/Fact/20事例|既存diagnosesは固定診断、汎用評価/immutable Factの同義正本なし|`packages/rules` と060で差分新設。認可済みsourceだけ。未登録sourceはdisabled|
|Suggestion/history/draft/apply|既存 `suggestion_feedback` は固定診断の反応、`intervention_runs` は既存操作追跡|新canonical提案は060。旧機能を消さず互換mappingし二重提案を抑止|
|Announcement/status/legal/contact/static|`operations/publication.ts`, `app/publication-data`, `legal/status-view`, support form|公開allowlist artifact追加、実publisher能力なしではpublish無効|
|Privacy|`security/privacy.ts`, `deletion_requests`, `beta_deletion_jobs`, DB sessions|正本流用と061拡張。削除と新評価の共通scope lock。一般Webscope拡張なし|
|Operator|`operator/server.ts`, `security/operator-auth.ts`, `operator_sessions`|別loopback維持。step-up/preview/限定receiptと最小UI追加|

### Writer/reader と有効化の制約

新評価・提案・draft・purge writerはPGの同一scope lockを取得し、削除writerと同期。旧automation/action/analytics writerを全面置換しない。旧writerのtarget/version同期が未成立のtargetへ新Applyを有効化しない。現在認可はBFFとdomain、実行直前で再確認。queueはIDのみで正本を持たない。

`NEXUS_WEB_URL` はapp/OAuth基準。公式static origin・publisher能力は別契約。実値をrequest Hostから補完しない。Operator/internal API/DB/queueへの公開proxyなし。

後続の[仕様差分](alpha16-spec-deltas.md)で、新Fact/health/evaluation/evidence48時間・最小提案履歴/監査/抑止/receipt14日をソース契約として確定。新安全classの寿命、configの稼働profile・source照合・閾値/予算の検証と実運用有効化は別。提案表示の事前承認は不要で、現在READへ直接「推奨される対応」を示す。G6実domain/Tunnel/OAuth/backup/独立期限強制はalpha17。実データへの削除適用・運用設定変更は行っていない。

G2追加照合により、DetailedのWeb接続、Explore削除、保存template CRUD、本人Preference、FlowRollback専用操作は単なる流用では満たさないことが判明。N16-07で実接続を追加し、完了前に再対応する。未接続を全実装完了と呼ばない。

旧192項目は [機械対応台帳](alpha16-alpha15-regression-ledger.json) へ原ID・旧入力/期待・旧判定を保存。188確認/3部分/1未実行を維持し、alpha16列はすべてNOT_RUN。
