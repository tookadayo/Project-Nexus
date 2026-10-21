# alpha16 CASE01–12 実装・受入コード台帳

2026-10-16。branch `codex/alpha16-rule-platform`、開始HEAD `35b0d22398c1463e2c88d7f49d960fa8a065002a`。原文37ファイル、manifest、既存変更とnext-envは変更しない。本文は**実装コードと未実行の受入素材**の記録であり、試験・型検査・lint・build合格、本番の有効化、G3/G5/G6通過を意味しない。

## 正本と変更範囲

原文README→migration plan→contract decisions→decision gate→design indexを入口とし、IV0/IVA/IVB/IVC、VA/VB/VIの明示訂正、II0/IIA/IIB/IIC、公開運営事例調査を参照した。CASE02はVIと最終migration/contractのquiet/no-contact→coverage OUT→INかつhuman=0かつbot>0→INかつ両方0→INかつhuman>0の順を採用。VBのbot0=BOT_ONLY記述、optional intro単独抑止は失効させた。

所有ファイル：`packages/rules/src/case-types.ts`、`case-engine.ts`、`cases-01-12.ts`、`tests/fixtures/alpha16-cases-01-12.ts`、`tests/unit/alpha16-cases-01-12.test.ts`、本書。13〜20担当とは共通AST/型/exportsを合意した。

## G2 source・target・Action mapping

|Case|既存コードとの接点|canonical target|未成立の入力契約|
|---|---|---|---|
|01|`packages/onboarding/src/index.ts:16`、Settings、Discord permission metadata|ONBOARDING_FLOW|期待/実アクセス、管理者friction、可視性、previewを同scope/版で返すcase専用adapterは未確認|
|02|`packages/lifecycle/src/index.ts`、Settings、`packages/presentation/src/community.ts:60`|COMMUNITY_ENGAGEMENT_POLICY|actor分類済み有人/bot count、既存no-contact preference、coverageの封印観測adapterは未確認。新規個人追跡は追加しない|
|03/04|`packages/operations/src/attention.ts:132`、lifecycle|ISSUE_TARGET|askerの明示outcome/intake、専門割当、guide mapping adapterは未確認。Attentionの返信/記録を解決や回答品質へ置換しない|
|05|CommunityService/lifecycleの集計は既存|GUILD|成熟期間・campaign class・比較窓を宣言した4つのcohort rate adapterは未確認。個人IDの長期再構成はしない|
|06|Discord event metadata、Operations inbox、Automation store|EVENT|event capacityと人が確認したmoderation issue categoryの専用adapterは未確認|
|07|Discord event metadata|EVENT|管理者が確認した比較可能状態/形式希望/余力/logisticsの専用adapterは未確認。submissionにRSVP閾値を流用しない|
|08|Automation store、CommunityService|GUILD|release間隔に適合した認可aggregate、明示interest/capacityの専用adapterは未確認|
|09|新CommunityRequest型のみ|COMMUNITY_REQUEST|既存publications/Suggestionをrequest registryとして流用しない。request adapter未実装|
|10|Settings・Discord channel metadata|CHANNEL|期待権限/実権限・protected用途・明示overlap・専用window countを同scopeで返すadapterは未確認|
|11|Discord event metadata、Explore集計経路|EVENT|任意feedback/access確認とevent専用再参加aggregateは未確認。専用metric/config/windowがなければ定量分岐しない|
|12|`packages/operations/src/publication.ts:181`、Operator publications|ANNOUNCEMENT|一般guild告知のcategory/mention/audience確認を公開管理DBと混同しない。case adapter未確認|

各caseのsource IDは`CASE##_STRUCTURED_CONTEXT_V1`。全`sourceMappings.confirmed=false`で登録し、実コードの接点をadapter成立の証明にしない。稼働profileでは承認保持とconfig、source/target/permissionの成立前にDISABLED。fixtureのregistry確認はSYNTHETIC_FIXTURE専用で、`publishable=false`。本番APIにfixture承認を渡す経路は追加しない。

