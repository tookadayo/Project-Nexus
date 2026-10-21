Source: https://chatgpt.com/c/6ad1abf0-d13c-83ee-a484-307ae6b5e52b
Collected via answer Copy control: 2026-10-16 05:26 UTC
Reasoning: 極高. Design only. Supersession applies to the explicit subjects listed below.

以下を「旧付録の対応条項を置換する統合補遺」として扱います。既存route/table名は断定せず、数値はfixtureを含めすべて閾値・benchmarkを意味しません。

# 統合補遺V-A：型・評価・数値比較の訂正契約

**適用**  
旧付録に存在する `source quality / predicate / deterministic evaluation / budget-retention / CASE05 / CASE07 / CASE11 / CASE09` の相当条項を本補遺で置換する。旧定義との併用は禁止する。本補遺はalpha16の設計契約であり、実装・実行・試験は行わない。

---

## V-A.1 型・三値評価契約

### 必要field

```text
Observation<T> = {
  value: T|null,
  quality: SUFFICIENT|PARTIAL|STALE|MISSING|SUPPRESSED|UNKNOWN,
  observedAt,
  expiresAt,
  sourceRef,
  sourceRevision
}
```

業務値の未分類・未審査・未回答は `T` 側のdomain enumとして表現する。

```text
UNCLASSIFIED
UNASSESSED
NOT_SET
```

これらを `quality=UNKNOWN` に変換してはならない。

predicate は必ず次の3値。

```text
TRUE | FALSE | UNKNOWN
```

```text
AND:
  いずれかがFALSE → FALSE
  両方TRUE         → TRUE
  その他           → UNKNOWN

OR:
  いずれかがTRUE → TRUE
  両方FALSE      → FALSE
  その他         → UNKNOWN

NOT:
  TRUE    → FALSE
  FALSE   → TRUE
  UNKNOWN → UNKNOWN
```

### 不変条件

- `quality` は観測品質、`value` は業務値であり、相互変換しない。
- 必要fieldだけを依存関係から抽出して評価する。無関係な欠測は既知の警告を抑止しない。
- ordered first-match は `TRUE → action`、`FALSE → 次枝`、`UNKNOWN → 明示された unknownNext` とする。
- `unknownNext` はbranchまたは明示的な非発火終端でなければならない。UNKNOWNを暗黙にFALSEへ変換しない。
- diagnosticを表示しても、それ自体をdomain改善SuggestionのFIREとしない。
- 未評価条件が残る場合、解消・安全・正常を断定しない。

### 実装時静的検証

次を実行前に検証可能なschemaとして持つ。

```text
declared schema
type
unit
unknownNext
unique branchId
DAG
fixture path
```

いずれか不正ならruleを有効化しない。

**受入要点：** domainの `UNASSESSED` とqualityの `UNKNOWN` が完全に分離され、無関係な欠測によって既知の安全警告が消えないこと。

---

## V-A.2 決定論・集約・coverage契約

### 必要field

```text
evaluationAsOf

immutable Fact observation reference
immutable source-health observation reference
periodRole
window

catalogVersion
ruleVersion
engineVersion
configVersion
schemaVersion
branchVersion
actionVersion
explanationVersion
```

`evaluationAsOf` は最初のserver評価時に固定する。

### 入力hash

入力hashは少なくとも次の集合を固定対象とする。

```text
evaluationAsOf
+ immutable Fact/source-health observation ID + revision 集合
+ periodRole
+ window
+ catalog/rule/engine/config/schema/branch/action/explanation version 集合
```

同一Runのretryは同一入力集合を使用し、現在Factと前期間Factは `periodKey` により共存させる。現在値で前期間値を上書きしない。

### DATA

次を分離する。

```text
source-health Observation<T>.quality

business-source:
  lastSuccessfulIngestAt
  neverSucceeded
  coverage
```

`neverSucceeded`、`lastSuccessfulIngestAt`、`coverage` をhealth qualityへ自動変換しない。`coverage` は当該sourceで宣言された型・単位だけで比較し、別metricの閾値を流用しない。

### COMM

同一の

```text
guild
+ evaluation context
```

内でも、原則として

```text
target
+ metric-specific window
```

を分離する。異なるtarget/windowの集約は、宣言済みcompatibility allowlistにある組合せだけ許可する。

`domain` は次の8種類だけとする。

```text
ONBOARDING
SUPPORT
RETENTION
CHANNEL_USAGE
EVENT
REPORTING
AUTOMATION
PERMISSION
```

`COMM`を追加domainとして扱わない。

### Rule slot coverage

