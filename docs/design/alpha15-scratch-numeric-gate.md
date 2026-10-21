# alpha15 Scratch 数値・乱数の実装と残る技術ゲート

2026-10-15 UTC。対象は `codex/alpha15-web-blocks`、旧実装の照合基準は `e37fd32`。原本17資料や旧6資料は変更していない。本書は実装証拠であり、元のT132件・S60件を全件合格とする記録ではない。

**現状更新**：後続の明示承認を受け、固定gmp-wasm1.3.2 / MPFR4.2.1を実取得・実ロードし、10種の同期adapterとserver-only loaderを実装した。独立decimal.js400/800桁golden396行は有限336行・エラー60行すべて一致し、専用unit406件が成功した。サーバーvalidation/simulation/Runへの明示capability接続は親担当が進めている。全有限域の区間幅、分類境界の隣接bitpattern、artifact SHA、実行原本は [MPFR実装証拠](alpha15-scratch-mpfr-engine.md)、source/license/relinkは [配布証拠](alpha15-math-engine-distribution.md) を参照する。以下に残す「artifact未取得・10種拒否」は追加承認前の履歴であり、現在の実装状態を意味しない。

## 実装

- `packages/automation/src/scratch-numeric.ts`：`nexus-binary64-exact-v1`。新規の明示2丸めmode、最短往復10進表現をBigInt有理数として丸める小数丸め（−308..308）、除数符号のmodulo、binary64の厳密な分解・最終ties-to-even変換、平方根、度数の厳密周期剰余、規定の4 ULP幅の比較器。
- `packages/automation/src/scratch-random.ts`：`nexus-entropy-tape-v1`。最大幅2^54−1の安全整数範囲、最大54bitの棄却、有限Q、準備材料の予算検査、固定tapeからの決定的評価、失敗結果、Fisher–Yates、固定部分列による抽出、53bit格子による小数補間。逆符号の最大有限端点もNumber差分を作らず処理する。
- `packages/automation/src/random-tape-store.ts` とruntimeの新profile分岐：既存のRunに従属するテーブルを使用し、材料・予算・元PC、計算開始の予約、結果・次PCをそれぞれ原子的に保存する。checkpointのhashによるCAS、応答喪失時の再照合、行ロック後の最新時刻によるRun/局所期限検査を接続する。
- `tests/unit/alpha15-scratch-numeric.test.ts`：数値・乱数の単体15件。小幅の全tape列挙、両端と最初の棄却候補、有限枠失敗、保存材料の再評価、同一材料への競合保存の契約例、予算検査、6通りの3要素並替え、隣接小数端点、平方根のbit-pattern境界、明示丸め、規定ULP幅を検査する。
- `tests/integration/alpha15-scratch-random.test.ts`：隔離PostgreSQLで24件成功。全幅整数・小数・shuffle/sample、再開、保存応答喪失、二重worker、stale checkpoint、単調状態版、予算、Run/局所期限、旧形式、取消/終了/削除後の拒否、7日でのentropy/result削除を検査する。実Discord接続はない。

旧 `number.round` は `Math.sign(scaled) * Math.floor(Math.abs(scaled)+0.5) / factor`、桁域−8..8だった。旧opcodeをこの新規moduleへ置換していない。旧 `number.remainder` のJavaScript `%` も新 `number.modulo` と区別する。

平方根は入力を整数仮数と2の指数へ正確に分解し、出力の量子に対して整数平方根を求める。丸め先は正確な中点の二乗との整数比較で決定する。`Math.sqrt` を本番実装の正本に使わない。テストのhost `Math.sqrt` との比較は補助的な有限の差分検査であり、全有限入力を試験したという主張ではない。

## 乱数の保存接続契約

`planRandomTape` → 共通bytes/試行予算の予約 → `prepareRandomTape` → dynamicKeyによる材料の一意永続化 → 保存済み勝者材料だけを `evaluateRandomTape` → 結果または失敗・論理消費・次PCを一つの遷移でcommitする。

