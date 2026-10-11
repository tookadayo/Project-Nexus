# alpha.13 UX 実装・検証記録

**現在の追加修正・受入結果は[alpha.13受入対応表](alpha13-acceptance.md)を参照。以下は初回commit db67cb8時点の記録。**

2026-10-09 / Normal Development / MacBook。承認された「要点中心ホーム」「4主要入口と既存機能維持」「利用者Web/Discord優先」を適用した。公開可能判定ではない。

## 対象と変更

- 基点: `e4a146a58196357904f9f14ac3322d1e4b2756c4` (`codex/alpha12-hosted-beta`)。
- 独立checkout: `/Users/rei/Documents/Codex/2026-10-09/task/Project-Nexus`、branch `codex/alpha13-ux`。ローカル元repoから履歴を複製し、Git metadataも分離した。remote masterは使用していない。
- バージョン: `0.6.0-alpha.13`。依存追加・lockfile変更・schema/migration変更なし。
- 設定指定: `gpt-6-astra / high`。ランタイム実設定を独立に検証するAPIは使用しておらず、実設定確認済みとはしない。

[移行台帳](alpha13-navigation.md)に旧13画面＋4リンク、権限、移行先を記録した。さらに旧view 6/7のdeep linkも保持した。

`console.tsx`はホーム・分析・要確認・履歴を主要入口にし、設定や追加分析は目的別に展開する。ホームは取得状況、返信待ち条件に基づく要確認、保存された対応結果の3要約とし、従来の詳細概要をボタンで開ける。nullと確認された0を分離し、存在する更新時刻をUTC付きで表示する。新しい指標は作っていない。

`product-navigation.tsx`のモバイルメニューには全入口、言語、ログアウト、ヘルプを収めた。native dialogで背景をinertにし、Tab循環、Escape、起点へのfocus復帰を実装した。意味のあるview変更はpushState、Backはpopstateで復元する。URLへ保存するのは既存の数字viewだけで、未知のquery/hashを引き継がない。サーバー変更では旧本文を即座に隠し、既存の`/auth/select`を経て新しい認可を受ける。新しい共有キャッシュは導入していない。

`tokens.css`をサイトと製品で共有し、白・紺・青を基準にした。`product.css`で224px sidebar、1200px未満のdrawer、768px未満の1列表示、focus・操作領域を整えた。既存の詳細画面・フォーム・wizard・Operationsの機能を再利用している。local operatorアプリの外観は変更していない。

`auth/session.ts`では既存の認可済みbeta read結果からACTIVE/PAUSED/EXPIREDだけを表示用に渡す。新規の認可は追加・緩和していない。停止中の通常操作をclientでも抑え、履歴・個人OAuth解除・サーバー解除の既存server-side境界を維持した。接続解除は既存preview/confirmationをnative dialogへ結び、同期的な送信中guardを追加した。Explore/Operationsのraw error表示はJA/ENの安全な案内へ変更した。

Discordは既存の詳細分析種類、固定条件preview、予約・消費、結果、履歴、比較、Attention記録を再利用した。個人ホームに履歴入口、接続設定に既存`unlink`の影響確認入口を追加し、共有ホームには個人履歴を追加していない。色はbrand blueへ変更した。新しいcreate API、収集範囲、権限、課金は追加していない。

**Web/Discordの実装境界:** Web view 3は対応・実験の保存結果であり、詳細分析runの履歴ではない。詳細分析のpreview/実行/履歴/比較は既存Discord UIで提供される。Webにはこの区別を表示した。Webへの詳細分析run UIの新設は行っていない。

## ブランド素材

Libraryの正式materializationを試したが、各ファイルは初回と許可された再試行1回で取得できなかった。その後、ユーザーが指定した`/Users/rei/Downloads`から4点を読み取り、実画像を確認してバイト変更なしでコピーした。Libraryとのバイト一致は未確認。取得URLやcredentialsは保存していない。

[原本記録とSHA-256](alpha13-brand-assets.json)を参照。配置先は`apps/web/public/nexus/brand/`。

