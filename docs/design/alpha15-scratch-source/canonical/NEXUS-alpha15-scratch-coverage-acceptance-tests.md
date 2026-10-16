# NEXUS alpha15 Scratch対応：具体受入試験

作成日：2026-10-15 UTC。すべて未実施。NEXUSの実装や実機試験が通ったという記録ではない。数値はテスト入力であり固定仕様ではない。性能上限をQと書いた箇所は、実機計測後に採用された構成値を使う。Scratch公式の局所実装テストは別資料であり本表のNEXUS試験とは別。

## A. 数値・型・全演算選択

| ID | 入力/操作 | 期待結果 |
|---|---|---|
| T001 | Number空欄、placeholder「例:10」のまま保存/有効化 | 未入力の診断。10や0として実行されない |
| T002 | PlainText「12」をNumber欄へ直接差込み | 型不一致。EX11の明示変換なら12へ成功 |
| T003 | EX11で空文字、空白だけ、12abc、NaN、Infinityを解析 | 全件ParseResultの形式不正。0へ変換されない |
| T004 | 3+4、3−4、3×4、3÷4 | 7、−1、12、0.75 |
| T005 | 1÷0、0÷0、変数d=0で1÷d | ZeroDivision。Infinity/NaNを値にせず後続変更なし |
| T006 | 有限最大付近のNumber×2でoverflow | NumericOverflow。外部送信されない |
| T007 | count入力に2.5、−1、2^53を指定 | 整数/非負/安全整数検査で拒否。黙ってroundしない |
| T008 | 0.1+0.2を厳密に0.3と比較 | false。UIは精度の説明を提供 |
| T009 | Number 3 < 4、3 = 3、4 > 3 | すべてtrue |
| T010 | Number 3とPlainText「3」の比較 | 型不一致。暗黙の数値比較なし |
| T011 | 2つの異なるChannelRefが同じ表示名 | 等値false。IDをNumberへ変換しない |
| T012 | -7 mod 3、7 mod -3、-6 mod 3 | 2、-2、+0 |
| T013 | 7 mod 0 | ZeroDivision |
| T014 | 明示Scratch丸めモードでround(1.5)、round(-1.5)、round(-0.5) | 2、-1、+0 |
| T015 | 明示Scratch丸めモードでround decimal(1.005,2) | 規定の10進丸めで1.01。ブラウザの素朴な乗算roundへ依存しない |
| T016 | floor(-1.2)、ceil(-1.2)、truncate(-1.2) | -2、-1、-1。各説明が区別される |
| T017 | abs(-4) | 4 |
| T018 | sqrt(9)、sqrt(0)、sqrt(-1) | 3、0、DomainError |
| T019 | sin(0)、sin(90)、sin(180) | 0、1、0の代表値。一般値は採用ルーチンの誤差基準で判定 |
| T020 | cos(0)、cos(90)、cos(180) | 1、0、-1の代表値 |
| T021 | tan(0)、tan(45)、tan(90)、tan(-90) | 0、1、DomainError、DomainError |
| T022 | asin(1)、asin(-1)、asin(1.1) | 90、-90、DomainError |
| T023 | acos(-1)、acos(1)、acos(-1.1) | 180、0、DomainError |
| T024 | atan(1)、atan(0)、atan(-1) | 45、0、-45 |
| T025 | ln(1)、ln(0)、ln(-1) | 0、DomainError、DomainError |
| T026 | log10(100)、log10(0) | 2、DomainError |
| T027 | e^0、e^1、overflowする指数、underflowして0になる指数 | 1、採用精度内のe、NumericOverflow、NumericUnderflow |
| T028 | 10^2、10^0、非有限になる指数、underflowする指数 | 100、1、NumericOverflow、NumericUnderflow |
| T029 | 不明な演算opcode/mathop名を保存JSONへ混入 | サーバーで拒否。0を返して成功しない |
| T030 | clamp(5,0,3)、clamp(5,3,0) | 3、RangeError。上下を黙って交換しない |
| T031 | range(1,5,2)、range(5,1,-2)、range(2,2,1) | [1,3,5]、[5,3,1]、[2] |
| T032 | range(1,5,0)、range(1,5,-1)、予測件数Q+1 | step不正、方向不正、生成前BudgetExceeded |

## B. 分岐・短絡・未知

