Source: https://chatgpt.com/c/6ad1abf0-d13c-83ee-a484-307ae6b5e52b
Collected via answer Copy control: 2026-10-16 06:16 UTC
Reasoning: 極高. Design only; no implementation or testing. Apply latest user decisions and integration corrections where this answer conflicts.

# VI確定差分

## 1. 計画順序・依存・Gate境界

**判定：17作業の順序変更は不要。致命的な抜けはない。**  
ただし、以下を各完了条件へ追加して確定する。

- **N16-00**：alpha15報告は過去の証跡、現baselineは別物として扱う。`192 / 188完了・3部分・1未実行`を現在完了とは解釈せず、3部分・1未実行を原IDで特定する。
- **N16-05/06/11/14**：UNKNOWN後のtarget-side safety state、単一lock order、Run削除後のApply防止を必須契約として組み込む。
- **N16-08/09**：enqueue transactionで封印した`evaluationAsOf`と入力版集合を決定論の正本とする。
- **N16-14 → G4**：canonical contract freezeを追加。G4後のN16-15は原則「実装上の不具合修正」に限定し、型・状態・lock order・retention・action意味等の契約変更が発生した場合はN16-14へ戻し、影響範囲を再確定する。
- **G2**：正式なscopeは本資料では定義・再定義しない。現コード/DBのroute・table・source・target・action・writer/reader等は`未照合`として明示し、照合完了前は有効化しない。`CODE_SCHEMA`側の照合と`ENVIRONMENT`側の照合を混同しない。
- **alpha17**：Windows実PC、Node/Next/API/Worker/Scheduler、DNS/Tunnel、秘密値、実外部接続、お名前.com公開能力、期限強制、backup/restore、負荷・実環境受入を閉じる。新規外部サービスを追加しない。
- **N16-07の全機能対応表**は削除・縮小せず、各行に既存実装へのmapping状態を付与する。現物未確認は未確認のまま扱う。

---

## 2. CASE02の訂正固定

**正本field**

```text
welcome.botReplyCount
welcome.humanStaffReplyCount
```

coverageは宣言済みenumを使用し、未知sourceは`unknownNext`へ送る。

**ordered first-match**

```text
quiet purpose
OR explicit no-contact
→ pressure抑止

coverage = OUT
→ 次のcoverage判断

coverage = IN
AND humanStaffReplyCount = 0
AND botReplyCount > 0
→ BOT_ONLY

coverage = IN
AND humanStaffReplyCount = 0
AND botReplyCount = 0
→ GENERAL_HUMAN_GAP

coverage = IN
AND humanStaffReplyCount > 0
→ next destination
```

`optional intro`単独では抑止条件にしない。  
V-Bの`botCount=0`によるBOT_ONLY記述は失効。

枝のactionIdは既登録済みとは断定せず、catalog照合対象。未登録ならその枝は`DISABLED`。

**Fixture F02 — BOT_ONLY**

```text
quiet purpose = false
no-contact = false
coverage = IN
botReplyCount = 2
humanStaffReplyCount = 0
```

期待path：

```text
BOT_ONLY
```

**Fixture F03 — GENERAL_HUMAN_GAP**

```text
quiet purpose = false
no-contact = false
coverage = IN
botReplyCount = 0
humanStaffReplyCount = 0
```

期待path：

```text
GENERAL_HUMAN_GAP
```

---

## 3. evaluationAsOfの固定位置

旧V-Aの「最初のserver評価時」表現を失効し、以下へ置換。

**固定点**

```text
first accepted enqueue transaction
```

このtransaction内でserver側が`evaluationAsOf`を生成し、以下を同時にsealed状態へ固定する。

```text
evaluationAsOf
job/dedupe identity
input hash
SEALED Fact observation ID + version 集合
source-health observation ID + version 集合
period_role
window
rule version
config version
engine version
catalog version
schema version
branch version
action version
explanation version
```

同一enqueueのretry / resume / reclaimでは、これらを一切再生成・更新しない。

`current/prior` Factはperiod keyで共存させ、現在値を後からpriorへ読み替えない。

**Fixture F04 — enqueue sealing**

```text
enqueue transaction A:
  evaluationAsOf = T0
  Fact/source-health refs = S0
  inputHash = H0

retry transaction B:
  evaluationAsOf = T0
  Fact/source-health refs = S0
  inputHash = H0
```

