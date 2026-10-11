# NEXUS — alpha.11 分析結果の説明と対応への導線

**Type:** REVIEW

**Status:** Final — ローカル実装・検証の記録。公開・本番受け入れは未実施。

## 1. 結論

- 保存済み分析の値・根拠・期間・対象範囲・欠損を、日本語と英語で説明する。日本語の画面には「集計期間」「確認できた投稿」「集計できていないデータ」など、内容に合う表現を使う。
- 結果から既存 Attention、対応記録、History、Compare に移動できる。既存の状態とイベント履歴を再利用し、完了・撤回した記録も閲覧できる。
- 対応記録の完了は、返信・問題解決・改善の証明ではない。操作は保存済み分析値と消費履歴を変更しない。
- 比較は同一定義・互換性のある対象範囲・集計方法、十分なデータ、同じ長さで重ならない期間を必要とする。カレンダー日や隣接期間の一致は求めない。非互換時は不足理由を表示する。
- 新しいデータモデル・migration・収集・権限モデル・課金・ホスティングは追加していない。Web dashboard は維持する。

## 2. 前提・目的

**確定:** 承認された目的は、管理者が結果を理解し、次の対応を選び、後から比較へ進むこと。対象は既存分析体験の改善と短い関連検証、ローカル commit まで。

開始時と最終確認時の元 checkout `/Users/rei/Documents/GitHub/Project-Nexus` は clean な `master`、HEAD `9ed3af8f94b2c760f52894b5cdca4da8b5695de7`。この確認範囲で別チャットとの変更重複は見つからなかった。元の `.git` を変更せず、書き込み可能な専用ローカル clone `/Users/rei/Documents/Codex/2026-10-08/task-3/Project-Nexus` の `codex/alpha11-analysis-experience` で作業した。

関連する root `AGENTS.md`・`.agents/skills` は存在しない。`apps/web/AGENTS.md` と、生成宣言の扱いに関するインストール済み Next.js TypeScript ドキュメントを確認した。Web のソース変更は行っていない。build による `next-env.d.ts` の生成先差分はパッチから除いた。

**In Scope:** 結果・基本分析の説明、保存済み根拠と対象の表示、既存対応状態・履歴・比較への導線、非互換理由、権限と期限切れの回帰検証。

**Out of Scope:** 自動介入、自由入力の対応ノートや担当者管理の新設、収集範囲や既存集計式の変更、権限モデル、課金、deployment、公開、全体 E2E、性能調査。

## 3. 設計判断

**Recommended / 実装済み:** `AnalysisResult` と `MetricEvidence`、保存された run 条件・対象 ID、既存 `attention_items` / `attention_events` を使う。別の対応台帳は作らない。

| 判断 | 採用 | 不採用理由 |
|---|---|---|
| 説明の根拠 | 保存した evidence と定義版に対応する固定説明 | AIによる補完は不明を事実に変える危険があり、今回の価値に不要 |
| 対応の記録 | 既存の確認・完了・撤回と状態履歴 | 別モデルは重複とmigrationを生み、承認範囲を超える |
| 比較 | SQLで互換対象を選別し、共通関数で指標ごとに再確認 | 同じ日数だけの比較や、最近の少数件だけを探す方式では不適合 |
| モバイルの表示 | 結果は主要3指標、詳細は2指標/頁、保存した場所は5件/頁 | 全指標・全場所を一度に表示すると読みにくく、Discordの上限を超える |

既存 `RESOLVED` の意味を分析画面では「対応記録を完了」と説明する。既存の状態値・自動応答の判定・他画面の状態契約は変更しない。撤回は既存 `DISMISSED` を使い、再開や新しい業務状態は追加しない。

## 4. 詳細仕様

結果は保存した集計期間（終了境界は含まない）、実際の対象 ID、分析種類と保存した用途による絞り込み、計算時刻を表示する。詳細画面は各指標の期間・記録の種類・件数・不足理由を示す。現在の設定で古い結果を説明し直さず、未確認の定義版にはその制限を表示する。

- `UNKNOWN` / `COLLECTING` / `NO_ELIGIBLE` / null / 非有限値を件数ゼロに変えない。対象ゼロが既知の sample と、未知の結果値を区別する。
- 少ない sample の実測値は不足表示付きで残す。`LOWER_BOUND` は確認できた下限であり総数ではない。空の要確認一覧も、データ不足時には「問題なし」を意味しない。
- 投稿数は実際の場所に記録されたメッセージ。返信数は応答を確認できた投稿数で、返信メッセージ数ではない。返信時間は応答がある投稿の最初の人間の応答までの中央値。未応答の待ち時間を混ぜない。
- 要確認は、保存した質問・不具合の用途に合う、期間終了時点で1日以上経過し、人間の応答を確認できない対象投稿。質問内容や問題解決を推測しない。
- ボイスは保存した同席時間条件を満たす参加記録を期間内で重複させない人数。会話・閲覧・Discordへの再訪は測らない。退会・再参加による別の membership 記録を一人の生涯活動に統合しない。
- イベント申込と参加は記録件数。複数イベントや日をまたぐ記録を含み、重複のない人数や外部イベントへの実出席には変換しない。
- リアクション・投票は期間内に更新された現在有効な状態。期間終了時点の過去状態、満足度や交流の原因とは説明しない。