| ID | 入力/操作 | 期待結果 |
|---|---|---|
| T033 | if true / elif true / else | 最初の枝のみ。elif条件/本文もelseも未実行 |
| T034 | if false / elif true / elif true / else | 2番目だけ。3番目は未評価 |
| T035 | if false / elif false / else | elseだけ |
| T036 | if falseでelseなしの文分岐 | 何もせず後続へ |
| T037 | 値返却ifのelseなし | 有効化不可。未返却を0にしない |
| T038 | if unknown / elif true / else | 不明経路のみ。elif/elseへ進まない |
| T039 | if false / elif unknown / else | その時点で共通不明経路へ。elseは未実行 |
| T040 | C条件なのに不明経路未設定 | 有効化拒否 |
| T041 | 条件式の動的ゼロ除算 | 評価失敗で停止。unknown/false/elseへ変換しない |
| T042 | 選択した枝の外部操作が結果不明 | 他elifへ移動せず停止。自動再送なし |
| T043 | if内のif/elseを編集 | 内側elseだけが内側ifに所属。外側の接続を変えない |
| T044 | if trueの本文でWait→停止/復旧、外部状態はその間変化 | 同じ選択枝・保存位置から再開。条件再判定なし |
| T045 | Boolean false AND (1÷d>0)、d=0はRun入力 | 右を未評価、false。純粋式の実行時エラーなし |
| T046 | Boolean true OR (1÷d>0)、d=0はRun入力 | 右を未評価、true |
| T047 | Cのtrue/false/unknown全9組でAND/OR | 設計本文の真理値18結果と一致 |
| T048 | unknown AND false / unknown OR true | 右を評価しfalse / true |
| T049 | unknown AND true / unknown OR false / NOT unknown | unknown / unknown / unknown |
| T050 | true ORを使って操作時認可を省略しようとする | 認可は独立検査され、省略不可 |
| T051 | if/elif各枝を並べ替えて保存→読込→手順一覧→ブロック表示 | 順序と本文の組、unknown辺、IDを維持。Revision差分を表示 |
| T052 | 既存のfalse側に処理や別のunknownハンドラがある入れ子 | 意味を変える自動平坦化なし。従来の入れ子を保持 |

## C. 文字・Unicode・空値

| ID | 入力/操作 | 期待結果 |
|---|---|---|
| T053 | join(空文字,abc)、join([],区切り) | abc、空文字 |
| T054 | NumberやRefをPlainText結合へ直挿し | 型エラー。明示format等を案内 |
| T055 | length(空)、length(A😀é)、length(家族ZWJ絵文字) | 0、3、採用Unicode版で1 EGC |
| T056 | letter(A😀B,2) | 完全な😀。サロゲート半分を返さない |
| T057 | letter(abc,0)、letter(abc,4)、letter(空,1)、位置1.5 | 全件IndexError/型エラー |
| T058 | slice(abc,4,0)、slice(空,1,0)、slice(abc,3,2) | 空、空、範囲外エラー |
| T059 | contains(ABC,a)、contains(ABC,空) | 既定false、true。大小無視モードなら前者true |
| T060 | 「é」と「e＋結合アクセント」の厳密比較→明示NFC後の比較 | 既定false、NFC後true |
| T061 | replace(aaaa,aa,b,all) | bb。重なりなしで左から処理 |
| T062 | replaceの検索文字が空 | 検証エラー。大量挿入を生成しない |
| T063 | split(a,,b,「,」,空項目保持)→除外へ変更 | [a,空,b]→[a,b] |
| T064 | split(空,「,」,保持/除外)、空区切り | [空]/[]、空区切りは拒否 |
| T065 | 不正サロゲート列の入力/読込 | 明示診断。置換文字へ黙って変更しない |
| T066 | 表示上短い絵文字文が外部payload制約を超える | 送信前の別検証で拒否。表示EGC数だけで送信許可しない |

## D. 変数・一覧・自作ブロック

