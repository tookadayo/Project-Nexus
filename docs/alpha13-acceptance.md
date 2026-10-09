# alpha.13 追加修正・現在の受入対応表

2026-10-09。`db67cb80f1f00674c85f0d8f26fa213e7b93c459`の限定レビューと継続指示に基づく追加実装。最初の[実装報告](alpha13-ux.md)の「全フォーム離脱確認・filter復元は未実装」という記載を、下記の画面別結果で更新する。モデル指定は引き続きGPT-6 Astra / high（実設定の独立確認は未実施）。

## 文言の追加修正（fa7202b7以後）

[最新の文言修正・検証記録](alpha13-labels.md)を参照。以下の115 unit / 33 integrationと8幅smokeは`fa7202b7deeb71d868d63974b64af1d00476cf50`の検証記録であり、今回の文言修正で再実行したものとは区別する。認可・domain・状態遷移は今回変更していない。

## 不足の具体化と修正

|今回扱った画面|db67cb8で不足していた動作|現在の対応|
|---|---|---|
|Consoleの設定・目的/ルール・改善条件|未保存のscope、staff role、週次通知、helper、目的、改善条件があるまま離脱できた|保存単位のdraft baselineを保持。変更を元に戻せばdirtyを解除し、成功した保存だけbaselineを進める。画面移動・Back・server変更の明示確認と、reload/外部リンクのbeforeunload保護。|
|CommunityModelEditor / RecipeWizard（設定内・view 11）|子componentがunmountすると編集したmodelを失った|model全体のdraftと処理中状態を親へ通知。キャンセル時は入力保持。失敗でdirtyを解除しない。成功したmodelは親でも保持し、戻ったときに保存前の初期値へ戻さない。wizardの必須条件・既存保存APIは維持。|
|分析 / 新規メンバー|Backはviewだけ戻り、分析tab・期間が戻らなかった。refreshは30日へ戻った|既存のtab（overall/channels/behavior）とrange（7/30/90）をallowlistでURL化。serverの初期readにも同じrangeを使用。push/pop/refreshで復元。古いrange requestをabortし、取得中は古い結果を新条件の結果として表示しない。range結果は対象の分析画面に限定。|
|Explore|filterがrefreshで消え、保存ビューの編集中に別ビューへ上書きできた|既存ChartQuery schemaのqをguildと一緒に保存。別guild・不正queryは初期条件へ戻す。名前・shortcut・編集中queryは保存draftとして離脱保護。通常の閲覧filter変更自体は保存操作と扱わない。保存後の再readを現在のquery effectへ統合し、古い条件の応答による上書きを防止。|
|Operations（既存14フォーム）|新navで別ページへ移る際に入力保護がなかった|このcomponent配下のform input/changeと項目追加/削除を追跡。フォームごとに成功した送信時点の編集世代だけ保存済みにする。送信後の追加編集はdirtyのまま。既存recordの編集切替でも確認。リンク/Back/reloadはbeforeunload。新しいフォーム/保存APIは作っていない。|
|Server切替|そのタブの本文非表示だけでは、別タブでCookieが変わった際の対象一致を保証できなかった|下記P1修正。切替前にdraft確認し、キャンセルなら表示と選択を維持。実行時は旧本文を隠して既存/auth/selectへ。表示条件を初期化する旨を切替欄に表示。|

draftはcomponent内メモリーだけに保持し、localStorage、sessionStorage、URL、ログへ書き出していない。URL/history stateにも入力本文・個人情報・token・削除要求を保存しない。beforeunloadの表示文はブラウザの標準文言であり、内部viewの確認文はJA/ENで用意した。ユーザーが離脱を明示的に許可した場合の破棄まで防ぐ仕様ではない。

履歴entryには非機密のscopeとindexだけを記録する。内部Backをキャンセルした場合はhistory.goで元entryへ戻し、pushし直してforward履歴を失わせない。サーバー変更では新しいscopeで再認可し、旧scopeのqueryを流用しない。Operationsのページ選択は従来の`?view=`を継続し、入力フォームの値を閲覧filterとしてURL化していない。

