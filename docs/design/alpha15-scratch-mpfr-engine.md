# alpha15 Scratch 数学エンジンの実装証拠

2026-10-15 UTC。正式入力17資料・旧6資料の変更はない。以前の `alpha15-scratch-numeric-gate.md` が記録した「MPFR実体未取得」の時点から、ユーザーが承認したローカル同梱数値library評価を継続した実測記録である。配布のsource/license/relinkは別資料 `alpha15-math-engine-distribution.md` を参照する。

## 実際に取得・実行した候補

`gmp-wasm@1.3.2` を公式npm registryの固定tarballから取得した。registry SHA512 integrityと実ダウンロードbytesの一致を確認した。registry署名鍵による署名検証は実施していない。gitHeadは `4e372e5a3c4a65f871e1bcaab63c78b29dc80ff8`。tarball SHA256は `e417809469b6139e420f31e01a4fe64168c229499e5798ac037f683d6877261a`。

同梱UMDを変更せず `packages/automation/vendor/math-engine/gmp-wasm-1.3.2/index.cjs` として置いた。bundle SHA256は `76af404a6521699a9f2a0dd3fc34a48368b470cc5044e1fa8e5e480a3deae55a`。展開されたWASMは522,561 bytes、SHA256 `ca1f8def552c30d44c67247d0a959bbf17e022d1e5999889ce4b9922f5211909`。loaderは実行前にbundle SHAを照合し、APIのMPFR版も照合する。

Windows上のNode 24.18.1で**実ロード・実関数評価を行った**。MPFR runtime versionは4.2.1、初回load約19.8 ms、初期WASM memory 16,973,824 bytes。GMP 6.3.0は対応commitのbuild script指定から確認された版でありruntime API取得値とは区別する。ローカルでのMPFR/GMP再ビルド、native workerビルド、OS/global toolchainインストールは行っていない。artifact以外の別候補を実ビルドした実績もない。

`mpfr_set_d/get_d` の ±0、±MIN_VALUE、最小normal、±MAX_VALUE の7 bitpatternはすべて完全往復した。domain flags4、ln0のdivide-by-zero flags32、53bit/subnormalizeによる最小値半分の丸めでunderflow+inexact flags9を実確認した。指数範囲とflagsの復元も確認した。原本は `.local/alpha15-scratch-mpfr-20261015/{load-gmp-wasm.json,probe-primitives.json}`、実行scriptは同名 `.mjs`。

