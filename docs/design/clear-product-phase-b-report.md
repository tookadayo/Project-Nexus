# Project NEXUS Clear Product Phase B 実装報告

2026年10月12日。Phase Aの受入確認後、オーナーの「Phase AがもうよさそうであればPhase Bに進んでください」に基づき、Dashboardと分析画面の表示改善をローカルで実装・検証しました。変更はすべて未コミットです。

## A. 実装概要と作業状態

| 項目 | 結果 |
| --- | --- |
| 開始／終了branch | `master` |
| 開始／終了HEAD | `d370faaab3fb8e5c86710ee7c0699476b204b018` |
| Phase B開始時 | Phase Aの25ファイルの未コミット差分を保持 |
| 現在の差分 | Phase A＋Bの33ファイル。変更16、追加16、削除1 |
| 対象 | Dashboard共通表示、Home、分析、要確認、履歴、Explore。その他Dashboard内画面への共通CSSの影響も確認 |
| 外部操作 | commit、push、PR、deploy、本番設定変更なし |
| 業務処理 | 認証・認可、集計・収集、保存・削除、課金、Discord操作、News／Legal公開管理は変更なし |

Phase Aのtypecheck・lint・build、公開ページの受入テストに未解消FAILがないことを確認して移行しました。[Phase A報告](./clear-product-phase-a-report.md)にその時点の結果を保存しています。Phase B後も、公開ページ・5プラン・操作デモ・JS無効時の公開内容を再確認しました。

## B. 変更ファイル

Phase Aから追加・更新したファイルです。

| ファイル | 変更理由 |
| --- | --- |
| `apps/web/app/workspace.css` | `.nx-workspace` を付けたConsole／Exploreに限定し、文字、余白、白い本文、淡いサイドバー、境界線、操作欄、比較グラフ、focus、reflow、reduced-motionを統一 |
| `apps/web/app/console.tsx` | スタイルを適用。本文へのskip linkとfocus先を追加。履歴内の重複H1をH2へ変更 |
| `apps/web/app/explore/page.tsx` | Exploreにも共通表示と本文へのskip linkを適用。既存のscope・query・権限処理は不変 |
| `apps/web/app/landing/workflow.tsx` | 再撮影した製品画像の正しいwidth／heightへ更新し、レイアウトずれを防止 |
| `apps/web/public/nexus/screens/feature-analysis-ja.png` | 実ObservationChart＋合成データで更新後の日本語画面を撮影 |
| `apps/web/public/nexus/screens/feature-analysis-en.png` | 同じ英語画面 |
| `apps/web/public/nexus/screens/feature-attention-ja.png` | 実Attention＋合成データで日本語画面を再撮影 |
| `apps/web/public/nexus/screens/feature-attention-en.png` | 同じ英語画面 |
| `apps/web/public/nexus/screens/feature-history-ja.png` | 実HomeSummaryの最近の対応記録を再撮影 |
| `apps/web/public/nexus/screens/feature-history-en.png` | 同じ英語画面 |
| `tests/e2e/clear-workspace.spec.ts` | 日英・13 Dashboard表示＋Explore・7幅、グラフ欠測／0、keyboard、skip link、menu、拡大、記録あり履歴の検証と撮影 |
| `tests/e2e/render-clear-workspace.tsx` | 実Consoleを使う保存済み記録の隔離SSR fixture。未確認と観測値0を別々に設定 |
| `tests/e2e/alpha14-acceptance.spec.ts` | 既存のHome状態テストでも新CSSを読み込む。期待する状態・件数・動作は不変 |
| `tests/fixtures/alpha14-home-browser.tsx` | 既存の状態fixtureへ実画面と同じ表示クラスを適用 |
| `tests/e2e/render-clear-product.tsx` | 公開サイトの実画面素材にも新CSSを適用 |
| `tests/e2e/clear-product-capture.spec.ts` | 再撮影用クラスとPhase Bの画像寸法記録先を設定。過去のbefore画像は維持 |
| `docs/design/clear-product-phase-a-report.md` | Phase B承認後の追記。Phase A当時の結果は保存 |
| `docs/design/clear-product-phase-b-report.md` | 本報告 |

package／lockfileや新しいClient Componentは追加していません。Next.js生成ファイル `next-env.d.ts` に最終差分はありません。

## C. 画面別の結果

| 画面 | 結果 |
| --- | --- |
| Home | 「取得状態→確認したい投稿→最近の対応記録→参加の動き」の既存優先順位を維持。本文16px、主要補助説明14px、状態と件数を読みやすく整理 |
| Navigation | 選択中の項目に青い背景と左線。既存の折りたたみ・メニュー・移動先を保持。モバイルdialog中は背景スクロールを抑止 |
| 要確認 | 対象条件、フィルター、対象時点、候補、記録欄の余白を整理。主要操作は44px以上。状態・返信の意味や記録処理は不変 |
| 履歴 | H1を1つに整理。比較ラベル14px、値30px、Mobileでは前後の値を縦配置。未確認「—」と「0.0%」を区別 |
| 分析 | 既存タブを軽い境界線と選択色で整理。新規メンバー・チャンネル等の定義は不変 |
| Explore | 条件欄、期間、凡例、合計、値一覧の余白と文字を統一。本期間は青、比較期間は青灰色の破線・四角。欠測の「?」は維持 |
| その他Dashboard | 新規メンバー、改善、設定、ルール、Journeys、Community Model、連携、Coverage、Collectionの横はみ出しを日英で確認 |
| 公式サイト | 機能紹介の6画像を更新後の実表示へ同期。Heroの合成データと操作デモの挙動は維持 |

