# Project NEXUS Clear Product Phase A 実装報告

2026年10月12日。公式サイトのローカル実装と検証を完了しました。合成データのHTML Hero、既存の操作デモ、実製品の表示コンポーネントから撮影した機能紹介を、白と青を基調とする公開サイトに統合しています。変更は未コミットです。

**後続作業の追記：** 本文はPhase A完了時点の記録です。その後、オーナーがPhase Bへの進行を明示的に承認しました。Dashboardの表示改善、製品画像の再撮影、公開サイトの再検証と現在の差分は[Phase B報告](./clear-product-phase-b-report.md)に記載しています。以下の「Phase B未開始」「Dashboard差分なし」、画像サイズ・件数・性能値はPhase A完了時点を指します。`before/` は保持し、`after/` は最新の公開画面検証で再撮影しています。

## A. 実装概要

| 項目 | 結果 |
| --- | --- |
| 作業前branch | `master` |
| 作業前HEAD | `d370faaab3fb8e5c86710ee7c0699476b204b018` |
| 作業前差分 | clean。既存の未コミット差分なし |
| 作業後HEAD | 同じSHA。commit・push・PR・deployなし |
| 作業後差分 | 25ファイル。変更12、追加12、削除1。すべて未コミット |
| 実行環境 | Windows、Node 24.18.1、pnpm 11.19.0、Next.js 16.3.5、React 19.3.0 |
| 対象 | Home、Product、共通Navigation／Footer、Pricing、News／Support／Legalの公開表示 |
| 対象外 | ログイン後Dashboard刷新、課金・収集・認可・保存・削除処理、法務本文、外部サービス設定 |

`apps/web/AGENTS.md` と同梱Next.jsガイドを確認して実装しました。公開ルートは `/`、`/product`、`/pricing`、`/news`、`/news/[id]`、`/support`、`/legal`、`/terms`、`/privacy`、`/legal/beta`、`/legal/operator`、`/legal/history` を調査しています。言語は既存の `nexus_locale` cookie／Accept-Languageの判定を継続します。

通常の最大コンテンツ幅は1200px、Heroプレビューは1140px。Hero見出しはDesktop最大54px、日本語48px、Mobile 28〜36pxです。Geistと既存の日本語フォント指定を継承し、日本語見出しの字間と意味単位の折返しを調整しました。細い境界線、読みやすい本文、短いボタン遷移を使い、常時動く演出や依存ライブラリは追加していません。

## B. 変更ファイル

| ファイル | 変更理由 |
| --- | --- |
| `apps/web/app/page.tsx` | 確定Heroコピー、主要CTA `/#demo`、副CTA `/product`、Beta参加案内、操作デモ見出し |
| `apps/web/app/landing/hero-example.tsx` | 静止画Heroを初期HTMLの閲覧専用Dashboard表示へ変更 |
| `apps/web/app/landing/hero-data.ts` | 実製品の表示モデル型に整合する合成fixtureを追加 |
| `apps/web/app/landing/clear-product.css` | 公開サイトだけに適用する文字・余白・プレビュー・機能紹介・reflow・reduced-motionの設計 |
| `apps/web/app/landing/official-refresh.css` | 置換された旧Hero／公開表示の上書きCSSを削除。新CSSへ役割を統合 |
| `apps/web/app/landing/workflow.tsx` | 活動分析・要確認・対応記録を、説明文と実製品画面の組合せへ変更 |
| `apps/web/app/landing/navigation.css` | 展開メニューを必要幅に限定し、文字中心の2列へ整理 |
| `apps/web/app/landing/beta-notice.tsx` | 移動後も意味が通るよう「以下の／below」の方向指定のみ削除。条件・数値・分岐は不変 |
| `apps/web/app/product/page.tsx` | HTMLプレビュー、デモ／機能へのCTA、共通の機能紹介を適用 |
| `apps/web/app/public-ui.tsx` | 共通SiteShellに公開専用スタイルを適用 |
| `apps/web/app/pricing/page.tsx` | Beta案内を5プランの後へ移動し、通常プランと区別 |
| `apps/web/app/pricing/pricing.css` | カード幅と余白、条件・機能・詳細リンクの文字サイズを調整 |
| `apps/web/app/support/page.tsx` | Beta／導入・設定／一般サポート／権利請求への案内を整理 |
| `apps/web/public/nexus/screens/feature-analysis-ja.png` | 実ObservationChartを合成データで描画した日本語画像 |
| `apps/web/public/nexus/screens/feature-analysis-en.png` | 同じ分析表示の英語画像 |
| `apps/web/public/nexus/screens/feature-attention-ja.png` | 実Attentionを合成データで描画した日本語画像 |
| `apps/web/public/nexus/screens/feature-attention-en.png` | 同じ要確認表示の英語画像 |
| `apps/web/public/nexus/screens/feature-history-ja.png` | 実HomeSummaryの「最近の対応記録」を抜粋した日本語画像 |
| `apps/web/public/nexus/screens/feature-history-en.png` | 同じ対応記録表示の英語画像 |
| `tests/e2e/render-clear-product.tsx` | 実表示コンポーネントと合成fixtureを使う画像生成元 |
| `tests/e2e/clear-product-capture.spec.ts` | 明示opt-inの実画面撮影と変更前のローカル記録 |
| `tests/e2e/clear-product.spec.ts` | 公開ページの7幅、日英、キーボード、JS無効、拡大、性能計測 |
| `tests/e2e/nexus-landing.spec.ts` | 承認コピーとHTMLプレビューの検証、7幅の撮影。既存デモとメニュー検証は維持 |
| `tests/e2e/overview.spec.ts` | 確定したHome見出しへ期待値を更新 |
| `docs/design/clear-product-phase-a-report.md` | 本報告書 |

