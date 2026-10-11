# alpha.13 — R1–R5 / N1–N2 implementation and verification

2026-10-09 / Normal Development。ユーザーの7項目の実装承認に基づく追加変更。元のalpha.13実装・13画面＋4補助入口の台帳は [alpha13-navigation.md](alpha13-navigation.md)、前段の検証は [alpha13-acceptance.md](alpha13-acceptance.md)、ラベル改善は [alpha13-labels.md](alpha13-labels.md) に保持する。

作業環境: MacBook、Node 24.19.0 / pnpm 11.19.0。branch `codex/alpha13-ux`、開始時のcleanなHEAD `ff2e40324584f736e860ff25aaab203b39da1fea`。元の未公開alpha.12 `e4a146a58196357904f9f14ac3322d1e4b2756c4` を祖先として保持し、元の作業ツリーは変更しない。最終SHA・各ログhash・終了コードはローカルの `.local/alpha13-rn/receipt.json` に記録する。実行モデル／思考量の設定値はこの記録から独立には検証できない。

## 実装と根拠

|項目|実装・受入確認|
|---|---|
|R1 保存された施策の履歴|隔離DBで、GROWTH→FREE後も高度な内訳と、絞り込み済み記録のタイトルが返ることを2件の失敗テストで再現。`InterventionReview.list` が現在の権限・有効な利用権・集計保持／履歴日数・削除状態で再評価する。snapshotは既知の構造だけを許可し、現在読めない内訳を除外。絞り込みの前提そのものを失った記録、分離できない古いsnapshotはタイトルも返さない。許可された証拠からのみ比較を再計算する。|
|R1 保持と削除|UTC日単位の集計履歴と整合する境界を採用し、最終日の途中で有効な記録が消えることを防ぐ。個人の寄与を分離できる来歴をsnapshotが持たないため、既存の個人削除tombstoneより前に作成された記録は保守的に非表示にする。DB内の記録を勝手に削除・書換えしない。複数grantの一方が終了しても他の有効なgrantによる閲覧を維持。|
|R2 比較からの復帰|選択済みの比較は、データ取得失敗や利用不可でもチェック解除できる。明示的な解除ボタンも提供。URL直アクセス→エラー→解除→Back→再解除→refreshをJA/ENで検証。Betaの30日＋前30日は履歴範囲外、30日単独と7日＋前7日は既存サービスで判定し、回数は消費しない。履歴制限とサンプル不足の説明を分ける。|
|R3 読めるグラフ|ExploreとLPで共通の読み取り専用`ObservationChart`を使用。日付・単位・値・凡例・比較期間の実日付・非因果の注意・取得不足の説明・全件の値表を提供。チャンネルの日別内訳と絞り込み操作を維持。ヒートマップは曜日／24時間の見出し、0と欠測、横スクロール可能な表、セルの値詳細を提供。Enter/Space、閉じる、Escape、起点への焦点復帰は共通ダイアログを再利用。|
|R4 保存権限|認可済みのread modelからANALYZE、有効なsurface_breakdowns、Betaの操作許可を判定。Save View / Save Filterを同じ条件で制御し、APIの既存サーバー側認可も維持。ADMIN/ANALYST/OPERATOR/VIEWERで実保存サービスと表示判定を照合。Operationsのロール不足では課金誘導を出さず、プラン不足と区別。停止時はREADを残し、通常mutationの操作を抑止。|
|R5 利用条件|公開Home/Product/Pricing/Supportに無料・期限付き・招待制Betaを明示。通常5プランとBeta grantを分離し、Live／パックは提供しない。標準の回数・同時実行・サーバー数・履歴・席・API上限は既存plan registryから表示。認証後のExplore/Operationsには通常プラン、有効な追加権利、期限、残数、予約、消費、月次付与、Beta安全上限を表示。取得不可の残数は不明とし、0にしない。プラン相当の追加grantを通常契約と混同せず、操作には役割権限も必要と説明。|
|N1 LPデモ|既存の3つの表示を維持し、合成データの7／30日切替、値詳細、欠測とゼロ、根拠の表示、リセットを追加。実サーバー情報ではないことを常時表示。共有グラフはfetch・認証・保存・利用枠の処理を持たない。|
|N2 軽い動き|グラフ、hover/focus、デモ詳細、既存feature rowの短い表示変化を150〜180msに限定。ページのスクロールを制御しない。JS前から内容は可視。prefers-reduced-motionでは動きを止め、設定変更時は進行中のrevealも取消。新しいアニメーション依存を追加しない。|

R1の個人削除に対する非表示は、無関係なメンバーだけで作られた古い記録も読めなくする可能性がある。安全に再表示するには寄与の来歴が必要であり、今回の範囲ではデータモデルを拡張しない。古いsnapshotのDB内保存・物理削除の契約を変更するmigrationは追加していない。

ブランド4点は既存の原本 `apps/web/public/nexus/brand/` をそのまま使用。今回の追加変更では再生成・再着色・画像加工を行わない。新規の料金、指標、課金処理、権限モデル、外部API、外部送信を追加しない。

## 検証

対象は上記HEADにこのcommitの未commit差分を適用した最終コード。検証後の変更は文書とローカル証跡だけに限定する。終了コード0を取得してからPASSと記録する。旧SHAの成功を新しいコードの成功として流用しない。

コマンドの共通prefix:

```sh
PATH=/Users/rei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PWD/.local/bin:$PATH
.local/bin/pnpm --config.verify-deps-before-run=never ...
```

