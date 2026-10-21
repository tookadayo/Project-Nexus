# NEXUS alpha15: Scratch公式ブロック全体棚卸しと意味論監査

調査日: 2026-10-15 UTC。設計調査のみ。NEXUSの実装・設定変更・リリースは行っていない。

## 0. 調査基準と重要な結論

- Scratch Foundation公式 `scratch-editor` の develop を取得し、commit **eccdbed86086e7f7c77d7302dc3c811f830f242d**（2026-10-14 17:57:31 UTC）に固定した。「現行」はこの公開ソースを意味し、scratch.mit.edu本番の配備commitを同一と保証するものではない。
- GUIが依存する `scratch-blocks 2.1.34` は別repo。対応tagのcommit **054c45ddd9b904d82a7d8fd0e60c2359084f1bc8** を使用した。日本語表記は依存 `scratch-l10n 6.1.133`、commit **c08c6625bb5166a64cce690ad1ac3cc6dbbe20b6** の `editor/blocks/ja.json` に基づく。空白・括弧は表の可読性のため整形。
- パレットはGUI `makeToolboxXML(false, isStage, ...)` の通常表示、VariablesとMy Blocksはscratch-blocksの動的flyoutを基準にする。VMのgetPrimitives一覧だけでは「画面で選べるブロック」を判定できない。
- 公式拡張ライブラリは **12件**。Face Sensingを含む。標準Sensingには **sensing_online** が入っている。旧Scratch 3一覧を再利用するとこの2点を落とす。
- Scratchの「かつ/または」は入力reporterを先に評価するため、**式の短絡評価を保証しない**。`&&`/`||`という演算メソッドだけを見てNEXUSも同じと判断してはいけない。
- `stop this script` は自作ブロック内では最も近い呼出し境界まで戻る。Run全体の終了、手順のreturn、loopのbreakは別契約にする。
- Scratchは不正な数値を0へ変換し、ゼロ除算・定義域外の数学結果としてInfinity/NaNを許す。UTF-16単位で文字を扱う。これらをNEXUSの暗黙仕様にしない。
- 本資料のNEXUS判断は **Run最大7日、単一Wait最大7日、無限ループ・任意コード・再帰・永続変数・外部HTTPを今回採用しない** 方針を維持する。Scratch互換の調査は、これらを採用する承認ではない。