評価開始時に `requestedRuleSlots` を固定する。

```text
evaluatedRuleSlots ⊆ requestedRuleSlots
```

欠測slotを `NO_FIRE` とみなさない。未評価が残り、条件未達を判断する根拠が不足する場合は `INELIGIBLE` とし、解消を断定しない。partial summaryを生成できる場合も `REVIEW_ONLY` に限定する。

### cooldown / reject / dismiss

これらは同一lineage単位で管理する。新しいsnapshot、window、evidence、versionだけでは迂回できない。

次を別状態として扱う。

```text
明示的再検討
期限到来
SUFFICIENTな解消確認
```

**受入要点：** retryで評価結果が変化せず、current/priorが混線せず、partial coverageが安全側の「NO_FIRE」に化けないこと。

---

## V-A.3 予算・保持契約

### 実行予算

旧候補値

```text
maxDepth = 8
maxNodes = 64
maxOps = 256
maxInputs = 128
```

は**case単位の実行上限候補**としてのみ扱う。未検証・未承認であり、全評価の上限ではない。

別途、

```text
EvaluationAggregateBudget
  = 全caseを横断する実行step / operation / input / deadline等のaggregate予算
```

を持つ。

`catalog static node count` と `run executed steps` は別物とする。20 caseをcatalogへ登録しただけでcase実行上限を消費したことにしてはならない。

### publish gate

次のいずれかに該当する評価は正常Suggestionとしてpublishしない。

```text
deadline exceeded
cancelled
tombstoned
aggregate budget exceeded
required evaluation incomplete
```

partial resultを残せる場合も `REVIEW_ONLY` に限定する。

### 保持

```text
Fact 48h
Suggestion 14d
```

は未承認候補であり、実装時に正式policy値として確定するまでは固定benchmarkとしない。

Suggestionについて、

```text
historyExpiresAt
actionableUntil
```

を分離する。

`actionableUntil` は少なくとも必要根拠の最短 `expiresAt` を超えてはならない。

```text
actionableUntil
  <= min(required evidence.expiresAt)
```

根拠最短期限を過ぎたSuggestionはaction不可。ただし履歴保持期限と同一視しない。

Fact削除時にevaluation FK `RESTRICT` が物理削除を阻害してはならない。期限到来時は、

```text
参照を切り離した最小履歴を残す
または
依存evaluationも同時に削除する
```

のいずれかとし、根拠本文をコピーして保持期間を延長してはならない。

```text
Run retention = 7d
backup retention = 7d
```

をFact/Suggestionの延命根拠にしない。

PC停止中に期限内物理削除済みと記録してはならない。alpha17へ、独立したretention enforcementと期限切れrestore拒否を運用要件として引き渡す。

**受入要点：** 20case登録とruntime budgetが混同されず、期限切れ根拠によるactionが禁止され、FKによってFact削除が永久阻害されないこと。

---

## V-A.4 CASE05 — cohort比較式の全面置換

### 必要field

各値を対応する `Observation<CohortMetricPoint>` とする。

```text
newCurrent
newPrior
establishedCurrent
establishedPrior
```

各pointには少なくとも、

```text
cohortKey
periodRole
cohortMaturityWindow
metricWindow
numerator
denominator
```

を持たせる。

さらに当該metric専用のcandidate configから、

```text
metricConfigRef
minN
coverage
```

を参照する。

認可aggregateが存在しない場合は `INELIGIBLE`。

### 不変条件

- `newCurrent` と `newPrior` は同一new cohort / 同一campaign cohort key / 同一cohort maturity windowで比較する。
- `establishedCurrent` と `establishedPrior` は同一established cohort / 同一cohort maturity windowで比較する。
- currentを別cohortのpriorと比較してはならない。
- campaign cohortをestablished cohortへ混ぜない。
- 各rateは必ず対応する分子・分母の組から算出する。
- `minN`、`coverage` は当該metricのcandidate configだけを参照する。普遍benchmark化しない。
- 4点のいずれかが必要条件を満たさなければ、分類は `UNKNOWN/INELIGIBLE` とし、単純変動からbranchを発火しない。

### 訂正後の式

各cohortについて、

```text
newCurrentRate      = newCurrent.numerator      / newCurrent.denominator
newPriorRate        = newPrior.numerator        / newPrior.denominator

establishedCurrentRate = establishedCurrent.numerator
                       / establishedCurrent.denominator

establishedPriorRate   = establishedPrior.numerator
                       / establishedPrior.denominator
```

有効性は当該metric configの `minN` / `coverage` を満たした場合だけ成立する。