期待：

```text
Bは新しいAsOf/snapshotを作らない。
AとBは同一sealed inputとして扱う。
```

---

## 4. 単一lock order・token分離

### 採用方式

**PostgreSQLを唯一のtransaction/lock正本とし、row-level lock + unique constraint + CASを使用する。**  
Redisは搬送/cache用途に限定し、安全状態・lock・Apply権限の正本にはしない。

### Global lock order

scopeを複数取得する処理は、まず全scopeをcanonicalな`scopeLockKey`順に取得する。同一resource rank内もcanonical key順とし、後から下位rankのlockを取得しない。

```text
scope locks
→ tombstone
→ deletion job
→ target safety / live resource
→ Run
→ Step
→ Intent
→ Attempt
→ Lease
→ operation guard
→ Suggestion
→ Draft / Link
→ Evidence / History
→ Evaluation
→ Fact
```

この順序を全横断処理の唯一のlock orderとする。以前の異なるsend-prep orderingは失効。

- tombstone/guard等の**存在しないrowの作成競合**は、check-then-insertを行わず、canonical unique keyによるcreate-if-absent後にlockする。
- transaction開始後に新しいscope/resourceが必要になった場合は、そのtransaction内で逆順lockを取得せず、DB変更を中断してlock setを再構成する。
- snapshot/delete競合では、tombstoneを先に判定・lockする。tombstone成立後は新規evaluation/applyを開始しない。
- tombstone成立前にsealedされたevaluationは、その後tombstoneが成立した時点で`apply不可`となり、古いsnapshotを根拠に公開・適用しない。
- Apply直前には、tombstone、target/liveVersion、target safety epoch、Suggestion/Draft version、permission、approval、guardを同一transactionで再確認する。
- DB transaction中にDiscord/Stripe等の外部通信を行わない。
- Outboxはdomain lockの独立rankを持たず、必要なDB状態と同一transactionでcommitする。commit後にWorkerが外部通信する。
- **admission DB commitがlinearization point**。commit前のcancel/lease失効は送信不可、commit後の応答喪失はUNKNOWN。
- 外部応答UNKNOWNをDB retryやqueue retryによって再送へ変換しない。DB transactionの再試行と外部作用の再試行を別物とする。

### 3種のtoken/receipt

| 要素 | 最小目的 | 正本的意味 | 禁止用途 |
|---|---|---|---|
| **Idempotency-Key** | 通信retryの同一操作照合 | 同一通信要求・operation fingerprintの再照合 | 権限付与、UNKNOWN解除、新intent化 |
| **server operation token** | 承認済み操作のadmission束縛 | `targetType/targetId/liveVersion`、action、Suggestion/Draft版・hash、approval、safetyEpoch、期限等へ束縛 | 別target/actionへの流用、期限切れ後の実行、UNKNOWN解除 |
| **deletion receipt** | 削除処理statusの通知 | `deletionStatus`のみ | 外部作用成功証明、認可、idempotency、UNKNOWN解除 |

tokenの期限切れ・消失は新intentを生成しない。  
deletion receiptも新intentを生成しない。

**Fixture F05 — deletion/apply race**

同一scope・同一target/liveVersionについて、削除とApplyを同時要求する。

期待：

```text
両方とも同一global lock orderを使用する。
tombstone成立側が先ならApplyは拒否。
Apply admissionが先にcommitした場合、削除はそれを遡及取消しない。
外部通信はcommit後のみ。
その後の応答喪失はUNKNOWN。
UNKNOWNを理由に別Suggestion/Draftを再予約しない。
```

いずれの順序でもdeadlockを前提とせず、外部通信中にDB lockを保持しない。

---

## 5. UNKNOWN terminal後のRun削除と迂回Apply防止

### 推奨方式：target-side safety state + lifecycle guardの二層化

Run/operation lifecycle側の`unresolved-operation guard`と、Run削除後も対象live root側に残る最小安全状態を分離する。

**target-side safety stateの正本field**

```text
targetType
targetId
liveVersion
safetyEpoch
applyGate
```

`applyGate`は少なくとも、

```text
OPEN
UNKNOWN_BLOCKED
```

を区別する。

### UNKNOWN terminalization

Runを`UNKNOWN`として終端するtransactionでは、対象targetごとの安全状態を先に確保し、