Compare は run の種類・scope identity・recipe・結果 schema、指標の定義版・単位・期間種別、等長かつ非重複の期間、十分な sample、完全な必要範囲、収集記録、比較阻害理由を確認する。比較できる指標だけを含め、除外指標の主な理由を表示する。結果全体が比較できない場合、閲覧可能な同種の以前の結果から非互換理由を説明する。非公開・削除・期限切れ・権限喪失した結果を理由説明にも使わない。

Attention の追加には確認画面を挟む。同じ分析・要確認の二重追加は既存1件を返し、追加監査も重複させない。保存済みの記録へ直接移動できる。更新は既存 READ/OPERATE 判定、tenant、privacy、対象権限、保存期限、optimistic version、行ロックと outbox を保持する。閲覧のみの人には変更ボタンを無効化し、サーバー側でも拒否する。終了した記録には変更操作を許可しない。

状態変更は既存イベントに操作主体を記録する。画面は最近5件の状態と時刻を表示し、個人の識別情報を新しく公開しない。期限切れ・削除された結果には履歴への戻り先を示す。署名済みコンポーネントの既存有効期限・ユーザー/Guild束縛は維持する。

## 5. 実装設計

| ファイル | 責務 |
|---|---|
| `packages/analysis/src/comparison.ts` | 共通比較条件、指標ごとの除外理由、期間メタデータ |
| `packages/analysis/src/index.ts` | 互換候補SQL、閲覧可能な診断対象、既存対応記録と履歴の読み取り、重複追加の監査制御 |
| `packages/operations/src/attention.ts` | 既存更新処理に任意の操作主体と撤回理由を渡す。既存呼び出し互換を維持 |
| `packages/discord-panels/src/views/analysis-evidence.ts` | 定義版を確認した説明、evidence状態・期間・sourceの翻訳、保存した場所、対応状態の説明 |
| `packages/discord-panels/src/views/analysis.ts` | 結果・詳細・比較・既存対応記録の表示と導線 |
| `packages/discord-panels/src/views/basic-analysis.ts` | 同じ根拠に基づく基本分析の説明と履歴への導線 |
| `packages/discord-panels/src/i18n/analysis.ts` | 日本語・英語の平易な説明、内部理由コードの非公開翻訳 |
| `apps/worker/src/analysis-interactions.ts` | 既存ルートの頁・記録フィルター・撤回の入力検証 |
| `packages/shared/src/errors.ts`、`error-types.ts`、パネルの `i18n/errors.ts`、`views/errors.ts` | 結果が見られない場合の説明と履歴への復帰 |
| `tests/unit/alpha11-analysis.test.ts` | evidence状態、比較条件、説明、空状態、操作導線、表示上限 |
| `tests/integration/alpha11-analysis.test.ts` | 実サービスでの更新・不変性・監査・権限・期限切れ・比較・ルート |

既存の版番号テスト `tests/unit/v060.test.ts` に従い、root `package.json` と20 workspace manifest、README、docs/READMEを `0.6.0-alpha.11` に同期した。依存関係・lockfile・release tag は変更していない。旧単体テストの文言期待値を新しい説明に合わせ、未知値のゼロ誤表示の確認は維持・強化した。

## 6. 検証・Acceptance Criteria

| Given / When | Then / 検証 |
|---|---|
| 保存済み evidence を日本語・英語で表示 | 値・期間・source・不足理由と対応する説明。内部コードを画面に出さない |
| 未知・収集中・対象なしと実測0がある | 未知を0や完了に変換せず、実測0と小sampleは区別する |
| 230の保存した場所と多い不足理由がある | 頁送りを維持し、再帰的Components V2の40コンポーネント・総テキスト4,000文字以内 |
| 等長で非重複の、異なるカレンダー日の結果 | 互換指標を比較。定義・単位・範囲・期間・収集の不一致には理由を示す |
| 新しい非互換候補がある | さらに以前の互換候補を選べる。25件で探索を打ち切らない |
| 追加を二重実行、古いversionで更新 | 一つの記録・追加監査だけを保存。古い更新は拒否 |
| 確認・撤回を操作 | 正しい主体で既存履歴に記録。保存済み結果と消費履歴は不変 |
| READのみ・無権限・別tenant・期限切れ | 閲覧/操作の既存判定を維持し、不許可操作を拒否 |
| 対象の権限喪失・privacy削除 | 結果・比較・対応記録の全関連経路から見えなくなる |