分類：

```text
NEW_ONLY_DECLINE
  if newCurrentRate < newPriorRate
  AND establishedCurrentRate >= establishedPriorRate

BOTH_DECLINE
  if newCurrentRate < newPriorRate
  AND establishedCurrentRate < establishedPriorRate

ESTABLISHED_ONLY_DECLINE
  if newCurrentRate >= newPriorRate
  AND establishedCurrentRate < establishedPriorRate

NO_DECLINE
  if newCurrentRate >= newPriorRate
  AND establishedCurrentRate >= establishedPriorRate

UNKNOWN
  otherwise / required input unavailable
```

数値は当該metric configが明示的に提供した場合だけ使用する。`60/100`、`0.30`等を一般基準として導入しない。

**受入要点：** newとestablishedの4値が各自のcurrent/priorだけで比較され、campaign cohortが混線せず、認可aggregate・minN・coverageなしでbranchが出ないこと。

---

## V-A.5 CASE07 / CASE11 — metric流用の全面置換

### CASE07 必要field

```text
comparableParticipationState:
  LOW_COMPARABLE
  STABLE_PURPOSE_ALIGNED
  NOT_COMPARABLE
  UNASSESSED

preferredFormat:
  CURRENT
  ALTERNATIVE
  NO_PREFERENCE
  UNASSESSED

capacityState:
  SUFFICIENT
  INSUFFICIENT
  UNASSESSED

logisticsState:
  NO_PROBLEM_CONFIRMED
  PROBLEM_CONFIRMED
  UNASSESSED
```

各観測は `Observation<T>` として `observedAt / expiresAt / sourceRef / sourceRevision` を保持する。

### CASE07 不変条件・式

別形式pilot：

```text
comparableParticipationState = LOW_COMPARABLE
AND preferredFormat = ALTERNATIVE
AND capacityState = SUFFICIENT
AND logisticsState = NO_PROBLEM_CONFIRMED
```

→ `ALT_FORMAT_PILOT` のsemantic action候補、`REVIEW_ONLY`。

満足している小規模状態：

```text
comparableParticipationState = STABLE_PURPOSE_ALIGNED
AND preferredFormat = CURRENT
```

→ `KEEP_CURRENT` のsemantic action候補、`REVIEW_ONLY`。

`NOT_COMPARABLE` / `UNASSESSED` から一般的な参加率警告を生成しない。

`submissionCount` にRSVP conversion閾値を流用しない。定量版を有効化する場合は、専用の

```text
denominator
window
source contract
```

を別途宣言する。

### CASE11 必要field

```text
accessBarrierState:
  CONFIRMED
  NOT_CONFIRMED
  UNASSESSED
```

確認済みaccess障害は参加率に関係なく先行するoperational gateとする。

```text
accessBarrierState = CONFIRMED
```

なら、参加率・再参加率の比較より先にaccess対応を評価する。

event再参加確認は専用aggregateが成立するときだけ、

```text
dedicated numerator
dedicated denominator
dedicated window
declared source contract
```

を使用する。成立しない場合は `optionalFeedback` の確認に留め、再参加率を推定しない。

`event再参加率` に一般RET閾値を流用しない。

旧説明における

```text
60 / 100
rate < 0.30
```

をCASE07/CASE11の有効predicate・configから失効させる。

**受入要点：** access障害が参加率より先に処理され、CASE07の初期版が管理者確認stateを中心に動作し、専用aggregateなしの定量比較が発火しないこと。

---

## V-A.6 CASE09 — community request / AI suggestion model置換

### 必要field

#### CommunityRequest registry

```text
requestId
status:
  SUBMITTED
  ACKNOWLEDGED
  UNDER_REVIEW
  ACCEPTED
  BLOCKED
  DECLINED
  DUPLICATE
  COMPLETED

duplicateOfRequestId: optional
canonicalRef: optional
ownerRoleId: RoleId|null
ownerAssigned: boolean
```

#### AI Suggestion registry

```text
suggestionId
targetRequestId
status:
  ACTIVE
  REJECTED
  EXPIRED
  INVALIDATED
  CONSUMED

canonicalRef: optional
consumptionEvidence:
  DB_COMMIT_CONFIRMED
  EXTERNAL_SUCCESS_CONFIRMED
  NONE
```

### 不変条件