全ActionはREVIEW_ONLY。Action IDはcase namespaceで一意とし、元の短いsemantic名を`CASE##-`に続ける。観測・分岐理由・具体的確認・担当・注意/代替・見直し条件はcatalog固定文と日本語/英語slotsで構成し、自由文や心理評価を入力しない。根拠をCASE_OBSERVATION/OFFICIAL_GUIDANCE/DESIGN_INFERENCEに分離し、歴史的な割合をbenchmarkや候補閾値へ転用しない。

## 共通評価器の境界

Observationはvalueとquality、source ID/版、authority scope、対象live版、observedAt/expiresAt、period/window、必要時cohortを分離。許可されたbounded predicate ASTだけを評価し、未知のfield/enum、単位不一致、unknownNext欠落、重複ID、DAG違反を静的に拒否する。AND/ORは三値論理で短絡し、無関係な欠測で既知の警告を消さない。domain UNASSESSED/UNCLASSIFIEDとquality UNKNOWNを混同しない。

case runtime予算とaggregate予算は別。static catalog node数をruntime消費としない。cancel/tombstone/deadline/予算超過/不完了では通常Suggestionを出さない。asOfをbusiness時刻として固定し、現時計は実行deadlineのguardにだけ使う。source-health集合・permissionsの順序、timestampの6桁UTC表記をcanonical hashへ正規化する。必要根拠の最短期限よりActionを延命しない。

CASE05は各cohortのcurrent/priorを各自で比較する。cohort ID/join区間の同一化を要求せず、metric/cohortDefinitionVersion/campaignClass/maturity offset/window契約を照合する。各分母/minN/coverageは専用candidate profileだけを参照する。分母0は判定不能。CASE11の再参加は別metric/config/windowを必要とし、RET-001の閾値を使用しない。

CASE09はCommunityRequestStatusとAiSuggestionStatusを別型とする。canonicalRefがなくてもrequestIdで発見する。targetRequestIdはCOMMUNITY_REQUEST subtypeにだけ存在する。CONSUMEDはDB_COMMIT_CONFIRMEDまたはEXTERNAL_SUCCESS_CONFIRMEDだけを許可する。

## 後日一括試験の素材

fixtureは完全baselineから全Observation/source-health/scope/target版/窓/asOf/profile版を実体化し、差分field一覧と手で定義した期待branchPath/outcome/reason/action/explanationを保存する。期待値を本評価器から生成しない。候補の60秒、件数10、再参加0.5、minN10、coverage0.9、budget値はfixture専用・未検証・非稼働設定である。

受入コードは各Action/優先分岐、CASE02のbot-only/両方0/optional/quiet/no-contact、CASE03/04のsource欠落と正常な未確認、CASE05の4点と異なるcohort ID、CASE07のenum-only、CASE09の型・identity、CASE10の保護用途、CASE11のaccess先行と専用metric、通常/境界/UNKNOWN/品質不十分/権限失効/tombstone/deadline/予算/決定論、catalogの不正登録を検証する構成。

**未実施：すべてのテスト実行・型検査・lint・build・UI・DB実行。** 全実装完了後のG5で集約検証する指示を維持している。未確認sourceを有効としたり、未実行をPASSへ読み替えたりしない。

## 追加の保存・worker接続

`packages/rules/src/case-storage.ts`、`migrations/064_alpha16_case_contexts.sql`、`tests/integration/alpha16-case-contexts.test.ts`を追加。`service.ts`はブラウザーからCASE Fact本文を受けず、default空・confirmed falseの内部adapterだけを受け口とする。初回accepted enqueue内で、valueをscalar/cohort専用列、profileの閾値を専用scalar列へ保存し、context/quality/source/権限/窓/版の定型metadataを厳密codecで制限する。元観測・source-healthの最短期限とFACT承認policy（観測時刻起点）、最新ソース契約の封印起点最大48時間でclampし、profileのfixture種別を永続化しない。

