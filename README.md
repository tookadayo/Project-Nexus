# NEXUS v0.1 — Vertical Slice

Discord内の初期設定 → 分岐オンボーディング → 所有権付きロール付与 → Lifecycle / Activation → Coverage付きOverview → Preference変更までの実装です。対象は **Technical ValidationとWP-00〜WP-08のみ**。AI、Experiment、診断、Helper Alertの実行など後続機能は実装していません。

## 必要環境

- Node.js 24 / pnpm 11.19.0
- PostgreSQL 18 / Redis 8（本番・CIでは公式コンテナ推奨）
- 実Discord検証にはテストアプリ、テストguild、HTTP endpointのHTTPS公開が必要です。

```powershell
pnpm install --frozen-lockfile
docker compose -f infra/docker/compose.yaml up -d
```

このWindows環境はDocker未導入のため、開発用ネイティブPostgreSQLとRedisを使用しました。再現する場合：

```powershell
powershell -File scripts/setup-native-redis.ps1
pnpm infra
```

RedisのWindowsバイナリはredis-windowsのテスト用ビルドです。プロダクションのRedisを置き換える技術選定ではありません。

## Discordで実行する

1. `.env.example`を`.env`へコピーし、Discord設定と独立した暗号鍵をローカルで設定します。秘密情報をチャットやGitへ貼り付けないでください。
2. `IDENTITY_KEY` / `LOOKUP_KEY` / `COMPONENT_KEY`はそれぞれ独立した32バイトのhex値、`API_KEY`は32文字以上を用意します。
3. Developer Portalで**Server Members Intentのみ**privileged intentとして有効にします。Message Content Intentは有効にしません。
4. Guild install scopesは`bot applications.commands`。必要権限はViewChannel、SendMessages、ManageRolesのみ（permissions整数`268438528`）。管理対象ロールをBotの最上位ロールより下に置きます。
5. Interaction endpointを`https://<your-host>/interactions`に設定し、ローカル`:3002`へ転送します。ローカルのサービスは127.0.0.1にbindします。
6. `pnpm migrate`、`pnpm register`、`pnpm dev`を実行します。コマンド登録もOutboxから送信されます。
7. Discordで`/nexus panel` → テンプレート → 開始チャンネル → NEXUS / Onboardingを有効化 → Role mappings。
8. 一般メンバーは`/nexus personalize`またはPanelのPersonalizeから開始し、完了後にUpdate Preferencesで再設定できます。

Admin操作はManageGuild権限または設定済みNEXUS Admin Roleが必要です。BotにAdministratorを要求しません。

## Overview

`/nexus overview`でDiscord内の集計を表示します。Webは任意の読取専用補助UIです。

```powershell
pnpm build
pnpm web
```

`.env`の`NEXUS_WEB_PASSWORD`（16文字以上）と`DISCORD_GUILD_ID`、`API_KEY`を設定します。`pnpm web`はguild限定APIトークンをメモリー内で生成します。ブラウザーのBasic認証ユーザー名は`nexus`です。外部公開する場合はHTTPSのリバースプロキシが必要です。Webの直接公開、OAuthログイン、マルチguild切替はこのsliceに含みません。

## 検証

```powershell
pnpm check
pnpm test:integration
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`test:integration`は実PostgreSQL・Redisを起動します。Windowsでは`.local/redis/.../redis-server.exe`または`REDIS_BINARY`を使います。Docker環境では`NEXUS_TEST_INFRA=docker`にするとStreams側の統合テストがTestcontainersを利用します。Discord RESTはFakeDiscordで置き換えています。テストDBは本番接続文字列を使いません。

署名HTTP → durable jobs → BullMQ → Panel / settings → branching flow → role grant → Gateway normalize → Redis Streams → Lifecycle → authenticated API → preference reconciliationを通す統合シナリオ、および実APIに接続するPlaywrightテストを含みます。

実Discord資格情報は未準備とユーザーから確認済みです。実Gateway接続、Discordクライアント表示、実REST権限は**未検証**です。

## データと計測の境界

- メッセージ本文、添付、embed、DM、ユーザー名は永続化しません。
- DiscordユーザーIDはguildごとのHMACとAES-256-GCM vaultで扱い、Analyticsは内部UUIDのmembership episode単位です。
- 初回返信は既存メンバーの明示的返信だけを使い、Analyticsに返信者IDやユーザー間の辺を保存しません。
- Activationは「開始チャンネルで加入後7日以内に送信」。Active Retentionは加入からD1/D7/D30の各24時間窓でのメッセージ活動です。未成熟な窓は分母から除外します。
- TEST / PREVIEWは本番集計・Discordロール操作から除外します。
- 切断、heartbeat欠落、Redis送信失敗、未処理eventがある期間はCoverageを低下させます。取得不能はnullです。
- 詳細イベント・membership episode・監査・所有権証跡は45日で期限切れにします。45日を超えて証跡が失われたロールは外しません。長期のPreference同期はこの保持境界内のみ保証します。
- Interaction token / jobは15分、Streamの正規化メタデータは24時間で削除します。保持期限処理はworker稼働中と再起動後に実行します。
- 個人削除は再取り込みを防ぐguild限定HMAC tombstoneのみ残します。guild削除は停止状態と削除監査を残します。Discord上の既存ロールは削除しません。
- UNKNOWNの副作用は自動再実行しません。成功を推測してロール所有権を作りません。

[Work Packet報告](docs/work-packets.md) / [Architecture](docs/architecture/vertical-slice.md) / [計測定義](docs/architecture/metrics.md) / [検証結果](docs/validation.md)