- requestとAI suggestionは別registry・別status型とする。
- `requestId` 自体をrequestのidentity/targetとして扱う。
- `duplicateOfRequestId` はoptionalな参照であり、DUPLICATE以外では必須としない。
- `canonicalRef` はoptional metadataであり、request discoveryのidentity keyではない。
- `canonicalRef` が存在しなくても `requestId` により未処理requestを発見・評価できる。
- `ownerRoleId` と `ownerAssigned` は別fieldとする。
- `ownerAssigned=true` の場合は `ownerRoleId` が存在しなければならない。
- AI suggestionは `targetRequestId=requestId` で対象requestへ結び付ける。
- request `ACCEPTED` はAI suggestion `CONSUMED`を意味しない。
- AI suggestion `CONSUMED` は次のいずれかの確認が存在する場合だけ成立する。

```text
DB_COMMIT_CONFIRMED
EXTERNAL_SUCCESS_CONFIRMED
```

draft、受付、承認、UNKNOWN、未確定外部結果を `CONSUMED` としてはならない。

**受入要点：** canonicalRefの有無でrequestを見失わず、request statusとAI suggestion statusを混同せず、CONSUMEDを実際のcommit/success確認に限定すること。

---

# V-A.7 合成fixture

## F01 — quality/domain分離・無関係欠測

```text
reportPermission:
  value = PUBLIC
  quality = SUFFICIENT

redactionReview:
  value = null
  quality = MISSING

contentChecklist:
  value = UNASSESSED
  quality = SUFFICIENT
```

期待：

```text
PUBLICに依存する既知警告 → TRUE
redactionReviewの欠測によって抑止しない
UNASSESSED ≠ quality UNKNOWN
```

---

## F02 — retry決定論・period/COMM分離

```text
evaluationAsOf = 固定値A

Fact:
  target=A, period=CURRENT, revision=7
  target=A, period=PRIOR,   revision=4

COMM:
  target=A, window=W1
  target=B, window=W2
```

同一hash入力でretryした場合：

```text
hash = 同一
evaluation result = 同一
```

`A CURRENT` と `A PRIOR` を上書きせず、`A/W1` と `B/W2` はallowlistなしに混合しない。

---

## F03 — static/runtime budget・partial publish

```text
catalog:
  20 cases registered
  static node count > 64
```

期待：

```text
catalog登録自体 → case budget超過としない
```

さらにruntimeでaggregate budget超過：

```text
execution = budget exceeded
```

期待：

```text
normal Suggestion publish = 禁止
partial result = REVIEW_ONLY
```

---

## F04 — 根拠期限とFact削除

```text
Suggestion:
  historyExpiresAt = 14d候補
  required evidence.expiresAt = 48h候補より前

Fact:
  expiry reached
  evaluation FK = RESTRICT
```

期待：

```text
evidence expiry後 → action不可
history retention → 別管理
Fact削除 → FK RESTRICTで永久阻害しない
evidence copy → 延命禁止
Run/backup 7d → Suggestion/Factの延命不可
```

---

## F05 — CASE05 + CASE07/11

### CASE05

```text
newCurrent       = 2/10
newPrior         = 3/10

establishedCurrent = 9/10
establishedPrior   = 8/10

same cohort maturity window
new = separate campaign cohort
authorized aggregate = available
metric config minN/coverage = satisfied
```

期待：

```text
new decline = TRUE
established decline = FALSE
classification = NEW_ONLY_DECLINE
```

`establishedCurrent` と `newPrior` を比較する実装は不合格。

### CASE07/11

```text
accessBarrierState = CONFIRMED
participation state = STABLE_PURPOSE_ALIGNED
```

期待：

```text
access operational gate → 先行
participation-rate threshold → 評価根拠にしない
```

別vector：

```text
comparableParticipationState = LOW_COMPARABLE
preferredFormat = ALTERNATIVE
capacityState = SUFFICIENT
logisticsState = NO_PROBLEM_CONFIRMED
```

期待：

```text
ALT_FORMAT_PILOT
REVIEW_ONLY
```

---

## F06 — CASE09 registry分離

```text
Request:
  requestId = R-001
  status = SUBMITTED
  canonicalRef = null
  ownerRoleId = MOD_ROLE
  ownerAssigned = false

Suggestion:
  suggestionId = S-001
  targetRequestId = R-001
  status = ACTIVE
  canonicalRef = null
  consumptionEvidence = NONE
```

期待：

```text
R-001 → 発見可能
S-001 → ACTIVE
S-001 ≠ CONSUMED
canonicalRef absence → request見落としなし
```

別vector：

```text
Suggestion.status = CONSUMED
consumptionEvidence = DB_COMMIT_CONFIRMED
```

期待：

```text
CONSUMED = 有効
```

`ACCEPTED` やdraftだけで `CONSUMED` とする実装は不合格。