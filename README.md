# NEXUS v0.5.1

NEXUS は、Discord に新しく参加した人が最初の活動、交流、別の日の参加、1週間後の活動へ進む様子を集計します。普段から参加している人との違いや、改善テストの結果も確認できます。ゲームコミュニティ向けのツールです。メッセージ本文、添付、DM、プレゼンスは分析用に保存しません。

## Windows で始める

1. Node.js 24 をインストールします。Discord Developer Portal で **Server Members Intent** を有効にし、Bot をサーバーへ追加します。Message Content Intent は不要です。
2. Discord Developer Portal の **Interactions Endpoint URL を空欄**にします。Gateway で Slash Command、ボタン、メニューを受ける設定です。[Discord の説明](https://docs.discord.com/developers/interactions/receiving-and-responding)
3. `NEXUS SETUP.cmd` をダブルクリックします。Discord Application ID、サーバー ID、Bot Token を入力します。依存関係、専用 Redis、`.env`、ランダムな秘密鍵と Web のビルドを準備し、PostgreSQL と Web を起動します。DB migration と Command 登録は起動時に自動実行します。
4. 表示されたローカル Web パスワードを保存し、[http://localhost:3100](http://localhost:3100) を開きます。

| ファイル | 役割 |
| --- | --- |
| `START NEXUS.cmd` | PostgreSQL、Redis、Bot/API、Web を起動。起動済みなら状態を確認 |
| `STOP NEXUS.cmd` | NEXUS と確認できたプロセスを停止 |
| `RESTART NEXUS.cmd` | 停止してから再起動 |
| `NEXUS STATUS.cmd` | サービス、Discord 接続、最近のイベントを確認 |
| `NEXUS DOCTOR.cmd` | 環境・ポート・残留プロセスを診断。`-Repair` で確認済み孤児プロセスを回収 |

PowerShell の Execution Policy を恒久的に変更する必要はありません。内部の pnpm 実行には `corepack pnpm` を使い、`corepack enable` は不要です。起動失敗時は画面にエラーを残し、`.local/runtime/*.err.log` を参照できます。ポート 55432、56379、3001、3100 を使用します。Webhook を明示した場合のみ 3002 も使用します。起動・停止はリポジトリ由来と確認できたプロセスだけを操作し、判定できないポート所有者は停止しません。

## 見る順序

1. **ホーム**で、十分な観測期間がある新規メンバーの参加段階と、次へ進んでいない人が多い場所を確認します。
2. **新しいメンバー**で、最初の目標と参加後の流れを確認します。目標は既存のルール定義を使用します。
3. **コミュニティ／比較**で、普段参加している人との最初の3日間相当の活動を比較します。継続して参加している人、最近活動が確認できない人、スタッフを分けます。
4. **チャンネル**で、新しい人が返信を受けた割合や他の場所で活動した割合を見ます。3人未満のチャンネル詳細は隠します。
5. **改善／結果**で、観測された傾向に基づく改善策を確認し、改善テストとその結果を見ます。比較から原因を断定しません。
6. **設定**で「分析する範囲」をサーバー全体、指定チャンネルのみ、指定チャンネルを除外から選びます。スタッフのロールも設定できます。初期値はサーバー全体です。

Discord では閲覧だけの行動を観測できません。「1週間後も活動が確認できた」は参加7〜14日後の観測可能な活動を意味します。結果が確定していない人と計測不足の人は、活動しなかった人として数えません。比較・改善提案には少なくとも5人の対象が必要です。分析用の日数閾値は設定スキーマで変更できる構造です。

## 詳細設定

`.env.example` を参照してください。標準は `NEXUS_INTERACTION_TRANSPORT=gateway` です。Webhook が必要な場合だけ `webhook` に変更し、`DISCORD_PUBLIC_KEY` と外部公開 URL を用意します。ngrok は標準起動に含まれません。

`NEXUS_DEV_PLAN=GROWTH` は `NODE_ENV=development` の場合だけ使用できます。本番では実際の契約情報を読みます。ローカルセットアップは Web の開発用パスワード方式を選びます。本番では `NODE_ENV=production`、`NEXUS_WEB_AUTH_MODE=oauth`、`DISCORD_CLIENT_SECRET`、HTTPS の `NEXUS_WEB_URL` を設定し、`${NEXUS_WEB_URL}/auth/callback` を Discord OAuth redirect URI に登録します。

## 検証

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm test:runtime
```

統合テストはローカルの埋め込み PostgreSQL と専用 Redis を利用します。Docker を使う場合は `NEXUS_TEST_INFRA=docker` を設定します。Windows の起動停止テストは偽サービスを隔離した一時ディレクトリで実行し、他アプリのポート利用者が停止されないことを確認します。

DB 変更は追加 migration のみで、既存データを削除しません。旧設定には安全なデフォルトを補います。削除依頼とデータ保持の境界は従来どおりです。
