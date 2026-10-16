Source: https://chatgpt.com/c/6ad1abf0-d13c-83ee-a484-307ae6b5e52b
Collected via answer Copy control: 2026-10-16 05:38 UTC
Reasoning: 極高. Design only; no implementation or testing.

以下をV-Aに対する**最終差分正本**として整理します。数値は引き続き未検証・未承認候補であり、本書は実装・試験・利用者承認を意味しません。

# 統合補遺V-B：分岐と文書統合の最終差分

**位置付け：** 本補遺はV-Aおよび旧付録の該当条項を置換する差分正本である。共通仕様・20事例全文は再掲しない。

---

## A. V-Aの解釈固定

### A-01 — AI Suggestionのglobal型

**変更後**

```text
AI Suggestion canonical target:
  targetType
  targetId
  liveVersion
```

CASE09の

```text
targetRequestId
```

は `targetType=COMMUNITY_REQUEST` の場合にのみ使用する**typed projection / reference**とする。

community requestのstatus型とAI Suggestionのstatus型は完全に分離する。

**追加scope制約**

```text
SHARED_REJECT:
  guildId = required
  userId = null

PER_USER_DISMISS:
  guildId = required
  userId = required
```

DBはscopeごとのunique制約とnullabilityを保証する。個人view/dismissはshared lifecycle stateとは別管理。

**失効旧条項：** CASE09のrequest専用target schema化、およびshared stateとpersonal dismissの混在。

---

### A-02 — cohort比較可能性

**変更後**

比較対象は、

```text
same metric
same cohortDefinitionVersion
same campaignClass
same maturityOffset
compatible declared window
```

を満たす比較可能な集団同士とする。

`cohortId` はcurrent/priorで異なってよく、join区間も契約上異なり得る。異なるcohortを同一IDへ書き換えてはならない。

**失効旧条項：** current/priorの同一cohortId・同一join区間を比較可能性の必須条件とする表現。

---

### A-03 — incomplete evaluationとpartial coverage

**変更後**

```text
budget exceeded
deadline exceeded
cancelled
tombstoned
required evaluation incomplete
```

のいずれかで不完了となった評価は、`REVIEW_ONLY` であっても通常Suggestionとしてpublishしない。partial resultは**内部diagnosticのみ**。

一方、COMMで契約上定義された部分coverageを持つ**完了評価**は別扱いとし、そのsummaryは `REVIEW_ONLY` に限定できる。

**失効旧条項：** 不完了evaluationのpartial resultをREVIEW_ONLY Suggestionとしてpublish可能とするV-A記述。

---

### A-04 — Run retention

**変更後**

```text
deleteBy = terminalAt + 7d以内
```

Runはterminal化後7日以内に削除する。`createdAt+7d`で全Runを一律終了させる意味ではない。

backup retentionは7日を維持する。その他の新規保持期間は未承認候補。

**失効旧条項：** Runの7日保持をcreatedAt基準または実行終了期限として解釈する表現。

---

### A-05 — V-A F01 privacy fixture

**変更後**

privacy warningのfixtureは必ず、

```text
reportChannel.expectedPermission = RESTRICTED
reportChannel.actualPermission   = PUBLIC
```

を観測する。

`actualPermission=PUBLIC`だけではprivacy問題を断定しない。

**失効旧条項：** expectedPermissionを欠いたV-A F01。

---

### A-06 — Suggestion scope / unique

**変更後**

```text
SHARED_REJECT:
  unique(guildId, suggestionId, scope)
  userId IS NULL

PER_USER_DISMISS:
  unique(guildId, suggestionId, userId, scope)
  userId IS NOT NULL
```

shared `REJECTED` と個人 `DISMISS` を同一状態として扱わない。

**失効旧条項：** guild/user scopeを区別しないSuggestion rejection/dismissモデル。

---

## B. 既存CASEの枝差分

### CASE01

**変更後field**

```text
expectedAccess
actualAccess
adminFriction
visibilityState = VISIBLE_TO_EXISTING
```

`destinationCount` および未定義の `mandatoryQuestionMax` はpredicateから除外。

**条件：** access期待との差分と、宣言済み `adminFriction` / `VISIBLE_TO_EXISTING` のみで分岐する。