根拠: [基準commit](https://github.com/scratchfoundation/scratch-editor/commit/eccdbed86086e7f7c77d7302dc3c811f830f242d)、[GUI依存](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-gui/package.json)、[日本語訳](https://github.com/scratchfoundation/scratch-l10n/blob/c08c6625bb5166a64cce690ad1ac3cc6dbbe20b6/editor/blocks/ja.json)。

## 1. 数え方と型の読み方

本資料の「表示ブロック」は、通常パレットから選べる独立opcode形を数える。ドロップダウンの選択肢、変数名の数、ユーザー定義手順の数、shadow入力、作成ボタンは組込ブロック数に足さない。Stage限定とSprite限定は別に示す。

Scratchのソケット形は静的型システムではない。以下の `Number入力` は通常の数値欄、`Boolean入力` は六角形の条件欄を表す。VMが受け取る実値には文字列やboolean等も来得るため、数値キャスト/真偽キャストは第7節を必ず合わせて読む。`Value` はScratchの実行値であり、NEXUSにAny型を追加する提案ではない。

- 文: 順に実行する副作用/制御ブロック。値を返すreporterではない。
- 値: 丸いreporter。数値・文字などを返す。
- 条件: Boolean reporter。
- 起点: イベントhat。条件がそろうとスクリプトを開始。
- 定義: ワークスペースの自作ブロック定義。パレットからの呼出しとは別。

## 2. 制御: 通常パレットの全11 opcode

Stageでは `control_start_as_clone` と `control_delete_this_clone` が出ず9種類。`control_create_clone_of` はStageにも出る。以下の全行は標準パレット掲載を確認した。

| opcode | 日本語表記・形 | 入力 / 出力・効果 | Scratchの実際の境界動作 |
|---|---|---|---|
| `control_wait` | (秒) 秒待つ / 文 | DURATION:Number → 現在スレッドの待機 | `max(0,1000×toNumber)` ms。負数/空/不正文字は0秒になるが、初回はyieldする。Infinityは終了しない待機になり得る。7日上限はない |
| `control_repeat` | (回数) 回繰り返す / C型 | TIMES:Number、SUBSTACK → 回数反復 | 回数はMath.round。2.5は3回、2.4は2回、負数/0は0回。不正文字は0。counterは開始時に固定するが入力reporter評価はVMの再実行順に従う。Infinityは有限回数にならない |
| `control_forever` | ずっと / 終端C型 | SUBSTACK → 無期限反復 | 自動終了条件なし。通常実行は協調スケジューリング。NEXUSには採用しない |
| `control_if` | もし <条件> なら / C型 | CONDITION:Boolean、SUBSTACK → 条件枝 | Cast.toBooleanで判定。falseなら中身を実行せず後続へ |
| `control_if_else` | もし <条件> なら / でなければ / C型 | CONDITION、SUBSTACK、SUBSTACK2 → 一方のみ実行 | 条件がtrueなら1枝、falseなら2枝。未選択の文の中身は実行しない |
| `control_wait_until` | <条件> まで待つ / 文 | CONDITION:Boolean → 条件成立待ち | falseの間yieldして再評価。最初からtrueなら待たず進む。タイムアウト/回数制限なし |
| `control_repeat_until` | <条件> まで繰り返す / C型 | CONDITION、SUBSTACK → 前判定反復 | 条件falseの間実行。最初からtrueなら0回。条件不成立なら無期限 |
| `control_stop` | [すべて/このスクリプト/スプライトの他のスクリプト]を止める / 終端または文 | STOP_OPTION → 停止範囲に応じた制御 | allはプロジェクト全threads停止・clone破棄。「他」は同一targetの自分以外を止め自分は続行。「この」は手順内なら最も近いprocedures_callまで巻戻し、手順外ならthread終了。後続接続可は「他」だけ |
| `control_start_as_clone` | クローンされたとき / 起点 | 引数なし → cloneの起動 | getHatsに登録。通常の計算primitiveではない。Spriteのみ |
| `control_create_clone_of` | [対象] のクローンを作る / 文 | CLONE_OPTION:対象名/`_myself_` → clone作成 | 存在しないtargetは何もしない。Stage自体はclone不可。global clone上限300。元targetのlocal変数/listはコピーし、global変数は共有 |
| `control_delete_this_clone` | このクローンを削除する / 終端 | 現target → clone破棄・targetのthreads停止 | originalでは何もしない。Spriteパレットのみ |

根拠: [GUI control](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-gui/src/lib/make-toolbox-xml.js)、[制御VM](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_control.js)、[stopのstack動作](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/engine/thread.js)、[block utility](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/engine/block-utility.js)、[runtime上限・停止](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/engine/runtime.js)、[clone](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/sprites/rendered-target.js)。

### 2.1 制御の非パレット・互換opcode: 表示11個に加えない

「VMにだけ残る」と一括表現すると不正確。次の6個はVMに残り、scratch-blocksにも定義があるが、現行標準パレットには出ない。保存済みプロジェクト互換として存在する。

| opcode | 意味・実動作 | 境界 / NEXUS判断 |
|---|---|---|
| `control_while` | 条件trueの間繰り返す | 条件不変trueなら無期限。通常UIで新規選択できる標準ブロックとして数えない |
| `control_for_each` | 変数を1から順に増やしVALUEまで反復 | `index < Number(VALUE)` の後index++。正の2.5なら1,2,3の3回。一般List foreachではない。日本語訳だけからリストforeachと解釈しない |
| `control_get_counter` | VM共通counterを返す | 数値reporter。初期0。独立したユーザーRun変数ではない |
| `control_incr_counter` | counterを1増やす | 文。普通の変数changeとは別primitive |
| `control_clear_counter` | counterを0へ戻す | 文。runtime dispose時にもclear |
| `control_all_at_once` | 中の文を1回実行 | VMコメントも「if true相当」と明記。warpやatomic transactionではない |

根拠: [制御VM](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_control.js)、[制御block定義](https://github.com/scratchfoundation/scratch-blocks/blob/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8/src/blocks/control.ts)。

## 3. 演算: 通常パレットの全18 opcode

| opcode | 日本語表記・出力 | 入力キー | Scratchの実際の境界動作 |
|---|---|---|---|
| `operator_add` | (a)+(b) → Number | NUM1、NUM2 | 両方toNumber後に加算。文字列結合にはならない。`abc+1=1`。浮動小数点 |
| `operator_subtract` | (a)-(b) → Number | NUM1、NUM2 | 両方toNumber後に減算。有限性制約なし |
| `operator_multiply` | (a)*(b) → Number | NUM1、NUM2 | 両方toNumber後に乗算。overflowはInfinityになり得る |
| `operator_divide` | (a)/(b) → Number | NUM1、NUM2 | 1/0=Infinity、-1/0=-Infinity、0/0=NaN。例外停止しない |
| `operator_random` | (a)から(b)までの乱数 → Number | FROM、TO | 上下逆なら交換。同じならその値。整数判定は元入力のCast.isInt、整数枝は両端含む。小数枝は通常low以上high未満。Math.randomで呼出しごと再抽選 |
| `operator_gt` | (a)>(b) → Boolean | OPERAND1、OPERAND2 | Cast.compare>0。両方数値化可能なら数値、そうでなければ小文字化した文字の順序。空白は数値0扱いから除外 |
| `operator_lt` | (a)<(b) → Boolean | OPERAND1、OPERAND2 | 同上、compare<0 |
| `operator_equals` | (a)=(b) → Boolean | OPERAND1、OPERAND2 | 同上、compare===0。`01`と1は同値、ABCとabcは同値、空文字と0は異なる |
| `operator_and` | <a>かつ<b> → Boolean | OPERAND1、OPERAND2 | 各値をtoBoolean。**入力reporterの短絡なし**。a=falseでもbのreporterは事前評価される |
| `operator_or` | <a>または<b> → Boolean | OPERAND1、OPERAND2 | 同上。a=trueでもbのreporterを未評価とは保証しない |
| `operator_not` | <a>ではない → Boolean | OPERAND | toBooleanの否定 |
| `operator_join` | (a)と(b) → String | STRING1、STRING2 | String(a)+String(b)。区切りは自動追加しない。空文字もそのまま |
| `operator_letter_of` | (文字列)の(n)番目の文字 → String | LETTER、STRING | 1始まり。`toNumber(n)-1`の範囲検査後charAt。0/負/範囲外は空文字。正の小数位置はcharAtが整数化。UTF-16 1コード単位のため絵文字を分割し得る |
| `operator_length` | (文字列)の長さ → Number | STRING | String(value).length。UTF-16コード単位数。😺=2、e+結合アクセント=2 |
| `operator_contains` | (文字列)に(部分文字列)が含まれる → Boolean | STRING1、STRING2 | 両方String→toLowerCase→includes。大文字小文字無視、空検索文字はtrue。正規化・完全casefoldではない |
| `operator_mod` | (a)を(b)で割った余り → Number | NUM1、NUM2 | JS remainder後に必要なら除数を足し、床除算型に調整。-7 mod 3=2、7 mod -3=-2。除数0はNaN |
| `operator_round` | (n)を四捨五入 → Number | NUM | Math.round。ちょうど半分は+∞方向。-1.5→-1、-0.5→-0。銀行丸め/常に絶対値方向ではない |
| `operator_mathop` | (n)の[数学関数] → Number | OPERATOR、NUM | 下表の14メニュー。1つのopcode。自由式・任意コード・任意底a^bのソケットではない |

根拠: [演算VM](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_operators.js)、[cast](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/util/cast.js)、[演算block定義](https://github.com/scratchfoundation/scratch-blocks/blob/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8/src/blocks/operators.ts)、[VM入力評価](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/engine/execute.js)。

### 3.1 mathopの全14選択肢

| 内部値 / 表示 | 入出力・実装 | 境界 |
|---|---|---|
| `abs` / 絶対値 | n→Math.abs(n) | -0→+0 |
| `floor` / 切り下げ | n→Math.floor(n) | -1.2→-2 |
| `ceiling` / 切り上げ | n→Math.ceil(n) | -1.2→-1 |
| `sqrt` / 平方根 | n→Math.sqrt(n) | n<0はNaN |
| `sin` | 度→sin | radian変換後toFixed(10)→parseFloat。180→0 |
| `cos` | 度→cos | 同じ10桁処理。90→0 |
| `tan` | 度→tan | angle%360。90/-270→Infinity、270/-90→-Infinity。その他toFixed(10) |
| `asin` | 値→角度（度） | Math.asin×180/π。範囲[-1,1]外はNaN |
| `acos` | 値→角度（度） | Math.acos×180/π。範囲[-1,1]外はNaN |
| `atan` | 値→角度（度） | Math.atan×180/π |
| `ln` | n→自然対数 | 0→-Infinity、負→NaN |
| `log` | n→常用対数 | Math.log(n)/Math.LN10。0→-Infinity、負→NaN |
| `e ^` | n→eのn乗 | Math.exp。大きい入力はInfinity |
| `10 ^` | n→10のn乗 | Math.pow(10,n)。大きい入力はInfinity |

VMではOPERATORを小文字化してswitchし、未知名なら0を返す。通常GUIはこの14個に限定する。NEXUSの未知operationエラーを0成功に変える根拠にはならない。

根拠: [mathop](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_operators.js)、[tan補正](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/util/math-util.js)。

## 4. 変数: 通常パレットの全5 opcode

変数を作るボタンは実行opcodeではない。変数がないと操作文4個も表示されず、変数作成後に表示される。変数名ごとのreporter複製は同一opcodeのインスタンス。

| opcode | 日本語表記・形 | 入力 / 出力・効果 | Scratchの実際の境界動作 |
|---|---|---|---|
| `data_variable` | (変数名) / 値 | VARIABLE:id/name → 現在のValue | local→globalでlookup。未解決ならnameで探し、なければlocal新規作成。新規scalarの値は0 |
| `data_setvariableto` | [変数]を(値)にする / 文 | VARIABLE、VALUE → 代入 | 値を数値に強制変換せず保持。cloudフラグがある場合はcloud更新要求も発生 |
| `data_changevariableby` | [変数]を(値)ずつ変える / 文 | VARIABLE、VALUE → 加算代入 | 現値と増分をtoNumberして加算。現値がabcなら0として扱う。cloudなら更新要求 |
| `data_showvariable` | 変数[変数]を表示する / 文 | VARIABLE → monitor表示 | データの公開権限ではなくScratch舞台上の表示切替 |
| `data_hidevariable` | 変数[変数]を隠す / 文 | VARIABLE → monitor非表示 | 値の消去/秘密化/アクセス制御ではない |

### 4.1 スコープと保持

- 「すべてのスプライト用」はStage所有のglobal。「このスプライトのみ」はtarget local。スクリプトごと/手順呼出しごとのローカル変数ではない。同じtargetの複数スクリプトは同じ変数を共有する。
- lookupはまずIDでlocal→Stage、IDで見つからなければ同名・同typeをlocal→Stage。nameは通常変数ではcase-sensitiveの完全一致。表示名だけで参照同一性を推定しない。
- clone作成はlocal変数を複製、list配列もsliceでコピーする。globalはStage参照を共有。
- 緑旗は変数値/listを0/空へリセットしない。プロジェクトの保存形式には変数/listの値が入る。したがってScratchの変数はNEXUSのRun限定変数と同じライフサイクルではない。
- cloud変数は既存のset/change opcode上の属性であり、別パレットopcodeではない。これはNEXUSに永続変数・共有ストアを認める根拠にはしない。

根拠: [Data flyout](https://github.com/scratchfoundation/scratch-blocks/blob/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8/src/data_category.ts)、[Data VM](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_data.js)、[variable初期値](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/engine/variable.js)、[target lookup/複製](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/engine/target.js)、[保存](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/serialization/sb3.js)。

## 5. リスト: Variables内の全12 opcode

独立した第10標準カテゴリではない。「リストを作る」ボタンはopcodeではない。作成すると以下12形が出る。リスト型はScratchでは異種Valueの可変配列で、NEXUSのList<T>をAny化する理由にはならない。

| opcode | 日本語表記・形 | 入力 / 出力・効果 | Scratchの実際の境界動作 |
|---|---|---|---|
| `data_listcontents` | (リスト名) / 値・monitor | LIST → 文字列表現 | 通常式ではList配列そのものを返さない。全要素が長さ1のstringなら区切りなし、それ以外は半角space結合。空list→空文字。monitor評価だけは配列を返す特別経路 |
| `data_addtolist` | (値)を[リスト]に追加する / 文 | ITEM、LIST → 末尾追加 | 上限200,000件。上限到達時は何もしない |
| `data_deleteoflist` | [リスト]の(n)番目を削除する / 文 | INDEX、LIST → 削除 | 1始まり。無効位置は何もしない。内部文字allは全削除を許可 |
| `data_deletealloflist` | [リスト]のすべてを削除する / 文 | LIST → 空配列 | 空でも成功。変数定義は残る |
| `data_insertatlist` | [リスト]の(n)番目に(値)を挿入する / 文 | INDEX、ITEM、LIST → 挿入 | 有効位置1..length+1。lastはlength+1の末尾追加。満杯時の範囲内挿入は末尾をpopして上限維持。上限超の位置は何もしない |
| `data_replaceitemoflist` | [リスト]の(n)番目を(値)で置き換える / 文 | INDEX、ITEM、LIST → 置換 | 有効位置1..length。無効なら何もしない。新規末尾追加にはならない |
| `data_itemoflist` | [リスト]の(n)番目 / 値 | INDEX、LIST → 項目Value | 無効位置/空listは空文字。正当な空文字要素と区別できない |
| `data_itemnumoflist` | [リスト]中の(値)の場所 / 値 | ITEM、LIST → Number | Cast.compare一致の最初の位置を1始まりで返す。なしは0。`[1,"01"]`で"01"を探すと1 |
| `data_lengthoflist` | [リスト]の長さ / 値 | LIST → Number | 要素数。文字数ではない。空listは0 |
| `data_listcontainsitem` | [リスト]に(値)が含まれる / 条件 | LIST、ITEM → Boolean | 全要素にCast.compareの同値。数値1と文字列"01"、Aとaが一致し得る |
| `data_showlist` | リスト[リスト]を表示する / 文 | LIST → monitor表示 | データを作る/送る機能ではない |
| `data_hidelist` | リスト[リスト]を隠す / 文 | LIST → monitor非表示 | list消去ではない |

### 5.1 添字の厳密な境界

`Cast.toListIndex(index,length,acceptAll)` が共通。通常数値は `floor(toNumber(index))`。1.9→1、0/負/length超はINVALID。`last`、`random`、`any`は英語内部値の完全一致で、`LAST`は認識しない。random/anyは1..lengthから選び、空なら無効。`all`はdeleteだけ許可し、get/insert/replaceでは無効。insertだけ評価に渡すlengthが実length+1。

200,000件はここで確認したadd/insertメソッドの操作上限であり、保存ファイル読込やメモリ全体に同じ上限検証が必ず掛かると確認したものではない。

UIの数値欄のshadow制約とVMの入力契約は別。挿したreporterから小数/文字列が来たときにもVMの上記挙動が発生する。NEXUSで範囲外を黙殺したり、検索不一致の0をそのまま取得へ渡す設計にしない。

根拠: [Data flyout全列挙](https://github.com/scratchfoundation/scratch-blocks/blob/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8/src/data_category.ts)、[Data VM](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_data.js)、[添字cast](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/util/cast.js)。

## 6. 自作ブロック: パレット・定義・引数を区別

| opcode / UI | 表示位置・表記 | 入力 / 出力・効果 | Scratchの実際の境界動作 |
|---|---|---|---|
| 作成ボタン（opcodeなし） | My Blocks内「ブロックを作る」 | 名前・ラベル・文字/数値引数・真偽引数・warp指定 | 編集操作。実行時の新しい組込種類には数えない |
| `procedures_call` | パレットに定義ごとに生成される呼出し / 文 | proccodeと可変個の引数 → 定義の文実行 | 値を返す関数reporterではない。定義が見つからないとno-op。引数を名前へ格納し欠落引数は定義defaultで補完 |
| `procedures_definition` | workspace上「定義 …」 / 定義hat | custom_block → 本体 | 通常のイベントhatではなく呼出し先。primitive自体はno-opで本体へ進む。パレットの独立選択項目ではない |
| `argument_reporter_string_number` | 定義の引数名から使う丸い値 | VALUE:引数名 → 呼出し引数 | 最も近い呼出しparamsだけを見る。見つからない場合0。親の別手順の同名引数へ暗黙に遡らない |
| `argument_reporter_boolean` | 定義の引数名から使う六角形条件 | VALUE:引数名 → 呼出し引数 | 実装はstored valueをそのまま返し、見つからない場合0。使用側がtoBooleanする |
| `procedures_prototype` | 定義内の署名/パラメータ構造 | mutation: proccode/argumentids/names/defaults/warp | 実行用の独立ユーザー処理ではない。executeはcustom_block入力を評価対象から外す |
| `procedures_declaration`、`argument_editor_string_number`、`argument_editor_boolean` | 編集ダイアログ用 | 署名編集 | 実行primitiveでも標準パレット操作でもない |

### 6.1 呼出し、再帰、warp、停止

- 定義lookupは `thread.target.blocks` で行う。同じsprite/targetの手順であり、任意の他spriteの手順を名前だけで呼ぶ機能ではない。
- Scratchは再帰を禁止しない。sequencerは再帰らしい呼出しを検知して通常modeでyieldする。threadの探索は近傍の限定範囲であり、再帰検出は安全性証明ではない。
- 「画面を再描画せずに実行」のwarpはスケジューリング設定。定義のmutationにwarp flagを置き、500msのwarp時間枠を使う。外部副作用のatomic性・失敗時rollback・無制限実行権限を意味しない。
- `stop this script`は自作ブロック内では手順から早期に戻るように働く。Scratchにはパレット上の汎用 `return value`、break、continue、try/catchブロックはない。
- NEXUSの純粋な自作値ブロックは独自拡張として明記する。Scratchの標準My Blocksが値を返すと思わせない。再帰は禁止し、定義依存グラフと固定版を検査する。

根拠: [My Blocks flyout](https://github.com/scratchfoundation/scratch-blocks/blob/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8/src/procedures.ts)、[block形と署名](https://github.com/scratchfoundation/scratch-blocks/blob/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8/src/blocks/procedures.ts)、[手順VM](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_procedures.js)、[sequencer](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/engine/sequencer.js)、[thread params/stop/再帰](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/engine/thread.js)。

## 7. 横断する境界意味論: Scratchからそのまま移さない点

### 7.1 数値と真偽

`toNumber`はJS Numberを使い、NaNになれば0。空文字/空白/abc→0、true→1、false→0、0x10→16、1e3→1000、Infinityはそのまま。計算で生じたNaNも「次の数値入力」では0になるため、`(0/0)+1`は1になる。数値型はJS binary64で、整数精度や十進厳密性の保証はない。

`toBoolean`は数値0/NaN等をfalse、文字列では正確に空文字、"0"、大小文字無視の"false"だけをfalseにする。"0.0"、" 0 "、" false "、単なる空白はtrue。数値変換と真偽変換の一致を前提にしてはいけない。

本資料のNaN/Infinity/-0はVM内部の実値を指す。特に-0の画面表示が常に「-0」になるとは限らない。

NEXUSでは明示変換、失敗結果、finite numberの制約を用いる。Snowflake等のIDをNumber化しない。未入力・不正値・unknownを0/falseで埋めない。

### 7.2 比較

比較はまず両値をNumberに変換する。ただし空文字/空白だけのstring/nullが0に見える場合は非数値扱いとする。両方数値なら数値差で比較し、同符号Infinity同士を同値として特別処理。一方でも非数値ならString→toLowerCase後にJS文字順比較。

例: "01"=1はtrue、"ABC"="abc"はtrue、""=0はfalse、""=" "はfalse、éとe+結合アクセントは異なる。大文字小文字無視はlocale-aware照合でもUnicode正規化でもない。list検索もこの比較を使う。

### 7.3 乱数の型依存と再現性

元引数がnumberなら整数かを判定。stringなら「`.`が含まれないか」だけで整数扱いを決める。このため数値として同じ1でも `"1.0"` と `1` で乱数枝が異なる。より奇妙な境界として `"1e-1"` と `"1"` は整数枝になり、Math.random=.999なら1.1を返し、数値化した上限1を超える。通常UIで一般的な入力ではないが、互換実装に意味論を持ち込むなら見落とせない。

seed固定や再試行の再現性は提供しない。NEXUSでは明示取得操作として1つの動的実行identityに抽選結果を確定し、再試行で引き直さない別契約が必要。金銭抽選・認証秘密への適用は別判断。

### 7.4 Unicodeと位置

length/letterはUTF-16 code unit。😺は2、家族のZWJ絵文字👨‍👩‍👧‍👦は11。letter 1/2で😺のsurrogate半分が返る。結合文字も分割できる。人が見る1文字とは一致しない。containsはtoLowerCaseだけで、ßにSSが含まれる判定はfalse。NEXUSの表示用処理は書記素クラスタ等の方針を別に確定し、Discord等のpayload字数/byte制限とは独立に検証する。

### 7.5 短絡、未選択枝、評価順

VMのexecuteは各inputの子operationを先に `_ops`へ並べ、そのあと親operationを追加する。したがってAND/ORメソッド内部の&&/||は「右reporterを実行しない」という言語上の短絡ではない。副作用がある拡張reporter、乱数、時計読取等の評価を条件式で隠さない。

一方、if/if-elseのSUBSTACKは選ばれた文だけを実行する制御。AND/ORの入力評価と同じではない。NEXUSで短絡を採るなら、左→右順・未評価枝・コスト/unknown伝播を明文化した独自仕様にする。

### 7.6 待機・無限・再帰

Scratchは無期限forever、条件成立までの無期限待機、再帰、Infinity入力を許し得る。NEXUSはRunと単一Waitがともに最大7日でも、**開始後6日目に7日Waitを置けるわけではない**。Waitは残りRun期限内に収める。待機開始時に残り期限を判定し、再開/遅延/時計ずれで期限が過ぎていれば後続副作用へ進めない。Scratchの自由な反復をそのまま採用せず、有限count/list反復・上限付き登録読取pollで表現する。

横断根拠: [cast](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/util/cast.js)、[operators](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_operators.js)、[execute](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/engine/execute.js)。NEXUS上限との調整部分は本調査からの設計判断で、Scratch仕様ではない。

## 8. 確認方法と未確定事項

1. 固定commitのGUI通常パレットXMLをStage/Sprite別に評価し、表示opcodeを抽出した。Variables/My Blocksはscratch-blocks側の動的flyoutを直接照合した。
2. 公式VMのcast/operators/dataソースを読み、限定的なNode検証を **73ケース** 実行した。数値/真偽/比較、zero divide/mod/round/math、乱数分岐、UTF-16、list境界を確認。これは公式メソッドの局所検証であり、ブラウザで全エディタを操作したE2E検証ではない。
3. 手順stop/再帰/warp、clone、scope、保存はVM/engine/serializationのコード読解に基づく。ブラウザでの全スケジューリング再現テストは未実施。
4. scratch.mit.edu本番の配備commit、feature rollout、国/端末/アカウント別の拡張表示は未確定。公開developのコードとしては確認済み。
5. 日本語表示は依存l10nを基準とする。UIのフォント・空白調整・別locale・翻訳更新は固定資料の範囲外。
6. 公式ハードウェア拡張の実機通信、音声/翻訳の外部サービス稼働、Face Sensingの端末対応を実機検証したものではない。NEXUSへ移植する許可も意味しない。
7. Scratch公開ソースのライセンスは各repo/fileを参照。NEXUSへのコード転用・依存導入のライセンス適合性は本資料の調査対象外。今回は挙動比較と設計の整理のみ。

## 9. 全標準カテゴリ・公式拡張の補足棚卸し

この後の付録は同じ基準commitからの独立抽出結果。2〜6節と重複するカテゴリは件数と位置付けの確認に用い、二重に加算しない。

### 標準9カテゴリ（実際の並び順）

|順|表示カテゴリ|toolboxitemid|VM/core差替えカテゴリID|Sprite/Stage表示数|範囲|
|---|---|---|---|---|---|
|1|Motion / 動き|motion|motion|18 / 0|Stageでは「Stage selected: no motion blocks」のlabelのみ|
|2|Looks / 見た目|looks|looks|20 / 7|和集合21。Stageだけの「背景を変えて待つ」がある|
|3|Sound / 音|sound|sound|9 / 9|音声ファイル再生・音響効果・音量|
|4|Events / イベント|events|event|8 / 8|和集合9。クリックhatがSprite/Stageで異なる|
|5|Control / 制御|control|control|11 / 9|第2節参照。Stageはclone開始・自身のclone削除を表示しない|
|6|Sensing / 調べる|sensing|sensing|19 / 14|online?を含む|
|7|Operators / 演算|operators|operators|18 / 18|第3節参照|
|8|Variables / 変数|variables|data|動的 / 動的|custom="VARIABLE"。変数・リスト・作成ボタン|
|9|My Blocks / ブロック定義|myBlocks|procedures|動的 / 動的|custom="PROCEDURE"。作成ボタン・定義/呼出|

拡張カテゴリは、標準9カテゴリの後に categoriesXML の順で追加される。標準カテゴリをextension方式で差し替えられる仕組みはあるが、通常状態の標準9カテゴリの分類とは別の実装上の仕組み。

### Motion / Looks / Sound / Events / Sensing: 全表示opcode

表の英語表示は公式英語メッセージのテンプレート。`%1` 等は引数やアイコン位置。C=命令、R=レポーター、B=真偽値、H=開始hat。Sprite/Stageの○はその対象を編集中の通常パレットに表示されることを表す。

#### Motion — Sprite 18 / Stage 0 / 和集合 18

[パレット根拠](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-gui/src/lib/make-toolbox-xml.js#L9-L148) / [形状・メッセージ定義](https://github.com/scratchfoundation/scratch-blocks/blob/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8/src/blocks/motion.ts)

|opcode|英語表示テンプレート|形状|Sprite|Stage|
|---|---|---|---|---|
|`motion_movesteps`|move %1 steps|C|○|—|
|`motion_turnright`|turn %1 %2 degrees|C|○|—|
|`motion_turnleft`|turn %1 %2 degrees|C|○|—|
|`motion_goto`|go to %1|C|○|—|
|`motion_gotoxy`|go to x: %1 y: %2|C|○|—|
|`motion_glideto`|glide %1 secs to %2|C|○|—|
|`motion_glidesecstoxy`|glide %1 secs to x: %2 y: %3|C|○|—|
|`motion_pointindirection`|point in direction %1|C|○|—|
|`motion_pointtowards`|point towards %1|C|○|—|
|`motion_changexby`|change x by %1|C|○|—|
|`motion_setx`|set x to %1|C|○|—|
|`motion_changeyby`|change y by %1|C|○|—|
|`motion_sety`|set y to %1|C|○|—|
|`motion_ifonedgebounce`|if on edge, bounce|C|○|—|
|`motion_setrotationstyle`|set rotation style %1|C|○|—|
|`motion_xposition`|x position|R|○|—|
|`motion_yposition`|y position|R|○|—|
|`motion_direction`|direction|R|○|—|

#### Looks — Sprite 20 / Stage 7 / 和集合 21

[パレット根拠](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-gui/src/lib/make-toolbox-xml.js#L162-L303) / [形状・メッセージ定義](https://github.com/scratchfoundation/scratch-blocks/blob/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8/src/blocks/looks.ts)

|opcode|英語表示テンプレート|形状|Sprite|Stage|
|---|---|---|---|---|
|`looks_sayforsecs`|say %1 for %2 seconds|C|○|—|
|`looks_say`|say %1|C|○|—|
|`looks_thinkforsecs`|think %1 for %2 seconds|C|○|—|
|`looks_think`|think %1|C|○|—|
|`looks_switchcostumeto`|switch costume to %1|C|○|—|
|`looks_nextcostume`|next costume|C|○|—|
|`looks_switchbackdropto`|switch backdrop to %1|C|○|○|
|`looks_nextbackdrop`|next backdrop|C|○|○|
|`looks_changesizeby`|change size by %1|C|○|—|
|`looks_setsizeto`|set size to %1 %|C|○|—|
|`looks_changeeffectby`|change %1 effect by %2|C|○|○|
|`looks_seteffectto`|set %1 effect to %2|C|○|○|
|`looks_cleargraphiceffects`|clear graphic effects|C|○|○|
|`looks_show`|show|C|○|—|
|`looks_hide`|hide|C|○|—|
|`looks_gotofrontback`|go to %1 layer|C|○|—|
|`looks_goforwardbackwardlayers`|go %1 %2 layers|C|○|—|
|`looks_costumenumbername`|costume %1|R|○|—|
|`looks_backdropnumbername`|backdrop %1|R|○|○|
|`looks_size`|size|R|○|—|
|`looks_switchbackdroptoandwait`|switch backdrop to %1 and wait|C|—|○|

#### Sound — Sprite 9 / Stage 9 / 和集合 9

[パレット根拠](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-gui/src/lib/make-toolbox-xml.js#L305-L364) / [形状・メッセージ定義](https://github.com/scratchfoundation/scratch-blocks/blob/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8/src/blocks/sound.ts)

|opcode|英語表示テンプレート|形状|Sprite|Stage|
|---|---|---|---|---|
|`sound_playuntildone`|play sound %1 until done|C|○|○|
|`sound_play`|start sound %1|C|○|○|
|`sound_stopallsounds`|stop all sounds|C|○|○|
|`sound_changeeffectby`|change %1 effect by %2|C|○|○|
|`sound_seteffectto`|set %1 effect to %2|C|○|○|
|`sound_cleareffects`|clear sound effects|C|○|○|
|`sound_changevolumeby`|change volume by %1|C|○|○|
|`sound_setvolumeto`|set volume to %1%|C|○|○|
|`sound_volume`|volume|R|○|○|

#### Events — Sprite 8 / Stage 8 / 和集合 9

[パレット根拠](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-gui/src/lib/make-toolbox-xml.js#L366-L409) / [形状・メッセージ定義](https://github.com/scratchfoundation/scratch-blocks/blob/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8/src/blocks/event.ts)

|opcode|英語表示テンプレート|形状|Sprite|Stage|
|---|---|---|---|---|
|`event_whenflagclicked`|when %1 clicked|H|○|○|
|`event_whenkeypressed`|when %1 key pressed|H|○|○|
|`event_whenthisspriteclicked`|when this sprite clicked|H|○|—|
|`event_whenbackdropswitchesto`|when backdrop switches to %1|H|○|○|
|`event_whengreaterthan`|when %1 > %2|H|○|○|
|`event_whenbroadcastreceived`|when I receive %1|H|○|○|
|`event_broadcast`|broadcast %1|C|○|○|
|`event_broadcastandwait`|broadcast %1 and wait|C|○|○|
|`event_whenstageclicked`|when stage clicked|H|—|○|

#### Sensing — Sprite 19 / Stage 14 / 和集合 19

[パレット根拠](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-gui/src/lib/make-toolbox-xml.js#L466-L548) / [形状・メッセージ定義](https://github.com/scratchfoundation/scratch-blocks/blob/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8/src/blocks/sensing.ts)

|opcode|英語表示テンプレート|形状|Sprite|Stage|
|---|---|---|---|---|
|`sensing_touchingobject`|touching %1?|B|○|—|
|`sensing_touchingcolor`|touching color %1?|B|○|—|
|`sensing_coloristouchingcolor`|color %1 is touching %2?|B|○|—|
|`sensing_distanceto`|distance to %1|R|○|—|
|`sensing_askandwait`|ask %1 and wait|C|○|○|
|`sensing_answer`|answer|R|○|○|
|`sensing_keypressed`|key %1 pressed?|B|○|○|
|`sensing_mousedown`|mouse down?|B|○|○|
|`sensing_mousex`|mouse x|R|○|○|
|`sensing_mousey`|mouse y|R|○|○|
|`sensing_setdragmode`|set drag mode %1|C|○|—|
|`sensing_loudness`|loudness|R|○|○|
|`sensing_timer`|timer|R|○|○|
|`sensing_resettimer`|reset timer|C|○|○|
|`sensing_of`|%1 of %2|R|○|○|
|`sensing_current`|current %1|R|○|○|
|`sensing_dayssince2000`|days since 2000|R|○|○|
|`sensing_online`|online?|B|○|○|
|`sensing_username`|username|R|○|○|

#### 表示差・意味の注意

- Motionは18種類ともSprite専用。StageのMotionカテゴリ自体は残る。
- LooksのStage表示は、背景切替・背景切替して待つ・次背景・効果変更/設定/消去・背景番号/名前の7種類。`looks_switchbackdroptoandwait` はこのGUIパレットではStageだけ。
- Eventsは `event_whenthisspriteclicked` と `event_whenstageclicked` が対象依存で入れ替わる。両方を常に同一対象に並べる構成ではない。
- SensingのSprite専用は接触対象、色接触、色同士の接触、距離、ドラッグ設定の5種類。その他14種類はStageにも出る。
- `sensing_online` は真偽値・monitor対応。VM実装は `window.navigator.onLine` を返し、booleanでなければ空文字を返す。特定サービスへの到達性やScratchログイン状態を検査するブロックではない。
- `isInitialSetup=true` はStage強制と一部の翻訳済みデフォルト文字列ブロック省略のための初期化用状態。これを通常パレット棚卸しと混同しない。

### Shadow/menuと非表示・互換opcode

#### 引数UIを構成するshadow/menu（独立パレット数に加算しない）

- Motion: `motion_goto_menu`, `motion_glideto_menu`, `motion_pointtowards_menu`
- Looks: `looks_costume`, `looks_backdrops`
- Sound: `sound_sounds_menu`。VMには `sound_beats_menu`, `sound_effects_menu` もあるが、この通常Soundパレットの独立表示opcodeではない。
- Events: `event_broadcast_menu`。`event_touchingobjectmenu` は非表示hatの補助menu。
- Sensing: `sensing_touchingobjectmenu`, `sensing_distancetomenu`, `sensing_keyoptions`, `sensing_of_object_menu`
- 共通の `math_number`, `math_angle`, `math_integer`, `text`, `colour_picker` 等も入力UI用shadowであり、この5カテゴリの独立した操作種類には加算しない。

#### VMにあるが通常パレットには出ないopcode

|区分|opcode|扱い|
|---|---|---|
|Motion|`motion_scroll_right`, `motion_scroll_up`, `motion_align_scene`, `motion_xscroll`, `motion_yscroll`|VMソースに明記されたLegacy no-op|
|Looks|`looks_hideallsprites`, `looks_changestretchby`, `looks_setstretchto`|VMソースに明記されたlegacy no-op|
|Events|`event_whentouchingobject`|VMにpredicate/hatが存在しブロック定義もあるがGUI通常パレットにはない。非表示互換枠として分離し、通常機能数に加算しない|
|Sensing|`sensing_loud`|音量閾値判定の旧ブロック。VM/ブロック定義に存在、通常パレット非表示|
|Sensing|`sensing_userid`|旧互換用no-op、通常パレット非表示|

根拠: [motion VM](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_motion.js) / [looks VM](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_looks.js) / [sound VM](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_sound.js) / [event VM](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_event.js) / [sensing VM](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/blocks/scratch3_sensing.js)。表示有無は上記make-toolbox-xml.jsと照合。

### 公式拡張ライブラリ（12件）

ライブラリの表示名と追加後のパレットカテゴリ名はハードウェア系の一部で異なる。IDは大文字小文字を含めて正確に保存する。各リンクはgetInfoを含むVM実装。

|ライブラリ表示名|追加後のカテゴリ名（英語）|現行ID|Sprite/Stage表示数|主機能|
|---|---|---|---|---|---|
|[Music](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_music/index.js)|Music|`music`|7 / 7|楽器・ドラム・音符・拍・テンポ|
|[Pen](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js)|Pen|`pen`|9 / 1|消去、スタンプ、描画の上下、色パラメータ、太さ|
|[Video Sensing](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_video_sensing/index.js)|Video Sensing|`videoSensing`|4 / 4|カメラ映像の動き量/方向、閾値hat、映像on/off・透明度|
|[Face Sensing](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_face_sensing/index.js)|Face Sensing|`faceSensing`|9 / 5|顔パーツ追従、顔の傾き/大きさ、顔検出、パーツとの接触|
|[Text to Speech](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_text2speech/index.js)|Text to Speech|`text2speech`|3 / 3|読み上げ、声、言語設定|
|[Translate](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_translate/index.js)|Translate|`translate`|2 / 2|文章翻訳、閲覧者の言語取得|
|[Makey Makey](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_makeymakey/index.js)|Makey Makey|`makeymakey`|2 / 2|キー入力hatと順序付きキー列hat|
|[micro:bit](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_microbit/index.js)|micro:bit|`microbit`|10 / 10|ボタン、ジェスチャー、LED表示、傾き、pin接続|
|[Go Direct Force & Acceleration](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_gdx_for/index.js)|Force and Acceleration|`gdxfor`|9 / 9|力、押す/引く、ジェスチャー、傾き、自由落下、回転、加速度|
|[LEGO MINDSTORMS EV3](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js)|LEGO EV3|`ev3`|11 / 11|モーター駆動/出力/位置、ボタン、距離、明るさ、beep|
|[LEGO BOOST](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js)|BOOST|`boost`|12 / 12|モーター時間/回転/速度/方向/位置、色、傾き、ライト|
|[LEGO Education WeDo 2.0](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js)|WeDo 2.0|`wedo2`|11 / 11|モーター、ライト、距離、傾き|

#### 拡張と標準の境界・対象差

- MusicはSound標準カテゴリではなく追加拡張。Penも独立拡張。Video Sensing/Face Sensingは標準Sensingカテゴリに混ぜず追加拡張として扱う。
- VM builtinExtensions にある `coreExample` は開発用の参照実装であり、公式GUIの拡張選択ライブラリには表示されない。13番目の公式拡張として加算しない。
- PenはStageでは `pen_clear`（erase all）だけを表示。残り8種類はSprite filter付き。
- Face SensingはSprite9種類、Stage5種類。`goToPart`, `pointInFaceTiltDirection`, `setSizeToFaceSize`, `whenSpriteTouchesPart` の4種類がSprite専用。
- その他10拡張のgetInfoには対象をSpriteに限定するfilterはなく、同じ表示opcodeがStageにも出る。実際にハードウェアやカメラが動くかは権限・接続・環境の別条件。
- GUI libraryの metadata は text2speech / translate に internetConnectionRequired を付ける。microbit / gdxfor / ev3 / boost / wedo2 は bluetoothRequired・internetConnectionRequired・launchPeripheralConnectionFlow付き。Makey Makeyはキー入力として扱い、このBluetooth接続フローではない。
- 接続不可・未実装を成功扱いのno-opにせず、NEXUSの設計では「未対応」「要接続」「要権限」「利用可能」を区別するのが妥当（設計上の推奨）。

#### 拡張の表示opcode一覧（補助一覧）

VMの拡張ブロック識別子は extension ID と getInfoのopcodeを結合した `ID_opcode` 形式。以下はメニュー生成opcodeを除く独立したブロック。`[S]` はSpriteだけに表示。

- Music: `music_playDrumForBeats`, `music_restForBeats`, `music_playNoteForBeats`, `music_setInstrument`, `music_setTempo`, `music_changeTempo`, `music_getTempo`
- Pen: `pen_clear`, `pen_stamp` [S], `pen_penDown` [S], `pen_penUp` [S], `pen_setPenColorToColor` [S], `pen_changePenColorParamBy` [S], `pen_setPenColorParamTo` [S], `pen_changePenSizeBy` [S], `pen_setPenSizeTo` [S]
- Video Sensing: `videoSensing_whenMotionGreaterThan`, `videoSensing_videoOn`, `videoSensing_videoToggle`, `videoSensing_setVideoTransparency`
- Face Sensing: `faceSensing_goToPart` [S], `faceSensing_pointInFaceTiltDirection` [S], `faceSensing_setSizeToFaceSize` [S], `faceSensing_whenTilted`, `faceSensing_whenSpriteTouchesPart` [S], `faceSensing_whenFaceDetected`, `faceSensing_faceIsDetected`, `faceSensing_faceTilt`, `faceSensing_faceSize`
- Text to Speech: `text2speech_speakAndWait`, `text2speech_setVoice`, `text2speech_setLanguage`
- Translate: `translate_getTranslate`, `translate_getViewerLanguage`
- Makey Makey: `makeymakey_whenMakeyKeyPressed`, `makeymakey_whenCodePressed`
- micro:bit: `microbit_whenButtonPressed`, `microbit_isButtonPressed`, `microbit_whenGesture`, `microbit_displaySymbol`, `microbit_displayText`, `microbit_displayClear`, `microbit_whenTilted`, `microbit_isTilted`, `microbit_getTiltAngle`, `microbit_whenPinConnected`
- Go Direct Force & Acceleration: `gdxfor_whenGesture`, `gdxfor_whenForcePushedOrPulled`, `gdxfor_getForce`, `gdxfor_whenTilted`, `gdxfor_isTilted`, `gdxfor_getTilt`, `gdxfor_isFreeFalling`, `gdxfor_getSpinSpeed`, `gdxfor_getAcceleration`
- LEGO MINDSTORMS EV3: `ev3_motorTurnClockwise`, `ev3_motorTurnCounterClockwise`, `ev3_motorSetPower`, `ev3_getMotorPosition`, `ev3_whenButtonPressed`, `ev3_whenDistanceLessThan`, `ev3_whenBrightnessLessThan`, `ev3_buttonPressed`, `ev3_getDistance`, `ev3_getBrightness`, `ev3_beep`
- LEGO BOOST: `boost_motorOnFor`, `boost_motorOnForRotation`, `boost_motorOn`, `boost_motorOff`, `boost_setMotorPower`, `boost_setMotorDirection`, `boost_getMotorPosition`, `boost_whenColor`, `boost_seeingColor`, `boost_whenTilted`, `boost_getTiltAngle`, `boost_setLightHue`
- LEGO Education WeDo 2.0: `wedo2_motorOnFor`, `wedo2_motorOn`, `wedo2_motorOff`, `wedo2_startMotorPower`, `wedo2_setMotorDirection`, `wedo2_setLightHue`, `wedo2_whenDistance`, `wedo2_whenTilted`, `wedo2_getDistance`, `wedo2_isTilted`, `wedo2_getTiltAngle`

#### 拡張の非表示互換opcode

- Music: `music_midiPlayDrumForBeats`, `music_midiSetInstrument`
- Pen: `pen_setPenShadeToNumber`, `pen_changePenShadeBy`, `pen_setPenHueToNumber`, `pen_changePenHueBy`
- WeDo 2.0: `wedo2_playNoteFor`
以上7種類はgetInfoに `hideFromPalette: true` が明示される。通常パレット89/77の内数ではない。

### 残る確認範囲・不確実性

- 本資料の「現行」は指定commitのコードベースを意味する。scratch.mit.edu本番配信版のcommit・地域/アカウント別feature rollout・実機接続は未確認。
- この付録の5標準カテゴリと12拡張はパレット構成とopcodeの棚卸しを対象とし、各ブロックの境界値、停止・待機・スレッド意味論、音響/描画/カメラの性能互換性試験は実施していない。第2〜7節の制御/演算/データ/手順に関するコード確認・局所テストとは範囲が異なる。
- この付録の日本語名はカテゴリの説明として付記し、5標準カテゴリと12拡張の正式日本語翻訳の全照合は行っていない。テキスト比較を受入条件にする場合は依存scratch-l10nの日本語辞書を固定して追加照合する。
- SoundのVM補助menu2種や非表示イベントhatを、将来の互換import対象としてどこまで採用するかはNEXUS側の仕様判断。公式パレットの初期表示要件と分けて記録する。
- Variables/Lists/My Blocksの動的詳細は本資料第4〜6節を参照。

機械抽出資料: `scratch-palette-extracted.json`（Sprite/Stage双方。Variables/My Blocksの空配列は動的生成前の構造を示す）。


## 10. カテゴリ別の参照済み範囲と未確認範囲

この表の「全列挙」は固定commitのパレット・getInfoに現れるopcodeの網羅であり、すべての実行挙動をE2Eで検証したという意味ではない。

|対象|参照済み|未確認・保証しない範囲|
|---|---|---|
|Motion|表示18 opcode、形状、全てSprite限定、VMのlegacy no-op群|移動/衝突/回転/境界補正/描画rendererの全実動作|
|Looks|表示和集合21 opcode、20/7の対象差、形状、legacy no-op群|衣装/背景/効果/吹出し/レイヤーの全数値境界とタイミング|
|Sound|表示9 opcode、形状、標準とMusic拡張の分離|音声エンジン、音量/効果の境界、再生時間/停止のE2E|
|Events|表示和集合9 opcode、click hat対象差、非表示hat|broadcast競合、再起動、event順序の全組合せ|
|Control|表示11 opcodeの入出力・VMコード、hidden6、stop/clone/loop/waitの意味論|時間精度、全並行スケジューリングをブラウザで再現するE2E|
|Sensing|表示19/14 opcode、形状、online実装、hidden項目|他の全sensorの環境依存値、マイク/キーボード/日時/通信のE2E|
|Operators|表示18 opcode、mathop14、cast含む全メソッドコード、局所境界テスト|すべてのIEEE754値・locale・Unicode版・乱数統計分布の網羅試験|
|Variables|動的flyout5 opcode、set/change/get/show/hide、scope/初期値/clone/保存コード|cloudバックエンド接続・競合・権限・保存サービスのE2E|
|Lists（Variables内）|動的flyout12 opcode、添字/検索/表示/200,000件上限のコード、主要境界の局所テスト|最大容量・UI仮想化・全長期操作列の負荷試験|
|My Blocks|呼出し/定義/引数/編集用node分離、params/再帰/warp/stopコード|全mutator UI、深い/相互再帰の性能、E2E stack挙動|
|Music|公開7/hidden2のgetInfo opcode・カテゴリ・引数形|音源・MIDI・時間精度の実行試験|
|Pen|公開9、Stage1、hidden4のgetInfo opcode・対象filter|色変換/描画/スタンプ/sizeの実行境界|
|Video Sensing|公開4 getInfo opcode・カテゴリ|カメラ権限、映像解析、端末性能|
|Face Sensing|公開9、Stage5のgetInfo opcode・対象filter|顔検出精度、プライバシーUI、端末対応、カメラ実行|
|Text to Speech|公開3 getInfo opcode、internet要求metadata|声/言語の現地提供状況、サービス稼働、音声実行|
|Translate|公開2 getInfo opcode、internet要求metadata|翻訳サービス稼働、全言語対応、出力品質|
|Makey Makey|公開2 getInfo opcode・キー入力方式|実機キー列・OS別イベント差|
|micro:bit|公開10 getInfo opcode・接続metadata|実機/Bluetooth/Scratch Link・各sensor/LED境界|
|Go Direct Force & Acceleration|公開9 getInfo opcode・接続metadata|実機校正、単位/測定誤差、接続・sensor実行|
|LEGO MINDSTORMS EV3|公開11 getInfo opcode・接続metadata|モーター/センサー/安全停止/実機挙動|
|LEGO BOOST|公開12 getInfo opcode・接続metadata|モーター/色/傾き/ライトの実機挙動|
|LEGO Education WeDo 2.0|公開11/hidden1のgetInfo opcode・接続metadata|モーター/距離/傾き/互換音符の実機挙動|

今回の調査に基づいて言えるのは「固定された公式ソースの標準パレットと公式12拡張のopcodeを全体として棚卸しし、特に制御/演算/変数/リスト/自作ブロックの意味論を詳しく確認した」までである。「Scratch全ブロックを実行検証済み」「本番配信中の全機能と完全互換」「全拡張をNEXUSへ実装する」は主張しない。


## 11. 公式12拡張: 全表示ブロックの1行別付録

調査日: 2026-10-15 UTC。対象commit: `eccdbed86086e7f7c77d7302dc3c811f830f242d`。
公式GUI拡張ライブラリの12拡張について、VM実装の `getInfo()` を静的に読み取り、全表示89 opcodeを1行ずつ列挙した。通常パレットから隠される7 opcodeは末尾の別表に置いた。実装・実機実行・各メソッドの境界検証は行っていない。

### 読み方・抽出範囲

- opcodeはVMの完全名 `extensionID_localOpcode`。表内の英語表示は `text: formatMessage({default: ...})` の原文。`[KEY]` は引数プレースホルダー。
- 形状は `BlockType.COMMAND`（命令）、`REPORTER`（レポーター）、`BOOLEAN`（真偽値）、`HAT`（開始hat）。
- 引数は `KEY: ArgumentType` を順序を保って列挙し、menuが指定されていれば `menu=...` を付記。型名は元の宣言どおりで、実際の入力値へのVM coercion・menu値の実行時型・受入範囲を保証するものではない。
- Sprite/Stage列は通常パレットへの表示可否。○は表示、—は非表示。hiddenの別表では両方—。接続・権限・ネットワークが揃って動作することの証明ではない。
- separator、menu生成opcode、拡張選択ボタン、`coreExample` は独立した公式表示ブロック数に含めない。
- `getInfo()` 自体に副作用を含む拡張もあるため、今回はgetInfoを呼び出さずソースだけを解析した。ブロックobjectを括弧・文字列・コメントを認識して切り出し、引数キーとテンプレート内の全プレースホルダー一致も検算した。
- 実機実行、オンラインサービス応答、カメラ/マイク/Bluetooth権限、各メソッドの境界値・停止/待機意味論、本番配信ビルドとの一致は未確認。

ライブラリ根拠: [公式12拡張一覧](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-gui/src/lib/libraries/extensions/index.jsx)。各行の「source」はそのblock objectの固定commit・行範囲へリンクする。

### 全表示89 opcode

#### Music（music）: Sprite 7 / Stage 7

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`music_playDrumForBeats`|play drum [DRUM] for [BEATS] beats|COMMAND|`DRUM: NUMBER` (menu=`DRUM`); `BEATS: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_music/index.js#L767-L786)|
|`music_restForBeats`|rest for [BEATS] beats|COMMAND|`BEATS: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_music/index.js#L808-L822)|
|`music_playNoteForBeats`|play note [NOTE] for [BEATS] beats|COMMAND|`NOTE: NOTE`; `BEATS: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_music/index.js#L823-L841)|
|`music_setInstrument`|set instrument to [INSTRUMENT]|COMMAND|`INSTRUMENT: NUMBER` (menu=`INSTRUMENT`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_music/index.js#L842-L857)|
|`music_setTempo`|set tempo to [TEMPO]|COMMAND|`TEMPO: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_music/index.js#L874-L888)|
|`music_changeTempo`|change tempo by [TEMPO]|COMMAND|`TEMPO: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_music/index.js#L889-L903)|
|`music_getTempo`|tempo|REPORTER|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_music/index.js#L904-L912)|

#### Pen（pen）: Sprite 9 / Stage 1

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`pen_clear`|erase all|COMMAND|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L294-L302)|
|`pen_stamp`|stamp|COMMAND|なし|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L303-L312)|
|`pen_penDown`|pen down|COMMAND|なし|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L313-L322)|
|`pen_penUp`|pen up|COMMAND|なし|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L323-L332)|
|`pen_setPenColorToColor`|set pen color to [COLOR]|COMMAND|`COLOR: COLOR`|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L333-L347)|
|`pen_changePenColorParamBy`|change pen [COLOR_PARAM] by [VALUE]|COMMAND|`COLOR_PARAM: STRING` (menu=`colorParam`); `VALUE: NUMBER`|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L348-L368)|
|`pen_setPenColorParamTo`|set pen [COLOR_PARAM] to [VALUE]|COMMAND|`COLOR_PARAM: STRING` (menu=`colorParam`); `VALUE: NUMBER`|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L369-L389)|
|`pen_changePenSizeBy`|change pen size by [SIZE]|COMMAND|`SIZE: NUMBER`|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L390-L405)|
|`pen_setPenSizeTo`|set pen size to [SIZE]|COMMAND|`SIZE: NUMBER`|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L406-L421)|

#### Video Sensing（videoSensing）: Sprite 4 / Stage 4

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`videoSensing_whenMotionGreaterThan`|when video motion > [REFERENCE]|HAT|`REFERENCE: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_video_sensing/index.js#L419-L435)|
|`videoSensing_videoOn`|video [ATTRIBUTE] on [SUBJECT]|REPORTER|`ATTRIBUTE: NUMBER` (menu=`ATTRIBUTE`); `SUBJECT: NUMBER` (menu=`SUBJECT`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_video_sensing/index.js#L436-L456)|
|`videoSensing_videoToggle`|turn video [VIDEO_STATE]|COMMAND †|`VIDEO_STATE: NUMBER` (menu=`VIDEO_STATE`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_video_sensing/index.js#L457-L471)|
|`videoSensing_setVideoTransparency`|set video transparency to [TRANSPARENCY]|COMMAND †|`TRANSPARENCY: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_video_sensing/index.js#L472-L485)|

#### Face Sensing（faceSensing）: Sprite 9 / Stage 5

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`faceSensing_goToPart`|go to [PART]|COMMAND|`PART: STRING` (menu=`PART`)|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_face_sensing/index.js#L337-L353)|
|`faceSensing_pointInFaceTiltDirection`|point in direction of face tilt|COMMAND|なし|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_face_sensing/index.js#L354-L363)|
|`faceSensing_setSizeToFaceSize`|set size to face size|COMMAND|なし|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_face_sensing/index.js#L364-L373)|
|`faceSensing_whenTilted`|when face tilts [DIRECTION]|HAT|`DIRECTION: STRING` (menu=`TILT`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_face_sensing/index.js#L375-L390)|
|`faceSensing_whenSpriteTouchesPart`|when this sprite touches a [PART]|HAT|`PART: STRING` (menu=`PART`)|○|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_face_sensing/index.js#L391-L407)|
|`faceSensing_whenFaceDetected`|when a face is detected|HAT|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_face_sensing/index.js#L408-L416)|
|`faceSensing_faceIsDetected`|a face is detected?|BOOLEAN|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_face_sensing/index.js#L418-L426)|
|`faceSensing_faceTilt`|face tilt|REPORTER|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_face_sensing/index.js#L427-L435)|
|`faceSensing_faceSize`|face size|REPORTER|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_face_sensing/index.js#L436-L444)|

#### Text to Speech（text2speech）: Sprite 3 / Stage 3

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`text2speech_speakAndWait`|speak [WORDS]|COMMAND|`WORDS: STRING`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_text2speech/index.js#L424-L438)|
|`text2speech_setVoice`|set voice to [VOICE]|COMMAND|`VOICE: STRING` (menu=`voices`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_text2speech/index.js#L439-L454)|
|`text2speech_setLanguage`|set language to [LANGUAGE]|COMMAND|`LANGUAGE: STRING` (menu=`languages`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_text2speech/index.js#L455-L470)|

#### Translate（translate）: Sprite 2 / Stage 2

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`translate_getTranslate`|translate [WORDS] to [LANGUAGE]|REPORTER|`WORDS: STRING`; `LANGUAGE: STRING` (menu=`languages`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_translate/index.js#L113-L136)|
|`translate_getViewerLanguage`|language|REPORTER|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_translate/index.js#L137-L146)|

#### Makey Makey（makeymakey）: Sprite 2 / Stage 2

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`makeymakey_whenMakeyKeyPressed`|when [KEY] key pressed|HAT|`KEY: STRING` (menu=`KEY`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_makeymakey/index.js#L176-L191)|
|`makeymakey_whenCodePressed`|when [SEQUENCE] pressed in order|HAT|`SEQUENCE: STRING` (menu=`SEQUENCE`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_makeymakey/index.js#L192-L207)|

#### micro:bit（microbit）: Sprite 10 / Stage 10

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`microbit_whenButtonPressed`|when [BTN] button pressed|HAT|`BTN: STRING` (menu=`buttons`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_microbit/index.js#L593-L608)|
|`microbit_isButtonPressed`|[BTN] button pressed?|BOOLEAN|`BTN: STRING` (menu=`buttons`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_microbit/index.js#L609-L624)|
|`microbit_whenGesture`|when [GESTURE]|HAT|`GESTURE: STRING` (menu=`gestures`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_microbit/index.js#L626-L641)|
|`microbit_displaySymbol`|display [MATRIX]|COMMAND|`MATRIX: MATRIX`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_microbit/index.js#L643-L657)|
|`microbit_displayText`|display text [TEXT]|COMMAND|`TEXT: STRING`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_microbit/index.js#L658-L681)|
|`microbit_displayClear`|clear display|COMMAND|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_microbit/index.js#L682-L690)|
|`microbit_whenTilted`|when tilted [DIRECTION]|HAT|`DIRECTION: STRING` (menu=`tiltDirectionAny`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_microbit/index.js#L692-L707)|
|`microbit_isTilted`|tilted [DIRECTION]?|BOOLEAN|`DIRECTION: STRING` (menu=`tiltDirectionAny`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_microbit/index.js#L708-L723)|
|`microbit_getTiltAngle`|tilt angle [DIRECTION]|REPORTER|`DIRECTION: STRING` (menu=`tiltDirection`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_microbit/index.js#L724-L739)|
|`microbit_whenPinConnected`|when pin [PIN] connected|HAT|`PIN: STRING` (menu=`touchPins`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_microbit/index.js#L741-L757)|

#### Force and Acceleration（gdxfor）: Sprite 9 / Stage 9

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`gdxfor_whenGesture`|when [GESTURE]|HAT|`GESTURE: STRING` (menu=`gestureOptions`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_gdx_for/index.js#L638-L653)|
|`gdxfor_whenForcePushedOrPulled`|when force sensor [PUSH_PULL]|HAT|`PUSH_PULL: STRING` (menu=`pushPullOptions`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_gdx_for/index.js#L654-L669)|
|`gdxfor_getForce`|force|REPORTER|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_gdx_for/index.js#L670-L678)|
|`gdxfor_whenTilted`|when tilted [TILT]|HAT|`TILT: STRING` (menu=`tiltAnyOptions`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_gdx_for/index.js#L680-L695)|
|`gdxfor_isTilted`|tilted [TILT]?|BOOLEAN|`TILT: STRING` (menu=`tiltAnyOptions`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_gdx_for/index.js#L696-L711)|
|`gdxfor_getTilt`|tilt angle [TILT]|REPORTER|`TILT: STRING` (menu=`tiltOptions`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_gdx_for/index.js#L712-L727)|
|`gdxfor_isFreeFalling`|falling?|BOOLEAN|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_gdx_for/index.js#L729-L737)|
|`gdxfor_getSpinSpeed`|spin speed [DIRECTION]|REPORTER|`DIRECTION: STRING` (menu=`axisOptions`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_gdx_for/index.js#L738-L753)|
|`gdxfor_getAcceleration`|acceleration [DIRECTION]|REPORTER|`DIRECTION: STRING` (menu=`axisOptions`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_gdx_for/index.js#L754-L769)|

#### LEGO EV3（ev3）: Sprite 11 / Stage 11

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`ev3_motorTurnClockwise`|motor [PORT] turn this way for [TIME] seconds|COMMAND|`PORT: STRING` (menu=`motorPorts`); `TIME: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js#L961-L980)|
|`ev3_motorTurnCounterClockwise`|motor [PORT] turn that way for [TIME] seconds|COMMAND|`PORT: STRING` (menu=`motorPorts`); `TIME: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js#L981-L1000)|
|`ev3_motorSetPower`|motor [PORT] set power [POWER] %|COMMAND|`PORT: STRING` (menu=`motorPorts`); `POWER: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js#L1001-L1020)|
|`ev3_getMotorPosition`|motor [PORT] position|REPORTER|`PORT: STRING` (menu=`motorPorts`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js#L1021-L1036)|
|`ev3_whenButtonPressed`|when button [PORT] pressed|HAT|`PORT: STRING` (menu=`sensorPorts`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js#L1037-L1052)|
|`ev3_whenDistanceLessThan`|when distance < [DISTANCE]|HAT|`DISTANCE: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js#L1053-L1067)|
|`ev3_whenBrightnessLessThan`|when brightness < [DISTANCE]|HAT|`DISTANCE: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js#L1068-L1082)|
|`ev3_buttonPressed`|button [PORT] pressed?|BOOLEAN|`PORT: STRING` (menu=`sensorPorts`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js#L1083-L1098)|
|`ev3_getDistance`|distance|REPORTER|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js#L1099-L1107)|
|`ev3_getBrightness`|brightness|REPORTER|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js#L1108-L1116)|
|`ev3_beep`|beep note [NOTE] for [TIME] secs|COMMAND|`NOTE: NOTE`; `TIME: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_ev3/index.js#L1117-L1135)|

#### BOOST（boost）: Sprite 12 / Stage 12

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`boost_motorOnFor`|turn motor [MOTOR_ID] for [DURATION] seconds|COMMAND|`MOTOR_ID: STRING` (menu=`MOTOR_ID`); `DURATION: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1292-L1311)|
|`boost_motorOnForRotation`|turn motor [MOTOR_ID] for [ROTATION] rotations|COMMAND|`MOTOR_ID: STRING` (menu=`MOTOR_ID`); `ROTATION: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1312-L1331)|
|`boost_motorOn`|turn motor [MOTOR_ID] on|COMMAND|`MOTOR_ID: STRING` (menu=`MOTOR_ID`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1332-L1347)|
|`boost_motorOff`|turn motor [MOTOR_ID] off|COMMAND|`MOTOR_ID: STRING` (menu=`MOTOR_ID`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1348-L1363)|
|`boost_setMotorPower`|set motor [MOTOR_ID] speed to [POWER] %|COMMAND|`MOTOR_ID: STRING` (menu=`MOTOR_ID`); `POWER: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1364-L1383)|
|`boost_setMotorDirection`|set motor [MOTOR_ID] direction [MOTOR_DIRECTION]|COMMAND|`MOTOR_ID: STRING` (menu=`MOTOR_ID`); `MOTOR_DIRECTION: STRING` (menu=`MOTOR_DIRECTION`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1384-L1404)|
|`boost_getMotorPosition`|motor [MOTOR_REPORTER_ID] position|REPORTER|`MOTOR_REPORTER_ID: STRING` (menu=`MOTOR_REPORTER_ID`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1405-L1420)|
|`boost_whenColor`|when [COLOR] brick seen|HAT|`COLOR: STRING` (menu=`COLOR`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1421-L1436)|
|`boost_seeingColor`|seeing [COLOR] brick?|BOOLEAN|`COLOR: STRING` (menu=`COLOR`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1437-L1452)|
|`boost_whenTilted`|when tilted [TILT_DIRECTION_ANY]|HAT|`TILT_DIRECTION_ANY: STRING` (menu=`TILT_DIRECTION_ANY`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1453-L1469)|
|`boost_getTiltAngle`|tilt angle [TILT_DIRECTION]|REPORTER|`TILT_DIRECTION: STRING` (menu=`TILT_DIRECTION`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1470-L1485)|
|`boost_setLightHue`|set light color to [HUE]|COMMAND|`HUE: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_boost/index.js#L1486-L1500)|

#### WeDo 2.0（wedo2）: Sprite 11 / Stage 11

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`wedo2_motorOnFor`|turn [MOTOR_ID] on for [DURATION] seconds|COMMAND|`MOTOR_ID: STRING` (menu=`MOTOR_ID`); `DURATION: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L931-L950)|
|`wedo2_motorOn`|turn [MOTOR_ID] on|COMMAND|`MOTOR_ID: STRING` (menu=`MOTOR_ID`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L951-L966)|
|`wedo2_motorOff`|turn [MOTOR_ID] off|COMMAND|`MOTOR_ID: STRING` (menu=`MOTOR_ID`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L967-L982)|
|`wedo2_startMotorPower`|set [MOTOR_ID] power to [POWER]|COMMAND|`MOTOR_ID: STRING` (menu=`MOTOR_ID`); `POWER: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L983-L1002)|
|`wedo2_setMotorDirection`|set [MOTOR_ID] direction to [MOTOR_DIRECTION]|COMMAND|`MOTOR_ID: STRING` (menu=`MOTOR_ID`); `MOTOR_DIRECTION: STRING` (menu=`MOTOR_DIRECTION`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L1003-L1023)|
|`wedo2_setLightHue`|set light color to [HUE]|COMMAND|`HUE: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L1024-L1038)|
|`wedo2_whenDistance`|when distance [OP] [REFERENCE]|HAT|`OP: STRING` (menu=`OP`); `REFERENCE: NUMBER`|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L1059-L1078)|
|`wedo2_whenTilted`|when tilted [TILT_DIRECTION_ANY]|HAT|`TILT_DIRECTION_ANY: STRING` (menu=`TILT_DIRECTION_ANY`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L1079-L1095)|
|`wedo2_getDistance`|distance|REPORTER|なし|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L1096-L1104)|
|`wedo2_isTilted`|tilted [TILT_DIRECTION_ANY]?|BOOLEAN|`TILT_DIRECTION_ANY: STRING` (menu=`TILT_DIRECTION_ANY`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L1105-L1120)|
|`wedo2_getTiltAngle`|tilt angle [TILT_DIRECTION]|REPORTER|`TILT_DIRECTION: STRING` (menu=`TILT_DIRECTION`)|○|○|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L1121-L1136)|

### 非表示7 opcode（hideFromPalette: true）

以下はメタデータと実装が存在するが、通常パレットの表示89種類に含めない。対象のfilterがないことを「表示される」と読み替えず、hideFromPaletteを優先する。

|opcode|英語表示テンプレート|形状|引数キー / ArgumentType（menu）|Sprite|Stage|出典|
|---|---|---|---|---|---|---|
|`music_midiPlayDrumForBeats`|play drum [DRUM] for [BEATS] beats|COMMAND|`DRUM: NUMBER` (menu=`DRUM`); `BEATS: NUMBER`|—|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_music/index.js#L787-L807)|
|`music_midiSetInstrument`|set instrument to [INSTRUMENT]|COMMAND|`INSTRUMENT: NUMBER`|—|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_music/index.js#L858-L873)|
|`pen_setPenShadeToNumber`|set pen shade to [SHADE]|COMMAND|`SHADE: NUMBER`|—|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L423-L438)|
|`pen_changePenShadeBy`|change pen shade by [SHADE]|COMMAND|`SHADE: NUMBER`|—|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L439-L454)|
|`pen_setPenHueToNumber`|set pen color to [HUE]|COMMAND|`HUE: NUMBER`|—|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L455-L470)|
|`pen_changePenHueBy`|change pen color by [HUE]|COMMAND|`HUE: NUMBER`|—|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_pen/index.js#L471-L486)|
|`wedo2_playNoteFor`|play note [NOTE] for [DURATION] seconds|COMMAND|`NOTE: NUMBER`; `DURATION: NUMBER`|—|—|[source](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extensions/scratch3_wedo2/index.js#L1039-L1058)|

### 補足と検算

- † `videoSensing_videoToggle` と `videoSensing_setVideoTransparency` はgetInfoでblockType省略。ExtensionManager `_prepareBlockInfo` の既定値によりCOMMANDになる。[既定値根拠](https://github.com/scratchfoundation/scratch-editor/blob/eccdbed86086e7f7c77d7302dc3c811f830f242d/packages/scratch-vm/src/extension-support/extension-manager.js#L374-L386)
- Video Sensingの `ATTRIBUTE`, `SUBJECT`, `VIDEO_STATE` は、意味だけでSTRINGへ読み替えず、getInfoにある `ArgumentType.NUMBER` のまま記録した。menu項目の実値と一般的な数値入力の意味論は別途検討が必要。
- Micro:bitのLED絵柄入力は `MATRIX`、Musicの音符入力とEV3 beep音符入力は `NOTE`、Penの色入力は `COLOR`。単純なNUMBER/STRINGだけでは全入力UIを表現できない。
- Sprite専用の表示12種類はPenのclear以外8種類とFace Sensingの追従/姿勢/サイズ/接触hat4種類。それ以外77種類はStageのパレットにも表示される。
- 検算: 12拡張、表示89行、非表示7行、合計96の一意opcode。表示行のStage可は77。全96行でテンプレート中の引数キー集合とargumentsのキー集合が一致。
- 既存のカテゴリ棚卸し資料とNEXUSコードは変更していない。