検証環境: Node 24.19.0、固定 pnpm 11.19.0、既存lockfileに対応する依存ディレクトリの独立コピー。新しい install は行っていない。integration は新規のローカル PostgreSQL 18.4 / Redis fixtureだけを使う。本番DB・Discord・決済providerに接続しない。

| 実施項目 | 結果 / 証拠 |
|---|---|
| `pnpm typecheck` | PASS。`.local/alpha11-typecheck-final.log` |
| 変更16 TypeScriptファイルの `pnpm exec eslint ...` | PASS。`.local/alpha11-lint.log` |
| `pnpm build` | PASS、20/20 tasks（8 cache hits）。`.local/alpha11-build-final.log` |
| `vitest run` の stabilization-ui / alpha10-ui / alpha11-analysis / v060 | PASS、4 files / 52 tests。`.local/alpha11-ui-final.log` |
| integration の alpha11-analysis / analysis-operations / analysis-stabilization、関連名でfilter | PASS、3 files / 13 tests。45件はfilter対象外で NOT RUN。`.local/alpha11-integration-final.log` |
| `node --import tsx scripts/secret-scan.ts` | PASS、670 source files、値は表示しない。`.local/alpha11-secret-scan.log`。既存scannerを変更せず、sandboxで禁止されたtsx CLIのIPCだけを避けた |
| `git diff --check` | PASS、コミット前に実施 |

最初のintegration実行はsandboxのlocalhost bind拒否（`EPERM`）でhookがtimeout。実行制限を解除して同じfixtureを使用した。新テストは初回に保存済み結果の不変triggerで失敗し、fixtureを保存前に構築するよう修正した。初回buildは既存のGoogle Fonts取得が通信制限で失敗し、公開フォント取得を許した同じbuildの再実行で成功した。検証のための本体仕様・assertion・制限は弱めていない。

## 7. リスク・未決事項

**Risk:** この検証は変更に関連する範囲の確認。全体の安全性・本番capacityの証明ではない。変更箇所で課金・権限・データ整合性に関する新しい重大問題は確認されなかった。

**Risk:** 既存 SHOWCASE の保存sourceは共通 `showcasePosts` 定義の `THREAD_CREATE` を継承し、通常メッセージも含める現行集計のsourceをすべて列挙していない。説明は実際の集計条件に合わせ、source表示は保存値を翻訳する。今回、共通定義・recipe・集計を変更して過去結果を別の意味に置き換えていない。sourceメタデータを厳密化する場合は互換性方針を別途決める必要がある。

**Risk:** overlapping multirow PostgreSQL `40P01` は既知制約のまま。今回は該当するproduction triggerを変更していない。過去の性能probe修正をproduction安全性の証明として扱わない。独立した大規模調査は実施していない。

**未確定 / Open Question:** migration 047–050 が本番へ適用されたことは確認していない。既存の旧Gateway/Worker停止→順次migration→新runtime起動手順を保持し、新migrationを作成・適用していない。

公開前の専用デバッグで行う一覧:

| 項目 | 状態 / 理由 |
|---|---|
| 全unit/integration・全体lint | NOT RUN、最新指示に沿って変更範囲の短い検証に限定 |
| 全体E2E・全画像再生成・性能負荷試験 | NOT RUN、今回の完了条件ではない |
| 実Discord / モバイルでの導線・再訪・期限切れ操作の確認 | NOT RUN、実サービス受け入れは別途承認が必要。再訪は利用者の画面操作確認であり計測指標ではない |
| Hosted環境・稼働中Gateway/Worker・実Stripe Sandbox決済 | NOT RUN、ローカル実装だけが承認範囲 |
| Windows runtime | NOT RUN、今回macOSのみ |
| 新commitのremote CI | NOT RUN、push/PRは未承認。過去CIを今回の成功証明に流用しない |

Purchase Pack: **DISABLED**。Stripe Live: **DISABLED**。Hosted Beta: **NO-GO**。

**Future:** 自由入力の対応ノート、担当者管理、因果効果の実験設計は今回の必須要件へ昇格させない。

## 8. Deliverable

本体変更、2つの追加回帰テスト、同期したalpha.11版番号、本記録。ローカルbranchは `codex/alpha11-analysis-experience`。正確なcommit SHAは最終ハンドオフと `.local/alpha11-handoff.md` に記録する（本書を含むcommitは自身のSHAを本文に埋め込めない）。push・PR・merge・release tag・deployは行わない。