Next.jsが生成した `next-env.d.ts` の参照先変化は元へ戻しています。package／lockfile、Dashboard表示本体、API、DB migration、News／Legalの公開管理は変更していません。

## C. ページ別の変更結果

| ページ・共通領域 | 結果 |
| --- | --- |
| Home | Hero→HTMLプレビュー→既存デモ→3機能→導入／データ→Beta／通常プラン概要→News入口／FAQ→最終案内の流れ。新規参加者向け設定の説明も維持 |
| Product | 共通のHTMLプレビューと大きな実画面を配置。実装済みの機能説明、操作デモ、Discord／Webの用途説明を維持 |
| Navigation | 製品・使い方・料金・お知らせ・サポートの5入口を維持。既存のクリック、keyboard、Escape、モバイルfocus trap、スクロール制御、JS無効時fallbackを継続 |
| Pricing | Free／Starter／Growth／Scale／Enterpriseを維持。1440pxで5列、狭い画面では3／2／1列。カードの高さ固定なし。比較表／FAQ／購入可否の分岐を維持 |
| News | 共通の本文幅・見出し・余白を適用。公開記事、取り下げ、取得失敗、記事なし、JA／EN revisionの既存ロジックを維持 |
| Support | Beta、導入・設定、一般問い合わせ、権利請求を読み分けられる入口を追加。未稼働窓口や送信機能を新設していない |
| Legal | 既存の公開状態と表示内容を維持し、外側の読み幅と余白を調整。非公開の法務本文を追加・変更・公開していない |
| Footer | 既存リンクと分類を維持。共通コンテナと44pxのリンク高さで読みやすさ・操作性を統一 |

料金の正本は引き続き `packages/settings/src/plan-registry.ts` と `plan-copy.ts`、公開カタログは `apps/web/app/billing/catalog.ts` です。価格、利用上限、権限、grant、比較項目は変更していません。BetaNoticeは配置方向を示す「以下の／below」のみ除き、既存の承認済み条件を維持しています。無料招待制・全体最大10 Guild・初回30日などを通常プランと分けて表示します。

## D. Hero HTMLプレビュー

| 項目 | 合成fixture |
| --- | --- |
| サーバー | サンプルコミュニティ／Sample community。架空の表示名 |
| 取得状態 | `partial`、一部取得 |
| 要確認 | 2件の候補。未解決問題件数ではない |
| 保存された対応結果 | 1件。`records.length` から導出 |
| 最近の記録 | 同じ1件。Reply Rescue、開始2026-10-01 09:00 UTC、`collecting` |