|検証|結果|`.local/alpha13-rn/`のログ|
|---|---|---|
|`pnpm typecheck`|PASS / exit 0|`typecheck-final3.log`|
|`pnpm lint`|PASS / exit 0|`lint-final3.log`|
|`pnpm build --concurrency=2 --force`|PASS / exit 0、21/21、cacheなし|`build-final3.log`|
|focused unit（下記）|PASS / exit 0、27件 / 4ファイル|`unit-final2.log`|
|focused integration（下記）|PASS / exit 0、25件 / 4ファイル|`integration-final2.log`|
|R2/R3/R4/R5合成UI|PASS / exit 0、JA/EN、390pxの主フロー、320pxのグラフ、1440pxの停止表示|`ui-rn-final3.log`|
|既存13＋4、drawer、Back、未保存入力、焦点の回帰|PASS / exit 0、8幅（320/390/767/768/1024/1199/1200/1440）|`ui-regression-final.log`|
|指標・条件・ロールのJA/ENラベルと送信値|PASS / exit 0|`ui-labels-final.log`|
|secret scan（`node --import tsx scripts/secret-scan.ts`）|PASS / exit 0|`secrets-final2.log`|
|実buildの公開ページ／N1/N2|PASS / exit 0、320/390/1440px、JA/EN・7/30日・reset・reduced-motion|`public-final.log`|

```sh
pnpm exec vitest run tests/unit/alpha13-rn.test.ts tests/unit/alpha13-ux.test.ts tests/unit/alpha13-server-boundary.test.ts tests/unit/chart-spec.test.ts
REDIS_BINARY=/opt/homebrew/bin/redis-server pnpm exec vitest run --config vitest.integration.ts tests/integration/alpha13-history-access.test.ts tests/integration/alpha13-access-presentation.test.ts tests/integration/alpha12-beta.test.ts tests/integration/alpha11-analysis.test.ts
NEXUS_UI_RN_ONLY=1 pnpm exec tsx tests/ui/alpha13-smoke.ts
pnpm exec tsx tests/ui/alpha13-smoke.ts
pnpm exec tsx tests/ui/alpha13-public-rn.ts
```

DBは各実行専用の一時PostgreSQL／Redis。既存のDATABASE_URLや資格情報は使わない。ブラウザはループバックの同一origin以外を遮断。停止時の許可された履歴・連携解除／削除、旧世代ジョブ拒否、予約の一度だけの解放、Attentionの重複防止／撤回、権限・tenant・削除境界を含む。Discordはpayload生成と既存validator／fake serviceの検証であり、実投稿は行わない。

ヒートマップは生成し得る101段階の文字／背景組合せを計算し4.5:1以上を検証。これはページ全体のWCAG適合や実スクリーンリーダー検証の宣言ではない。グラフ／表／dialogのキーボード操作はブラウザで別途確認する。

途中の失敗は保存する。R1の再現2件FAILは修正前の実際の失敗（最初のfixture日付制約エラーとは別）。追加grant fixtureの開始／終了条件、実サービスのエラーコード`PLAN_REQUIRED`、UIテストのリンク探索範囲を訂正した。共通dialogの焦点処理は実装を修正した。7日デモにも実測ゼロを含めるよう合成データを修正した。lintの空catchは起動待ちの意図を明記した。`pnpm check:secrets` はsandboxのtsx IPC制限で起動失敗したため、同じread-onlyスクリプトをIPC不要の`node --import tsx`で実行してPASSを確認した。テスト削除、skip、許容値の緩和、timeout延長は行わない。

## UI証跡と軽量計測

`.local/alpha13-rn/` に `graph-320.png`、`explore-ja-390.png`、`explore-en-390.png`、`explore-paused-1440.png`、`home-{320,390,1440}.png`、`demo-{320,390,1440}.png`、Product/Pricing/Supportの各幅の画像を保存する。値表、focus/Escape、欠測と0、ロールによる保存制限、API通信なしは同ディレクトリのUIログで確認する。画像だけを権限検証の根拠にはしない。

N2の軽量計測は同一Mac／ローカルChromium、7日合成データ、390/1440px、外部通信を遮断、無スロットリングの各1回。初回ロードのJS `decodedBodySize` 合計は旧build `469,573` bytes → 新build `485,681` bytes（+16,108 bytes、約3.4%）。圧縮済みネットワーク量ではない。フォントready後250msまでのCLSは両buildの両幅で0。新buildの320pxも0。`public-baseline.json` / `public-final.json` に保存する。長時間・低速回線・実端末を含む性能合格を意味しない。デモ操作の要求記録に認証/API要求はなく、JA/EN、7/30日、reset、詳細、reduced-motionの有効／無効を検証する。

## 残る公開ゲートと未実施

- NOT RUN: 実Discord／OAuth／Hosted受入、Windows 11実機、重い全E2E／全回帰、容量・負荷、実スクリーンリーダー、実バックアップからの復元。別のalpha.14〜15ゲート。
- 継続管理: 40P01、SHOWCASEのsourceメタデータ、実環境受入、最新削除状態を含むbackup復元、容量、Windows 11。
- 既知のalpha.12毎分上限テストの単発失敗→無変更再実行成功は、原因未確定のまま保持する。今回の成功で原因を確定・解消したとはしない。
- Support設定なしの合成環境では窓口未設定と表示。架空の連絡先は追加しない。必要な連絡・削除依頼窓口の配備設定は公開前確認として残る。
- ローカルcommitのみ。push／PR／merge／deploy／本番設定／migration適用／実認証・実サービス操作は行わない。公開可能とは判定しない。
