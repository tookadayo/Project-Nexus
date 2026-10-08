# NEXUS

NEXUS は Discord Community Operations 製品です。サーバーの運営目的に合う計測方法を保存し、Discordで確認できた投稿・返信・参加の範囲と、集計できていないデータを示します。新しいメンバーへの対応、最初の返信やVoice同席、参加後の活動を確認し、運営の対応とその後の結果をつなげます。比較から原因を断定せず、個人の活動点数やスタッフ評価を作りません。

現在のリリースは **0.6.0-alpha.11** です。バージョンはルートの `package.json` を唯一のリリース版ソースとし、`MAJOR.MINOR.PATCH-prerelease` の SemVer に従います。例: `0.6.0-alpha.2`、`0.6.0-beta.1`、`0.6.0-rc.1`、`0.6.0`。Build は Git の短縮 SHA です。パッケージ環境では `NEXUS_BUILD_SHA` を指定できます。

## Project Nexus 製品サイト

Web の `/` は、実装済みの Discord Community Operations 製品を紹介する日本語・英語のホームページです。新規メンバーの活動、未返信への対応、測定根拠を説明し、製品画面の表示例にはサンプルデータであることを明記します。未実装の機能は、構想や準備中としても製品紹介に掲載しません。詳細は `/product`、利用可能な機能の比較は `/pricing`、ログインは `/auth/login` から確認できます。有料決済は未設定で、有料価格は公開していません。

掲載内容の根拠と設計方針は [Website design](docs/design/nexus-website.md)、画面レビューと検証結果は [Website QA](docs/design/nexus-website-qa.md) を参照してください。

## Development self-host