OpenAIの文字と余白、Linearの実画面中心の説明、Plausibleの凡例・数値の見やすさ、Discourseの概要から詳細へ進む情報順序というPhase Aの研究原則を引き継ぎました。各参考サイトの確認範囲・制限はPhase A報告Eに記載しています。Phase Bで参考サイトの新しい操作確認を行ったものではありません。

## D. データ・安全性

- Dashboardの実装へデータfixtureを埋め込んでいません。テスト環境は既存の隔離PostgreSQL／合成Guildを使用します。
- 要確認・Exploreの画面確認はブラウザ内の明示的な合成レスポンスを使用。認証を緩和する変更はありません。
- 開発用認証だけでは `/data/attention` の署名済みセッションが成立せず、最初のbaseline試行は2件のテスト失敗でした。既存alpha14と同じ方式で表示専用fixtureを用意し、変更前の画面を再取得しました。実サービスでの認証検証PASSとは扱いません。
- 記録あり履歴は実ConsoleのSSR表示で確認しています。操作はhydrateせず、実通信を遮断しています。撮影対象は記録パネルの抜粋です。
- UNKNOWN／欠測を0にせず、PARTIALをCOMPLETEにしません。スタッフの対応済みや返信を、問題解決の保証として扱う変更はありません。
- API、DB、Bot、認可、保存、削除、課金、公開管理の実装ファイルはPhase B差分に含まれません。

## E. 検証結果

コマンドはリポジトリルートで実行しました。ログは `.local/clear-product-phase-b-*.log` に保存しています。

| コマンド／確認 | 結果 | 証拠 |
| --- | --- | --- |
| `corepack pnpm typecheck` | PASS | 最終 `clear-product-phase-b-final-typecheck.log` |
| `corepack pnpm lint` | PASS | 最終 `clear-product-phase-b-final-lint.log` |
| `corepack pnpm --filter @nexus/web build` | PASS | 最終 `clear-product-phase-b-final-build.log`。TypeScriptと34ページの生成を完了 |
| `corepack pnpm exec vitest run tests/unit/alpha14-home.test.ts tests/unit/alpha14-charts.test.ts tests/unit/chart-spec.test.ts tests/unit/presentation.test.ts` | PASS・34 tests | `clear-product-phase-b-unit.log` |
| `corepack pnpm exec playwright test tests/e2e/alpha14-acceptance.spec.ts tests/e2e/clear-workspace.spec.ts tests/e2e/quality.spec.ts --reporter=line` | PASS・16 tests | 初回 `clear-product-phase-b-e2e.log` |
| `NEXUS_CAPTURE_PRODUCT_SCREENS=1` ＋ `playwright test tests/e2e/alpha14-acceptance.spec.ts tests/e2e/clear-workspace.spec.ts tests/e2e/clear-product-capture.spec.ts --reporter=line` | 15 PASS・1 FAIL・1 SKIP、その後FAIL解消 | `clear-product-phase-b-refinement.log`。alpha14全12件と画像生成はPASS。新しい履歴テストの期待値を、既存の正しい小数表記「0.0%」へ修正。baseline撮影は意図したSKIP |
| `corepack pnpm exec playwright test tests/e2e/clear-workspace.spec.ts tests/e2e/clear-product.spec.ts tests/e2e/nexus-landing.spec.ts tests/e2e/quality.spec.ts --reporter=line` | PASS・18 tests | `clear-product-phase-b-final-e2e.log` |
| `corepack pnpm exec playwright test tests/e2e/clear-workspace.spec.ts --reporter=line` | PASS・3 tests | 最後の比較ラベル調整後 `clear-product-phase-b-final-workspace.log` |

最終差分に未解消のテストFAILはありません。最後のCSS変更は比較ラベルのみで、その後に関連画面、lint、production buildを再確認しました。全バックエンドintegration suite、実Discord、Hosted Beta、Stripe、実利用者のセッションでの検証はNOT RUNです。

### Responsive / Accessibility