**失効旧条項：** destination数や未定義質問数をmandatory条件・閾値として使う旧枝。

---

### CASE02

**変更後順序**

```text
quiet purpose / explicit no-contact
→ bot-only human gap (botCount=0)
→ next destination
```

optional introの存在だけでは任意投稿への歓迎を抑止しない。

本人のno-contact情報が必要な場合のみ既存Preferenceを参照し、新たな個人追跡fieldを追加しない。

**失効旧条項：** optional introを理由に任意投稿・接触を抑止する旧枝。

---

### CASE03

**変更後ordered branch**

```text
SOLVED
→ NEEDS_DETAILS
→ OUTSIDE_COVERAGE
→ SPECIALIST
→ GENERAL
```

`GENERAL` は `intake=READY` の場合のみ。

source欠落と、正常に観測されたoutcome未確認を別状態として扱う。

**失効旧条項：** source欠落と「正常だがoutcome未確認」を同一unknownとして処理する旧枝。

---

### CASE04

**変更後優先順**

```text
explicit UNCLEAR
→ known missing-detail
→ guide-gap
→ normally observed outcome but unconfirmed → optional confirmation
```

source欠落は `INELIGIBLE`。

**失効旧条項：** source欠落を任意確認へ流す旧枝、および未確認outcomeを異常と断定する旧枝。

---

### CASE10

**変更後**

`protected channel + RESTRICTED` 自体は障害としない。

access reviewは、

```text
expectedAccess != actualAccess
```

の場合だけ候補化する。

`purpose=UNCLASSIFIED` とsource-quality欠測は別field。

取得不能の案内はdiagnosticのみ。投稿数だけで削除・整理を提案しない。

**失効旧条項：** RESTRICTED自体を障害とする条件、および投稿数のみからcleanupを発火する条件。

---

### CASE13

**変更後field**

```text
actionableNoiseMixState:
  MIX_CONFIRMED
  NO_MIX_CONFIRMED
  UNASSESSED
```

restricted triageは `MIX_CONFIRMED` 等の管理者確認を根拠とする。rule ambiguityそのものを根拠にしない。

report本文は読まない。

**失効旧条項：** ruleの曖昧さ・report本文内容をrestricted triage条件にする旧枝。

---

### CASE14

**変更後式**

```text
assignmentConcentrationRatio
=
max(
  open assignments per registered role/duty bucket
)
/
total open assignments across registered role/duty buckets
```

分母0：

```text
UNDEFINED
```

source欠測は別状態。

個人単位の最大割当率・個人ランキングを廃止する。role数またはcoverageが不明でも、人の能力・負荷を推測しない。

**失効旧条項：** 最大個人割当率を使用する旧式。

---

### CASE15

**変更後 B2**

```text
featureSupported
AND reviewed
AND totalReviewed >= config.minN
AND triggeredRuleCount = 1
AND staffFpCount / totalReviewed >= config.fpRateThreshold
```

**変更後 B3**

```text
featureSupported
AND reviewed
AND totalReviewed >= config.minN
AND triggeredRuleCount >= 2
```

不変条件：

```text
triggeredRuleCount == corresponding triggered-rule set count
0 <= staffFpCount <= totalReviewed
totalReviewed = 0 → rate comparison不可
```

`minN=20`、`fpRateThreshold=0.20` は候補値のまま。

NEXUS自身がAutoMod自体を「非学習」と断定する表現は禁止する。

**失効旧条項：** 縦棒・表記欠落によって分母またはAND条件が失われた旧B2/B3、および20/0.20を承認済みbenchmarkとする解釈。

---

### CASE16

**変更後**

```text
platformAlertType = NONE
```

を明示的なno-alert状態として追加。

campaign監視へ入るplatform alertはRAID/SAFETYに限定する。未審査状態は先にrestricted確認へ送る。

優先順：

```text
ACTIVE確認
→ 未審査のrestricted確認
→ RESOLVED + 制限残存 → recovery review
→ campaign monitoring
```

alertの存在だけではincident確定としない。

`F16-04` がcampaign枝へ吸収されないよう、旧枝の意味を独立して維持する。