1. Node.js 24 を用意します。Discord Developer Portal で Bot の **Server Members Intent** を有効にします。Message Content Intent は不要です。
2. Gateway を使う場合、Developer Portal の **Interactions Endpoint URL を空欄**にします。Webhook を選ぶ場合のみ公開 HTTPS URL と `DISCORD_PUBLIC_KEY` が必要です。
3. Windows では `NEXUS SETUP.cmd` を実行し、Application ID、開発サーバー ID、Bot Token を設定します。`.env.example` にすべての環境変数があります。`START NEXUS.cmd` で起動します。
4. スタッフ専用チャンネルで `/nexus panel` を実行します。Web は既定で [http://localhost:3100](http://localhost:3100) です。

CLI で起動する場合は `corepack pnpm install`、`corepack pnpm migrate`、`corepack pnpm dev` を使います。PostgreSQL と Redis が必要です。`NEXUS STATUS.cmd` はサービスと Interaction の状態、`NEXUS DOCTOR.cmd` は環境と残留プロセスを診断します。安全な修復は `NEXUS DOCTOR.cmd -Repair` で明示的に実行します。所有者が確認できないプロセスや ghost listener は停止しません。両方で Version / Build / Channel を表示します。

## Discord Control Panel

Homeの主な操作は **要確認、基本の分析、新しい参加者、設定、その他** の5つです。Sectionの縦並びで、確認した件数・詳しい分析の残り回数・最近の実行を表示します。設定は分析する場所・通知・運営メンバー・目標に分け、接続とプライバシーを直接確認できます。実行環境の診断情報は「その他」のサポート情報にまとめています。従来のコマンド名も引き続き使えます。

**基本の分析は回数を使わず、いつでも確認できます。** 集計・推移・既存チャートは、詳しい分析の残り回数が0でも利用できます。詳しい分析は、内容・対象期間・対象の場所・データ状況・回数を確認してから実行します。月間回数は Free 1 / Starter 3 / Growth 5 / Scale 10、Enterpriseは個別契約です。履歴・前回比較・要確認への追加をDiscordで行えます。PostgreSQLが実行と回数を管理し、専用の処理キューが実行します。成功時に1回だけ消費し、失敗時は予約を解除します。購入パックは1/3/5回の分類を用意していますが、価格未承認・販売無効です。

初回設定は、分析する場所・通知・運営メンバー・目標の4段階です。戻る・任意項目のスキップ・最終確認があり、確定するまで設定を保存しません。スキップは既存の値を保持します。通常のModalはLabel構造を使用します。詳しい設計と制限は [alpha.10の実装記録](docs/alpha10-analysis-operations.md) を参照してください。


対応ページでは返信が確認できない投稿を開き、確認中、30分・1時間・今日中の再確認、対応済みにできます。投稿の場所・識別子、対応種別、閾値、観測根拠・計測範囲と確認・再確認・解決時刻を保存します。本文は保存しません。対応済みや再確認待ちの投稿は通知しません。

別の人から新規メンバーの投稿へ追加されたリアクションは、軽い反応の件数として表示します。Botと自分のリアクションを除き、同じ人・投稿への複数の絵文字を重複人数にしません。現在の参加は解除を反映します。絵文字そのものや本文は保存せず、状態更新に必要な内部キーだけをHMAC化して保持します。リアクションだけでは「最初の交流」や対応状態を変更しません。最初の交流は参加資格を得てから72時間以内の別メンバーからの直接返信、目的に合う投稿への最初の応答、または設定時間以上のボイス同席です。同席は会話した証明ではありません。

`/nexus panel` を別チャンネルで実行すると移動確認が表示されます。新しいチャンネルと Bot 権限を確認してから新パネルを作り、設定を更新します。以前のパネルは削除を試みます。管理パネルの設置先はスタッフ専用チャンネルを推奨します。`@everyone` が見られないチャンネルは、スタッフロールに閲覧許可があっても公開扱いにしません。

alpha.11の分析結果は、保存した集計期間・対象範囲・値の意味・不足理由を日本語と英語で説明します。根拠から要確認、既存の対応記録、履歴、比較へ移動できます。対応記録の完了や撤回は返信・問題解決・改善効果の証明にはせず、保存した分析値と利用回数を変えません。比較は同じ定義・対象範囲・集計方法と、長さが同じで重ならない期間を必要とし、カレンダー日の一致は求めません。[実装・検証記録](docs/alpha11-analysis-clarity.md)を参照してください。

## Adaptive Community Model

構造と権限は保存済みの検出結果を表示し、定期・構造変更・手動更新はキューで処理します。ScreeningとGuestは、実際に観測したfalseと未観測を区別します。証拠のない既存メンバーはUNKNOWNであり、新規メンバーの対象人数に入れません。Screening待ちとGuestも分けます。Threads・Forum・Mediaは親の設定を引き継ぎ、投票は複数回答でも1人・1投票につき1参加として扱います。イベント参加登録は実際の出席と別で、外部イベントの出席は確認できません。新規作成を観測していないThreadに過去の最初の応答を補完しません。

対応範囲と公開APIの制限は [Discord capability matrix](docs/discord-capability-matrix.md)、状態・保存期限・計測定義は [Adaptive community model](docs/adaptive-community-model.md) を参照してください。Server Guideは公開されているメンバーフラグのみを観測します。本文・画像・音声・投票内容を分析しません。

Webは概要、新しいメンバー、対応、Journey、分析、Community Model、設定に加え、Discordとの接続状態・計測範囲・収集状態を確認できます。Recipe Wizardは利用可能な機能と観測した利用を分けて示し、管理者が目的を確認した後に測定内容を保存します。目的・Recipeの変更は新しい版になり、過去の定義を変更しません。

2026-11-16のChannel Obfuscation後は全チャンネル数を確認できない場合があります。過去の総数を現在の総数として再利用せず、確認できたチャンネル数と下限・不明を表示します。観測gapや必要Intentの停止は比較を止めます。

設計は [Evidence contract](docs/measurement-evidence-contract.md)、[Collection epochs](docs/collection-epochs.md)、[Recipe presets](docs/community-recipe-presets.md)、[Privacy inventory](docs/privacy-data-inventory.md)、[Privileged Intent operations](docs/privileged-intent-operations.md) を参照してください。

## Hosted Beta とインストール

Hosted Beta は準備中です。外部テスターには Bot Token やローカル起動を求めず、運営側がホストする Bot を通常の Discord OAuth Install で追加するモデルです。Web の `/servers` は未導入・導入済み未検証・検証待ち・検証済みを区別します。Bot導入後に `/nexus link` を実行し、発行した本人が `/link` でコードを入力するとDashboardを開けます。現在のDiscord/NEXUS管理権限もアクセスごとに確認します。

`DISCORD_APPLICATION_ID` を設定して `corepack pnpm install-url` を実行すると Install URL を生成できます。特定サーバー向けは `corepack pnpm install-url <guild-id>` です。基本スコープは `bot applications.commands`、権限は View Channel、Send Messages、Embed Links、Read Message History です。Administrator は要求しません。Role mapping など追加権限が必要な機能は利用時に案内します。Alpha のコマンド登録は Guild 単位です。`NEXUS_COMMAND_SCOPE=guild` を使用します。Alpha では `global` を指定すると設定検証で起動を拒否します。起動時と定期確認時に Discord 側のコマンド定義を確認し、不一致なら既存の指数 Backoff で再登録します。

Hosted Web は `NODE_ENV=production`、`NEXUS_WEB_AUTH_MODE=oauth`、`DISCORD_CLIENT_SECRET`、HTTPS の `NEXUS_WEB_URL` を設定し、`${NEXUS_WEB_URL}/auth/callback` を Discord OAuth redirect URI に登録します。OAuth セッション期限切れは再ログイン画面へ進み、可能な場合は以前の Guild に戻ります。

`NODE_ENV=production` と `NEXUS_WEB_AUTH_MODE=development` の組合せは起動時に拒否します。Basic認証は、production以外でdevelopmentを明示し、16文字以上の `NEXUS_WEB_PASSWORD` を設定した場合だけ使用できます。Dashboardは選択したサーバーの現在の権限とWeb接続を確認し、サーバー一覧全体の取得は `/servers` で行います。OAuthの自動更新は未実装で、有効期限後は再ログインが必要です。LogoutはローカルCookieを消し、Discordのトークン失効を試みます。

表示用語と計測の定義は [Product language](docs/product-language.md)、対応範囲・残課題・検証結果は [alpha.5 quality audit](docs/archive/releases/NEXUS%20v0.6.0-alpha.5%20QUALITY%20AUDIT.md) を参照してください。基本分析の比較期間はカレンダー週ではなく、観測を完了した参加期間です。

Webも既存のDB・Identity鍵・Bot設定を使用します。起動前に `corepack pnpm migrate` で046までのmigrationを適用してください。確認付きの `/nexus unlink` またはSettingsのサーバー接続解除でWeb接続だけを解除でき、設定・履歴・分析データは保持されます。構成・検証方法は [Server verification](docs/server-verification.md) を参照してください。

## Pricing & entitlements v4

現行リリース: **NEXUS v0.6.0-alpha.10 — Discord Analysis Operations**。[実装と検証](docs/alpha10-analysis-operations.md)、[市場での提供範囲](docs/research/alpha8-market-parity.md)、[Stripe integration](docs/billing/stripe-integration.md) を参照してください。以前の検証記録は各リリース文書に保存しています。

Freeは基本観測・測定根拠・Discord内の7/30日チャート・受付フォーム1件を含みます。Starterは90日履歴、保存ビュー・セグメント・集計CSV・イベントカレンダー、Growthは対応一覧・版管理Playbook・定期チャートレポート・読取API・署名通知、Scaleは5サーバーの組織管理・チーム権限・独立承認・過去データの試行・限定書込APIを追加します。EnterpriseのSSO・SCIM等はPLANNEDです。価格は暫定値で、公開販売の承認は別に必要です。

`/nexus plan` は非公開のプラン画面とプロモーションModalを開きます。Webの `/billing`、`/billing/manage`、`/billing/promotions` はOAuth・接続済みサーバー・現在の権限を確認します。`/billing/admin` のキャンペーン・Partner/Debug特典はNEXUS内部管理者だけが操作できます。Discordの管理者権限は内部権限ではありません。

[プランと提供範囲](docs/pricing-entitlements.md)、[請求アーキテクチャ](docs/billing-architecture.md)、[移行](docs/plan-migration.md)、[プロモーション](docs/promotion-system.md)、[セキュリティ](docs/billing-security.md)、[Discord公式要件の確認](docs/discord-premium-apps.md)、[Hosted Beta blockers](docs/hosted-beta-blockers.md) を参照してください。公式Stripe SDK・Hosted Checkout・Customer Portal・署名付きWebhook・サブスクリプション再照合を実装し、実Sandboxで購入・変更・割引・失敗回復を検証しています。Live Stripeは DISABLED、実金銭決済は NOT RUN、Production WebhookとDiscord Native Billingは NOT CONFIGURED です。SandboxのDiscord権限・価格同等性fixtureは本番承認を意味しません。価格は暫定USD $15/$49/$149で、公開承認前のLive購入CTAは出しません。

## Privacy とサポート

Web の `/privacy`、`/terms`、`/support` に Alpha 向けの方針を掲載しています。詳細データは設定に応じて 7・14・30 日、集計は 3・12・24 か月保持します。削除依頼は `/nexus privacy` から行えます。メッセージ本文、添付、DM 本文、プレゼンスは保存しません。Discord で観測できない閲覧だけの参加は測れません。新しい状態・集計テーブルにも既存の削除と保存期限を適用し、観測開始前の履歴を推定しません。

製品利用状況の記録はコミュニティ分析と別に保存し、固定したイベント名、ハッシュ化した Guild 識別子、必要な場合の処理時間のみを記録します。Raw user ID、ユーザー名、トークン、本文を含めません。「その他」のサポート情報から、診断情報をコピーできます。公開 Beta 前には方針文書の法的レビューを推奨します。フィードバック窓口は `NEXUS_FEEDBACK_URL` で指定します。

## 検証

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm test:e2e:verification
corepack pnpm test:runtime
corepack pnpm test:performance
```

性能は既存10k・50k Guildと600人Voiceのfixtureを継続測定し、alpha.4比20%以内を基本の回帰基準とします。raw factとdaily rollupの同じ活動結果も比較します。実測と限界は [Scaling architecture](docs/scaling-architecture.md) を参照してください。migrationは追加方式で、旧データの意味を変更しません。

現行の文書は [Documentation index](docs/README.md)、Stripe実装とLive gateは [Stripe readiness](docs/billing/stripe-readiness.md)、市場判断は [alpha.8 market parity](docs/research/alpha8-market-parity.md) を参照してください。過去のリリースレポートは `docs/archive/releases/` に保存しています。

alpha.9の購入導線と金融権限、移行・検証・公開条件は
[Owner-Gated Commerce report](docs/alpha9-owner-commerce.md) を参照してください。
実Stripe Sandbox決済とローカルfixture検証は別に記録します。