認証済みHomeSummaryは操作callbackやProductDataと結び付くため、公開Heroへ直接埋め込まず、独立したServer Componentを作りました。純粋なBrand／Iconと既存i18nの対応名を再利用し、fixtureの状態・record形状を `homeSummaryModel` の戻り値型でチェックしています。モデルのimportはtype-onlyです。

Heroのimportと実装にfetch、認証session、Discord API、DB、保存操作はありません。実Guild／実ユーザー／実投稿本文を含まず、ボタン・select・リンクも配置していません。JA／ENのJS無効テストでも一部取得、2件、1件が初期HTMLに出ることを確認しました。

Desktopは3列、640px以下は1列。合成データ・閲覧専用を明示し、取得できない値を0に変換していません。最近の対応の収集状態と、全体の取得状態は別の情報として示します。

機能紹介画像は、実際の `ObservationChart`、`Attention`、`HomeSummary` にローカルの合成データを渡して撮影しました。既存Dashboardのデザイン・計算・操作ロジックは変更していません。対応記録画像はHomeの最近の記録欄の抜粋で、履歴ページ全体の画像ではありません。全画像に実製品UI・合成データ・抜粋の説明と原寸画像へのリンクを付けています。

## E. 参考サイトの反映結果

| 参考サイト | 確認範囲と採用した設計原則 | NEXUSへの適用 |
| --- | --- | --- |
| [OpenAI](https://openai.com/ja-JP/) | 本文とナビ項目は取得。ブラウザは確認待ち画面で、トップページの視覚・操作は未確認。明確な分類と簡潔な導線を参照 | 5入口を保ち、必要幅だけ展開する文字中心のNavigationと共通の見出し階層 |
| [Base44 Superagents](https://base44.com/superagents) | 公開ページの見出しとビジュアルを目視。ユーザー添付画像も参照。大きなメッセージと製品ビジュアルの比率 | Heroコピーの下に幅1140pxの製品概要。特殊演出・3D・他社素材は使っていない |
| [Linear](https://linear.app/) | 公開画面と製品UIの配置を目視。説明と画面の対応、機能単位の整理 | Home／Productの3機能を文章40%・画面60%を基本とする配置へ |
| [Plausible](https://plausible.io/) | 公開画面とデモへの導線を目視。値・期間・根拠の近接配置 | 既存デモをHero直後に大きく配置。実グラフの期間・軸・欠測・0の表示を維持 |
| [ChatGPT Pricing](https://chatgpt.com/ja-JP/pricing/) | 指定の `/#pricing` は料金カードを表示しなかったため、公式料金ページへ移動して目視。名前・用途・価格・CTAの縦位置と比較表への流れ | 既存subgridの整列を維持し、5プランの幅と文字を調整。Betaをカード群の後へ分離 |
| [Discourse](https://www.discourse.org/)／[管理Dashboard記事](https://meta.discourse.org/t/better-insights-into-your-community-with-the-redesigned-admin-dashboard/404528) | 公開ページと記事を目視。管理者が概要から詳細へ進む情報構造 | Heroを取得状態・要確認・保存記録の順に整理し、最近の記録をその下へ |

参考サイトの全操作・全breakpointを検証したものではありません。他社のコード、画像、ロゴ、機能、価格、導入実績は転用していません。

## F. 検証結果

すべてローカル実行です。ログ・画面・計測値は `.local/clear-product-phase-a/` に保存しています。このフォルダはgit管理外です。

| 検証 | 結果 | コマンド・証跡 |
| --- | --- | --- |
| TypeScript | PASS | `corepack pnpm typecheck`、`final-typecheck.log` |
| ESLint | PASS | `corepack pnpm lint`、`final-lint.log` |
| Production build | PASS | `corepack pnpm --filter @nexus/web build`、`final-build.log` |
| 関連unit | PASS、7ファイル115件 | 下記コマンド、`unit.log` |
| 公開管理integration | PASS、14件 | `corepack pnpm exec vitest run --config vitest.integration.ts tests/integration/official-publications.test.ts`、`publications-integration.log` |
| 最終公開サイトE2E | PASS、13件 | `corepack pnpm exec playwright test tests/e2e/nexus-landing.spec.ts tests/e2e/clear-product.spec.ts --reporter=line`、`final-public-e2e.log` |
| 最終画面撮影 | PASS、日英の7幅 | `corepack pnpm exec playwright test tests/e2e/nexus-landing.spec.ts -g 'seven widths' --reporter=line`、`final-screenshots.log` |
| 既存polish／overview | PASS、16件 | 同2ファイルを公開サイトE2Eと合わせて実行、`public-e2e.log` |
| 差分の空白エラー | PASS | `git diff --check` |

関連unitの実行コマンド：

```powershell
corepack pnpm exec vitest run tests/unit/alpha14-home.test.ts tests/unit/alpha14-charts.test.ts tests/unit/official-news.test.ts tests/unit/official-legal-public.test.ts tests/unit/legal-candidates.test.ts tests/unit/publication-markdown.test.ts tests/unit/stripe-pricing-page.test.ts
```

途中の29件のE2E実行では28件成功・英語keyboardテスト1件失敗でした。Navの初期化前にキー入力を送っていたため、テストに既存のenhanced状態を待つ条件を追加しました。keyboard単独の2言語と、その後の公開サイト13件を再実行して成功しています。製品のNavロジックをテストのために変更していません。

### Responsive と Accessibility

| 項目 | 結果と範囲 |
| --- | --- |
| 幅 | PASS：1440／1280／1024／768／390／375／320px |
| 日英 | PASS：Homeおよび10公開ページで各幅を検証。単一H1、ページ横overflow、可視テキストのはみ出し、画像ロードを確認 |
| 主要導線 | PASS：Heroのデモ／Productリンク、Nav5入口、言語切替の既存導線、5プランと購入不可表示 |
| keyboard | PASS：skip link、DesktopメニューのEnter／Escape／focus復帰、Mobile focus trap／Escape／スクロール復帰、デモの矢印／Home／End |
| デモ | PASS：概要／対応例／データ説明、7日／30日、詳細開閉、リセット。fixtureとグラフ実装は不変 |
| 固定Header | PASS：デモアンカーがHeader下に配置されることを測定。公開section／見出しに88pxのscroll margin |
| reduced-motion | PASS：公開配下のanimationなし・transition 0秒を日英で確認 |
| JavaScript無効 | PASS：日英320pxでHome＋10公開ページを読める。Heroの3状態、fallback Navを確認。ブラウザから外部への要求なし |
| 200% | PARTIAL：CSS `zoom: 2` で日英Homeの表示と横overflowを確認。ブラウザメニューによるネイティブ200%操作はNOT RUN |
| 400%相当reflow | PASS：1280pxの400%に相当する320 CSS pxで日英の公開ページを検証。ネイティブ400%操作はNOT RUN |
| contrast | PASS：今回の主要色の計算値は下表。全既存画面の全色を監査したものではない |
| 読み上げ・実機 | NOT RUN：NVDA／VoiceOver、実機touch、Safari／Firefox。WCAG 2.2 AAの全項目適合を保証するものではない |

画像とグラフ、比較表の横スクロールは領域内に限定しています。機能画像には意味を説明するaltを付与し、フォーカス可能なスクロール領域と原寸表示を用意しました。

| 前景／背景 | contrast ratio |
| --- | --- |
| `#17212B`／white | 16.29:1 |
| `#526171`／white | 6.35:1 |
| `#526171`／`#F7F9FC` | 6.02:1 |
| `#2758CA`／white | 6.30:1 |
| `#1F47A8`／white | 8.32:1 |
| 一部取得 `#805100`／white | 6.79:1 |
| 収集中 `#365581`／`#F0F4FB` | 6.86:1 |

### 既存機能と公開境界

Newsの公開／取り下げ／取得不能、LegalのPrivate／Publicと候補本文の非露出は関連unitと公開管理integrationで確認しています。動的な公開記事本文の全組合せを画面比較したものではありません。Pricingの正本・比較表・FAQ、ログイン後Dashboard、認証・認可、集計・保存・削除のコードは差分なしです。ローカルE2Eは既存の合成fixture環境を使用し、実Discord・Stripe・本番サービスに接続していません。

### Performance

同じローカル開発用E2E環境、JA／1440pxで取得した単回計測です。HTML bytesはロード後DOMのシリアライズサイズで、圧縮済み配信サイズではありません。キャッシュ・開発時処理・warm-upの影響を制御しておらず、速度改善の証明には使いません。

| ページ | DOM HTML bytes 変更前→後 | Resource数 | Resource転送bytes | DOMContentLoaded ms |
| --- | --- | --- | --- | --- |
| Home | 82,995 → 92,632 | 21 → 22 | 1,661,875 → 1,762,069 | 243.1 → 100.8 |
| Product | 60,483 → 70,737 | 21 → 22 | 1,661,796 → 1,762,016 | 141.4 → 106.7 |

新しいHeroはServer Componentで、API呼出しやClient Componentを追加していません。6枚の新画像は合計273,571 bytes、各言語では約123KB／150KBです。画像はローカル配信・lazy loading・明示width／heightを使用します。Lighthouse、実運用のLCP／INP／CLS、低速回線の比較はNOT RUNです。

## G. スクリーンショット

ローカルブラウザで実際に撮影した画像です。Homeのファーストビュー、全ページ、Heroプレビュー、機能紹介、操作デモを保存しています。撮影用の生成画像や完成イメージではありません。開発環境のNext.jsインジケータが一部に写っています。

| 画面 | 変更前 | 変更後 |
| --- | --- | --- |
| Home JA Desktop | [1440px](../../.local/clear-product-phase-a/before/ja-1440.png) | [1440px](../../.local/clear-product-phase-a/after/ja-1440.png) |
| Home JA Mobile | [390px](../../.local/clear-product-phase-a/before/ja-390.png) | [390px](../../.local/clear-product-phase-a/after/ja-390.png) |
| Home EN Desktop | [1440px](../../.local/clear-product-phase-a/before/en-1440.png) | [1440px](../../.local/clear-product-phase-a/after/en-1440.png) |
| Home EN Mobile | [390px](../../.local/clear-product-phase-a/before/en-390.png) | [390px](../../.local/clear-product-phase-a/after/en-390.png) |
| Pricing JA Desktop | [1440px](../../.local/clear-product-phase-a/before/ja-pricing-1440.png) | [1440px](../../.local/clear-product-phase-a/after/ja-pricing-1440.png) |
| Product JA Mobile | [390px](../../.local/clear-product-phase-a/before/ja-product-390.png) | [390px](../../.local/clear-product-phase-a/after/ja-product-390.png) |

追加の確認画像：[HTMLプレビューDesktop](../../.local/clear-product-phase-a/after/ja-hero-preview-1440.png)、[同Mobile](../../.local/clear-product-phase-a/after/ja-hero-preview-390.png)、[3機能](../../.local/clear-product-phase-a/after/ja-features-1440.png)、[操作デモ](../../.local/clear-product-phase-a/after/ja-demo-1440.png)、[EN最小320px](../../.local/clear-product-phase-a/after/en-320.png)。News、Support、Legal各ページの日英Desktop／Mobile画像も `after/` に保存しています。

## H. 残課題とPhase Bへの引継ぎ

- Phase A内で実施したテストの未解消FAILはありません。手動の読み上げ、実機、多ブラウザ、ネイティブzoom、production性能測定は未実施です。
- 独立した `next start` プレビュー起動は自動承認レビューで拒否されました。返却理由は `blocked by policy` で、具体的な理由は示されていません。画面確認は既存の隔離E2Eサーバーで完了しています。
- Newsの取得不能、法務文書の未公開、問い合わせ・購入の提供準備状態は現行仕様のままです。表示改善を理由に稼働中へ変更していません。
- Phase Bでは実Dashboard／グラフの字の大きさ、凡例・軸・比較色、要確認／対応記録の密度を検討できます。今回は実画面画像の真正性を優先し、その元の表示を変更していません。
- 機能紹介画像は実表示部品の変更に合わせて再撮影する必要があります。明示環境変数 `NEXUS_CAPTURE_PRODUCT_SCREENS=1` で撮影テストを実行できます。過去のbefore画像を上書きするbaseline撮影は通常実行でskipします。
- commit、push、デプロイ、法務の公開、本番設定、実Discord／決済の検証は別の明示的な承認範囲です。Phase Bは開始していません。