**失効旧条項：** alert存在だけでincidentを確定する枝、およびF16-04をcampaign監視へ吸収する旧分岐。

---

### CASE18

**変更後field**

```text
essentialInfoTextEquivalentState:
  PRESENT_CONFIRMED
  MISSING_CONFIRMED
  UNASSESSED
```

`descriptionPresence=PRESENT` だけでは内容の同等性を証明しない。

`barrierReport=REPORTED` は装飾画像への冗長追記抑止より優先し、報告対象に限定してreviewする。

**失効旧条項：** descriptionの存在だけでequivalent informationを確認済みとする旧条件。

---

### CASE19

**変更後優先順**

```text
urgentTaskClarity=UNCLEAR_CONFIRMED
→ resource purpose + stable viewing
→ その他
```

閲覧source不存在は「閲覧ゼロ」と同義ではない。

明示されたentry barrier reviewは、それ自体の必要fieldが成立していれば、無関係な閲覧source欠測で抑止しない。

**失効旧条項：** resource維持枝をurgent task clarityより先に評価する順序、および閲覧source欠測を閲覧ゼロへ変換する条件。

---

### CASE20

**変更後forum pilot入口**

```text
channelType = TEXT_CHAT
AND
staffConfirmedBuriedDiscussion =
  MULTIPLE_HELP_BURIED_CONFIRMED
```

既存FORUMについては別途navigation/thread整理review。

```text
OLDER_POST
ARCHIVED
LOCKED
```

のいずれからも `SOLVED` を生成しない。

**失効旧条項：** 既存FORUM自体をpilot入口とする条件、およびold/archived/lockedから解決済みを推定する条件。

---

## C. 文書・runtime契約の正規化

### C-01 — 外部作用のUNKNOWN再送

**変更後**

```text
UNKNOWN同一作用 → 再送禁止
```

旧workerはsend admission時点でfenceする。admission後に応答だけ失われた場合は `UNKNOWN` とする。

cancel競合および未実行scheduleについては、それぞれのmissed/cancel policyを適用し、正常成功へ補正しない。

同一Suggestionからdraft A/B等を経由して同一作用を再予約する迂回も、

```text
same target
+ liveVersion
+ unresolved operation
```

guardで禁止する。

**失効旧条項：** UNKNOWNを単純retry可能なfailureとして扱う例外、およびdraft変更による同一作用再予約。

---

### C-02 — Operator受入ID namespace

**canonical mapping**

```text
A16-OP-01/02
→ A16-OP-BASE-01/02

旧最小UI:
A16-OP-01..07
→ A16-OP-UI-01..07
```

旧IDは出典付きaliasとしてのみ保持し、canonical IDとして新規参照しない。

privacy受入：

```text
A16-DEL-01..08
```

は維持する。

Operator pathの設計上の統一名：

```text
/operator/v1/...
```

実routeの存在・名称は未照合として扱う。

**失効旧条項：** BASE/UIを区別しないA16-OP namespace。

---

### C-03 — 出典・調査状態

20事例の出典確認は別添の20事例調査を根拠とする。

```text
case
公開運用
公式助言
design inference
```

を区別する。

このチャットで再検索していないことと、「資料未確認」という事実を同一視しない。

URLは提示済みcanonical URLを使用し、未確認の編集主体・route・table・公開運用効果を推定しない。

---

# D. Catalog有効化拒否条件

catalogを有効化する前に、以下のいずれかを検出した場合は**有効化拒否**とする。

```text
1. 未定義field / enum
2. 未登録source / target / action
3. 単位違い・unit不一致
4. 前枝に隠れる到達不能leaf
5. unknownNextなし
6. fixtureの期待path不一致
```

V-Aから継承する静的整合性として、さらに

```text
duplicate branchId
DAG違反
schema/type不一致
```

も拒否対象とする。

これらは実行時warningで済ませず、catalog activation gateで停止させる。

この版では、V-Aの曖昧だった箇所を「旧条項 → canonicalな変更後契約」という形に固定し、特に**incomplete evaluationとCOMMのpartial coverage、cohort比較、AI Suggestionのglobal schema、CASE15/16の枝優先順**を分離しています。