| 項目 | 確認範囲と結果 |
| --- | --- |
| 日英・7幅 | 1440／1280／1024／768／390／375／320px。13 Dashboard表示＋Exploreのページ全体の不要な横スクロールなし |
| 記録あり履歴 | 1440／768／390／320px、日英で確認。見出し1つ、未確認と0の値が別表示 |
| Keyboard | Home主要操作、Console skip link、モバイルメニューのEnter／Escape／focus復帰、グラフ点のEnter／Escape／focus復帰を確認 |
| 状態・欠測 | alpha14のHome 7状態、要確認101候補・ページ移動・フィルター・スタッフの状態遷移、Explore比較・欠測／0・アクセス表示を確認 |
| Reduced motion | `reduce` で表示確認、主要操作のcomputed transition durationが0sであることを確認 |
| 拡大 | ExploreのCSS zoom 200%を640px viewportで確認。320px reflowも確認。ブラウザのネイティブ200%／400% zoomはNOT RUN |
| コントラスト | 主要本文16.29:1、補助文字6.35:1（淡い背景では6.02:1）、青6.30:1、比較線5.96:1、記録状態6.61:1。色だけで区別しない形・破線・ラベルを保持 |
| JS無効 | 公開サイトの主要内容とHTML Heroを再確認。認証後の操作可能性をJS無効で保証するものではない |
| 未実施 | スクリーンリーダー実機、実スマートフォン、Firefox／WebKit、全状態の自動WCAG監査。WCAG 2.2 AA全面適合とは断定しない |

## F. Performance

新しい依存ライブラリ、API通信、アニメーションライブラリ、Client Componentは追加していません。表示用CSSは未圧縮14,084 bytes。新しいスタイルは対象クラス配下に限定しています。

公開サイトの6枚の製品画像は計289,445 bytes。Phase A完了時273,571 bytesから15,874 bytes増えました。文字と余白を大きくした実画面への更新によるもので、画像ごとの寸法を `workflow.tsx` に反映しています。lazy loadingを維持しています。

production buildはPASSです。実運用LCP／INP／CLS、Lighthouse、低速回線、ネイティブzoomでの性能測定はNOT RUN。開発サーバーの単回計測を性能改善の証明には使用していません。

## G. スクリーンショット

以下はローカル限定・Git管理外の撮影保存先です。画像はリポジトリに同梱していません。

実際のローカルブラウザ撮影です。変更前56枚、変更後94枚を `.local/clear-product-phase-b/` に保存しました。開発認証の注意表示やNext.jsインジケータが写っているものがあります。サンプルは合成データで、実績ではありません。

| 画面 | 変更前 | 変更後 |
| --- | --- | --- |
| Home JA Desktop | 1440px（ローカル限定: `../../.local/clear-product-phase-b/before/ja-home-1440.png`） | 1440px（ローカル限定: `../../.local/clear-product-phase-b/after/ja-home-1440.png`） |
| Home JA Mobile | 390px（ローカル限定: `../../.local/clear-product-phase-b/before/ja-home-390.png`） | 390px（ローカル限定: `../../.local/clear-product-phase-b/after/ja-home-390.png`） |
| 要確認 EN Desktop | 1440px（ローカル限定: `../../.local/clear-product-phase-b/before/en-attention-1440.png`） | 1440px（ローカル限定: `../../.local/clear-product-phase-b/after/en-attention-1440.png`） |
| 要確認 JA Mobile | 390px（ローカル限定: `../../.local/clear-product-phase-b/before/ja-attention-390.png`） | 390px（ローカル限定: `../../.local/clear-product-phase-b/after/ja-attention-390.png`） |
| Explore EN Desktop | 1440px（ローカル限定: `../../.local/clear-product-phase-b/before/en-explore-1440.png`） | 1440px（ローカル限定: `../../.local/clear-product-phase-b/after/en-explore-1440.png`） |
| Explore EN Mobile | 390px（ローカル限定: `../../.local/clear-product-phase-b/before/en-explore-390.png`） | 390px（ローカル限定: `../../.local/clear-product-phase-b/after/en-explore-390.png`） |
| 分析 JA Desktop | 1440px（ローカル限定: `../../.local/clear-product-phase-b/before/ja-analysis-1440.png`） | 1440px（ローカル限定: `../../.local/clear-product-phase-b/after/ja-analysis-1440.png`） |
| 履歴 JA Desktop | 1440px（ローカル限定: `../../.local/clear-product-phase-b/before/ja-history-1440.png`） | 1440px（ローカル限定: `../../.local/clear-product-phase-b/after/ja-history-1440.png`） |

追加：記録あり履歴・Desktop抜粋（ローカル限定: `../../.local/clear-product-phase-b/after/populated-history-ja-1440.png`）、同EN 320px抜粋（ローカル限定: `../../.local/clear-product-phase-b/after/populated-history-en-320.png`）、Home JA 320px（ローカル限定: `../../.local/clear-product-phase-b/after/ja-home-320.png`）、Explore CSS zoom 200%（ローカル限定: `../../.local/clear-product-phase-b/after/en-explore-200-percent.png`）。

## H. 残課題

- 実機・多ブラウザ・読み上げ・ネイティブzoom・production性能測定は未実施です。
- 本番相当の署名済みセッションでの要確認／Explore接続確認は、このローカル表示検証とは別に必要です。アプリの認証要件は維持しました。
- 設定・運用系の業務フローや入力項目を組み替える情報設計変更は行っていません。対象画面の既存機能・新規参加者設定は保持しています。
- commit、push、公開、デプロイ、実Guild操作は実施していません。成果はローカル差分としてレビューできます。