|素材|用途|読み取った寸法|
|---|---|---|
|青N|狭いheader|1254×1254|
|紺N|製品footer|1254×1254|
|紺NEXUS wordmark|desktop・公式サイトbrand|2172×724|
|紺タイル＋白N|favicon/apple icon|1254×1254|

wordmarkの実ファイル寸法は設計提供値2048×683と異なる。指定されたローカル原本を採用し、再生成・再着色・再エンコードはしていない。微小alphaを含む余白にはCSSの表示領域を用い、32px可視markと152px wordmarkをブラウザで確認した。紺タイルは作品の一部として保持した。

## 最終コードの検証

全コマンドは上記基点HEADに本変更が未commitで存在する状態で実行した。下記の最終コード検証後は記録文書・証跡のみを追加する。対象コードとテストは最終commitへそのまま含める。最終SHAと各ログのhashはcheckout内`.local/alpha13-handoff.md`および`.local/alpha13-verification-receipt.json`へ記録する。

Mac Node 24.19.0 / pnpm 11.19.0。既存の固定依存を元checkoutからコピーして使用した。fresh installはNOT RUN。以下の`pnpm`は`.local/bin/pnpm --config.verify-deps-before-run=never`。Node/PATHは同checkoutの`.local`実行記録に残した。

|コマンド|結果（終了コード）|ログ `.local/`|
|---|---|---|
|`pnpm typecheck`|PASS (0)|`alpha13-typecheck-final-code.log`|
|`pnpm lint`|PASS (0)|`alpha13-lint-final-code.log`|
|`pnpm build --concurrency=2 --force`|PASS (0)、21/21、cache使用なし|`alpha13-build-final-code.log`|
|focused unit、下記7ファイル|PASS (0)、94 tests|`alpha13-unit-final-code.log`|
|focused integration、下記4ファイル|PASS (0)、33 tests|`alpha13-integration-final-code.log`|
|`node --import tsx tests/ui/alpha13-smoke.ts`|PASS (0)|`alpha13-smoke-final-code.log`|
|`node --import tsx tests/ui/alpha13-public.ts`|PASS (0)|`alpha13-public-final-code.log`|
|`node --import tsx scripts/secret-scan.ts` / `git diff --cached --check`|PASS (0)|`alpha13-secrets-final-code.log` / 差分check出力なし|

```sh
pnpm exec vitest run tests/unit/alpha13-ux.test.ts tests/unit/alpha11-analysis.test.ts tests/unit/panels.test.ts tests/unit/auth-hardening.test.ts tests/unit/session-lifecycle.test.ts tests/unit/server-verification.test.ts tests/unit/alpha12-configuration.test.ts
pnpm exec vitest run --config vitest.integration.ts tests/integration/alpha12-beta.test.ts tests/integration/alpha12-sessions.test.ts tests/integration/alpha12-outbox.test.ts tests/integration/alpha11-analysis.test.ts
```

Integrationは隔離したローカルPostgreSQLと合成データ。権限拒否等の意図した例外ログが含まれるが、テスト結果は上記の終了コード・assertion結果で判断した。テスト削除、skip、assertion緩和はしていない。

初期検証のFAILも`.local/alpha13-*`ログに保持した。新規payloadテストのvalidatorは成功時voidであり、最初のboolean期待を実際の契約へ修正し、81文字button labelの拒否assertionも追加した。この修正の最初の一括コマンドは自動承認レビューで拒否されたため、実装と既存テストを確認してから修正を分離した。UIで見つかったTab循環・dialog起点focus復帰、型エラー、テストharnessの文字コード/React解決も修正し、上記最終検証で再確認した。失敗した実行をPASSへ読み替えていない。

## Acceptance証拠と限界

PASSは記載したローカル範囲に限定する。全実環境受入を意味しない。

