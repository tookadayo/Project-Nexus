Source: https://chatgpt.com/c/6ad1abf0-d13c-83ee-a484-307ae6b5e52b
Collected via answer Copy control: 2026-10-16 05:17 UTC
Reasoning: 極高. Design only. Integration review pending.

# 付録IV-E：実事例17–20

## CASE17 — Transparency / Privacy

**source URL**  
[Discord Safety — Confidentiality in moderation](https://discord.com/safety/confidentiality-in-moderation?utm_source=chatgpt.com)  
※提示URL・編集主体は未照合。

**Typed入力**

| field | type / enum | 由来 |
|---|---|---|
| `reportChannel.expectedPermission` | enum `{RESTRICTED, PUBLIC, NOT_CONFIGURED, UNASSESSED}` | guild/operator設定 |
| `reportChannel.actualPermission` | enum `{RESTRICTED, PUBLIC, UNASSESSED}` | permission観測 |
| `staffConfirmedRedactionReview` | enum `{PUBLIC_SUMMARY_PII_CONFIRMED, BROAD_LOG_SENSITIVE_DATA_CONFIRMED, NO_PRIVACY_FINDING_CONFIRMED, UNASSESSED}` | 権限者による構造化確認。報告本文・告発者属性は入力しない |
| `retentionConfiguration.logScope` | enum `{CASE_RESTRICTED, BROAD_LOG, NOT_CONFIGURED, UNASSESSED}` | retention設定の観測 |
| `aggregateCaseStatus` | enum `{OPEN, RESOLVED, UNASSESSED}` | 許可されたaggregate case statusのみ |
| `quality.*` | enum `{SUFFICIENT, PARTIAL, STALE, MISSING, SUPPRESSED, UNKNOWN}` | source-health。業務値のenumとは別field |

**Ordered first-match**

| 枝 | 正確条件 | actionId / target / owner / review |
|---|---|---|
| B1 | `expectedPermission=RESTRICTED AND actualPermission=PUBLIC` | restricted path review → `CASE17-B1` / `reportChannel` / `GUILD_ADMIN` / `REVIEW_ONLY` |
| B2 | `staffConfirmedRedactionReview=PUBLIC_SUMMARY_PII_CONFIRMED` | redaction review → `CASE17-B2` / `publicSummary` / `Privacy Admin/Owner` / `REVIEW_ONLY` |
| B3 | `retentionConfiguration.logScope=BROAD_LOG AND staffConfirmedRedactionReview=BROAD_LOG_SENSITIVE_DATA_CONFIRMED` | privacy deletion review → `CASE17-B3` / `retentionLog` / `Privacy Admin/Owner` / `REVIEW_ONLY` |
| B4 | `expectedPermission=PUBLIC AND actualPermission=PUBLIC AND staffConfirmedRedactionReview=NO_PRIVACY_FINDING_CONFIRMED AND retentionConfiguration.logScope=CASE_RESTRICTED` | public route維持 review → `CASE17-B4` / `publicFeedbackRoute` / `Community Manager` / `REVIEW_ONLY` |

**unknown時**  
必要fieldが `Value<T>=Unknown/Missing/Failed` → `INELIGIBLE/INPUT_UNKNOWN`、後続枝へ進めない。`quality≠SUFFICIENT` も通常判定せず `INELIGIBLE/INPUT_QUALITY`。`UNASSESSED` / `NOT_CONFIGURED` は正常観測値として保持し、確認済み状態へ補完しない。

**表示範囲**  
case情報・個別report情報は専用権限のrestricted audienceのみ。一般engagement画面には出さない。

### 完全baseline

```text
reportChannel.expectedPermission = RESTRICTED
reportChannel.actualPermission = RESTRICTED
staffConfirmedRedactionReview = NO_PRIVACY_FINDING_CONFIRMED
retentionConfiguration.logScope = CASE_RESTRICTED
aggregateCaseStatus = OPEN
quality.* = SUFFICIENT
```

### 枝fixture

- `IV-E17-F01` → Δ `reportChannel.actualPermission=PUBLIC` → **B1**
- `IV-E17-F02` → Δ `staffConfirmedRedactionReview=PUBLIC_SUMMARY_PII_CONFIRMED` → **B2**
- `IV-E17-F03` → Δ `retentionConfiguration.logScope=BROAD_LOG`、`staffConfirmedRedactionReview=BROAD_LOG_SENSITIVE_DATA_CONFIRMED` → **B3**
- `IV-E17-F04` → Δ `reportChannel.expectedPermission=PUBLIC`、`reportChannel.actualPermission=PUBLIC` → **B4**

### 自然文例

1. 「報告先は限定公開を想定していますが、現在は公開範囲になっています。私的な報告が露出しない経路へ戻す案を運営担当者が確認してください。」
2. 「公開サマリーに個人情報が含まれることを権限者が確認しています。公開前に伏字・削除の対象を確認してください。」

---

## CASE18 — Image-only / Voice-only Barriers

**source URL**  
[Discord Support — Upload images and GIFs](https://support.discord.com/hc/en-us/articles/211866427-How-do-I-upload-images-and-GIFs?utm_source=chatgpt.com)  
[Discord Blog — Improving App Accessibility](https://discord.com/blog/improving-app-accessibility-a11y-updates?utm_source=chatgpt.com)  
※提示URL・編集主体は未照合。

**Typed入力**

| field | type / enum | 由来 |
|---|---|---|
| `contentChecklist` | enum `{IMPORTANT_IMAGE, VOICE_EVENT, DECORATIVE_IMAGE, OTHER, UNASSESSED}` | 管理者content checklist |
| `descriptionPresence` | enum `{PRESENT, ABSENT, UNASSESSED}` | 利用可能なdescriptionの有無。OCRは行わない |
| `textCompanion` | enum `{PRESENT, ABSENT, EQUIVALENT_ADJACENT, UNASSESSED}` | 構造化されたtext companion確認 |
| `barrierReport` | enum `{REPORTED, NONE_REPORTED, UNASSESSED}` | 任意の構造化barrier report |
| `quality.*` | enum `{SUFFICIENT, PARTIAL, STALE, MISSING, SUPPRESSED, UNKNOWN}` | source-health。業務値とは別field |

**Ordered first-match**

| 枝 | 正確条件 | actionId / target / owner / review |
|---|---|---|
| B1 | `contentChecklist=IMPORTANT_IMAGE AND descriptionPresence=ABSENT AND textCompanion=ABSENT` | equivalent text案 → `CASE18-B1` / `contentItem` / `Community Manager` / `REVIEW_ONLY` |
| B2 | `contentChecklist=VOICE_EVENT AND textCompanion=ABSENT` | text companion / facilitator案 → `CASE18-B2` / `voiceEvent` / `Event Owner` / `REVIEW_ONLY` |
| B3 | `contentChecklist=DECORATIVE_IMAGE AND textCompanion=EQUIVALENT_ADJACENT` | 冗長な追加を行わない確認 → `CASE18-B3` / `contentItem` / `Community Manager` / `REVIEW_ONLY` |
| B4 | `barrierReport=REPORTED` | accessibility review → `CASE18-B4` / `barrierReport` / `Community Manager` / `REVIEW_ONLY` |

**unknown時**  
必要fieldが `Value<T>=Unknown/Missing/Failed` → `INELIGIBLE/INPUT_UNKNOWN`、後続枝へ進めない。`quality≠SUFFICIENT` は `INELIGIBLE/INPUT_QUALITY`。`UNASSESSED` は正常観測された未審査状態として保持し、障害の有無を推定しない。

**入力禁止境界**  
本文OCR、voice録音・文字起こし、本人の障害・identity推定は行わない。barrier reportに含まれる本人情報も一般表示へ出さない。

### 完全baseline

```text
contentChecklist = OTHER
descriptionPresence = PRESENT
textCompanion = PRESENT
barrierReport = NONE_REPORTED
quality.* = SUFFICIENT
```

### 枝fixture

- `IV-E18-F01` → Δ `contentChecklist=IMPORTANT_IMAGE`、`descriptionPresence=ABSENT`、`textCompanion=ABSENT` → **B1**
- `IV-E18-F02` → Δ `contentChecklist=VOICE_EVENT`、`textCompanion=ABSENT` → **B2**
- `IV-E18-F03` → Δ `contentChecklist=DECORATIVE_IMAGE`、`textCompanion=EQUIVALENT_ADJACENT` → **B3**
- `IV-E18-F04` → Δ `barrierReport=REPORTED` → **B4**

### 自然文例

1. 「重要な内容が画像だけで、説明文とテキストによる補足も確認できません。要点をテキストでも読める形にする案を確認してください。」
2. 「音声イベントに対応するテキスト経路がありません。要点を追える補足方法を用意する案を担当者が確認してください。」

---

## CASE19 — Quiet Reader Community

**source URL**  
[Discord Blog — Fostering a Thriving, Partner-Worthy Community](https://discord.com/blog/fostering-a-thriving-partner-worthy-community-on-discord?utm_source=chatgpt.com)  
※提示URL・編集主体は未照合。歴史的助言であり、genericな数値基準には転用しない。

**Typed入力**

| field | type / enum | 由来 |
|---|---|---|
| `adminPurpose` | enum `{RESOURCE, SOCIAL, MIXED, UNASSESSED}` | 管理者が明示した用途 |
| `authorizedAggregateViewing.provided` | enum `{PROVIDED, NOT_PROVIDED, UNASSESSED}` | 許可されたaggregate閲覧の実提供状態 |
| `authorizedAggregateViewing.stabilityReview` | enum `{STABLE_CONFIRMED, NOT_STABLE_CONFIRMED, UNASSESSED}` | 管理者が確認した実際の閲覧状態 |
| `authorizedAggregateViewing.sourceAvailable` | boolean | 閲覧を示す許可済みaggregate sourceの有無 |
| `postingAggregate` | enum `{OBSERVED, NOT_AVAILABLE, UNASSESSED}` | 許可された投稿集計 |
| `optionalFeedback` | enum `{RECEIVED, NONE_REPORTED, UNASSESSED}` | 任意feedbackの構造化状態。本文は扱わない |
| `entryBarrierReview` | enum `{BARRIER_CONFIRMED, NO_BARRIER_CONFIRMED, UNASSESSED}` | 管理者確認 |
| `urgentTaskClarity` | enum `{CLEAR_CONFIRMED, UNCLEAR_CONFIRMED, UNASSESSED}` | 管理者確認 |
| `quality.*` | enum `{SUFFICIENT, PARTIAL, STALE, MISSING, SUPPRESSED, UNKNOWN}` | source-health。業務値とは別field |

**Ordered first-match**

| 枝 | 正確条件 | actionId / target / owner / review |
|---|---|---|
| B1 | `adminPurpose=RESOURCE AND authorizedAggregateViewing.provided=PROVIDED AND authorizedAggregateViewing.stabilityReview=STABLE_CONFIRMED` | 投稿pressure抑止案 → `CASE19-B1` / `resourceChannelGuidance` / `Community Manager` / `REVIEW_ONLY` |
| B2 | `adminPurpose=SOCIAL AND entryBarrierReview=BARRIER_CONFIRMED` | optional low-pressure format案 → `CASE19-B2` / `entryFormat` / `Community Manager` / `REVIEW_ONLY` |
| B3 | `authorizedAggregateViewing.sourceAvailable=FALSE AND authorizedAggregateViewing.provided=NOT_PROVIDED` | 投稿集計だけに分析範囲を限定 → `CASE19-B3` / `analysisScope` / `Community Manager` / `REVIEW_ONLY` |
| B4 | `authorizedAggregateViewing.sourceAvailable=TRUE AND authorizedAggregateViewing.provided=PROVIDED AND urgentTaskClarity=UNCLEAR_CONFIRMED` | task clarity案 → `CASE19-B4` / `taskGuidance` / `Community Manager` / `REVIEW_ONLY` |

**unknown時**  
必要fieldが `Value<T>=Unknown/Missing/Failed` → `INELIGIBLE/INPUT_UNKNOWN`、後続枝へ進めない。`quality≠SUFFICIENT` は `INELIGIBLE/INPUT_QUALITY`。閲覧sourceが存在しないことを、閲覧者がいないことへ変換しない。

**禁止境界**  
native閲覧率をBotが取得できる前提を置かない。個人lurkerラベル、prune、自動DM、個人engagement scoreは作らない。

### 完全baseline

```text
adminPurpose = SOCIAL
authorizedAggregateViewing.provided = PROVIDED
authorizedAggregateViewing.stabilityReview = NOT_STABLE_CONFIRMED
authorizedAggregateViewing.sourceAvailable = TRUE
postingAggregate = OBSERVED
optionalFeedback = NONE_REPORTED
entryBarrierReview = NO_BARRIER_CONFIRMED
urgentTaskClarity = CLEAR_CONFIRMED
quality.* = SUFFICIENT
```

### 枝fixture

- `IV-E19-F01` → Δ `adminPurpose=RESOURCE`、`authorizedAggregateViewing.stabilityReview=STABLE_CONFIRMED` → **B1**
- `IV-E19-F02` → Δ `entryBarrierReview=BARRIER_CONFIRMED` → **B2**
- `IV-E19-F03` → Δ `authorizedAggregateViewing.sourceAvailable=FALSE`、`authorizedAggregateViewing.provided=NOT_PROVIDED` → **B3**
- `IV-E19-F04` → Δ `urgentTaskClarity=UNCLEAR_CONFIRMED` → **B4**

### 自然文例

1. 「閲覧は実際に確認でき、resource用途で安定した閲覧も確認されています。投稿を参加の条件にせず、読むことを中心に使える導線を運営担当者が確認する案です。」
2. 「閲覧を示す情報源がないため、現在分かるのは投稿集計の範囲です。投稿量だけからコミュニティ全体の参加状況を判断しないようにします。」

---

## CASE20 — Forum / Old Post ≠ Resolved

**source URL**  
[Discord Support — Forum Channels FAQ](https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ?utm_source=chatgpt.com)  
※提示URL・編集主体は未照合。

**Typed入力**

| field | type / enum | 由来 |
|---|---|---|
| `channelType` | enum `{FORUM, TEXT_CHAT, OTHER, UNASSESSED}` | Discord channel metadata |
| `explicitTags` | `Set<enum{CASUAL_CHAT, HELP, RESOURCE, OTHER}> \| NOT_SET \| UNASSESSED` | 管理者が意味を明示したtagのみ |
| `explicitOutcome` | enum `{SOLVED_CONFIRMED, PURPOSE_ACHIEVED_CONFIRMED, UNSOLVED_CONFIRMED, NOT_SET, UNASSESSED}` | 明示されたoutcomeのみ。inactive/lockから推定しない |
| `lastReplyAt` | `Instant \| NOT_SET \| UNASSESSED` | Discord metadata。old判定の数値閾値には使用しない |
| `archiveState` | enum `{ACTIVE, OLDER_POST, ARCHIVED, UNASSESSED}` | Discord forum/post状態 |
| `locked` | enum `{LOCKED, UNLOCKED, UNASSESSED}` | Discord post状態。solved判定には使用しない |
| `staffConfirmedBuriedDiscussion` | enum `{MULTIPLE_HELP_BURIED_CONFIRMED, OTHER_BURIED_CONFIRMED, NOT_BURIED_CONFIRMED, UNASSESSED}` | 管理者確認 |
| `postingActivity` | enum `{LOW_CONFIRMED, REGULAR_CONFIRMED, UNASSESSED}` | 管理者が明示確認した状態。数値閾値なし |
| `roleAccessibility.visibilityTagComplexity` | enum `{PROBLEM_CONFIRMED, NO_PROBLEM_CONFIRMED, UNASSESSED}` | role accessibility / visibility・tag構造の確認 |
| `quality.*` | enum `{SUFFICIENT, PARTIAL, STALE, MISSING, SUPPRESSED, UNKNOWN}` | source-health。業務値とは別field |

**Ordered first-match**

| 枝 | 正確条件 | actionId / target / owner / review |
|---|---|---|
| B1 | `channelType=FORUM AND staffConfirmedBuriedDiscussion=MULTIPLE_HELP_BURIED_CONFIRMED` | forum pilot案 → `CASE20-B1` / `forumPilot` / `Community Manager` / `REVIEW_ONLY` |
| B2 | `channelType=FORUM AND archiveState IN {OLDER_POST, ARCHIVED} AND explicitOutcome IN {NOT_SET, UNSOLVED_CONFIRMED}` | unresolved/unknown維持 → `CASE20-B2` / `forumPostState` / `Community Manager` / `REVIEW_ONLY` |
| B3 | `channelType=FORUM AND postingActivity=LOW_CONFIRMED AND roleAccessibility.visibilityTagComplexity=PROBLEM_CONFIRMED` | visibility/tag導線整理案 → `CASE20-B3` / `forumNavigation` / `Community Manager` / `REVIEW_ONLY` |
| B4 | `channelType=TEXT_CHAT AND explicitTags CONTAINS CASUAL_CHAT AND explicitOutcome=PURPOSE_ACHIEVED_CONFIRMED` | textchat維持 → `CASE20-B4` / `textChat` / `Community Manager` / `REVIEW_ONLY` |

**unknown時**  
必要fieldが `Value<T>=Unknown/Missing/Failed` → `INELIGIBLE/INPUT_UNKNOWN`、後続枝へ進めない。`quality≠SUFFICIENT` は `INELIGIBLE/INPUT_QUALITY`。`OLDER_POST`、`ARCHIVED`、`LOCKED`、`lastReplyAt` は `SOLVED_CONFIRMED` へ変換しない。

### 完全baseline

```text
channelType = FORUM
explicitTags = NOT_SET
explicitOutcome = NOT_SET
lastReplyAt = 2026-10-15T12:00:00Z
archiveState = ACTIVE
locked = UNLOCKED
staffConfirmedBuriedDiscussion = NOT_BURIED_CONFIRMED
postingActivity = REGULAR_CONFIRMED
roleAccessibility.visibilityTagComplexity = NO_PROBLEM_CONFIRMED
quality.* = SUFFICIENT
```

### 枝fixture

- `IV-E20-F01` → Δ `staffConfirmedBuriedDiscussion=MULTIPLE_HELP_BURIED_CONFIRMED` → **B1**
- `IV-E20-F02` → Δ `archiveState=ARCHIVED` → **B2**
- `IV-E20-F03` → Δ `postingActivity=LOW_CONFIRMED`、`roleAccessibility.visibilityTagComplexity=PROBLEM_CONFIRMED` → **B3**
- `IV-E20-F04` → Δ `channelType=TEXT_CHAT`、`explicitTags={CASUAL_CHAT}`、`explicitOutcome=PURPOSE_ACHIEVED_CONFIRMED` → **B4**

### 自然文例

1. 「フォーラム内で会話が埋もれ、複数の相談が同時に流れていることを管理者が確認しています。いきなり全体を変えず、フォーラムを小さく試す案を確認してください。」
2. 「投稿が古くなってアーカイブされていても、解決済みの明示はありません。解決扱いにはせず、状態は未確定のまま維持します。」