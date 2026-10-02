> Historical release evidence. Preserved from its original release; current contracts are indexed in [Documentation](../../README.md) and [Stripe readiness](../../billing/stripe-readiness.md).

# NEXUS v0.6.0-alpha.4 — Adaptive Community Model

実装日: 2026-10-02。基点は master `3298f2fa412bfc5e99981466f4311909eabb4634`。既存のサーバー検証・Web認可を維持し、masterへ直接反映する。branch / PRは作成しない。

## Commit SHA(s)

- `c24931c95eb6cb1749faaed94ba38b0f446124d2` — capability discoveryと活動の観測基盤。
- `a019cb084be66fce0bb442f5bfdbd2eeffafd0e0` — 目的別の集計とWeb / Discord操作画面。
- `52b8d310692d8b705d612255a3447d3406824f72` — surface別対応、規模・プライバシー検証と文書。
- Release commit — この報告書と全workspaceの `0.6.0-alpha.4` 更新を含むcommit。最終SHAと、そのSHAのCI結果は作業完了の返信に記載する。

## Discord capabilities audited

実装前にGuild/member、channel、message、Gateway/intents、permissions、Threads、Poll、Voice、Stage、Scheduled Events、AutoMod、Components、Soundboard、Stickerの公式仕様と、Onboarding / Server Guide / Screening / Forum / Legacy Welcome Screenの公式製品説明を確認した。[監査表](../../../docs/discord-capability-matrix.md) に意図・権限・Community要件・観測範囲・保存範囲・代替手段・対応状態を記載。

FULL SUPPORTは表に記載した公開メタデータの対応範囲。Discord機能全体の取得や完全な履歴を保証する意味ではない。7種類の検出状態、チャンネル権限の範囲、取得開始日時、閲覧できるactive Thread数を保存する。定期・変更・手動確認はキューで処理し、Dashboardごとに全構造を取得しない。

## New Gateway support

Guild/channel変更、Thread作成・更新・削除・同期・メンバー増減、リアクション全解除形式、Poll回答追加・解除、Voice状態、Stage lifecycle、Scheduled Event lifecycle / 登録解除、最小限のAutoMod executionに対応。追加intentはGuildMessagePollsとAutoModerationExecution。Message Content、Presence、DM intentを追加しない。

1 packetから0〜Nのstrict envelopeを生成する。ordinal 0の既存dedupe keyを維持し、複数member/structure eventのordinalを区別する。既存durable ingest、ACK、再試行、privacy lockを維持する。

## Community Profile

8種類の目的を複数選択でき、管理者が明示的に確認する。チャンネル用途とForumタグの意味は管理者の対応付けを使い、名前から決定しない。Webは用途・タグ・同席時間を編集でき、Discordは本人に紐づくModalで複数目的・1チャンネル用途・同席時間を編集する。保存は最新認可とrevision確認を使う。検出結果で通知時間を自動変更しない。

## Threads / Forum / Media

親チャンネル設定を継承し、再起動後もmappingを利用する。公開・非公開・Announcement Thread、Forum / Media postを区別する。`newly_created=true`を実際の作成として扱い、既存Threadへの追加通知やREST検出から過去の最初の応答を捏造しない。

最初の他者メッセージを直接返信と別に集計し、同時到着による重複を防ぐ。Archive / lockは解決を意味しない。管理者がRESOLVEDに対応付けたタグのみを解決状態に使う。投稿本文・タイトル・添付は収集しない。

## Replies / Reactions / Polls

直接返信の意味を維持し、他者による投稿応答を目的に応じて強い応答として扱う。リアクションはactive state、解除、unique human / user-message単位を分け、Bot・自己を除く。作者不明の状態は内部に保持するが、自己リアクションを否定できないため、確認済みの他者参加や受信反応に数えない。作者確認のためのMessage REST取得を行わない。

Pollは複数回答を1人・1投票の参加にまとめる。最後の回答解除で現在の参加を解除し、保存期間内の再投票で最初の参加を重複記録しない。絵文字・回答の内部キーはスコープ付きHMAC。質問・回答ラベル・意見の意味は分析しない。リアクション・投票だけで最初の交流を成立させない。

## Voice / Stage / Events

join / move / leave、通常のVoice参加、一定時間の人同士の同席を区別する。初期基準は5分で設定可能。AFK、Bot、Guest、種類未確認のチャンネル、Stageを通常の同席から除外する。参加者別sessionとチャンネル別clockを使用し、全参加者のpair graphを作らない。tickは最大500件、切断・欠落は継続時間の証拠を無効化する。

Stageの聴衆 / スピーカー状態を区別し、実際の会話・発言とは表現しない。登録と出席は別。Gatewayで実際のACTIVE期間を確認し、対応する既知のVoice / Stageへ参加した場合にのみ出席を導出する。RESTで検出したACTIVEだけでは開始時刻を補完せず、External出席は不明のまま。

## Onboarding / Screening / Server Guide

Rules Screening pendingを活動の対象から分け、通過を観測した時点から活動期間を開始する。Onboarding完了を活動の必須条件にしない。公開member flagsの開始 / 完了、Home Action開始 / 完了、Guestを観測する。更新の観測日時を保持し、古い参加日時で新しい状態を上書きしない。

