# NEXUS Scratch追加補足：受入試験 S001–S060

2026-10-15 UTC。全件未実施。正式T001–T132を置換しない追加・明確化試験。通常チャット提案T133–T141との重複は実装者が対応表で整理する。入力数字はfixture例であり製品上限ではない。Qは実測後に確定した共通予算設定。

| ID | 項目・入力 | 期待結果 |
|---|---|---|
| S001 | until、N=0、初回true | guard1回、body0回、condition_satisfied、正常後続1回 |
| S002 | until、N=0、初回false | guard1回、body0回、limit handler1回、非成功終端、正常後続0回 |
| S003 | while、N=0、初回false/true | falseは正常、trueはlimit。片方に自動統一しない |
| S004 | 最後のbodyでuntil条件がtrueになる | N回body、N+1回guard、正常終了。limit handlerなし |
| S005 | 最後のbody後もuntil条件false | N回body、N+1回guard、limit handler→非成功終端。N+1回bodyなし |
| S006 | guard unknown | body0回、conditionUnknown handler1回。false/else/通常後続へ落ちない |
| S007 | guardの型/数値評価失敗 | evaluationError、unknown handlerではない。値0で続けない |
| S008 | 明示breakとcontinue | breakはbrokenでループ後続へ。continueは残bodyを飛ばし回数1をcommitし次guardへ |
| S009 | 手順内loopの正当Return | ループ後続を飛ばし当該callへ戻る。Run全体停止と混同しない |
| S010 | handler通常完了とhandler内成功Return/break元loop | 通常完了も非成功Run終端。元領域を回避するReturn/breakは静的拒否 |
| S011 | limit handler内の許可済み外部通知 | 既存認可・残期限/予算・全先行外部操作確定を確認し、明示した通知だけ1回。後続通常送信なし |
| S012 | 条件unknownだが操作権限も不明 | handler操作は独立認可で拒否。条件unknownを操作許可にしない |
| S013 | localDeadline handlerへ外部read/write/Wait/乱数を配置 | 有効化拒否。純粋handlerだけ許可 |
| S014 | Wait中に内側/外側localDeadline、同時期限 | 最早期限の所有loop、同時なら外側を選ぶ。innerをunwindして所有handlerだけ純粋実行。存続する上位期限は外さない |
| S015 | Run期限とlocal期限同時、wakeAtも同時 | Run期限hard stopが優先。handler/通常後続/新規外部操作0回 |
| S016 | 取消/全体予算超過がhandler前または途中 | handlerも新規実行を止める。別handlerへ再帰復帰しない |
| S017 | 外部操作結果不明がbody/handler/他枝で発生 | unresolved_external_resultが保持され、どのhandlerからも新規外部操作しない |
| S018 | handler自身の評価失敗 | 元原因とhandler失敗のコードを保持し終端。再帰handler呼出しなし |
| S019 | 並列他枝が外部操作開始中にloop非成功 | 先行操作を未開始と誤認しない。不明ならhard stop、証跡保持。handler勝手開始なし |
| S020 | handler内Wait後のcrash | 選択原因・handler phase・PCで復帰、bodyや別handlerへ戻らない |
| S021 | CT01 A.otherwise=[B]を折畳み/展開/保存 | AST/ID/意味hash/挙動不変。BのunknownはBに所属 |
| S022 | CT01 A.otherwise=[B,X] | 連鎖へ自動平坦化しない。Bunknown通常終了後Xが動く旧意味を維持 |
| S023 | 旧CT01の空unknown[] | 既存通り暗黙合流。今回のloop失敗停止へ変更しない |
| S024 | 異なるunknownを持つ旧入れ子 | 個別unknownを保持。内容が似ていても統合/複製/procedure化しない |
| S025 | A=false、B=unknown、C=trueのelif | Bunknownのみ1回、C/else未評価。unknown内Wait後も同じ枝 |
| S026 | 新規共通unknown templateを3節へ保存 | 各展開先block/Variable/binding/targetのID写像が一意・安定、実行は選択節のコピーのみ。表示/再保存でID変化なし |
| S027 | 共通templateから節内localを参照 | 静的拒否。入口を支配する適合値だけ参照可能 |
| S028 | 共通template修正中に保存失敗 | ASTコピー群とauthoring mapが部分更新されない。旧版または新版の完全な一方 |
| S029 | elif節の並替＋開始済みRun | 条件/then/unknownが一組で移動。新Revisionだけ新順序、旧RunのPC/乱数key不変 |
| S030 | 共通unknown内のWait、乱数、break/Return | コンパイル後のscope/終了先/動的IDを検証。旧木から等価変換したと主張しない |
| S031 | 比較matrix全許可/不許可セル | サーバーとUIが同じ判定。異型暗黙変換なし |
| S032 | Ref同表示名・別ID/別scope | 同値としない。比較が存在/認可を証明しない |
| S033 | Record key等値、構造等値、descriptorなし | 登録profile通り。descriptorなしは拒否。List内でも同じ規則 |
| S034 | Optional/ConditionResult/OperationOutcomeへ汎用比較 | 拒否し、対応する型付き状態分岐を提示 |
| S035 | any/all/find/filterの述語がConditionResult | Booleanへ落とさず型エラー。空any=false/all=trueは維持 |
| S036 | Integer用途へliteral/変数/式/自作値で小数・危険整数 | 全入口で同じ拒否。旧保存Number型は維持 |
| S037 | 最大整数幅、固定bitでr=0/W−1/W | 最小端/最大端/棄却。内部Number丸めやmod縮小なし |
| S038 | 小bit幅・短tapeを全列挙 | 成功値ごとの本数が等しい。失敗を別集計。統計だけで証明しない |
| S039 | 固定Q候補すべて棄却 | RandomSamplingExhaustedを固定。端値/剰余/予算追加/再seedなし |
| S040 | entropy準備保存の応答消失・二重worker | 一意確定tapeだけ使用。敗者は勝者を読む。未確定候補を公開しない |
| S041 | 棄却cursor/成功commit前後のcrash | 同じキーは同じ値または同じ失敗、予算二重消費/復活なし |
| S042 | 結果確定後に元変数が変わる | 旧snapshot結果を読む。現在値で再評価/不整合誤検知しない |
| S043 | 小数隣接端点・逆符号最大幅・同値・逆転 | 半開区間、overflowなし、同値はその値、逆転は拒否 |
| S044 | e+結合アクセントへのContains/Find/Replace/Split | scalarとEGC境界の仕様表通り。操作間の違いをUIで説明 |
| S045 | Join/Repeatで境界に結合文字やZWJをまたぐ | 結果を再segmentation。入力EGC数の加算で誤計数しない |
| S046 | CRLF、家族絵文字、肌色、国旗列、Indic、Hangul、不正surrogate | 採用Unicode公式fixtureとgolden通り。不正scalarは拒否 |
| S047 | Replaceの$・\\・重なり、Split空区切り・空項目 | テンプレート/regex評価なし。左から非重複、空方針を維持 |
| S048 | casefold/normalize後の長さ変更とFind | 変換後文字列の位置。元文字列への不正逆indexなし |
| S049 | 旧Unicode profileのRunを新版で再開 | 旧意味を維持。欠落versionを最新に置換しない |
| S050 | 旧roundの正負半値と隣接値、新2mode | 旧fixture不変、新modeは明示差。欠落modeを推測しない |
| S051 | 数学14選択のdomain・代表値 | 全項目を試験。三角度数、正確な0/±1、極、log/sqrt域を検証 |
| S052 | 最大finite角度・exact巨大周期・nextUp/Down極近傍 | 素朴なπ変換/epsilon極判定なし。採用精度/域の技術ゲートを検証 |
| S053 | 最小subnormal/normal境界、0へ丸まる非ゼロ | 非ゼロsubnormal成功、真の非ゼロ→0はUnderflow。flag単独拒否しない |
| S054 | 4 ULP目標・2の冪境界・oracle中点 | 高精度の規定ulp式で判定。別の4step距離へ変更しない |
| S055 | decimal-round桁端・正負半値・1.005 | 明示modeと最短10進規則どおり。旧decimal操作を置換しない |
| S056 | D6 T01–T10/L01–L25全具体形 | 欠落なし。average/minmaxのRecord出力、集合順序、zip不一致、chunk端を維持 |
| S057 | 型ソケット・色なし・キーボード・狭画面 | 型/所属/unknown/非成功終端を色に依存せず判別。接続拒否理由・焦点復帰あり |
| S058 | 例示placeholder/試運転値/本番値、Undo/Redo | 例示の自動実行なし。試運転外部送信なし。ASTとmetadata同時復元 |
| S059 | terminalAt後の遅延callback、7日削除後worker | terminalAt/削除期限不変。通常再開・状態復活・自動別Runなし。内容ログなし |
| S060 | opcode追跡表全採用行と正式132＋S試験 | 実在実装と証拠へリンク。未実装/未実施を合格扱いにしない |

## 実行証拠

実装commit、意味profile、数値/Unicode/乱数/compiler版、設定予算、匿名合成fixture、期待/実結果、再現手順を記録する。本文・変数値・entropyを本番ログへ流して試験しない。性能計測は採用環境で行う。本書作成時点は60件すべて未実施。