準備は候補の採否を調べない。材料の保存応答が不明なら同じkeyを照合し、再seedしない。保存済みなら現在のRun状態を再読し、そのtickを終えて確定したPCから次tickで進む。照合不能/未保存は停止する。予算・期限・CASなど既知の拒否は通信障害として再照合しない。中断後に同材料を再計算しても同じ結果または同じ失敗になる。異なる固定入力への差替えと、後から変わった現在変数の再評価はstore側で区別する。Run終端・取消・期限・削除後の再作成を拒否し、既存のRun削除CASCADEで材料と結果を消去する。

抽選材料inputは不変のまま、PREPARED result側に計算開始予約数と現在checkpointのhashを保持する。初回のQ予約が最初の有界な計算を覆い、2回目以降の再計算は同じ共通evaluation予算へQ相当（最低1）を追加予約する。Q=0の空/単値結果にも最初の計算費用1を計上する。応答が計算前に失われた場合も保守的に予約済み費用を戻さず、再開回数による無制限なCPU回避を防ぐ。候補が尽きたときの論理Qやtapeは増やさない。候補列の計算は副作用のない有界な一括処理であり、論理cursorは未完了から最終消費数/結果へPCと同時にcommitする。中間crashは同じ材料を再計算するが、その実作業費用を追加予約する。

統合試験では初回4994 evaluationsまで予約した後の故障を注入し、2回目の再計算費用が上限を超える場合に候補を読む前にRunが失敗終端することを確認した。材料・Q・候補の決定的な結果は変わらず、通常後続操作は0件、終了から7日で材料も消える。

新profileの全resume writerと同じ `checkpointVersion` を使う。prepare・計算開始予約・completeは、それぞれ旧版をロック内で照合して次版を保存し、commit成功後だけ呼出元stateへ版を反映する。PREPAREDのhashは次版を含むsnapshotへ結ぶ。rollback時は版も増えない。旧版から既存finalを再読するだけの操作はresumeを更新せず、そのstale workerが後続の通常checkpointを書こうとした時点で共通CASが拒否する。競合の勝者をFAILED保存で上書きせず、最新Run状態を返す。旧profileの版なし保存形式は変更しない。

Qは保存した初回材料の一部で、再開時に増やさない。各候補が独立一様なb bitという前提では、有限Q回以内の任意の成功値の確率は `(1-r^Q)/W`。成功条件付きの範囲写像は1/W、失敗は別結果になる。bit源の情報理論的独立性、金銭抽選・暗号用途・人為的に選別したRun集合の公平性は保証していない。tape・入力・抽選値は最小再開状態として既存の7日以内削除対象に含め、実行ログへ出さない。

## 短いWindows計測

Node 24.18.1、win32 x64。原本は `.local/alpha15-scratch-numeric-20261015/measurement.json`、実行器は同フォルダの `measure.mjs`。各数値操作と整数は1000回、100要素並替えは300回の短い測定である。

| 入力 | 平均時間 | 材料/予約 |
|---|---:|---|
| 最大有限値のsqrt | 約1.07 µs | 数値状態なし |
| 小数丸め308桁 | 約2.28 µs | 数値状態なし |
| 最大整数幅、Q32、準備と評価 | 約15.31 µs | 669 bytes、32試行予約 |
| 100要素shuffle、Q32、準備と評価 | 約170 µs | 5273 bytes、3168試行予約 |
| 同shuffleで全棄却可能stepを最終試行で成功させる再計算 | 約504 µs | 2982試行消費 |

既存共通予算5000 evaluations/65536 bytesとの接続候補として、host設定へ明示するQ32を提案した。新しい商用上限の確定ではない。残予算の検査は個別に必要であり、Q未設定時は新profileの乱数を有効化しない。理想bit源では1選択の枠切れは2^-32未満、99選択の和の上界は約2.31×10^-8。並列負荷や最悪キャンセル応答の性能保証は行っていない。実MPFRの後続簡易測定は別の [MPFR実装証拠](alpha15-scratch-mpfr-engine.md) へ記録した。

## 数学14種の状態