## 限定レビュー4件

|指摘|原因と修正|検証|
|---|---|---|
|P1 `/control`の別タブ誤対象保存|Cookie選択のみでupstream対象を決めていた。clientは表示中guildを`X-Nexus-Guild`へ付加。serverは**既存のsession/live権限/admission確認後**、認可された選択guildとの完全一致を要求し、不一致/欠落は409 `SERVER_SELECTION_CHANGED` / `NOT_STARTED`で終了する。headerを認可には使用しない。|実route unitで、両guildに権限・同じrevisionがあってもstale scopeを拒否しupstream fetch 0件。正常一致、権限喪失、header欠落を確認。UIでもheader、拒否表示、draft保持を確認。|
|P1と同じ原因のread/補助画面|Consoleの4つの/data readと、Explore/Operationsのread/write/exportにも同じ境界を適用した。exportの通常リンクはguild queryを使用し、同じ認可後比較を行う。|stale journey read、Explore/Operationsのread/export/writeがservice処理前に409で止まるunit。既存auth・停止・削除回帰も実施。|
|P2 Operations/Explore暗背景|旧`.surface` gradientが残り、文字だけ暗色になっていた。`.operations-page .surface`も白・本文tokenへ統一。見出し、button、fontも共通tokenへ寄せた。|Mac Chromiumでbackground白・gradient noneをassertし、[Explore画像](alpha13-ui/explore-followup-1440.png)・[Operations画像](alpha13-ui/operations-followup-1440.png)を目視確認。|
|P2 Home件数が初期値|HomeSummaryへ初期propsのresultsを渡していた。現在の`results` stateを渡すよう修正。|setResults経路からHomeSummaryへの同じstate参照を差分確認、typecheck、既存Homeのunknown/0 UI回帰。実サービスでの結果生成はNOT RUN。|
|P3 公式トップfavicon|page metadataの旧mark.svgがlayoutの支給画像を上書きしていた。両方を支給navy-tileへ一致させた。|built Nextの390/1440px public smokeで実際の`link[rel=icon]`をassert。|

新しい認可モデル、権限拡張、DB migrationはない。旧alpha.12/初期alpha.13の開きっぱなしのclientは表示対象headerがないため更新を拒否される。再読み込みが必要になる意図的なfail-closed互換性変更であり、古いタブを推測して別serverへ保存するfallbackは設けない。サーバー側の追加判定は整合性確認であり、元の認可・revision・CSRF/Origin・停止条件の代替ではない。

検証中には、展開したdesktop設定群が主navをflex shrinkで圧縮してクリックできなくなる問題も見つかった。全sidebarをscroll対象にし、子を圧縮しないよう修正。force clickやtimeout延長で通していない。

## 詳細分析のWeb/Discord対応

既存の詳細分析API/履歴は、Discordの`analysisMenu`→条件preview→同じrunの実行状態/結果→`analysisHistory`/比較/Attentionで提供されている。Web view 3は対応・実験の保存結果であり、このrun台帳とは別の責務である。移行前からWebに同等のrun開始・run履歴・比較APIはなく、既存Web入口を削除してDiscordへ強制移動したものではない。

今回の対応は、既存Discordの分析・履歴・比較の入口を維持し、個人ホームにも履歴を追加し、Webで利用先と保存結果の違いを説明するもの。利用者に提示できる既存panelへのWeb deep link情報も、このWeb DTOにはないためURLを推測していない。**新規Web run APIとネイティブWeb実行UIは未実装**であり、新機能の無断追加を避けた既存構造への対応である。将来Web内完結を必須にする場合は、そのAPI/UIを別途具体化する必要がある。今回の既存機能維持や主要ナビ・編集保護を止める判断待ちはない。

## Acceptance matrix（現在版）

PASSは以下に書いた検証範囲を意味する。未実装とNOT RUNを混同しない。