度数用 `sinu/cosu/tanu/asinu/acosu/atanu` はwrapperにもraw WASM exportにもない。この点をAPI推測で補っていない。[公式repo](https://github.com/Daninet/gmp-wasm) と [MPFR4.2.1 manual](https://www.mpfr.org/mpfr-4.2.1/mpfr.html) を確認した。MPFR4.2.1公式修正一覧にはfloat128 configureとformatted outputの問題があるため、runtimeにそのAPIを使わないことと版更新の検討を区別する。最新版へ自動差替えはしない。[4.2.1 release / fixes](https://www.mpfr.org/mpfr-4.2.1/)

## 実装と接続契約

`scratch-mpfr.ts` はbinding注入型の同期adapterで、10種の超越関数だけを受ける。`scratch-mpfr-loader.ts` の `loadScratchMpfrEngine(): Promise<ScratchMpfrEngine>` がサーバー起動時に固定artifactを読み、`engine.evaluate(op,value)` を明示capabilityとして渡す。Flow/Run/planに関数やbindingを保存しない。ブラウザ用の式moduleからloaderをimportしない。loaderはfilesystem/module/cryptoを使うserver-only entryである。

semantic profileは `nexus-mpfr4.2.1-directed256-v1`。通常precision256bit、有向区間が分類境界を確定できない場合だけ512bitに1回拡張する。それでも未確定なら `NumericCertificationUnavailable` を返し、host Mathへfallbackしない。各評価で指数範囲とflagsを保存し、広い範囲で計算してfinallyで復元する。処理は途中でawaitしない。初期化後の同一engine再入は拒否する。

角度はbinary64をBigInt dyadicへ正確に分解し、符号と象限を整数演算で決める。sin/cosはsinまたはcosの0..45度へ、tanは0..45度と必要なら逆数へ還元する。負のMIN_VALUEを360−tinyへ近似して消す処理はない。fold後のsignificandは64bit以下を実行時にも確認し、MPFRに正確な2進文字列で設定する。πの下/上界を有向丸めで求め、乗除算と単調性に合わせて関数下/上界を伝播する。逆三角は正引数でrad→degreeの区間変換を行い、odd symmetryまたは `acos(-x)=180-acos(x)` を外向きに適用する。

正確な0/±1/90/180とtanの極は整数/入力の完全一致で先に決める。epsilonはない。非ゼロ数学値がbinary64で0へ丸まった場合だけ `NumericUnderflow`、非ゼロsubnormalは保持する。expの入力>1024/<−1075、exp10の>309/<−324は保守的な明白境界として先に分類し、巨大有限入力の内部指数計算を避ける。実際のbinary64 overflow/underflow近傍はMPFR区間で分類する。

有向区間の各端点をbinary64最近接丸めした値の間に正しい丸め値rが含まれる。端点が一致すればそれを返す。一致しない場合は両端点の小さい方の量子1個以内の差だけを許し、下端点を選ぶ。これは最終丸めの半量子分にも余裕を残し、高精度の数学値を基準とする `abs(y-r)<=4*ulp(r)` を守るための十分に強い判定である。丸め済みの参照値との4ULP差をそのまま全幅許す判定ではない。0/∞をまたぐ区間は許容幅を理由に返さず、追加precisionで分類する。これは全2^64入力の総当たり検証を実施したという意味ではない。

## 有限域の区間幅と分類を分けた根拠

以下は有限試験の件数からの外挿ではなく、MPFRの正しい有向丸め契約を前提にしたadapterの誤差伝播の議論である。artifact自体の正当性は固定source/artifact照合、独立golden、実行試験で別に確認する。

precision p に対して u=2^(1−p) とする。指数範囲の内部にある非ゼロ値の1回の有向丸めの相対誤差はu以下である。MPFR中間値はbinary64のsubnormal制限を受けない。度数最小入力からのradは約2^−1080、expの早期分類内の中間出力はおおむね2^−1551..2^1478に収まり、設定した±1,073,741,823の指数範囲の端に近づかない。πにも同じ丸め契約を使う。

foldしたdegreeの設定は正確である。元の絶対入力が45未満なら元の53bit significandを保ち、45以上ならdyadic分母は高々2^47で、0..45へのfold後の分子は45*2^47<2^53。大きい正整数角度のmod計算もBigIntなので桁落ちはない。実装の64bit guardはこの上界より緩く、正当な有限入力を除外しない。

rad区間の生成はπ、乗算、180での除算の最大3回の丸めであるから、各端点の相対誤差は p>=256 で4u未満となる。評価角の区間は0..π/4をわずかに囲み、1rad未満に留まる。この区間でsin/cos/tanの対数条件数はそれぞれ2、2、4で上から抑えられる（sin t>=t/2、cos t>=1/2を使う十分に緩い上界）。関数自身の有向丸めとtan逆数の丸めを足しても、各端点と数学値の相対誤差は128u未満、区間全幅は256u*|f|未満と保守的に抑えられる。符号反転は正確である。

逆三角は正確な入力でMPFR原関数を評価し、180倍/π除算を行うため、条件数による入力誤差増幅は生じない。負のacosでの180−zは返却値>=90、引く値z<=90なので、相対誤差上界は上記256uより十分小さい。ln/log/exp/exp10はMPFR原関数の直接有向丸めである。正確なzeroは先に分離している。

p=256で区間全幅は2^−247*|f|未満となる。normalのbinary64量子に対して少なくとも約194bitの余裕があり、subnormal領域でも全幅は固定量子2^−1074より小さい。したがって、0/∞への丸め分類境界を除くとbinary64へ丸めた両端点は一致するか隣接値となる。実装は端点間の正確な差が小さい方の端点量子以下であることもBigIntで確認する。選んだ端点と数学値との誤差には最後の半量子分を足しても余裕があり、binade境界で量子が2倍になる場合も4ULP内となる。512bitの一回拡張は異常/未解決を無限再計算にしないための有限な追加余裕である。

丸め分類はこの相対幅の議論だけで済ませない。以下の境界を独立goldenの隣接値で押さえる。

- sin/tan: 周期のexact zeroとtanのexact poleは整数判定。0..45度の非ゼロ枝は単調で、28*MIN_VALUEと29*MIN_VALUEの間にzero丸め境界がある。両点を区間で確定すれば、この小さい枝の全binary64入力を分類できる。0以外の象限境界付近は元の角度>=45なので最小非ゼロdegree差>=2^−47となり、subnormal underflow域に入らない。tanの極に最も近い非極入力もこの差以上で、cot(delta*pi/180)<180/(pi*delta)<2^53となりoverflowしない。
- asin/atan: 最小非ゼロ絶対入力MIN_VALUEでdegree絶対出力>45*MIN_VALUE。以降は単調であり、zeroへ丸まらない。acosはx=1のexact zeroを分離し、その隣接入力1−2^−53の出力がnormalより十分大きい。値域はいずれも±180以内。
- ln/log: x=1のexact zeroを分離する。隣接入力1−2^−53と1+2^−52ですでにnormalの非ゼロ出力となり、それ以外は単調性で0から離れる。正の有限入力全体の出力は有限である。
- exp/exp10: 正の出力を持つ単調関数なので、半MIN_VALUEとoverflow最近接丸め閾値の逆像を挟む隣接binary64各2点で、underflow/overflowの分類を域全体へ拡張できる。その2点間には別のbinary64入力が存在しない。閾値はMathの近似値で選ばず、独立高精度oracleで計算した入力bitpatternを用いる。

分類境界の実証は独立decimal.js400/800桁oracleの隣接bitpatternとMPFRの区間確定を照合した。以下の隣接各点間には別のbinary64入力が存在しない。負の入力でhex値の大小と実数順が逆になる点もそのまま表記する。

| 関数/境界 | 入力bits → 結果 | 隣接入力bits → 結果 |
|---|---|---|
| sin / tan のzero丸め | `000000000000001c` → NumericUnderflow | `000000000000001d` → `0000000000000001` |
| exp のoverflow | `40862e42fefa39ef` → `7fefffffffffff2a` | `40862e42fefa39f0` → NumericOverflow |
| exp のzero丸め | `c0874910d52d3051` → `0000000000000001` | `c0874910d52d3052` → NumericUnderflow |
| exp10 のoverflow | `40734413509f79fe` → `7feffffffffffba1` | `40734413509f79ff` → NumericOverflow |
| exp10 のzero丸め | `c07439b746e36b52` → `0000000000000001` | `c07439b746e36b53` → NumericUnderflow |

fixtureは `tests/fixtures/scratch-math-golden.json`。これらと周辺点、符号対称点、normal/subnormal境界の計38点はすべて独立oracleとbit単位/エラー分類が一致し、MPFRの256bitだけで区間が確定した。512bit arenaは生成されなかった。原本 `.local/alpha15-scratch-mpfr-20261015/boundary-certification.json`、実行器 `certify-boundaries.mjs`。単調性と上記の狭い区間幅を合わせることで、有限corpusの外側も含む受理域と誤差幅の根拠を与える。oracle自身の400/800桁収束は正式な有向区間証明ではないため、MPFRの正しい丸め仕様を代替するものとしては扱わない。

費用は一呼出し最大2精度、各精度で固定個数のMPFR操作と最大約1084bitのBigInt還元である。MPFR内部の正しい丸め算法の費用をCPU時間の厳密上限と同一視しない。同期呼出しの前後で既存取消/期限検査を行い、共通evaluation workへ新10種だけ保守的な固定予約を加える接続を採る。旧sqrt平均約1.07µsに対し新層化平均7.61µs、最大2精度なのでwork32案には通常比率と追加精度の余裕がある。起動時loadと初回arena作成を、この比率による時間保証には含めない。

## 実施済み検証と残り

`tests/unit/alpha15-scratch-mpfr.test.ts` の9件と `alpha15-scratch-mpfr-golden.test.ts` の397件、計406件が通過した。10種の通常値、exact象限/極/0/domain、sin(±100*MIN_VALUE)=±2*MIN_VALUE、sin(±MIN_VALUE)のunderflow、asin/atanのMIN_VALUE出力、exp/exp10 subnormal、±MAX_VALUE角度のexact residue128、指数/flags復元、固定512bit再評価上限と未確定拒否、独立golden396行とmetadataを含む。原本 `.local/alpha15-scratch-mpfr-20261015/unit-results.json`。sandbox内ではVitest5の共通変換cache ENOENTで片方suiteが起動しない現象があり、原本を `unit-first-golden-transform-failure.json` と `unit-parallel-transform-failure.json` に保管した。fixtureをfsで読む変更やfile並列無効化では根治せず、親が旧unitでも確認済みのホスト実行を許可範囲内で用い、同じ2ファイル・同じ通常設定を406件完走した。製品やVitest設定を変更して回避していない。

独立oracleは製品MPFR/adapterを使わないdecimal.js10.6.0と独立Taylor三角関数で、400/800桁の396行が一致した。製品の有限336行は許容幅内だけでなくexpectedBitsと全件完全一致、エラー60行も全件一致した。最終fixture SHA256は `1d69b085d0452e9084b4af606ba5e8ddc489d70ca949d2fdd0864016b40adbed`。原本 `golden-comparison.json`、oracle生成器は `scripts/generate-scratch-math-golden.mjs`。非ゼロ参照の0/逆符号への出力は4ULP区間に入っても失敗とする。exact代表値の行も厳密一致を要求する。

合成binary64の指数field0..2046、各1つの決定的significand、符号±をsin/cos/tan/atan/ln/logへ与える層化計24,564呼出しは約185 ms、平均7.54µs、最大1呼出し約2.58ms（初期計算を含む）。予期しない認証gateは0件だった。原本 `function-corpus.json`、script `probe-functions.mjs`。これは短い受理域・費用確認であり、独立精度oracleでも最悪時間保証でもない。

独立読取りレビュー（runtime担当）は区間の符号/単調性、exact zeroの網羅、端点量子判定に重大な不具合を認めず、残りとして上記分類境界の隣接bitpattern証拠を指摘した。その証拠は後続の396行照合と38点の256bit確認で補った。レビューは通常ChatGPTレビューの回数へ加算しない。

最終の別担当読取りレビューも、38点の原本が実binding/実engineでprecision記録だけを加えた実行であること、隣接tableとfixture SHAの一致を確認し、分類gateの従来指摘を解消と判断した。MPFR有向丸め保証を前提とするwrapper論証であり、全bit総当たりやlibrary独立形式証明とは区別する。

サーバーvalidation/simulation/Runへのcapability接続、UIと保持・実行予算を含む統合確認は親担当の別証拠で判断する。配布可能性と全192行の合格をこの単体結果だけから宣言しない。engine本体は状態/入力値を永続化せず、既存7日保持契約を追加目的へ変更しない。