| 選択 | 状態 |
|---|---|
| abs / floor / ceiling / sqrt | exact moduleを実装、単体境界検査済み。UI・保存・Runの接続は統合担当の証拠と合わせて判断する |
| sin / cos / tan / asin / acos / atan / ln / log / exp / exp10 | 固定MPFR4.2.1の有向区間adapter/loaderを実装し、独立golden396行・専用406unitを通過。全有限域の誤差・分類根拠は後続資料に記録。server capability未注入/破損artifact/未確定区間は拒否し、browser Mathへfallbackしない。統合接続の結果は親担当の証拠を参照 |

## 追加承認前の技術留保（履歴）

現地でPATH上のgcc/clang/cl/make/emccは解決できず、repoの直接依存にMPFR/GMPのbindingや固定artifactはなかった。既存の間接依存 `decimal.js-light@2.5.1` は三角関数群を備えず、今回の要求一式を満たす正本に使っていない。依存導入・インストーラ実行はしていない。

MPFR 4.2.2はGMP 5以上を必要とし、公式ページにはLinuxやMinGW系の検証例がある。現地Windows 11や配置先での動作証拠とは区別する。[MPFR 4.2.2 release](https://www.mpfr.org/mpfr-4.2.2/)

公式APIはsinu/cosu/tanu等の度数法（u=360）、53bit精度とsubnormalizeによるbinary64再現を提供する。flags/指数範囲はbuildによりglobalまたはTLSで、wrapperは設定を隔離・復元する必要がある。配布はLGPL 3以降のsource/re-link条件を満たす構成の検討が必要である。[MPFR manual](https://www.mpfr.org/mpfr-current/mpfr.html) GMP側の配布条件も別途固定する。[GMP copying](https://gmplib.org/manual/Copying)

具体的な継続案は、MPFR/GMPのsource・patch・build option・artifact SHAを固定し、(A) Windows/Linux用の同梱native worker、または(B) 同一ソースの同梱WASM workerを作ること。ユーザーデータを外部oracleへ送らない。両案ともNode側bit-pattern変換、subnormal/ternary伝播、精密な極/代表値、元の `abs(y-r) <= 4*ulp(r)`、独立golden、取消と費用を検証してから有効にする。未検証のWASM bindingや将来artifactが既にあるとは扱わない。

この段階ではお名前.comの配置プランのNode/native/WASM実行可否を未確認で、artifactができるまで当該10関数を保留していた。後続でWASM実取得/Windows実行/適合確認を行ったが、実際の配置先での起動検証とは区別する。入力角度の縮小、subnormal拒否、4 ULP緩和、browser Mathへのfallbackは採用していない。

## 実行済み検査と範囲

`node node_modules/vitest/vitest.mjs run tests/unit/alpha15-scratch-numeric.test.ts --reporter=json --outputFile=.local/alpha15-scratch-numeric-20261015/unit-results.json`：15件成功。

`node node_modules/vitest/vitest.mjs run --config vitest.integration.ts tests/integration/alpha15-scratch-random.test.ts --reporter=json --outputFile=.local/alpha15-scratch-numeric-20261015/integration-results.json`：24件成功。最初のsandbox内実行はloopback接続EACCESでsetup失敗・未実施。その結果を `integration-sandbox-blocked.json` へ保存し、許可済みの隔離DB試験を制限外で実行した。初回の実DB試験はfixture間で並行枠が残る8件の失敗があり、afterEachで各synthetic Runの実予約を取消して修正した。修正後16件を通過し（`integration-before-work-accounting.json`）、実再計算費用・期限等の22件（`integration-before-checkpoint-version.json`）、単調状態版を含む最終24件も通過した。

専用5ファイルのESLint、repo全体の `tsc --noEmit --pretty false` は成功。完全なUI/全192計画の結果はそれぞれの統合証拠を参照する。

この初期段階の部分確認に対応した計画：T012–T015、T018、T103–T108、T121–T122、T125–T127、T130、T132、S037–S043、S050（新mode部分）、S051（4種のみ）、S052（周期剰余のみ）、S053（rational/sqrt境界のみ）、S054（比較器のみ）、S055。当時はT019–T028/T123と関係S051–S054の数学基盤が未達だった。後続MPFRと統合接続の受入判定は最新の [受入証拠対応表](alpha15-scratch-implementation-evidence.md) を参照する。