|ID|現在実装・検証|判定と未確認|
|---|---|---|
|A01|320pxを含むdrawerで全旧入口、言語/logout/help、Tab、Escape、起点復帰|PASS（synthetic Chromium）|
|A02|[13画面＋4リンク台帳](alpha13-navigation.md)、旧view 6/7も保持。権限処理は維持|PASS（台帳・route/unit・空状態render）|
|A03|view、分析tab、range、Explore既存queryのBack/Forward/refresh。cancel時の元entry/input保持|PASS。実OAuthを挟む全遷移組合せはNOT RUN|
|A04|server切替時旧本文を隠す。別タブ/stale Back/復元相当のscope要求をserverで拒否。異なるguildのfilter初期化|PASS（route unit＋UI）。実サーバー2台のOAuth受入はNOT RUN|
|A05|現session、live権限、選択guild、scope/admissionの既存境界。client scopeは認可を与えない|PASS（focused unit/integration）|
|A06|unknownと取得済み0を区別。Bot参加と十分なdataをreadyへ混同しない|PASS（presentation/UI）。実収集開始の受入はNOT RUN|
|A07|preview/保存結果再表示で新規消費しない既存domain契約を維持|PASS（既存analysis regression）|
|A08|既存run冪等性/予約・消費を維持。Web送信中guardは同期ref、応答不明の自動mutation再送なし|PASS（domain回帰・code）。実Discord timeoutの受入はNOT RUN|
|A09|既存Attention追加/撤回/重複抑止と権限維持|PASS（analysis integration）|
|A10|期間が異なっても互換なら比較、不一致evidence windowは拒否。欠測を0へ変換しない|PASS（comparison regression）|
|A11|停止/期限案内、認可されたhistory、既存解除・削除導線を維持|PASS（UI＋停止/outbox integration）|
|A12|現権限喪失、個別削除、tenant境界、旧generation拒否|PASS（focused regression）。本番backup復元はNOT RUN|
|A13|変更したナビ/状態/離脱/エラー/Discord入口のJA/EN。raw error非表示|PASS（変更範囲）。旧全コピー全面監査はNOT RUN|
|A14|unknownと実測0の文字/DOMを区別|PASS。screenreader実機はNOT RUN|
|A15|support未設定時に架空連絡先を出さない|PASS（built Next）。実配備先窓口の確認はNOT RUN・未設定なら公開blocker|
|A16|menu/解除dialogのTab/Escape/focus、native beforeunloadを拒否した入力保持|PASS（keyboard/browser）。screenreaderはNOT RUN|
|A17|8幅、長いJA/emoji名、200% CSS文字、展開したdesktop設定群の到達性|PASS。OS文字設定/全実データ/WindowsはNOT RUN|
|A18|JA/EN、共有/個人panel、履歴、unlink preview、既存payload制限|PASS（payload tests）。実Discord投稿はNOT RUN|

その他の設計項目:

|要件|現在の対応|判定|
|---|---|---|
|共有token/ブランド原本|青/紺N、wordmark、紺tileを無加工で使用。Library失敗後のユーザー指定Downloads原本。色・文字・余白を共通化|PASS（原本hash・UI）。Libraryとのbyte同一性は未確認|
|Home→詳細|最大3summary＋既存詳細、現在の結果state、欠測と0を区別|PASS|
|初期設定|既存wizardを再利用、必須条件を解除せずdraft保護を追加。通知skipで空配列保存する新処理なし|PASS（code・focused UI）。実招待からの全手順はNOT RUN|
|設定保存/失敗|保存単位draft、成功時だけbaseline更新、失敗/競合/送信後追加編集を保護|PASS（合成保存成功/失敗・追加編集回帰）|
|メニュー/外部連携/ヘルプ|旧入口を保持。Discord接続とAPI/Webhookの責務を維持|PASS|
|全画面の新しい確認dialogへの統一|menu/解除はnative dialog、離脱はbrowser標準confirm/beforeunload。既存preview/差分確認を再利用|対応済み。無関係な旧フォームの確認UI全面刷新は未実装・今回の必須不足にはしない|
|履歴/比較のWeb内完結|既存Discordフローを案内。対応結果とrun履歴を混同しない|既存機能維持はPASS。新しいWeb run機能は未実装（上記理由）|
|常設context幅/全tableの新カード化|必要時の詳細は既存detail UIを利用。全画面に新しい320px context列を作る変更は行わない|提案寸法を既存構造へ対応。全実データtable視覚受入はNOT RUN|
|ローカル運営画面|外観刷新の後回しを維持|対象外（承認された優先順位）|