job descriptorにはCASE snapshot ID/revision/contentHash、profile/registry hash、aggregate budgetを固定する。workerは同じprivate参照を読み戻し、UTC microseconds、全版、target/window、全入力値、source-health ID/revision集合をhashで照合して`evaluatePlatform`へ接続する。未入力・未確認sourceのCASEはDISABLEDで、架空のActionを作らない。current actor proofをjob actorへ再結合し、claim/publish時に現在権限と元根拠の期限・削除を再確認する。

CASE公開は固定Action/担当/日本語英語slots/provenance/参照digestを展開し、根拠値は14日履歴へコピーしない。READによる表示に別の承認workflowを要求しない。REVIEW_ONLYは設定やDiscordの外部作用を作らない意味である。本人が明示HIDEした保存済み有効設定のみ一覧を空にし、readinessへ本人設定を返す。

重複はdedupeとlineage/action別抑止を使い、最初に作成したcooldown_untilを固定する。Ruleの暦日は保存IANAで既存calendarRelativeInstantを使いfoldはlaterを明示、gap/不存在は公開をfailclosedとする。再観測でcooldown/actionable/history期限を延ばさない。CASEの専用cooldownSecondsは稼働profileで明示されなければ公開を無効とし、fixtureの閾値と稼働承認を分離する。

integration受入コードにはtyped DB roundtrip、6桁日時、異なるasOfの1μs差、tenant/revision/profile/registry/hash、未承認保持/fixture/source拒否、immutable trigger、元期限優先を記述した。**この追加分も未実行**。

## IV0仲裁と暦日窓の補完

20CASEの各Actionに有限のpriorityBand/targetSpecificityを明示した。IV0の安全/incident→data quality→access/permission→pending task→capacity→purpose/structure→reversibleの順を採用し、同一のlogical targetとUTC窓内でのみ競合を比較する。帯が同じ場合はENTITY→POLICY→GUILD、実際に成立した条件数の降順、BranchNode.priorityの昇順、branchId辞書順を使う。条件数は短絡三値評価で結論を支えたTRUE条件だけを数え、FALSE/UNKNOWNの部分木は加算しない。下位はCONFLICT_SUPPRESSEDとしてActionを除去し、分類欠落と同じtarget/window内の対象live版の矛盾は全体の公開を閉じる。選ばれたCASEの封印RuleResultRefと一致する汎用Rule提案を二重公開しない。この帯分け自体はDESIGN_INFERENCEであり、因果や副作用権限を追加しない。

CASE05/11のCohortMetadataにはwindowKind/timeZoneを必須化した。ELAPSEDは宣言秒数とUTC boundsの厳密一致、CALENDAR_DAYはcalendarDays/startDate/endDateExclusiveとconfirmedなresolvedCalendarを必要とする。新規封印時には既存IANA dateBoundary(firstValidEarlier)で各完全日と両端を確認し、欠落日・未確認境界・不正zoneを拒否する。保存後の再開では固定されたUTC instantsを使い、現在のIntl/tzdataで再解決しない。比較は同一definition/windowContract/zone/kindを必要とし、CALENDAR_DAYの同じ日数に限ってDSTによる167/169時間と168時間の差を許す。終端は半開区間で除外する。

fixtureにはNew Yorkの2026年春/秋DST、TokyoのUTC日跨ぎ、異なるzone、境界ずれ、未確認resolution、終端除外、保存後Intl規則変更の例を追加した。064のheader CHECKも封印(captured_at)から最大48時間をDB制約にした。元sourceの早い期限・観測起点policyの保守的clampは別に維持する。いずれも未実行で、実adapterと稼働設定を有効化していない。

REVIEW_ONLYの生成・READ表示はtarget safetyの寿命/OPEN承認と分離した。workerの任意の登録済みDB target readerはPRESENT/MISSING/UNKNOWNを返し、未接続はUNKNOWNとして制約を表示する。既知の現在版が封印版と違うものはINVALIDATEDで履歴閲覧だけとする。target_safetyをOPENと捏造せず、CREATE_DRAFTと外部Applyの副作用admissionだけは現在権限・Safety gateを維持する。