|ID|判定・証拠|
|---|---|
|A01/A02|PASS: 320pxを含むdrawer、13 nav button＋4旧リンク、補助リンク、Tab/Escape。台帳と全view 0〜14の合成空状態render。|
|A03|PASS: view 5→3→Back→refresh→Back。既存view URL契約のみ。各画面の全filter状態のURL永続化は未追加・全組合せ検証NOT RUN。|
|A04|PASS（限定）: 選択直後に旧本文が消え、mockしたauth/selectへ遷移。実OAuthを伴う競合受入NOT RUN。既存認可回帰はPASS。|
|A05|PASS: auth-hardening/server-verification/session/alpha12 integrationの現権限・scope・admission拒否。実OAuth NOT RUN。|
|A06/A14|PASS: unknownと実測0の表示を分離、UTC表示。Bot参加から実収集開始までの実機受入NOT RUN。|
|A07/A08/A09|PASS（domain）: 保存結果・Attention重複/撤回とusage不変、予約/解除一回、既存署名・権限境界。UI送信中guard追加。実Discordの二重click/timeout受入NOT RUN。|
|A10|PASS: 異なる日付の互換期間選択、不一致evidence window拒否の既存integration。|
|A11/A12|PASS: paused/expired案内、停止後history、現権限喪失、tenant削除、unlink、旧generation拒否、outbox再認可。復元のfocused単体シナリオは含むが、本番backup復元受入ではない。|
|A13|PASS（変更範囲）: JA/EN nav/home/notice、safe raw-error遮蔽、Discord payload。既存全文言の全面翻訳監査NOT RUN。|
|A15|PASS: support未設定のbuilt Next画面に架空連絡先なし。実配備先の窓口設定確認NOT RUN。|
|A16|PASS: menu/接続解除dialogのkeyboard、Escape、focus復帰。screenreader NOT RUN。|
|A17|PASS（軽量）: 320/390/767/768/1024/1199/1200/1440px、長いJA名/emoji、200% CSS文字拡大。OS文字拡大・全画面browser zoom・Windows NOT RUN。|
|A18|PASS: JA/EN共有/個人home、unlink preview、既存analysis/panelsのvalidator。実Discord投稿NOT RUN。|

Discord SDKはrepoの`discord.js 14.27.0` / `discord-api-types 0.38.55`を維持した。追加部品は既存Components V2と署名済みintent発行を使用し、[公式Component Reference](https://docs.discord.com/developers/components/reference)の40部品、action row最大5 button、label最大80文字、custom_id 1〜100文字の制約と照合した（2026-10-09）。新しいmodal APIは導入していない。

計算した代表tokenのコントラスト比は本文16.29、補助文字6.02、白/primary 6.30、成功6.52、注意6.37、失敗6.73、操作境界3.22、focus/白4.31。`.local/alpha13-contrast.json`に記録。全画素・全状態の測定やWCAG全体適合を主張しない。built Nextのfont-familyはGeist/self-hostedとfallbackを確認したが、日本語全glyphの実フォント同定はしていない。

[代表スクリーンショット](alpha13-ui/README.md)は合成データのMac Chromiumによる。外部リクエストはbrowser routingで遮断した。Next公開ページは資格情報を渡さないenv whitelistで起動した。通常のconsole画像は実コンポーネントを組み立てた隔離harnessであり、実OAuth済みserverの画面ではない。

## 未完了・公開前ゲート

- 詳細設計全体の完全受入は未完了。従来フォーム/wizardを維持しており、全フォームへの共通の未保存離脱確認や全画面filter復元の新設は行っていない。詳細分析のWebネイティブUIも上記の既存構造上の境界として残る。
- 全13画面の実データ入り視覚受入、screenreader、実Discord/OAuth/Hosted、Windows 11、全回帰/重いE2E、性能・容量、本番backup復元はNOT RUN（alpha.14〜15の別ゲート）。
- 既知の40P01、SHOWCASE sourceメタデータ、実環境受入、最新削除状態を含むbackup復元、容量・Windows 11の確認は未解決として保持する。
- alpha.12毎分上限テストの過去の1回失敗→無変更再実行成功は原因未確定。今回のPASSを原因解明として扱わない。
- 実配備先のsupport/削除依頼窓口は未確認。未設定なら公開blocker。UIに架空窓口を作って解決済みにはしない。

許可範囲はローカルコード/文書/検証/commitまで。push、PR、merge、deploy、実資格情報作成・設定、本番DB/network/Tunnel/DNS、実Discord投稿/OAuthは未実施。