| ID | 入力/操作 | 期待結果 |
|---|---|---|
| T067 | 初期値未定の必須変数を読む/増やす | 有効化/実行検査で拒否。0補完なし |
| T068 | Number変数5を3増やす、同じ処理のworker応答消失後に再開 | 正規の状態遷移は8に1回確定。再開で11へ二重加算しない |
| T069 | 変数名を変更し保存 | VariableIDと全参照を保持 |
| T070 | 分岐内だけで宣言した値を分岐外へ差込む | スコープ外で拒否 |
| T071 | 同一逐次フレームのloopで初期化済み合計へ明示加算 | 許可、各反復分だけ更新。並列兄弟/子からの親書込みは拒否 |
| T072 | 新しいRunを開始し前Run変数を読む | 値を引き継がない。永続変数入口なし |
| T073 | List<Number>へPlainTextを追加 | 型不一致 |
| T074 | append([1,2],3)→元一覧を読む→明示代入 | 新値[1,2,3]、元は[1,2]、代入後だけ新値 |
| T075 | insert([],1,x)、insert([a,b],3,c)、insert([a,b],4,c) | [x]、[a,b,c]、IndexError |
| T076 | delete([a,b],1)、replace([a,b],2,c)、clear([a,b]) | [b]、[a,c]、同型[] |
| T077 | delete([],1)、replace([a],0,b)、item([a],2)、小数添字 | 全件エラー。黙殺/空文字成功なし |
| T078 | find([a,b,a],a)、find([a,b],c)、contains([],a) | found(1)、not_found、false |
| T079 | 「random」「last」「all」をNumber添字欄へ文字挿入 | 型拒否。対応する明示形へ案内 |
| T080 | 一覧[A,A,B]を表示/非表示 | 表示だけ変化し内容は不変、外部送信/ログ記録なし |
| T081 | sum([])、average([])、min/max([])、any([])、all([]) | 0、none、none、false、true |
| T082 | zipの長さ不一致、chunk件数0、sort同順位 | エラー、エラー、元順を維持 |
| T083 | 同じ表示名の別MemberRefをdedupe | 別対象のまま。安定IDの重複だけ明示規則で除去 |
| T084 | 自作値「人数+予備」へ80と20 | 100。隠れた変数/時刻を読まない |
| T085 | 自作値内へ送信/外部read/乱数/Wait/状態代入 | 全依存をサーバー検査し拒否 |
| T086 | 自作手順A→B→A、直接A→A | 循環を有効化前に拒否 |
| T087 | 必須引数追加/出力型変更後に旧呼出しを新版へ変更 | 未対応呼出し診断。既存Runの固定子版は不変 |
| T088 | 自作値のある正常枝だけ戻り値欠落 | 有効化拒否。0や空にしない |

## E. 反復・待機・乱数・停止・保持

