# NEXUS alpha15 R04–R06：数値・Unicodeの実現性補足

作成日：2026-10-15 UTC。独立した資料調査と設計レビュー。実装・NEXUS実機試験・数値性能計測はしていない。大型実装の開始承認を意味しない。

## 結論

全安全整数域の偏りのない範囲写像、全有限binary64度数法、旧丸め互換、Unicodeの操作別境界は、入力域を縮めず具体化できる。整数乱数には最大54bitの棄却法、数学には版固定サーバー数値エンジン、文字には操作別単位を固定したsemantic profileを推奨する。4 ULPと小数丸め桁数−308～308は既存承認へ繰り上げず提案として扱う。全域正当性、再開一貫性、実機予算を検証できなければ設計ゲート未通過とし、域・精度・意味の変更は差分承認へ戻す。

## R04：最大幅を含む整数乱数

### 正確な範囲写像

- 入力は lo,hi ∈ [−(2^53−1), 2^53−1]、lo≤hi。内部の符号付き多倍長整数で W=hi−lo+1 を計算する。最大Wは2^54−1。Numberで差やWを先に計算しない。
- W=1ならloを確定し、乱数bitを消費しない。
- W>1では b=bit_length(W−1)。したがって1≤b≤54。独立一様なb bitから候補U∈[0,2^b−1]を作り、U<Wのときだけ採用する。
- 採用値は内部整数でlo+Uを求め、安全整数であることを確認してNumberへ正確に変換する。候補U自体が2^53を超えても途中でNumberへ変換しない。
- U≥Wなら棄却。U mod W、clamp、最寄りの端、53bit補間へのフォールバックは禁止する。
- 1回の動的評価に許す試行数Mは、実測に基づく共通予算設定から開始前に固定する正整数。同じ評価の再開で増やさず、M回すべて棄却なら RandomSamplingExhausted として失敗を一意確定する。成功値を必ず返すとは約束しない。

### 有界でも分布を偏らせない理由

理想化した独立一様bit源の下で r=(2^b−W)/2^b とおく。任意の候補vについて、M回以内にvを返す確率は

P(v)=2^(−b)×Σ(j=0..M−1) r^j=(1−r^M)/W。

すべてのvで等しく、成功を条件にした分布は1/W。失敗確率はr^M。これは範囲写像の数学的性質であり、実機の乱数源の真の独立性、金銭抽選の公正性証明、暗号用途の安全性を保証するものではない。有限seedからの任意のPRNG展開を、この証明の独立一様bit列と無条件に同一視しない。実装文書には採用bit源、保証の前提、抽選アルゴリズムと版を明記する。

