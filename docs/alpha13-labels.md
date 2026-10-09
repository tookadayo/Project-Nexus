# alpha.13 日本語表示の追加修正

2026-10-09。開始SHA: `fa7202b7deeb71d868d63974b64af1d00476cf50`。branch: `codex/alpha13-ux`。
本書を追加したcommitが文言修正の最終コード。確定後の完全SHA・終了コード・ログhashはローカルの`.local/alpha13-labels-receipt.json`と`.local/alpha13-labels-handoff.md`に記録する（自身のcommit SHAをcommit内へ埋め込むことはできない）。

## 変更範囲と意味

- Exploreの6指標、5活動種類をJA/ENの表示名に変更。Operationsの同じ指標選択も共通辞書を使用する。イベント登録を出席と呼ばず、ボイス同席の条件もラベルに残す。
- OperationsのNEXUS権限表示、既存権限選択、メンバーの権限表示を翻訳。`ADMIN`は「管理者」。Discordの権限を変更・付与する表示ではない。
- 既存`recipeVersionId`は測定方法の特定版で得た記録を絞るためのUUID。APIは同じtenantの`measurement_recipe_versions`を照合する。既存絞り込み機能を維持し、「測定方法の版ID（任意）」とし、UUIDが必要なこと、改訂番号との違い、空欄では版で絞らないことを補足した。入力に`aria-describedby`で説明を関連付けた。版を選ぶための追加データ/APIは作っていない。
- selectに明示的な元の`value`を指定。API値、schema、認可、課金、集計・測定定義、保存処理は変更なし。依存追加なし。

主なファイル: `apps/web/app/analysis-labels.ts`、`explore/view.tsx`、`operations/view.tsx`。テストは`tests/ui/alpha13-label-checks.ts`。既存smoke harnessに文言確認だけを選ぶモードを追加した。通常モードのassertionは削除・緩和していない。

## 今回の検証

Mac、Node 24.19、pnpm 11.19。最終コードの未commit差分を検証後、ソースを変更せず文書・画像を追加してcommitする。以下のコマンドはrepo rootで実行し、Nodeと`.local/bin`をPATHに追加した。

|コマンド|結果|ログ|
|---|---|---|
|`NEXUS_UI_LABELS_ONLY=1 node --import tsx tests/ui/alpha13-smoke.ts`|PASS / exit 0|`.local/alpha13-labels-ui.log`|
|`pnpm --config.verify-deps-before-run=never typecheck`|PASS / exit 0|`.local/alpha13-labels-typecheck.log`|
|`pnpm --config.verify-deps-before-run=never lint`|PASS / exit 0|`.local/alpha13-labels-lint.log`|
|`pnpm --config.verify-deps-before-run=never build --concurrency=2 --force`|PASS / exit 0・21/21、cache 0、54.798秒|`.local/alpha13-labels-build.log`|

表示テストは合成レスポンスとloopback Chromiumのみ。JA/ENの全指標・活動種類・NEXUS権限の表示名を確認し、選択後のExplore要求が`event` / `VOICE` / 元のUUIDであること、権限フォームの値が`ADMIN`のままであること、Operations指標の値が`reply`のままであることを確認。版ID補足の関連付け、画面エラーなしもassertした。外部通信は遮断。

[Explore画像](alpha13-ui/explore-labels-1440.png)と[Operations画像](alpha13-ui/operations-labels-1440.png)を目視確認。秘密・個人情報を含まない合成画面。古い画像は前版の記録として保持。

今回のdomain integration・全unit・8幅smoke・実Discord/OAuth・Windows 11・性能・復元検証はNOT RUN。文言だけの限定変更に対し、関連表示テストとtypecheck/lint/buildを実施した。前回の認可・入力保持・Back・409回帰のPASSを今回再実行したとは扱わない。

push / PR / merge / deploy / 実サービス操作なし。既存公開ゲート（40P01、SHOWCASE sourceメタデータ、実環境受入、最新削除状態を含む復元、容量、Windows 11）はそのまま残る。公開可能とは判定しない。
