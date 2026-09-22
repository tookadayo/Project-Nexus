# NEXUS v0.2 — Product

NEXUSはDiscordで観測できる新人の行動を、Activationの定義、施策、対照群付き実験につなげます。Native Onboardingを読み取り、Discordの設定を書き換えません。Message Content / Presence Intentは使用しません。

## 管理者の操作

1. `/nexus setup`でNative設定・権限を確認し、auto / native / fallback / hybridを選んで差分を公開します。
2. v0.2 rolloutのプレビューを確認します。既存guildのFallback設定は引き継がれます。
3. ActivationでFirst Valueの定義を公開します。新規加入episodeは公開済み版を固定します。
4. LifecycleとData Healthで観測窓、人数、欠測を確認します。Diagnosesは比較可能なデータだけから候補を出します。
5. InterventionsでまずSuggestのスタッフ通知を作成します。承認後も送信直前に権限・対象・接触上限を再確認します。
6. ExperimentsでControlを無介入、Treatmentを公開済み施策に設定します。スタッフ通知では日単位のtime-blockを推奨します。
7. 成熟した結果、区間、Guardrailを見て停止・継続を判断します。観測不足は成功扱いにしません。

Discordが主導線です。Webはguild管理者向けの補助画面で、定義のプレビュー・公開・過去版からの復元、施策承認、実験停止ができます。Webは共有管理パスワード方式であり、個人別OAuth/RBACは含みません。

## 実装範囲

Native能力検出、REST flagsの初回観測時刻、Fallbackの既存version/session拡張、Hybridの質問重複検査、型付きActivation、正規化signal、成熟窓を持つ指標、9種の診断ルール、安全な単一action施策、member/time-block割付、ITT集計、Guardrail停止、プラン判定とMTM、削除・保持期間を実装しています。

現段階はdomainごとに現行headが1つです。複数の施策や実験を同時に自由編成するキャンペーン管理ではありません。Hybrid開始はメンバーの操作から行い、after-nativeの条件と重複を検査します。自動の質問DMは送りません。

高度な保存Cohort編集、定期Reports、AI説明、checkout、webhook、独立したmicro-flow、組織横断分析は未実装です。画面は未提供を明示します。Billingのprovider interfaceやfeature定義が存在するだけでは、その機能が利用可能であることを意味しません。

実Discordの受け入れは未実施です。現在の検証は実PostgreSQL・RedisとDiscordの契約fixture/FakeDiscordによるものです。製品の有効性やPMFを示すデータはありません。