```text
target safety = UNKNOWN_BLOCKED
safetyEpoch = new epoch
```

を永続化したうえで、同一transaction内でRun terminalizationを確定する。

安全状態を確保できない場合、UNKNOWN terminalを成立させず、該当作用はnon-actionableのままにする。

### Run削除後

```text
terminalAt + 7日以内
→ Run最小状態を削除
```

この削除対象に、

- Run payload
- Run result
- Run IDの別table複製
- evidenceの複製
- operation履歴の複製による保持延長

を含め、7日を迂回する保存を行わない。

一方、target-side safety stateはRun由来payloadではなく、対象live rootの安全制御状態として独立する。

この保持classを**`TARGET_LIVE_SAFETY`という設計上の独立class**として扱う。具体的な保持期間は未承認であり、無期限tombstoneを承認したものではない。

### 安全状態の欠落・期限切れ

```text
safety state absent
OR safety state expired
→ fail closed
→ Apply不可
```

欠落・期限切れを`OPEN`、`SUCCESS`、`NO_EFFECT`へ変換しない。

### 新Suggestion/Draftの迂回

`UNKNOWN_BLOCKED`中は、同一`targetType + targetId + liveVersion`への自動Suggestion公開・CREATE_DRAFT・Applyを安全側で抑止する。既に存在するSuggestion/DraftについてもApply時に再検査し拒否する。

したがって、

```text
old UNKNOWN
→ Run削除
→ 新Suggestion
→ 新Draft
→ 同じliveVersionへApply
```

という迂回を成立させない。

### 明示的新intent

人が明示的に新しい操作を開始する場合は、旧UNKNOWNを消去・再利用しない。

必要条件：

```text
authoritative current-state reconcile
→ current permission recheck
→ risk review
→ new approval
→ new Intent
→ new liveVersion / safety state
```

reconcile不能ならApply不可。

新liveVersionの生成はこの新しい人間のintentだけが行える。旧UNKNOWN、旧token、旧Suggestion、保持期限到来そのものから新liveVersionを自動生成しない。

**Fixture F06 — UNKNOWN cleanup / new intent**

```text
Run = terminal UNKNOWN
targetType = X
targetId = Y
liveVersion = V1
safetyEpoch = E1
applyGate = UNKNOWN_BLOCKED
```

その後Runが7日以内に削除されても、

```text
new Suggestion(target=Y, liveVersion=V1)
→ non-actionable / Apply拒否
```

とする。

その後、人が明示的に新intentを開始し、

```text
authoritative reconcile = sufficient
current permission = valid
risk review = completed
new approval = valid
```

を満たした場合のみ、

```text
new liveVersion = V2
new safety state
```

を作成して新操作へ進む。V1のUNKNOWNは成功にも無効果にも書き換えない。

---

# 利用者に残す実質判断を最大3束

### 1. target-side safety stateの採用

**推奨：採用。**

`targetType / targetId / liveVersion / safetyEpoch / applyGate`を最小状態としてRun lifecycleから分離し、Run削除後も同一liveVersionへの迂回Applyを防ぐ。

ただし`TARGET_LIVE_SAFETY`の具体的保持期間は未承認。承認されるまでは、期限切れ・欠落をfail closedとして扱う。

### 2. PostgreSQL単一lock方式

**推奨：採用。**

PostgreSQLを唯一のtransaction/lock正本とし、

```text
scope
→ tombstone
→ deletion job
→ target safety/live
→ Run
→ Step
→ Intent
→ Attempt
→ Lease
→ guard
→ Suggestion
→ Draft/Link
→ Evidence/History
→ Evaluation
→ Fact
```

をalpha16のcanonical lock orderとして固定する。Redisに安全正本を分散させない。

### 3. G2 / alpha17の境界

**推奨：現在の境界を維持。**

G2の正式な意味は本資料で再定義しない。route/table/source/target/actionや現コードmappingは照合されるまで未確認扱いとし、実在を推測しない。

alpha16では**設計・構造・機能契約・実装・G4まで**を閉じ、alpha17で**実Windows PC・Tunnel/DNS・常駐・秘密値・実外部接続・公開能力・retention enforcement・backup/restore・実環境受入**を閉じる。

このため、本付録をもって大型更新の実装開始・migration適用・設定変更・試験実施を承認したものとは扱わない。