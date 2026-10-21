# Normal ChatGPT source copy

Source: https://chatgpt.com/c/6ad081d5-2d78-83e8-ad9d-7ada76ef0fa1
Collected through the answer Copy control: 2026-10-16 04:43 UTC
This source copy preserves formulas whose unescaped table pipes were lost by the page renderer.

## 付録IV-D：実事例13–16

### CASE13 — noisy logに重要対応が埋もれる

**Source:** 公式moderation助言 — [https://discord.com/safety/creating-moderation-team-channels](https://discord.com/safety/creating-moderation-team-channels) [Discord](https://discord.com/safety/creating-moderation-team-channels)  
**Version:** 1.0  
**実装照合:** source adapter / typed editor とも現コード未照合。欠落時は `MISSING/INELIGIBLE` とし、既知入力だけの診断をrestricted audienceへ表示する。

**入力定義:**  
`queueType: enum REPORT|MODERATION_ACTION|AUTOMATION_ALERT|GENERAL_SUPPORT`（認可済みqueue集計）、`visibility: enum PRIVATE_RESTRICTED|STAFF_SHARED|PUBLIC`（permission snapshot）、`actionableCount:uint32` / `noiseCount:uint32`（staff-confirmed集計）、`caseOwnershipState: ASSIGNED|UNASSIGNED|MULTIPLE_OWNERS|CLOSED`、`explicitRuleAmbiguity: CONFIRMED|NONE_CONFIRMED|UNREVIEWED`、`teamOperatingScale: SMALL|STANDARD|LARGE`（管理者選択）、`allowedAudience: ADMIN_ONLY|MOD_ONLY`、`quality` と `observationState: CONFIGURED_REVIEWED|NOT_CONFIGURED|UNREVIEWED`を別fieldで保持。本文・報告者属性は取得しない。

**First-match branches**

| ID | Predicate | action / target / owner / review |
|---|---|---|
| C13-B1 | `visibility=PUBLIC AND queueType=REPORT` | `REVIEW_ONLY_REPORT_PRIVACY_SCOPE` / report queue / privacy-safety owner / 公開範囲を先に確認 |
| C13-B2 | `visibility=PRIVATE_RESTRICTED AND queueType=MODERATION_ACTION AND actionableCount>0 AND explicitRuleAmbiguity=CONFIRMED AND caseOwnershipState=ASSIGNED` | `REVIEW_ONLY_RESTRICTED_TRIAGE` / private moderation queue / moderation lead / criticalでなく「確認済みactionable」としてtriage |
| C13-B3 | `actionableCount>0 AND caseOwnershipState IN {UNASSIGNED,MULTIPLE_OWNERS}` | `REVIEW_ONLY_OWNERSHIP_HANDOFF` / queue ownership / moderation lead / owner/handoffを確認 |
| C13-B4 | `visibility=PRIVATE_RESTRICTED AND queueType=MODERATION_ACTION AND teamOperatingScale=SMALL AND caseOwnershipState=ASSIGNED AND explicitRuleAmbiguity=NONE_CONFIRMED` | `REVIEW_ONLY_SINGLE_QUEUE` / moderation queue / moderation lead / 不要な階層追加を避ける |

各predicateの必須入力がUNKNOWNなら後続枝へ進まず、その枝を `INELIGIBLE` として必要fieldだけ診断。全入力が既知で4枝不成立なら `NO_FIRE`。出力はrestricted audienceのみ。

**Baseline B13:** `asOf=2026-10-15T12:00:00Z`、`queueType=MODERATION_ACTION, visibility=PRIVATE_RESTRICTED, actionableCount=4, noiseCount=6, caseOwnershipState=ASSIGNED, explicitRuleAmbiguity=NONE_CONFIRMED, teamOperatingScale=STANDARD, allowedAudience=MOD_ONLY, quality=SUFFICIENT, observationState=CONFIGURED_REVIEWED`。

| Fixture | B13との差分 | 期待 |
|---|---|---|
| F13-01 | `queueType=REPORT, visibility=PUBLIC` | C13-B1 / `REVIEW_ONLY_REPORT_PRIVACY_SCOPE` |
| F13-02 | `explicitRuleAmbiguity=CONFIRMED` | C13-B2 / `REVIEW_ONLY_RESTRICTED_TRIAGE` |
| F13-03 | `caseOwnershipState=UNASSIGNED` | C13-B3 / `REVIEW_ONLY_OWNERSHIP_HANDOFF` |
| F13-04 | `teamOperatingScale=SMALL` | C13-B4 / `REVIEW_ONLY_SINGLE_QUEUE` |

**自然文例**
- 「報告系の情報が広い閲覧範囲に置かれているため、まず担当者向けの閲覧範囲を確認するのが先です。」
- 「対応対象と判断された項目に担当者の重複があるため、ルール変更より先に担当と引き継ぎ先を整理する案です。」

---

### CASE14 — 少数volunteerに依存

**Source:** 公式moderation助言 — [https://discord.com/safety/understanding-and-avoiding-moderator-burnout](https://discord.com/safety/understanding-and-avoiding-moderator-burnout) [Discord](https://discord.com/safety/understanding-and-avoiding-moderator-burnout)  
**Version:** 1.0  
**実装照合:** adapter/editor未照合。健康状態・オンライン時間・個人評価は入力しない。

**入力定義:**  
`availabilityState: AVAILABLE|REDUCED|PAUSED|UNKNOWN`（本人が明示したavailability/rota）、`coverageAdjustmentRequest: NONE|REQUESTED|UNREVIEWED`（staff入力）、`queueLoadCount:uint32`、`oldestOpenQueueAgeMinutes:uint32`（認可済みaggregate）、`assignmentConcentrationRatio: decimal[0,1] = 最大担当者への割当件数/全割当件数`、`responsibilityClarity: CLEAR|UNCLEAR|UNREVIEWED`、`quality`、`observationState`。候補configは `queueAgeThresholdMinutes=120`（30–1440、分）、`assignmentConcentrationThreshold=0.80`（0.50–1.00、比率）；いずれも未検証・承認待ち。

**First-match branches**

| ID | Predicate | action / target / owner / review |
|---|---|---|
| C14-B1 | `availabilityState=PAUSED OR coverageAdjustmentRequest=REQUESTED` | `REVIEW_ONLY_COVERAGE_HANDOFF` / rota / moderation lead / 対象を期待coverageから外す案 |
| C14-B2 | `availabilityState=REDUCED AND queueLoadCount>0 AND oldestOpenQueueAgeMinutes>=120` | `REVIEW_ONLY_LOAD_REBALANCE` / moderation queue / moderation lead / 再配分または範囲縮小 |
| C14-B3 | `assignmentConcentrationRatio>=0.80 AND queueLoadCount>0` | `REVIEW_ONLY_BACKUP_COVERAGE` / assignment map / moderation lead / backup担当確認 |
| C14-B4 | `responsibilityClarity=UNCLEAR` | `REVIEW_ONLY_RESPONSIBILITY_CLARIFY` / staff responsibility / administrator / 責務整理 |

B1のavailability/requestがUNKNOWNならB2以降へ代替解釈せず `INELIGIBLE`。B2/B3の数値入力がUNKNOWNでも同様。thresholdは候補値であり、個人の能力・健康状態を意味しない。

**Baseline B14:** `asOf=2026-10-15T12:00:00Z`、`availabilityState=AVAILABLE, coverageAdjustmentRequest=NONE, queueLoadCount=12, oldestOpenQueueAgeMinutes=45, assignmentConcentrationRatio=0.50, responsibilityClarity=CLEAR, quality=SUFFICIENT, observationState=CONFIGURED_REVIEWED`。

| Fixture | B14との差分 | 期待 |
|---|---|---|
| F14-01 | `availabilityState=PAUSED` | C14-B1 / `REVIEW_ONLY_COVERAGE_HANDOFF` |
| F14-02 | `availabilityState=REDUCED, oldestOpenQueueAgeMinutes=120` | C14-B2 / `REVIEW_ONLY_LOAD_REBALANCE` |
| F14-03 | `assignmentConcentrationRatio=0.80` | C14-B3 / `REVIEW_ONLY_BACKUP_COVERAGE` |
| F14-04 | `responsibilityClarity=UNCLEAR` | C14-B4 / `REVIEW_ONLY_RESPONSIBILITY_CLARIFY` |

**自然文例**
- 「休止が明示されている担当者を現在のcoverage前提から外し、別担当への引き継ぎを確認する案です。」
- 「担当割当の最大比率が候補境界0.80に達しているため、担当者を増やすことを前提にせずbackup体制を確認します。」

---

### CASE15 — filter falsepositive

**Source:** 公式product docs — [https://support.discord.com/hc/en-us/articles/4421269296535-AutoMod-FAQ](https://support.discord.com/hc/en-us/articles/4421269296535-AutoMod-FAQ) [Discord サポート](https://support.discord.com/hc/en-us/articles/4421269296535-AutoMod-FAQ)  
**Version:** 1.0  
**実装照合:** AutoMod adapter / typed editor未照合。NEXUS自身が本文を保存・学習する前提にはしない。

**入力定義:**  
`ruleId:string`、`ruleVersion:uint32`、`staffFpCount:uint32`、`totalReviewed:uint32`（同一review集合）、`fpRate=staffFpCount/totalReviewed`（分母0なら未定義）、`triggeredRuleIds:set<string>`、`configuredLanguage:string`、`featureSupportCheck: CONFIRMED_SUPPORTED|CONFIRMED_UNSUPPORTED|NOT_REVIEWED`、`reviewState: REVIEWED|UNREVIEWED`、`quality`、`observationState`。候補configは `minReviewedN=20`（5–200、件）、`fpRateThreshold=0.20`（0–1、比率）；未検証・承認待ち。

**First-match branches**

| ID | Predicate | action / target / owner / review |
|---|---|---|
| C15-B1 | `featureSupportCheck=CONFIRMED_UNSUPPORTED` | `REVIEW_ONLY_FEATURE_COMPATIBILITY` / rule / moderation administrator / 機能適合性確認 |
| C15-B2 | `featureSupportCheck=CONFIRMED_SUPPORTED AND reviewState=REVIEWED AND totalReviewed>=20 AND |triggeredRuleIds|=1 AND fpRate>=0.20` | `REVIEW_ONLY_NARROW_MATCHING` / ruleId / moderation administrator / matching/exemption条件を確認 |
| C15-B3 | `featureSupportCheck=CONFIRMED_SUPPORTED AND reviewState=REVIEWED AND totalReviewed>=20 AND |triggeredRuleIds|>=2` | `REVIEW_ONLY_TRIGGER_BREAKDOWN` / rule set / moderation lead / 実trigger別に確認 |
| C15-B4 | `featureSupportCheck=NOT_REVIEWED OR reviewState=UNREVIEWED OR totalReviewed<20` | `REVIEW_ONLY_REVIEW_DATA_GAP` / rule review / moderation lead / 正誤を断定せず追加確認 |

`quality!=SUFFICIENT` はfalseとして扱わず `INELIGIBLE`。B4の不足をB2/B3へ昇格させない。FP率は統計的confidenceではない。

**Baseline B15:** `asOf=2026-10-15T12:00:00Z`、`ruleId=R17, ruleVersion=3, staffFpCount=5, totalReviewed=30, fpRate=0.166666..., triggeredRuleIds={R17}, configuredLanguage=en, featureSupportCheck=CONFIRMED_SUPPORTED, reviewState=REVIEWED, quality=SUFFICIENT, observationState=CONFIGURED_REVIEWED`。

| Fixture | B15との差分 | 期待 |
|---|---|---|
| F15-01 | `featureSupportCheck=CONFIRMED_UNSUPPORTED` | C15-B1 / `REVIEW_ONLY_FEATURE_COMPATIBILITY` |
| F15-02 | `staffFpCount=6, totalReviewed=30, fpRate=0.20` | C15-B2 / `REVIEW_ONLY_NARROW_MATCHING` |
| F15-03 | `triggeredRuleIds={R17,R21}` | C15-B3 / `REVIEW_ONLY_TRIGGER_BREAKDOWN` |
| F15-04 | `totalReviewed=10` | C15-B4 / `REVIEW_ONLY_REVIEW_DATA_GAP` |

**自然文例**
- 「確認済みのreview集合ではこのruleのfalse positive率が候補境界0.20に達しているため、全体無効化ではなくmatching条件を確認する案です。」
- 「設定と機能対応の確認が済んでいないため、誤判定とは断定せず、まず対応条件を確認する案に留めます。」

---

### CASE16 — join burst：campaignかincidentか

**Source:** 公式safety guide — [https://support.discord.com/hc/en-us/articles/10989121220631-How-to-Protect-Your-Server-from-Raids-101](https://support.discord.com/hc/en-us/articles/10989121220631-How-to-Protect-Your-Server-from-Raids-101) [Discord サポート](https://support.discord.com/hc/en-us/articles/10989121220631-How-to-Protect-Your-Server-from-Raids-101)  
**Version:** 1.0  
**実装照合:** join-rate adapter / security editor未照合。join数だけでincidentを確定しない。

**入力定義:**  
`joinRate: decimal[users/hour]`（認可済みaggregate）、`plannedCampaign: PLANNED|NOT_PLANNED|UNKNOWN`（管理者入力）、`staffConfirmedIncident: ACTIVE|RESOLVED|NONE_CONFIRMED|UNREVIEWED`、`confirmedDisruption: CONFIRMED|NONE_CONFIRMED|UNKNOWN`、`platformAlertType: NONE|RAID_ALERT|SAFETY_ALERT|UNKNOWN`、`temporaryRestrictionState: NONE|ACTIVE|UNKNOWN`、`incidentResolvedAt: timestamp|null`、`quality`、`observationState`。普遍join-rate thresholdは設定しない。

**First-match branches**

| ID | Predicate | action / target / owner / review |
|---|---|---|
| C16-B1 | `staffConfirmedIncident=ACTIVE` | `REVIEW_ONLY_RESTRICTED_INCIDENT` / guild security scope / security administrator / incident対応を優先 |
| C16-B2 | `staffConfirmedIncident=RESOLVED AND temporaryRestrictionState=ACTIVE AND incidentResolvedAt!=null` | `REVIEW_ONLY_RESTRICTION_RECOVERY` / guild security scope / security administrator / 復旧条件確認 |
| C16-B3 | `plannedCampaign=PLANNED AND staffConfirmedIncident=NONE_CONFIRMED AND confirmedDisruption=NONE_CONFIRMED` | `REVIEW_ONLY_CAMPAIGN_CAPACITY` / campaign context / community operator / 容量観測のみ |
| C16-B4 | `platformAlertType=RAID_ALERT AND staffConfirmedIncident=NONE_CONFIRMED` | `REVIEW_ONLY_INCIDENT_CONFIRMATION` / restricted safety view / security administrator / alertだけではincident確定しない |

B1/B2/B3/B4の必須入力がUNKNOWNなら、その値をfalseとして別枝へ進めず `INELIGIBLE`＋必要field diagnostic。特にTunnel停止・本文・avatar・言語・年齢等からincidentを補完しない。

**Baseline B16:** `asOf=2026-10-15T12:00:00Z`、`joinRate=18 users/hour, plannedCampaign=PLANNED, staffConfirmedIncident=NONE_CONFIRMED, confirmedDisruption=NONE_CONFIRMED, platformAlertType=NONE, temporaryRestrictionState=NONE, incidentResolvedAt=null, quality=SUFFICIENT, observationState=CONFIGURED_REVIEWED`。

| Fixture | B16との差分 | 期待 |
|---|---|---|
| F16-01 | `staffConfirmedIncident=ACTIVE` | C16-B1 / `REVIEW_ONLY_RESTRICTED_INCIDENT` |
| F16-02 | `staffConfirmedIncident=RESOLVED, temporaryRestrictionState=ACTIVE, incidentResolvedAt=2026-10-15T10:00:00Z` | C16-B2 / `REVIEW_ONLY_RESTRICTION_RECOVERY` |
| F16-03 | `plannedCampaign=PLANNED, confirmedDisruption=NONE_CONFIRMED` | C16-B3 / `REVIEW_ONLY_CAMPAIGN_CAPACITY` |
| F16-04 | `platformAlertType=RAID_ALERT` | C16-B4 / `REVIEW_ONLY_INCIDENT_CONFIRMATION` |

**自然文例**
- 「運営側でACTIVE incidentが確認されているため、通常の成長施策ではなく限定された担当者向けの対応確認を先にします。」
- 「予定されたcampaignと一致し、disruptionは確認されていないため、join増加だけをincidentとは扱わず容量観測に留めます。」

**全case共通の出力境界:** 4 caseとも初期actionは `REVIEW_ONLY`。incident/report等の個別情報は専用restricted audienceだけに提示し、一般engagement画面には出さない。typed editorが現コードに存在すると未確認のものは `CREATE_DRAFT` にせず、必要なら `REVIEW_ONLY` のみとする。fixtureはすべて**合成入力による設計例であり、実測値・実行済みテスト結果ではない**。