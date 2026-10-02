# NEXUS

NEXUS は Discord Community Operations 製品です。サーバーの運営目的に合う計測方法を保存し、Discordで観測できた事実の範囲と確実性を示します。新しいメンバーへの対応、最初の返信やVoice同席、参加後の活動を確認し、運営queueと改善後の結果をつなげます。比較から原因を断定せず、個人の活動点数やスタッフ評価を作りません。

現在のリリースは **0.6.0-alpha.5** です。バージョンはルートの `package.json` を唯一のリリース版ソースとし、`MAJOR.MINOR.PATCH-prerelease` の SemVer に従います。例: `0.6.0-alpha.2`、`0.6.0-beta.1`、`0.6.0-rc.1`、`0.6.0`。Build は Git の短縮 SHA です。パッケージ環境では `NEXUS_BUILD_SHA` を指定できます。

## Development self-host

1. Node.js 24 を用意します。Discord Developer Portal で Bot の **Server Members Intent** を有効にします。Message Content Intent は不要です。
2. Gateway を使う場合、Developer Portal の **Interactions Endpoint URL を空欄**にします。Webhook を選ぶ場合のみ公開 HTTPS URL と `DISCORD_PUBLIC_KEY` が必要です。
3. Windows では `NEXUS SETUP.cmd` を実行し、Application ID、開発サーバー ID、Bot Token を設定します。`.env.example` にすべての環境変数があります。`START NEXUS.cmd` で起動します。
4. スタッフ専用チャンネルで `/nexus panel` を実行します。Web は既定で [http://localhost:3100](http://localhost:3100) です。

CLI で起動する場合は `corepack pnpm install`、`corepack pnpm migrate`、`corepack pnpm dev` を使います。PostgreSQL と Redis が必要です。`NEXUS STATUS.cmd` はサービスと Interaction の状態、`NEXUS DOCTOR.cmd` は環境と残留プロセスを診断します。安全な修復は `NEXUS DOCTOR.cmd -Repair` で明示的に実行します。所有者が確認できないプロセスや ghost listener は停止しません。両方で Version / Build / Channel を表示します。

## Discord Control Panel

上位ページは **🏠 ホーム、👋 新しいメンバー、📥 対応、📊 分析、🧪 結果、⚙️ 設定** の6つです。Homeは応答待ちの投稿、参加資格のある人数、運営目的に合う活動と応答を表示します。各指標に対象期間・観測人数・範囲を付け、少人数では件数を、大人数では対応順と集計を中心に表示します。対応・新しいメンバー・分析・Webへは直接ボタンで移動できます。設定は現在の状態をまとめ、計測・通知・チーム・目標の詳細を操作した本人だけに表示します。通知のON/OFFはボタンで、待ち時間はModalで編集します。分析は目的に合う指標と計測根拠を表示します。設定で複数の運営目的、チャンネル用途、Forumタグの意味、ボイス同席の最低時間を明示します。構造の検出だけでは目的や意味を決めません。改善策はホームや分析で見つかった問題から開き、プレビュー後に確認して有効化します。

初回設定では分析範囲、運営、通知、目標の各項目を選択します。追加管理ロール、通知、目標を設定しない選択でも完了できます。旧 Guild には一度だけ設定確認が表示され、現在の設定を使うこともできます。管理ロール変更は確認画面を経て反映されます。管理・補助ロールはすべて解除できます。

対応ページでは返信が確認できない投稿を開き、確認中、30分・1時間・今日中の再確認、対応済みにできます。投稿の場所・識別子、対応種別、閾値、観測根拠・計測範囲と確認・再確認・解決時刻を保存します。本文は保存しません。対応済みや再確認待ちの投稿は通知しません。

別の人から新規メンバーの投稿へ追加されたリアクションは、軽い反応の件数として表示します。Botと自分のリアクションを除き、同じ人・投稿への複数の絵文字を重複人数にしません。現在の参加は解除を反映します。絵文字そのものや本文は保存せず、状態更新に必要な内部キーだけをHMAC化して保持します。リアクションだけでは「最初の交流」や対応状態を変更しません。最初の交流は参加資格を得てから72時間以内の別メンバーからの直接返信、目的に合う投稿への最初の応答、または設定時間以上のボイス同席です。同席は会話した証明ではありません。

`/nexus panel` を別チャンネルで実行すると移動確認が表示されます。新しいチャンネルと Bot 権限を確認してから新パネルを作り、設定を更新します。以前のパネルは削除を試みます。管理パネルの設置先はスタッフ専用チャンネルを推奨します。`@everyone` が見られないチャンネルは、スタッフロールに閲覧許可があっても公開扱いにしません。

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

表示用語と計測の定義は [Product language](docs/product-language.md)、対応範囲・残課題・検証結果は [alpha.5 quality audit](NEXUS%20v0.6.0-alpha.5%20QUALITY%20AUDIT.md) を参照してください。Homeの比較期間はカレンダー週ではなく、観測を完了した参加期間です。

Webも既存のDB・Identity鍵・Bot設定を使用します。起動前に `corepack pnpm migrate` で034までのmigrationを適用してください。確認付きの `/nexus unlink` またはSettingsのサーバー接続解除でWeb接続だけを解除でき、設定・履歴・分析データは保持されます。構成・検証方法は [Server verification](docs/server-verification.md) を参照してください。

## Privacy とサポート

Web の `/privacy`、`/terms`、`/support` に Alpha 向けの方針を掲載しています。詳細データは設定に応じて 7・14・30 日、集計は 3・12・24 か月保持します。削除依頼は `/nexus privacy` から行えます。メッセージ本文、添付、DM 本文、プレゼンスは保存しません。Discord で観測できない閲覧だけの参加は測れません。新しい状態・集計テーブルにも既存の削除と保存期限を適用し、観測開始前の履歴を推定しません。

製品利用状況の記録はコミュニティ分析と別に保存し、固定したイベント名、ハッシュ化した Guild 識別子、必要な場合の処理時間のみを記録します。Raw user ID、ユーザー名、トークン、本文を含めません。設定画面ではサポート用の診断情報をコピーできます。公開 Beta 前には方針文書の法的レビューを推奨します。フィードバック窓口は `NEXUS_FEEDBACK_URL` で指定します。

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
