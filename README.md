# NEXUS

NEXUS は、ゲームコミュニティに新しく参加した人が「参加 → 最初の活動 → 交流 → 別の日の活動 → 1週間後の活動」へ進む様子を、Discord で観測できる活動から集計します。管理者は対応が必要な投稿を確認し、改善策をプレビューしてから有効化し、結果を見られます。比較から原因を断定せず、少人数の詳細は表示しません。

現在のリリースは **0.6.0-alpha.3** です。バージョンはルートの `package.json` を唯一のリリース版ソースとし、`MAJOR.MINOR.PATCH-prerelease` の SemVer に従います。例: `0.6.0-alpha.2`、`0.6.0-beta.1`、`0.6.0-rc.1`、`0.6.0`。Build は Git の短縮 SHA です。パッケージ環境では `NEXUS_BUILD_SHA` を指定できます。

## Development self-host

1. Node.js 24 を用意します。Discord Developer Portal で Bot の **Server Members Intent** を有効にします。Message Content Intent は不要です。
2. Gateway を使う場合、Developer Portal の **Interactions Endpoint URL を空欄**にします。Webhook を選ぶ場合のみ公開 HTTPS URL と `DISCORD_PUBLIC_KEY` が必要です。
3. Windows では `NEXUS SETUP.cmd` を実行し、Application ID、開発サーバー ID、Bot Token を設定します。`.env.example` にすべての環境変数があります。`START NEXUS.cmd` で起動します。
4. スタッフ専用チャンネルで `/nexus panel` を実行します。Web は既定で [http://localhost:3100](http://localhost:3100) です。

CLI で起動する場合は `corepack pnpm install`、`corepack pnpm migrate`、`corepack pnpm dev` を使います。PostgreSQL と Redis が必要です。`NEXUS STATUS.cmd` はサービスと Interaction の状態、`NEXUS DOCTOR.cmd` は環境と残留プロセスを診断します。安全な修復は `NEXUS DOCTOR.cmd -Repair` で明示的に実行します。所有者が確認できないプロセスや ghost listener は停止しません。両方で Version / Build / Channel を表示します。

## Discord Control Panel

上位ページは **🏠 ホーム、👋 新しいメンバー、📥 対応、📊 分析、🧪 結果、⚙️ 設定** の6つです。Homeは対応が必要な投稿を先に表示し、今日の人数、観測期間が完了した週次指標、根拠のある比較を続けて表示します。対応・新しいメンバー・分析・Webへは直接ボタンで移動できます。設定は現在の状態をまとめ、計測・通知・チーム・目標の詳細を操作した本人だけに表示します。通知条件はModalで編集します。分析では「全体・チャンネル・行動」を切り替えます。改善策はホームや分析で見つかった問題から開き、プレビュー後に確認して有効化します。

初回設定では分析範囲、運営、通知、目標の各項目を選択します。追加管理ロール、通知、目標を設定しない選択でも完了できます。旧 Guild には一度だけ設定確認が表示され、現在の設定を使うこともできます。管理ロール変更は確認画面を経て反映されます。管理・補助ロールはすべて解除できます。

対応ページでは返信が確認できない投稿を開き、確認中、30分・1時間・今日中の再確認、対応済みにできます。保存するのは Guild、Channel ID、Message ID、検出時刻、状態と再確認・解決時刻のみです。本文は保存しません。対応済みや再確認待ちの投稿は通知しません。

別の人から新規メンバーの投稿へ追加されたリアクションは、軽い反応の件数として表示します。Botと自分のリアクションを除き、絵文字や本文は保存しません。リアクションだけでは「最初の交流」や対応状態を変更しません。最初の交流は参加後72時間以内に確認した別メンバーからの直接返信、または別メンバーとのボイス共有です。

`/nexus panel` を別チャンネルで実行すると移動確認が表示されます。新しいチャンネルと Bot 権限を確認してから新パネルを作り、設定を更新します。以前のパネルは削除を試みます。管理パネルの設置先はスタッフ専用チャンネルを推奨します。`@everyone` が見られないチャンネルは、スタッフロールに閲覧許可があっても公開扱いにしません。

## Hosted Beta とインストール

Hosted Beta は準備中です。外部テスターには Bot Token やローカル起動を求めず、運営側がホストする Bot を通常の Discord OAuth Install で追加するモデルです。Web の `/servers` は未導入・導入済み未検証・検証待ち・検証済みを区別します。Bot導入後に `/nexus link` を実行し、発行した本人が `/link` でコードを入力するとDashboardを開けます。現在のDiscord/NEXUS管理権限もアクセスごとに確認します。

`DISCORD_APPLICATION_ID` を設定して `corepack pnpm install-url` を実行すると Install URL を生成できます。特定サーバー向けは `corepack pnpm install-url <guild-id>` です。基本スコープは `bot applications.commands`、権限は View Channel、Send Messages、Embed Links、Read Message History です。Administrator は要求しません。Role mapping など追加権限が必要な機能は利用時に案内します。Alpha のコマンド登録は Guild 単位です。`NEXUS_COMMAND_SCOPE=guild` を使用します。Alpha では `global` を指定すると設定検証で起動を拒否します。起動時と定期確認時に Discord 側のコマンド定義を確認し、不一致なら既存の指数 Backoff で再登録します。

Hosted Web は `NODE_ENV=production`、`NEXUS_WEB_AUTH_MODE=oauth`、`DISCORD_CLIENT_SECRET`、HTTPS の `NEXUS_WEB_URL` を設定し、`${NEXUS_WEB_URL}/auth/callback` を Discord OAuth redirect URI に登録します。OAuth セッション期限切れは再ログイン画面へ進み、可能な場合は以前の Guild に戻ります。

`NODE_ENV=production` と `NEXUS_WEB_AUTH_MODE=development` の組合せは起動時に拒否します。Basic認証は、production以外でdevelopmentを明示し、16文字以上の `NEXUS_WEB_PASSWORD` を設定した場合だけ使用できます。Dashboardは選択したサーバーの現在の権限とWeb接続を確認し、サーバー一覧全体の取得は `/servers` で行います。OAuthの自動更新は未実装で、有効期限後は再ログインが必要です。LogoutはローカルCookieを消し、Discordのトークン失効を試みます。

表示用語と計測の定義は [Product language](docs/product-language.md)、監査範囲・残課題・検証結果は [Quality audit](NEXUS%20v0.6.0-alpha.3%20QUALITY%20AUDIT.md) を参照してください。Homeの比較期間はカレンダー週ではなく、観測を完了した参加期間です。

Webも既存のDB・Identity鍵・Bot設定を使用します。起動前に `corepack pnpm migrate` で025を適用してください。確認付きの `/nexus unlink` またはSettingsのサーバー接続解除でWeb接続だけを解除でき、設定・履歴・分析データは保持されます。構成・検証方法は [Server verification](docs/server-verification.md) を参照してください。

## Privacy とサポート

Web の `/privacy`、`/terms`、`/support` に Alpha 向けの方針を掲載しています。詳細データは設定に応じて 7・14・30 日、集計は 3・12・24 か月保持します。削除依頼は `/nexus privacy` から行えます。メッセージ本文、添付、DM 本文、プレゼンスは保存しません。Discord で観測できない閲覧だけの参加は測れません。

製品利用状況の記録はコミュニティ分析と別に保存し、固定したイベント名、ハッシュ化した Guild 識別子、必要な場合の処理時間のみを記録します。Raw user ID、ユーザー名、トークン、本文を含めません。設定画面ではサポート用の診断情報をコピーできます。公開 Beta 前には方針文書の法的レビューを推奨します。フィードバック窓口は `NEXUS_FEEDBACK_URL` で指定します。

## 検証

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm test:runtime
corepack pnpm test:performance
```

性能の目標は実環境で p50 < 1秒、p95 < 3秒です。これは目標値であり、Hosted Beta の実測達成を意味しません。10k・50k realistic fixture は継続して CI で測定します。既存データを削除する migration は追加していません。