Node.jsのcrypto.randomIntには範囲幅2^48未満の制約があるため、その関数だけで最大幅要件を満たすと記載しない。[公式API](https://nodejs.org/api/crypto.html#cryptorandomintmin-max-callback)

### 再開・並列workerの正本

具体的な推奨方式は「候補を評価する前に、有界なentropy tapeを一意確定して保持する」方式。

1. 既存の動的評価キーKに対し、未開始／準備済み／成功／失敗を一意管理する。既存のRunID・Revision・block・動的子呼出し・並列枝・全囲み反復pathに、意味版が結び付く。
2. 準備済みの最小状態として、初回入力、モード、数値／乱数アルゴリズム版、M、b、評価前のentropy tape、次の試行位置、予算状態を原子的に保存する。tapeは最大M×b bitで、割当前に共通bytes予算を検査する。未使用bitも再開のためだけに保持する。
3. 未確定tapeは候補として解釈せず、結果選別の材料にしない。保存応答が不明ならKを照合する。新しいtapeを選び直して既存準備済み状態を置換しない。複数workerの敗者は勝者の確定状態を読む。
4. 棄却・試行cursor・論理予算消費を一つの遷移として確定する。再実行は同じtapeとcursorを使う。CPU実時間の残量だけで「採用する値」を選ばず、論理試行上限を値に依存させない。
5. 成功値と後続PC、または失敗コードと停止状態を一意確定する。成功／失敗を確定したKは不変。失敗後にM追加、再seed、別モード、現在変数での再評価をしない。
6. terminalAt後と削除後に古いworkerが状態を再作成しない。保持は既存の終了後7日以内削除契約。tapeもログへ流さない。
7. 期限・中止は別の停止理由として処理する。外部中止や結果を見た人による選別まで含めた「成功Run集団の無条件公正性」は約束しない。

tape全体ではなく逐次write-ahead候補保存へ最適化する場合も、候補の先行永続化・cursor・重複排除・失敗固定について同等の証明が必要。単に最終結果だけを保存する方式では棄却途中のcrash再開が未定義になる。

### 最小受入

幅1、2、3、2^k−1、2^k、2^k+1、および最大2^54−1を含む。最大幅でU=0→最小端、U=W−1→最大端、U=W→棄却を確認。小さいbit幅では全tapeを列挙して成功各値の個数が等しいことを確認し、一般幅は数学的証明とBigInt実装の検査を併用する。統計検定だけで一様性を「証明」しない。

固定tapeで「棄却→採用」「M回棄却」を再現し、準備保存応答喪失、棄却cursor保存前後、成功保存応答喪失、二重worker、予算切れ、期限、削除後callbackを故障注入する。同じKは同じ値／同じ失敗、別反復Kは別評価になることを検査する。

小数モードを同時に具体化するなら、k∈[0,2^53−1]を確定し、厳密有理数lo+(hi−lo)k/2^53をbinary64 ties-to-evenへ一度丸め、hiに丸まった場合のみnextDown(hi)へ調整するという版固定写像が候補。これは有限格子からの写像であり、出力binary64値の等確率や連続一様分布ではない。区間端が逆符号の最大有限値でも中間Number差分を作らない。

## R05：Unicodeの全操作を同じ説明表で固定

PlainTextはUnicode scalarの有限列。不正UTF-16サロゲートを拒否し、暗黙の置換文字化・正規化をしない。EGCはUnicode UAX #29の指定版・指定profileで定義する。採用版のUCD・境界規則・必要な拡張データ・実装buildを固定する。OSやブラウザの未固定Intl.Segmenterだけを正本にしない。UAX #29には既定EGCと明示profileによる適合方式がある。[UAX #29固定版の例](https://www.unicode.org/reports/tr29/tr29-47.html)

| 操作 | 単位と一致 | 追加境界 |
|---|---|---|
| length / letter / slice | EGC | 既存1始まり・件数・空境界を維持 |
| contains | scalar列の完全一致 | EGC内でも一致。空検索true |
| startsWith / endsWith | 先頭／末尾でのscalar列完全一致 | 空検索true。EGC途中の一致も認める |
| replace first/all | scalar列の完全一致 | 空検索拒否。元入力を左から非重複走査。置換後文字列を再検索しない。置換文字の$や\\をテンプレート評価しない |
| split | scalar列の完全一致 | 空区切り拒否。元入力を左から非重複走査。先頭・末尾・連続区切りの空要素を保持設定どおり扱う |
| find | scalar完全一致かつ元入力の開始／終了がEGC境界 | 最初の一致を1始まりEGC indexで返す。空検索は1。見つからないとnot_found |
| equals | scalar列の完全一致 | 正規化・case変換なし |
| join | scalar列の通常連結 | 連結結果を新たにsegmentationする。EGC数の加算を仮定しない |
| case fold / upper / lower / trim / normalize | 明示変換の固定mode | Unicode版、locale有無、trim対象集合、NFC/NFD等を指定。ブラウザ既定localeを採らない |

「文字を途中で壊さない」という保証はEGC位置操作に限定する。scalar一致のreplace/splitは、利用者が指定した結合記号やZWJ等を取り除き、見た目を変え得る。これを隠して全文字操作がEGC単位と説明しない。

試験の例：
- S=「e＋U+0301」ではlength=1、contains(S,"e")=true、startsWith(S,"e")=true、endsWith(S,U+0301)=true、find(S,"e")=not_found。
- replace(S,U+0301,"",all)="e"、split(S,U+0301,空保持)=["e",""]。
- join("e",U+0301)の結果lengthは1。部分のlength合計2と一致しない。
- scalar列を壊さず、結合文字、ZWJ絵文字、肌色修飾、regional indicatorの奇数／偶数列、CRLF、Hangul、Indic結合、先頭の結合記号を試験。
- Unicode公式の採用版境界テストと独自の操作横断golden fixturesを同じprofileで実行する。公式テストの通過だけで全入力の網羅を主張しない。

### 旧定義・既存Runの互換

FlowRevisionとRunにtextSemanticVersionを結び付ける。旧データの欠落fieldを「最新Unicode」に解決してはいけない。実査で確認したlegacy意味へマッピングし、旧Revision保存round-tripと旧Run再開は旧意味のままにする。新規profileへ移るときは下書きでの明示改版＋差分表示。新旧の「同じ入力」を並べた回帰試験を用意する。旧profileが実行不能なら、新意味へ自動移行せず互換未解決として止める。

## R06：数学14選択の実装候補と実装前ゲート

### 維持する意味

入力binary64をそのexact real valueとして扱う。sin/cos/tanの単位は度、入力域は全有限Number。tanの数学的な極はDomainError。sqrt負、asin/acosの[-1,1]外、ln/logの0以下もDomainError。abs/floor/ceilと既存roundは各意味のまま。NaN/Infinityは公開値にしない。非ゼロsubnormalは許可、通常演算で数学的非ゼロが0へ丸まるならNumericUnderflow。明示round/floor/ceil等による0とは分ける。

### 第一候補：版固定したサーバー数値エンジン

MPFR 4.2系には度数法を直接扱えるsinu/cosu/tanu、asinu/acosu/atanuがあり、u=360で使える。exp/log/sqrt等もあり、正しく丸める計算とbinary64 subnormalエミュレーションが公式に説明されている。これを採用候補または参照oracleとし、サーバー同梱で固定する。利用者データを外部oracleへ送る案ではない。[MPFR公式manual](https://www.mpfr.org/mpfr-4.2.1/mpfr.html)

実装profile案：
- exact binary64 bit-patternを渡す。度を先にNumberでπ/180倍しない。
- MPFR候補ではprecision=53、emin=-1073、emax=1024、round-to-nearest ties-to-even、および演算のternary値を伝播するsubnormalizeを使用する。これはmanualにあるbinary64エミュレーション構成に基づく候補。
- 出力0で最終ternaryが非ゼロなら、厳密0と区別してNumericUnderflow。非ゼロsubnormalは許可する。MPFRのunderflow flagのみで失敗判定しない。
- 先に正確なdomain／極判定を行う。∞への丸めはNumericOverflow。±0は公開時に+0へ正規化。
- floor/ceil/round等の明示丸めは上記の「非ゼロ→0」判定の例外として個別意味を維持する。
- 数値エンジンとGMP等の依存版、patch、build option、wrapper、入力／出力変換を固定。global flags・指数範囲の共有による並列干渉を防ぐ。
- ライセンス・配布方法・公式既知不具合・対象platformを採用前に確認。4.2.2には4.2.1からの修正があるため、説明用manualの版をそのまま製品採用版と見なさない。[MPFR 4.2.2公式release](https://www.mpfr.org/mpfr-4.2.2/)

周期低減を自前で行う場合、binary64値の整数仮数と2の指数からexact dyadic rationalとしてmod360／mod180を計算する。BigInt等の内部整数計算を用い、巨大xにNumberでx/360→floor→乗算する方法を採らない。周期残余の変換で小さい値や端の近傍を丸め落とさない。直接度数APIを使う場合も全域と極の意味をwrapperテストで検査する。

### 精度判定の具体化

4 ULP以内は引き続き提案。最終仕様では「正しく丸めたbinary64参照値」との距離を、+0へ正規化した有限binary64の順序付き隣接ステップ数で定義すると、2の累乗境界やsubnormalでの曖昧さを避けられる。現行のULP幅定義を保持するなら式を厳密に固定し、この隣接距離へ無断で置き換えない。どちらを採るかを設計差分として示す。

4 ULPを満たしても、厳密な代表値0/±1、極、domain、underflowは別の必須条件。例えば真に非ゼロなのに0を返すことを「4 ULP内」で合格させない。参照値そのものが0／∞の場合には先にUnderflow／Overflow分類を判断する。

正しく丸めるMPFR型のwrapperが契約どおり動けば候補精度を上回るが、これだけで製品全域の検証済みとはしない。有限試験から全有限入力の精度証明を主張せず、ライブラリの意味保証・使用前提・wrapperの証明／レビューと境界試験を組み合わせる。同じMPFRの高精度版を使う比較はwrapperの検証には役立つが、同じlibrary内部bugに対する独立証明ではない。

interval oracle方式を使う場合は、入力をexactに保持して上下方向丸めによる包含区間を作り、binary64の同じ丸め先に確定するまで精度を上げる。厳密な代表値・中点ケースは別証明で解決する。予算内に確定できない場合は不確かな数値を返さずNumericCertificationUnavailable等の明示失敗とする。ただしこの失敗が普通の有限入力で頻発するprofileを全域対応済みとして出荷しない。全域要件を達成できないならゲート未通過として差分承認へ戻す。

### 丸め互換の修正が必要

現在読んだ主文書§4.2には「初期規則は半値+∞方向で統一」が残る。第1回レビューが確認した旧D2の半値away-from-zero維持と衝突するため、最終文書では修正する。

- legacy roundの旧opcode／旧Revision／欠落fieldの意味は実装照合のうえ維持する。新Scratch-style roundは別の明示mode（ties-to-positive-infinity）。
- 1.5は両方式2、−1.5はlegacy −2／Scratch-style −1、−0.5はlegacy −1／Scratch-style 0。
- Math.roundの意味はfloor(x+0.5)と単純に同一ではない。大きい値や半値近傍の加算自体の丸めが違いを作る。[ECMAScript公式round定義](https://tc39.es/ecma262/2022/multipage/numbers-and-dates.html#sec-math.round)
- decimal places roundingの−308～308と最短往復10進表現からの丸めは新提案。最短表現生成規則、第一段階の丸めmode、最後のbinary64 ties-to-evenを別々に固定する。legacyの式を黙って新decimal仕様へ差し替えない。

### 出荷／実装準備ゲート

1. 14関数のdomain・degree・厳密値・overflow・underflow・丸め互換の仕様表と版解決表が埋まる。
2. 採用候補が全有限角度契約を維持する技術根拠と、指定binary64変換／subnormalの正しさを示せる。
3. 境界試験：±0、最小subnormal、最大subnormal、最小normal、最大有限値、±1近傍、0/90/180等とnextUp/nextDown、巨大なexact周期、指数の0丸め／subnormal／overflow境界、roundの正負半値と隣接値、decimal桁端。
4. goldenの入力bit-pattern／結果bit-pattern／エラー分類がserver、preview、再開、新旧版で一致する。
5. 実機でCPU・一時bytes・精度上昇・キャンセル応答・並列負荷を計測し、共通予算へ接続する。ここで勝手な数値上限を置かない。
6. 一件でも意味・精度・全域が満たせない場合は未通過。ブラウザMathへのfallback、入力角度制限、subnormal全拒否、4 ULP緩和、旧round変更を黙って行わない。必要な変更はユーザーへ差分として戻す。

## 正式引継ぎ資料の回収による追記

2026-10-15 08:49 UTCにユーザー再添付の正式132件版を取得し、SHA-256 c16d85517066dc059d8b62e7996372ac5c6a016616c92a85c8a9c335dba7af1c と一致を確認した。上記「現在読んだ主文書」の丸め統一記述は作業領域に残った初期128件版の指摘であり、回収した正式版§4.2には旧丸め保持と明示2modeへの修正が既に存在する。最終補足では正式版を優先する。

## 現在の検証状態

- 公式資料に実装可能な数値APIがあること、Node標準乱数関数の幅制約、UnicodeのEGC/profileの考え方、round互換上の注意を確認した。
- 整数棄却方式の式は設計上の導出であり、NEXUS上の実装試験ではない。
- 全finiteの数値性能、NEXUS schemaとの互換、実装版、テスト通過数は未確認。