検出したnative Onboardingの状態、既定チャンネル、必須質問数と既存Setupを接続し、同じ質問の再作成を求めない。Server Guideの完全な設定は公開APIで取得できない。Guestは通常のmembership / 継続集計に含めず、別に扱う。

## Scale adaptation

人数だけでなく新規参加、対象人数、イベント量、対応待ち量でLOW / STANDARD / HIGHを判定する。閾値は [設計文書](../../../docs/adaptive-community-model.md) に記載し、テストする。少人数では件数・観測途中を表示し、大人数では対応順・集計・中央値 / p75 / p90を優先する。関係のない指標、未使用Poll等の指標を表示しない。

新規メンバーの各段階は同じ観測完了群を使い、観測途中と観測不足を分ける。Screening / Guest / staffを除外する。Text、Forum応答時間、Voice同席を別に表示し、本文や会話から意味を推測しない。既存の公開済み定義・実験・canonical daily metricsを勝手に置き換えない。

対応ではTextの直接返信待ち、Support postの最初の応答待ち、LFGの他者参加待ちを区別する。新しいSupport / LFG postは古くからのmemberによる投稿も対象。LFGへの他者参加は対応待ちを解除できるが、強い交流を自動成立させない。Voice / Event登録だけでは通知を作らない。

## Privacy

Migration 026は追加のみ。新規テーブルはguild scoped。member削除はsubject / recipientの状態・fact、thread owner hash、関連durable payloadを除去し、Voice clockを保守的に無効化する。Guild削除はsnapshot / mapping / state / fact / refresh jobを除去する。

既存の詳細保存期限を新規データにも適用し、過去のsnapshotとarchived mappingを期限処理する。最新snapshotとactive mappingはrouting stateとして保持する。本文、添付、画像、音声、DM、Presence、username、Poll意味を収集せず、導入前履歴を補完しない。

## Performance

- 10,000 member: **2,550 ms**、既存上限7秒以内。
- 50,000 member + 10,000 Thread / Forum応答 + 200,000 reaction / poll state + 10,000 Voice fact: **2,579 ms**、既存上限以内。
- 600人Voice: **1,799 ms**。600 session、1 channel clock、0 pair。500件を処理するtick境界も確認。

空のstaff除外設定でも重い返信集計を実行する問題を修正した。基準時間の引き上げやテストの無効化はしていない。数字は合成fixtureを使ったローカルのread / projection確認であり、Hosted環境のp95達成を意味しない。

## Tests

lint / typecheck、unit 233件、integration 113件の対象、18 package build、Web E2E 21件、production verification E2E 6件、performance 3件、Windows runtimeを確認した。全体確認で見つかった不整合を修正後、影響するテストとWeb buildを再確認した。既存DBテストも毎回独立した環境を使うよう変更し、固定ポートと残留状態に依存しないことを確認した。最終版の全体実行はCIでも確認する。

7代表Profileをstored capabilityから実際に選別するbackend test、7 Profile × 6 views × JA/ENの84 desktop Web画像、28 mobile画像、実際のComponents V2 payloadと42件のJA Discord表示近似を確認。Attention画像にも実画面と同じcomponentを使う。Web / Discordのサーバー設定保存、再検出、認可、revision、既存の対応・改善操作を検証する。

## CI

最終release commitをmasterへpushし、同じhead SHAのNEXUS CIについて `verify` と `windows-runtime` の成功を確認する。CI run URLと最終SHAは作業完了の返信に記載する。この文書内に、自身を含むcommitのSHAや未実行のCI成功を埋め込まない。

## Unsupported Discord capabilities and reason

Server Guideの完全な設定、Legacy Welcome Screenのenabled証明、private / archived Threadの完全な総数・履歴、Pollの内容・過去投票、External出席、実際の会話 / 発言、閲覧だけの参加は公開メタデータから証明できない。安全に取得できない部分はUNKNOWN / PARTIALとする。

Soundboard、Sticker、invite由来の個人別帰属、Presence、DM、音声内容、本文分析は、この版で収集しない。監査表のDEFERRED / NOT RELIABLY OBSERVABLEとして理由を記載する。AutoModとincidentはcontextのみで、memberの悪評や通常活動のscoreに使わない。

## Manual Discord acceptance still required

実際のCommunity / non-Community、View Channel不足、private Thread参加と再接続、Forum / Mediaタグ、Screening / Onboarding / Guide flags、リアクション解除4形式、複数回答Poll、Voice移動 / AFK / Guest、Stage聴衆 / スピーカー、ACTIVE event、他者によるModal再利用拒否、削除後の再観測を確認する。

Radio Group / Checkbox Groupはinstalled API typesとLabel内Modal処理を検証したが、実際のDiscord clientでの受け入れ確認は残る。Components画像は表示の近似であり、live Discord受け入れの代わりではない。実アカウントからの外部送信・本番サーバー操作はこの作業の成果に含めない。

## Remaining Beta blockers

以前から保留のOAuth refresh / rotation / durable revocation、Hosted運用・監視・障害対応、必要なprivileged GuildMembers承認、実Discord受け入れと複数サーバーでの実測が残る。Hosted Betaが公開済みとは表示しない。