## 最終検証記録

作業branch `codex/alpha13-ux`。対象は`db67cb8`上の追加未commit差分を含む最終コード。検証後は文書/証跡のみを追加してcommitし、最終SHAとログhashを`.local/alpha13-followup-handoff.md`および`.local/alpha13-followup-receipt.json`へ記録する。Mac Node 24.19.0 / pnpm 11.19.0。依存追加なし。

以下の`pnpm`は固定runtime PATHと`.local/bin/pnpm --config.verify-deps-before-run=never`を使用する。

|コマンド|結果|ログ `.local/`|
|---|---|---|
|`pnpm typecheck`|PASS / exit 0|`alpha13-followup-typecheck-final.log`|
|`pnpm lint`|PASS / exit 0|`alpha13-followup-lint-final.log`|
|`pnpm build --concurrency=2 --force`|PASS / exit 0、21/21、cacheなし|`alpha13-followup-build-final.log`|
|focused unit（下記）|PASS / exit 0、115件/9ファイル|`alpha13-followup-unit-final.log`|
|focused integration（下記）|PASS / exit 0、33件/4ファイル|`alpha13-followup-integration-final.log`|
|`node --import tsx tests/ui/alpha13-smoke.ts`|PASS / exit 0、追加flowは`alpha13-followup-checks.ts`|`alpha13-followup-smoke-final.log`|
|`node --import tsx tests/ui/alpha13-public.ts`|PASS / exit 0|`alpha13-followup-public-final.log`|
|`node --import tsx scripts/secret-scan.ts` / `git diff --cached --check`|PASS / exit 0|`alpha13-followup-secrets-final.log` / 差分check出力なし|

```sh
pnpm exec vitest run tests/unit/alpha13-ux.test.ts tests/unit/alpha13-server-boundary.test.ts tests/unit/alpha11-analysis.test.ts tests/unit/panels.test.ts tests/unit/auth-hardening.test.ts tests/unit/session-lifecycle.test.ts tests/unit/server-verification.test.ts tests/unit/alpha12-configuration.test.ts tests/unit/v05.test.ts
pnpm exec vitest run --config vitest.integration.ts tests/integration/alpha12-beta.test.ts tests/integration/alpha12-sessions.test.ts tests/integration/alpha12-outbox.test.ts tests/integration/alpha11-analysis.test.ts
```

初期FAILは保持している。新規unit fixtureのOrigin/Host/Sec-Fetch-Site不足、fixture Header型、UIテストの選択肢を含むlabel一致を実契約に合わせて修正した。React状態反映にはcondition pollingを使用。desktop navの圧縮は実コードを修正した。既存テスト削除・skip・assertion緩和・timeout延長はしていない。

テストは合成データと隔離ローカルDB。UIのAPI応答はmock、外部browser要求は遮断。実Discord/OAuth、Windows 11、重い全体E2E、性能/容量、本番backup復元、screenreaderはNOT RUN。40P01、SHOWCASE sourceメタデータ、実環境受入、最新削除状態を含むbackup復元、容量/Windowsの公開前ゲートを維持する。alpha.12毎分上限テストの過去の一過性FAILは原因未確定のまま。公開可能とは宣言しない。

push・PR・merge・deploy・本番操作・実資格情報設定・実Discord送信は未実施。


## R1–R5 / N1–N2 追加実装（2026-10-09）

`ff2e403`からの追加承認範囲、再現・修正・検証・残る制約は [alpha13-rn-acceptance.md](alpha13-rn-acceptance.md) に記録する。上記の旧検証結果は各旧SHAの証跡として保持する。