| ID | 入力/操作 | 期待結果 |
|---|---|---|
| T089 | repeat count=0、count=3 | 本文0回/3回。0回でも後続へ進む |
| T090 | for-each対象[a,b]を入口固定、本文で元一覧へc追加 | 反復はa,bだけ。対象を際限なく増やさない |
| T091 | until条件が最初からtrue、whileが最初からfalse | 本文0回、condition_met相当の正常終了 |
| T092 | until falseが継続、最大3 | 本文3回、条件4回まで評価しlimit_reached。成功扱いしない |
| T093 | until falseで最大0、while trueで最大0 | 条件1回、本文0回、limit_reached |
| T094 | while/until条件がunknownまたは評価エラー | 不明経路/失敗を区別し、本文を開始しない |
| T095 | 内側loopでbreak、continue | 直近loopだけ作用。continueでも反復/予算消費 |
| T096 | 子手順から親loop break、並列枝から外側continue | 検証拒否 |
| T097 | loop本文のWait後にworker再起動 | 同じ反復・本文PCから再開。既済操作/加算を重複しない |
| T098 | loopの外部書込み結果不明 | 次反復/後続新規外部変更を止め、自動再送しない |
| T099 | wait=0、負数、7日超 | 後続、拒否、拒否 |
| T100 | Run開始6日後に2日Wait | 単一7日以内でもRun期限超過で拒否 |
| T101 | wakeAt=Run期限と同時、キャンセルとwake競合 | 期限/停止が優先され新しい外部操作を開始しない |
| T102 | Run再開・子呼出し・再試行を繰り返す | startedAt/deadline/累計予算をリセットしない |
| T103 | 整数乱数lo=1/hi=3、lo=hi、lo>hi | 1/2/3の範囲、同値、逆転エラー |
| T104 | 小数乱数lo=0/hi=1で多数の模擬一様bit入力、丸め上端近傍 | 0以上1未満。hiを返さず、方式の解像度を記録 |
| T105 | 乱数生成保存直後に応答消失→同一キー再開 | 同じ確定値を照合。再抽選なし |
| T106 | 同じRun/同じblockでも反復番号が異なる | 別生成として記録。値が偶然同じでも成功 |
| T107 | 同一動的キーへ異なる固定入力を上書き要求 | 不整合で停止。後から変わった現在変数を勝手に再評価しない |
| T108 | 抽出n=0、n>候補数、空shuffle | 空、エラー、空 |
| T109 | 送信結果不明を理由に乱数を引き直そうとする | 再抽選と自動再送を拒否 |
| T110 | End runを外部操作開始後に要求 | 新規処理は停止、既済外部操作の取消を保証せず証拠を保持 |
| T111 | Return/End branch/End runをそれぞれ実行 | 呼出しだけ/枝だけ/当該Runの範囲を正確に終了。他Runへ作用しない |
| T112 | Run終了から7日を超えて再開データへアクセス | 削除済み。Run復活/自動再作成なし |
| T113 | 本文や変数値が含まれるRunを実行しログ/監視を点検 | 値本文をログへ保存しない。構造ID/状態/時刻等だけ |
| T114 | 保持不可の一時本文をWait後に必要な値として接続 | 有効化前に拒否。checkpoint名目で無断保存しない |
| T115 | wait解除前に権限失効/対象削除/Run中止 | 現行状態を検査し該当操作を止める。古い権限で実行しない |
| T116 | alias/分割/子手順/複数枝で総予算Qを超過 | 親子枝合算でBudgetExceeded。小分けで予算を再発行しない |
| T117 | Run期限7日、loop局所期限1時間、本文で2時間Wait | effectiveDeadline超過として拒否。Run期限内という理由で許可しない |
| T118 | 子手順/承認待機が囲みloopの局所期限に達する | 親の期限を継承して新規処理を停止。不明な外部操作は不明を保持 |
| T119 | List代入/continue確定直後、PC保存相当境界でcrash | 状態・PC・反復・予算の一貫した版だけ復元。二重適用/予算復活なし |
| T120 | 位置検索結果を数値欄へ直接挿入→found枝でindexを選ぶ | IndexResult全体の挿入は拒否、found枝のindexだけIとして使用可 |
| T121 | 明示Scratch丸めモードでround decimal(1234,-2)、桁数-309/309 | 1200、PrecisionRangeError。桁数を自動clampしない |
| T122 | 数学的に非ゼロの結果がsubnormalとして残る/0に丸まる | 有限subnormalは許可、非ゼロ→0はNumericUnderflow。明示roundの0は正常 |
| T123 | 全数学関数の一般値・巨大有限角度を高精度参照と比較 | 提案4 ULP以内、代表値0/±1は正確。未達は採用前ゲート不合格 |
| T124 | terminalAt確定後の遅延証拠、削除後の古いcallback | terminalAt/削除期限不変、通常実行と再開状態を復活させない |
| T125 | 小数乱数lo/hiが隣接binary64値、[-MAX,+MAX]の最大幅 | 半開区間内に収まり、中間overflowなし。隣接範囲ならloになる |
| T126 | 整数乱数の両端を±(2^53−1)にする | 内部範囲幅を正確に算出し、各結果は安全整数かつ範囲内 |
| T127 | 明示Scratch丸めモードでround decimal(-1.005,2)、round decimal(-1250,-2) | -1、-1200。負の半値も+∞方向 |
| T128 | contains(e＋結合アクセント,結合アクセント)とfind同入力 | containsはtrue、EGC境界でのfindはnot_found。意味の違いを表示 |

## 実施時に添付する証拠

試験ごとに実装Revision、runtime/数値ルーチン/Unicode/TZ版、環境、入力fixture参照、期待/実結果、判定、再現手順を残す。テストfixtureが本文や個人情報を含むなら匿名化された合成データを使う。ログ禁止を検証するために本番ログへ実データをわざと流すことはしない。

## 丸め互換性の追加試験

| ID | Given / When | Then |
|---|---|---|
| T129 | 旧schemaで保存したround定義を開く・再保存・実行再開 | 保存時のschema/runtime意味を維持。mode欠落を新Scratch方式へ補完しない。元の方式は実装照合してfixtureを固定 |
| T130 | 明示tiesAwayFromZeroで1.5、-1.5、-0.5を整数丸め | 2、-2、-1。Scratch方式の2、-1、0とモード説明を区別 |
| T131 | 新規roundでmode未指定、または旧下書きのmodeを変更 | 未指定は有効化不可。変更は新revision/再検証/再試運転/影響再確認。開始済みRun不変 |
| T132 | 小数桁丸めで-1.005を2桁、-1250を-2桁へ、各modeを明示 | tiesAwayFromZeroは-1.01、-1300。Scratch方式は-1、-1200。最終binary64再表現はties-to-even |

以上132件は受入条件の設計。実施結果欄は全件「未実施」。
