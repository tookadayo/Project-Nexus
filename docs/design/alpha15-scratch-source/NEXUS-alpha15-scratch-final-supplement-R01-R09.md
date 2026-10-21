# NEXUS alpha15 Scratch追加：実装用補足案 R01–R09

更新：2026-10-15 UTC。対象：Scratch由来の条件・elif・反復・計算・文字・一覧・Run内変数・自作ブロック、Web編集UX、旧互換と必要試験。

## 0. 文書の位置付け・承認・資料の優先順位

ユーザーは上記3範囲の仕様補完後の実装を承認したと親タスクから通知された。本書はその範囲の実装判断案であり、著しい機能縮小、既存動作の変更、未承認の新しい製品上限を承認済みにしない。コード変更は行っていない。

通常ChatGPTの第1回レビューは取得済み。第2回は極高表示で1回送信したが `Model not found`、第3回は未実施。本書は第1回指摘を受けた独立した補足設計であり、「通常チャット3回レビュー済み」ではない。

優先順位は、最新のユーザー承認・安全境界 → 現行実装の旧定義互換 → 本書の追加契約 → 正式132件版の引継ぎ資料 → 古い設計案。既存にない追加契約は新版のみへ適用し、旧動作を変える理由には使わない。

### 0.1 正式資料の取得ゲート

正式ZIPはユーザーの再添付 `NEXUS-alpha15-scratch-review-handover-package(2).zip` から2026-10-15 08:49 UTCに正規取得した。42ファイル、5,250,722 bytes、SHA-256 `c16d85517066dc059d8b62e7996372ac5c6a016616c92a85c8a9c335dba7af1c` で前回正本と一致。T001〜T132の132件、欠落・重複なしを確認。初期128件版からの再構成ではない。先の旧Library IDはscope外で拒否されたが迂回せず、ユーザーの新規添付により解消した。

本書の追加試験は衝突を避けて `S001` 形式とする。実装者は次を実物で読む。

1. 正式ZIPの `NEXUS-alpha15-scratch-full-coverage-design.md`、132件版受入試験、棚卸し、README。
2. 既存6資料：design / block-editor-revision / block-expansion-revision / web-setup-dashboard-revision / input-support-design / practical-blocks-integrated。
3. 第1回全文 `nexus-scratch-normalchat-round1-response-2026-10-15.txt`。
4. `NEXUS-alpha15-CT01-code-evidence-supplement.md`（HEAD e37fd32の読取り報告）。
5. 本書、補足試験、opcode追跡表、数値・Unicodeの実現性資料。

旧文書の「roundを+∞へ統一」「共通unknown辺へ接続」「通常チャット回答0件」「実装承認前」は本書および最新記録により置き換える。作業領域直下の初期128件版を最新正本として使わず、同梱canonicalフォルダの132件版を使う。

### 0.2 維持する境界

- 単一Wait、Run全体とも最大604800経過秒。開始時のRun絶対期限は再開・子・再試行で延長しない。
- 再開状態は最初のterminalAtから7日以内に削除。遅延証拠でterminalAtを動かさず、削除後に再生成しない。ログへ本文・変数内容・乱数入力/出力・secretを出さない。
- 複数Runをまたぐ永続変数、任意外部HTTP、危険な管理権限付与/BAN/kick/大量削除は除外。
- 無料招待Betaは共通言語。件数・深さ・bytes・評価量・CPU等の構成上限は実測後に設定し、架空の製品上限を本書に置かない。
- 外部操作結果不明は自動再送しない。結果不明を条件unknown/false/noneに変えず、後続外部変更を止める。
- Run内の同一動的乱数評価は初回固定。再開・競合・再描画で新しい抽選をしない。
- 無限反復、再帰、任意コード、自由regexは導入しない。参考画像は視覚参考用であり製品素材の無断複製許可ではない。

## 1. R01：反復の完了・失敗・停止を分離する

### 1.1 保存する実行情報と順序

新しい有界while/untilは既存count/foreachと区別できる版付きモードとして登録する。以下は必要な意味上のフィールドであり、実在するクラス/API名を主張するものではない。

- mode、maxBody=N（非負の安全整数）、absoluteLocalDeadline、condition、body。
- 原因別の `limit` / `conditionUnknown` / `evaluationError` / `localDeadline` handler。未設定なら直ちに当該理由で非成功終了。
- completedIterations、phase（guard/body/handler/terminal）、選択済み出口、固定入力・Revision、呼出し/反復path、残予算。
- 原因handlerは通常後続とは別の終端領域。末尾に消せない「このRunを理由付きで終了」を表示する。handlerの完了を通常成功へ変換しない。

absoluteLocalDeadlineは当該loopへの動的進入時に一度固定し、再開・子呼出し・再試行で延長しない。effectiveDeadlineはRun・全囲みloop・呼出し元継承期限の最小。WaitのwakeAtは単一7日以内かつeffectiveDeadline以下とし、同時刻wakeは期限到達を優先する。

入口ごとの順序：既存の停止要求・Run期限・全体予算・外部結果不明を検査 → 全囲み局所期限を検査 → 純粋条件を1回評価 → until=true / while=falseなら正常完了 → unknownならconditionUnknown → 継続が必要かつ完了回数=Nならlimit → 本文 → 本文完了またはcontinueを1回分として原子的に記録 → 次の入口。

最大N回の本文に対し条件は最大N+1回。N=0でも条件は1回だけ評価する。最後の本文が条件を成立させれば最終guardで正常完了となり、成立させなければlimitになる。条件評価そのものも予算へ加算する。countのN回完了・foreachの固定一覧完了は通常完了であり、条件ループのlimitと混同しない。

### 1.2 出口の全表

| 原因 | 本文・条件の続行 | 原因handler | 普通の後続 | 最終意味 |
|---|---|---|---|---|
| until=true / while=false | 終了 | なし | 進める | condition_satisfied |
| count / foreach完了 | 終了 | なし | 進める | count_completed / items_completed |
| 明示break | 最内側ループを終了 | なし | 進める | broken。条件成立と表示しない |
| continue | 当該本文の残りを飛ばす | なし | まだ進めない | 回数を1消費し次guardへ |
| 正当なReturn | 当該呼出しを終了 | なし | 呼出しの戻り先のみ | ループ後続は飛ばす。宣言戻り値必須 |
| guardの継続条件＋回数N | 終了 | limit | 進めない | 非成功：limit_reached |
| guardがunknown | 終了。本文へ入れない | conditionUnknown | 進めない | 非成功：condition_unknown |
| guard/本文の局所評価失敗 | 終了 | evaluationError | 進めない | 非成功：evaluation_failed |
| 所有loopの局所期限 | 当該loop配下の本文・子Waitを停止 | 制約付きlocalDeadline | 進めない | 非成功：local_deadline |
| Run期限、取消、全体予算超過 | 全新規実行を停止 | 実行しない | 進めない | deadline_expired / cancelled / budget_exhausted |
| 外部操作結果不明 | 全新規実行を停止 | 実行しない | 進めない | unresolved_external_result |
| handler自身の失敗 | handler停止 | handlerを再帰呼出ししない | 進めない | 元原因＋handler_failedを内容なしの診断で保持 |

### 1.3 handlerの権限と終端

理由別handlerを削除して一律停止に置き換えない。limit/conditionUnknown/evaluationErrorのhandlerは利用者が明示配置した型付き処理を実行できる。ただし以下を満たす。

- 残るRun・囲みloop期限、共有予算、取消、現行権限、保持条件を常に検査する。原因となった条件のunknownは操作権限の代わりにならない。
- 外部操作は既存許可範囲の操作だけ。原因となった確認済み失敗操作の暗黙再送はしない。開始済み操作が未確定なら先に結果不明hard stopへ昇格し、handlerを開始しない。
- handlerの変数scopeはループ入口を支配する変数と型付き理由コードのみ。終わった本文のローカルや未確定途中値を読まない。本文の確定済みRun変数更新は取り消さない。
- handlerは一度だけ選択・保存する。handler内のWait・許可操作も通常と同じ再開/結果不明規則。handler終端時は元の非成功理由でRunを終了し、親呼出し・外側loop・Joinの成功経路へ戻らない。
- handler内で元ループを対象にbreak/continue/成功Returnを置くことは拒否。handler内に新設された有界loopの局所break/continueや、そこで呼ぶ子手順の正当なReturnは可。
- 理由handler開始時には当該Runの他の新規枝進行を停止する。選択handlerとその正当な子呼出しだけに終端処理の実行権を渡し、その系統にも同じhard-stop検査を継承する。既に開始済み外部操作の取消を仮定しない。先行操作が未確定なら結果不明が優先する。状態と副作用証跡の確定方式が既存並列基盤で保証できなければ、新しい版付き終了モードを追加し、旧並列Runの挙動を変更しない。

期限判定では、期限到達済みのRun期限があればRun hard stopを選ぶ。そうでなければ、到達済み局所期限のうち絶対時刻が最も早いものを所有loopとし、同時刻なら外側を選ぶ。所有loopより内側のframeをunwindし、内側handlerを順に実行しない。所有loopのhandlerを選択する遷移自体も一度だけcommitする。

localDeadline handlerは所有loopの期限切れ本文の外側にある別終端領域として、純粋計算・型付き理由表示・Run内の最小結果整形だけを許す。外部read/write、Wait、承認、子の副作用呼出し、新規乱数は不可。失効した自己loop期限を延長する手段にはならない。handler評価で外せる期限は終了した所有loopとそのunwind済み内側loopの期限だけであり、Run/呼出元/存続する外側loop期限は残す。handler開始直前または途中でそれらが到達した場合は、その純粋handlerも止め、上記の期限選択規則で終了原因を確定する。この追加handlerの作業も共有予算へ加算する。

handler phaseはまだ非terminalである。正常にhandlerを完了した時点で元理由のterminalAtを確定する。handler途中のRun期限・取消・全体予算・外部結果不明は直ちにhandlerを停止し、hard-stop原因と元理由を保持して一度だけterminal化する。「元理由で終わる」は後発hard stopを隠す意味ではない。

同時事象は成功を先に確定しない。停止要求・期限・予算・未確定外部操作を同じ状態版で再検査し、hard stopがあれば通常遷移を拒否する。複数原因は状態内の原因集合と外部不確定フラグで保持でき、単一の画面見出しにより外部結果不明を消してはならない。terminalAtは最初の終了確定時点。

## 2. R02：CT01の木構造を保ったelif

### 2.1 読取りで判明したこと

HEAD e37fd32 は `kind:branch; then:Statement[]; otherwise:Statement[]; unknown:Statement[]` の木。unknownRefなし、全block ID重複禁止。runtimeは条件を一度判定して1枝を選び、親frame.indexを進めて子frameをpushする。通常終了ではlocalを片付けて親へpopするため、空unknownも普通に合流する。詳細根拠はCT01補足の types.ts:203 / definition.ts:196,799 / service.ts:91 / runtime.ts:142,159,173,379。

この既存合流を新loopの非成功出口へ流用しない。既存CT01の空unknownを、今回の設計だけでRun停止へ変更しない。

### 2.2 最小の専用UI

`A.otherwise=[B]` を「それ以外でもし」と表示・追加できる。列の各節は条件、then、当該条件のunknownを同一組として持つ。falseだけ次節へ進み、最初のtrueまたはunknownで選択が確定する。unknownの場合は後続elif/elseを評価しないが、当該unknown枝が普通に終わった後の親への合流は既存CT01通り。

旧木を実行構造を変えず折り畳む条件：false側が次のbranch1個だけであること。終端elseは最後のotherwise配列。`otherwise=[B,X]` は折り畳まず、入れ子＋Xを明示表示する。B.unknown後にはXが実行される既存意味を隠さない。

- 旧木のunknownは節ごとにそのまま表示する。「同じに見える」というだけで統合、複製、procedure化しない。
- 表示の折畳み/展開だけではAST、block ID、意味hashを変更しない。保存round-tripも同じ。
- 追加・削除・並替は意味改訂。条件/then/unknownを一組で移動し、既存nodeのIDを保持する。開始済みRunは旧定義・旧順序・旧PCのまま。
- 枝内Wait後は選択済み枝に戻る。条件を再判定して他のelifを試さない。

### 2.3 新規の「共通unknown」希望を保持する方法

共通unknownを持つ新規連鎖は、**新規作成用の版付きauthoring構造**として明示し、実行保存は既存CT01木へコンパイルする。これは既存unknown本体の等価な自動変換ではない。

- 新規の共通unknownテンプレートは、連鎖入口で支配される同じ型付き入力だけを参照する。各条件節やthen内で初めて定義されるlocalは参照不可。
- テンプレートを節ごとのunknown配列へ意図的に展開し、各実行nodeに重複しない永続IDを与える。logical template node ID×clause IDと実行IDの対応をauthoring版に保存する。既存IDを複製しない。
- どれか1条件がunknownになった時、その節の展開先1個だけが実行される。別節のコピーは評価・実行しない。Wait/乱数キー/手順returnの意味は、実際の展開後木に基づき定義する。
- 展開前後のAST・意味hash・動的識別子・条件評価回数・予算消費が同一とは言わない。新規定義の正本は保存されたコンパイル済み木＋版付き対応表であり、その版のままRunを実行する。
- 共通テンプレートの修正は全コピーを同一Revisionとして原子的に更新する。新規コピーのIDは安定対応表で管理。template内の宣言VariableID・出力binding・参照・内部制御targetもコピー単位で衛生的に写像する。入口で支配される外部bindingだけを共有参照として維持し、コピー間local衝突と誤captureを禁止する。差込みscope・break/continueの最内loop・procedure Return先・Wait再開をコンパイル時検証する。
- authoringの対応表を原子的に保存・検証できなければ、共通unknownモードを保存してはいけない。「UIだけで対応済み」とも言わない。必要な版付きauthoring metadataを追加する実装課題として扱う。

既存木からこの共通テンプレートへの変換は提供しない。旧定義にも共通化を適用したい場合は、その個別変更を新Revisionの意味変更として提示し、各unknown本文/依存/終端/ID差をレビューする。任意変換の一般的等価性は未証明のままである。

## 3. R03/R09：型・比較・短絡の確定表

Integerは新しい保存プリミティブを導入せず、Numberに付く「有限・整数・安全整数範囲」の入力制約。非負/正/添字範囲は用途別追加制約。Literal・変数・式・自作値のいずれも同じ実行時検証を受け、小数を丸めない。旧schemaの読込をIntegerという名前の追加だけで破壊しない。

| 同型の左右値 | = / ≠ | < / ≤ / > / ≥ | 条件 |
|---|---|---|---|
| Number（Integer制約を含む） | 可 | 可 | binary64の厳密比較。epsilonなし、非有限拒否、-0正規化 |
| PlainText | 可 | 通常比較では不可 | scalar列の完全一致。大小/正規化の暗黙変換なし。文字sortは明示の版付き順序キーを使う |
| Boolean | 可 | 不可 | true/falseのみ。0/1へ変換しない |
| Choice | 可 | 登録ordinal順序がある同一schemaだけ | 同一domain/schema版＋stable choice ID。表示順は順序保証でない |
| Ref | 可 | 不可 | 同じRef型。stable IDと所属範囲を比較。存在/権限の証明にはならない |
| Instant | 可 | 可 | 同じ時点表現に正規化。日時文字列とは比較しない |
| Date | 可 | 可 | 同じcalendar schemaの暦日。Instantとの混在不可 |
| LocalTime | 可 | 可 | 同じprecision/schemaの時刻順。日またぎ区間は別演算で明示 |
| Duration | 可 | 可 | 固定の経過時間型だけ。月/暦日Periodを黙って秒へ換算しない |
| List<T> | Tの等値descriptorがある場合可 | 不可 | 長さと順序が一致し、各要素を左から比較。異なる型のList間は不可 |
| 登録Record | 登録された等値descriptorがある場合可 | 不可 | descriptorは「明示stable key」または「列挙した比較可能fieldの構造等値」。版固定。無登録の全JSON比較はしない |
| Optional / ParseResult / FindResult / IndexResult | 不可 | 不可 | 状態分岐で値を取り出してから比較。none/not_foundを0等にしない |
| ConditionResult | 不可 | 不可 | 専用のtrue/false/unknown分岐、論理演算を使う |
| OperationOutcome | 不可 | 不可 | 認可された状態分岐のみ。Recordで構築・同値偽装しない |

この許可表は新規比較profileに適用する。旧定義の読込・再保存・再開では旧profileの許可型と意味を維持し、新表で遡及的に無効化しない。新profileでは異型比較は有効化エラー。実行時にしか分からない型/制約違反も型エラー。List/Record等値を短絡しても静的に不正な式は有効化不可。等値descriptorが未登録の型は型付きkeyを明示抽出する。sort・集合・findは同じ登録key/等値版を使い、表示名取得を暗黙に行わない。

AND/ORのBoolean版とConditionResult版を区別。B→Cはschemaで宣言された既知値昇格のみ。ANDは左falseで、ORは左trueで短絡する。左unknownのときは右を評価し、unknown AND false=false、unknown OR true=true、それ以外のunknown組合せはunknown。NOT unknown=unknown。右の評価失敗はunknownへ変換しない。

DA04のfilter/any/all/find述語はBoolean専用を維持する。ConditionResultをfalseへ落とさず型エラー。any(empty)=false、all(empty)=true、find未一致はFindResult.not_found。ConditionResult版一覧述語の追加は今回勝手に行わない。

## 4. R04：整数・小数乱数の一様性と再開

### 4.1 整数の選択

lo,hiは安全整数、lo≤hi。内部の正確な整数で W=hi−lo+1 を計算する。最大 W=2^54−1。W=1はloをそのまま確定し、乱数bitを不要に消費しない。

W>1は b=ceil(log2(W))（整数bit-length計算で求める）として、独立・一様なb bitの整数rを得る。r<Wならlo+rを採用、そうでなければ棄却して次候補。浮動小数の53bit値をmod Wする方式、上限へclamp、剰余へ落とす代替値は禁止。独立一様bit源という明示前提の下では各許容rの確率は1/2^bで同じなので、成功時の条件付き分布は各整数1/W。これは範囲写像の保証であり、実機bit源の情報理論的独立性やRunの人為的選別まで証明するものではない。有限回の打切りは成功率を変えるが、成功した値に偏りを入れない。

候補抽出に有限の試行枠Qを確保する。Qは共通実行予算と実測で決める構成値であり、本書に新しい固定回数を捏造しない。枠切れは `RandomSamplingExhausted` として確定し、値を返さず、成功扱いや新keyでの自動やり直しをしない。期限/取消/予算のhard stopが優先。

### 4.2 初回とcrashの記録

同一dynamicKey = RunID / 固定FlowRevision / BlockInstanceID / 動的呼出しpath・回 / 並列path / 全囲みloop反復番号。

1. 入力snapshot、mode、algorithm version、試行枠、初回の有界な乱数bit列（entropy tape）を、一意キーで**抽出結果を公開する前に**原子的に固定する。再開状態としてアクセス制御・7日削除の対象。ログに出さない。
2. 初回固定の線形化点はこの材料の一意保存成功時である。保存前の生成だけでは抽選結果は存在せず、照合で未保存が確定するまで別材料を作らない。その固定材料から候補列と成功/枠切れを決定的に算出する。保存前の未確定bit列を選択結果として使わず、外部操作へ進まない。
3. 候補cursor/消費予算/結果とPCを一貫した版でcommitする。重複workerはCASで勝者の記録を読む。失敗も同じキーの確定結果であり、予算や材料を再発行しない。
4. 保存応答消失時は同じキーを照合する。確定結果があればそれを読む。初回材料の保存状況を照合できない間は停止し、再抽選で埋めない。

v1は最大Q×b bitのentropy tapeを候補評価前に固定する方式にする。固定seedだけの任意PRNG展開へ黙って置き換えない。割当て前にbytes・候補試行・生成費用の予算を予約し、予約IDをdynamicKeyと結ぶ。候補評価/失敗の論理消費は一意の状態遷移で確定し、crash再計算で予約を増やさない。実CPU費用は別途測定し、再開で実際に増えた費用を無計上にしない。入力/モード/algorithm/Qを同じキーへ差替える要求は不整合として停止するが、後続変数の正当な変更だけでは不一致としない。認証秘密・金銭抽選・公正性認証の用途を追加しない。

### 4.3 小数・抽出

小数はlo<hiなら[lo,hi)、同値ならlo、逆転拒否。53bit一様整数kについてu=k/2^53を作り、内部の正確な有理補間 `(1−u)lo+u hi` を最後にbinary64へ丸める。overflowする `hi−lo` を先にNumberで作らない。丸めでhiならnextDown(hi)を使い、最終lo≤x<hiを検査する。隣接端点なら常にloになり得る。「表現可能な全浮動小数が等確率」とは表示しない。

shuffleはFisher–Yatesで各stepの整数選択に同じ棄却方式を使い、重複なし抽出はその固定部分列として定義できる。候補snapshot・重複処理・n・結果は一度固定し、失敗時の部分結果を投稿しない。

## 5. R05/R08：文字の全操作とUnicode版

PlainTextは有効なUnicode scalar列。不正サロゲートを拒否し、暗黙正規化・置換文字化をしない。EGCは採用Unicode UAX #29版・profile・辞書/データ版・実装buildを固定する。ブラウザ既定のIntl.Segmenterだけを本番正本にしない。

| 操作 | 型・単位 | 空値と境界 |
|---|---|---|
| Length | Text→Numberの非負Integer制約、EGC数 | 空=0 |
| Letter | Text×正Integer→Text、EGC | 1..len。範囲外はIndexError |
| Slice | Text×開始Integer×件数Integer→Text、EGC | 開始1..len+1、件数≥0、開始−1+件数≤len。空は(1,0)のみ |
| Contains | Text×Text→Boolean、scalar部分列 | 空検索=true。EGC内の一致もtrue |
| StartsWith / EndsWith | Text×Text→Boolean、scalar部分列 | 空検索=true。境界は文字列先頭/末尾でありEGC境界を要求しない |
| Find | Text×Text→IndexResult | 完全一致の開始/終了が元入力のEGC境界である最初の位置。空検索=found(1)、未一致=not_found |
| Replace first/all | Text×検索Text×置換Text→Text | 空検索拒否。scalar一致を元入力の左から非重複走査。置換後を再検索しない。$や\\を構文扱いしない |
| Split | Text×区切りText×空保持方針→List<Text> | 空区切り拒否。scalar一致を左から非重複走査。先頭/末尾/連続区切りの空要素を方針通り保持/除外。空入力は保持なら[""]、除外なら[] |
| Join | Text×Text、またはList<Text>×区切りText→Text | 空List=""。数値/Refの暗黙文字化なし |
| Repeat text | Text×非負Integer→Text | 0回=""。負/小数拒否。予測出力容量を計算して予算検査。入力数字はplaceholderで固定回数ではない |
| Upper / Lower / CaseFold | Text×明示mode→Text | Unicode版固定、既定localeなし。必要なら登録localeを明示。文字数変化を許す |
| Normalize | Text×NFC/NFD/NFKC/NFKDの明示mode→Text | 未選択時に勝手に正規化しない。認可Ref/正式証跡の同一性には使わない |
| Trim / 改行整形 | Text×登録mode→Text | Trimは採用版Unicode White_Space propertyのscalar集合。改行整形はCRLF/CR/LF等を列挙したmodeだけ。両者を曖昧な自動整形にしない |

EGCを途中で分割しない保証はLength/Letter/Slice/Findの位置操作に限定する。scalar一致のReplace/Split/前後一致は結合記号やZWJの途中に一致し得る。これはinvalid Unicode生成とは異なるが、見た目の文字が変わり得るのでヘルプと試運転で示す。

例：`e + U+0301` はLength=1、Contains(結合記号)=true、Find(結合記号)=not_found、Replace(結合記号,空)=e、Split(結合記号,空保持)=[e,空]。Join(e,結合記号)はLength=1となる。連結や置換後は新しい文字列を再segmentationし、入力のEGC数を単純加算しない。

case/normalizeは明示前処理。変換後のFindは変換後文字列の位置を返す。元文字列への逆index対応を保証しない。外部APIのUTF-16/bytes/メッセージ制限は別検証し、EGC数だけで送信可能としない。

## 6. R08：一覧・変数・自作値の欠落を防ぐ

既存D6のT01–T10、L01–L25を継承し、Scratchの12List opcodeだけを実装して既存操作を落とさない。

- 一覧は同型の不変値。append/delete/clear/insert/replace/slice/concatは新Listを返す。変数更新は明示DA02。添字は1..len、insertだけ1..len+1、sliceは文字と同じ開始/件数規則。
- concatは同型Listを入力順で連結。空同士も宣言型を持つ。copy/concatで型や出所を消さない。
- dedupeは最初を残す。sortは安定、明示比較key/順序版を使う。groupはキー最初出現順、組内入力順。intersection/difference/unionは既存D6の順序・重複除去を維持。
- mapは純粋T→U、filter/any/all/findは純粋Boolean述語。findは最初だけ。例外を未一致へ変換しない。
- zip長さ不一致はエラー。chunkは正Integer、末尾余りを残す。slice/concat/chunkは外部収集・連投・容量制限回避能力ではない。
- sum(empty)=0。averageは既存AverageValue（Optional値＋使用件数）を維持。min/maxは既存MinMaxValueの各Optional。空をNumber0へ置換したり、Record出力を単純Optionalだけに縮小しない。
- 集計は入力順で版固定の数値演算を行う。途中の型不正・overflow/underflowを黙って無視しない。既存実装に集計方式があれば旧profileは保持し、新しい集計の誤差/途中overflow方針は明示する。parallel reductionへの変更で結果を変えない。
- 宣言はstable VariableID＋型＋初期値＋scope。変数増減、List変更、PC/予算を同一論理commitで確定する。未初期化を0にしない。子/並列から親変数へ暗黙共有書込みしない。
- 手順は固定Revision、値渡し引数、宣言戻り値。純粋自作値は引数のみを読み、外部read/write、時計、新規乱数、Wait、変数代入を含まない。全正常経路同型返却、直接/間接再帰拒否。必須引数欠落を例示値で補わない。

## 7. R06：数学14関数・丸め・精度の実装条件

### 7.1 全選択の意味

| 関数 | 入力/出力・正確な境界 |
|---|---|
| abs / floor / ceiling | 有限Number→Number。abs(-x)、floor負は−∞側、ceil負は+∞側。明示丸めの0は正常 |
| sqrt | x≥0。負はDomainError、sqrt(0)=0 |
| sin / cos | 全有限Numberの度数法。0/90/180/270度の周期代表値は正確な0/±1 |
| tan | 全有限度数。90+180kの正確な極はDomainError。0/45/180度等の厳密代表値を検査 |
| asin / acos | −1≤x≤1、度を返す。端点は正確な±90/0/180。自動clampしない |
| atan | 全有限Number→度。0→0、±1→±45 |
| ln / log10 | x>0。0/負はDomainError。ln(1)=0、log10(1)=0、log10(100)=2 |
| exp / exp10 | e^x / 10^x。0→1。非有限へ丸まればOverflow、真に非ゼロなのに最終0ならUnderflow |

入力binary64をそのexact real valueとして解釈する。通常演算で非ゼロsubnormalは許す。数学的非ゼロ→0だけNumericUnderflowとし、underflow flag単独で非ゼロsubnormalを拒否しない。-0は公開値で+0へ正規化。純粋計算の失敗を0/false/unknownへ隠さない。

### 7.2 具体的な実現方法

第一技術候補はサーバーで版固定するMPFR系エンジン/同等保証のルーチン。MPFRにはdegreeを直接扱えるsinu/cosu/tanu、asinu/acosu/atanu（u=360）があり、Numberによる先行π/180変換を避けられる。sqrt/log/exp/exp10等も同じ検証対象。

候補wrapperはbinary64のbit-patternを正確に渡し、precision=53、emin=-1073、emax=1024と正しいsubnormalize/ternary伝播でbinary64をエミュレーションする方式を評価する。指数範囲/flagなどの共有状態が並列呼出し間で混ざらないことを検査する。ここで挙げた値はbinary64表現の技術設定であり、製品利用量上限ではない。

自前周期低減なら整数仮数と2の指数からexact dyadic rationalとしてmod360/mod180を計算する。巨大角度にNumberの除算→floor→積を使って極や象限を決めない。正確な極・代表値判定は近似値にepsilonを当てる方法ではない。

採用前に依存版・build・公式既知不具合・配布ライセンス・対象環境を確定し、CPU/一時bytes/キャンセル応答/並列負荷を実測する。MPFRがあることはNEXUS上で動作・性能・精度確認済みという意味ではない。採用候補を外部HTTP oracleサービスとして呼ぶ案ではない。

公式根拠：[MPFR manual](https://www.mpfr.org/mpfr-4.2.1/mpfr.html)、[4.2.2 release](https://www.mpfr.org/mpfr-4.2.2/)。説明用manual版をそのまま製品採用版としない。

### 7.3 精度の受入と未達時

元案の4 ULPは未検証の提案を維持し、既存の製品保証として宣言しない。技術目標の意味は、正しく丸めたbinary64参照rに対し `abs(y−r)≤4×ulp(r)`。正常数ではulp(r)=2^(floor(log2(abs(r)))−52)、0/subnormalでは2^-1074。比較式自体は高精度/整数表現で評価し、binary64の差のunderflowで誤合格させない。隣接値4stepという別定義へ無断変更しない。

domain・厳密0/±1・極・overflow・underflowはこの誤差幅より優先する。近い0を返したから許容誤差内、とは判定しない。正しく丸める候補はこの目標以上を狙えるが、実装wrapperと実行基盤を含めた検証が必要。

高精度oracleは方向丸めの包含区間と、binary64への一意な丸め先を確認する。exact中点/代表値は別証明で扱う。同じMPFRを高精度で再実行する検査はwrapper確認には有用だが、同じlibrary内部bugへの独立証明ではない。公式契約・wrapperレビュー・独立golden/高精度計算・境界/ランダム試験を組み合わせ、有限試験だけで全finite入力の網羅証明を主張しない。

技術選定で全有限角度、subnormal、精度/コストを満たせない場合、そのゲートを未完と報告する。ブラウザMathへ黙ってfallback、角度範囲の縮小、関数省略、subnormal拒否、精度緩和、通常入力に対する常態的な「精度不明」失敗へ置換して完成扱いにすることは不可。こうした変更が必要ならユーザーへ具体差分を戻す。

### 7.4 旧丸めの保持と新しい明示mode

旧D2の提案は半値away-from-zeroだが、HEAD e37fd32の実装round方式はこの作業では未照合。既存実装の意味を直接確認し、旧opcode/Revision/欠落modeの挙動をそのまま保持する。欠落modeを推測で新方式へ埋めない。

新規roundでは `tiesAwayFromZero` と `tiesTowardPositiveInfinity` を明示選択する。半値−1.5は前者−2、後者−1。新規に未指定なら保存/有効化時に選択を求める。旧定義を単に開いて保存しただけで方式が変わらない。

新decimal-round提案は、Numberの版固定した最短往復10進表現を有理数として明示modeで丸め、最後にbinary64 ties-to-evenへ変換する。公開桁域−308..308は言語APIの候補として検証し、実測済み予算とは扱わない。素朴なx×10^dの誤差へ意味を委ねない。既存decimal操作があれば旧意味を保持し、同じopcodeへ新版を無断上書きしない。

## 8. R07：全opcodeから具体形まで追跡する

別添 `NEXUS-alpha15-scratch-opcode-trace.csv` は、標準公開opcode、動的変数/リスト、自作ブロック、12拡張の公開opcode、隠し項目を区別して1行ずつ対応する。mathopの14選択も独立行として追える。列は出典・Scratch対象・NEXUS機能族/具体形・採用/有界代替/参考/非該当/除外・理由を持つ。

「全ブロック参照」はスプライト/音/機器/カメラ/クラウド変数等の全機能を同じ挙動で実装する意味ではない。標準Scratchに専用elif/break/continue/戻り値付き純粋customがあるとは書かず、NEXUS追加を明記する。追跡表は実装済み一覧ではない。実装受入時には各採用行を実在opcode/テストIDへ結び付け、未実装を空欄のまま完了にしない。

## 9. Web編集UXの実装契約

- カテゴリは制御、条件/論理、数値、文字、一覧、変数、手順/自作値を検索・フィルタできる。色tokenはカテゴリ単位で統一し、既存テーマの意味色を壊さない。色だけで型/安全性を表さず、名前・アイコン・ソケット形・読み上げを併用する。
- 文は上下接続、値は型付きソケット、Booleanは条件形、ConditionResultは「不明を含む」badge、制御は本文/枝の所属が分かる枠。線の重なりでelse/unknown/loop終端の所属を曖昧にしない。
- 接続候補は入力型・scope・純粋/副作用・Revisionに適合するものだけ有効。不適合は理由と期待型を表示。ドラッグだけでなく「この入力へ挿入」とキーボード操作を備える。
- 各値欄から固定値、変数参照、計算、純粋自作値を選べる。保存する方式は1つ。例示placeholder、設定済みdefault、試運転だけの値を別表示し、空欄へ例示数字を自動採用しない。
- elif追加/削除/上下移動は条件＋then＋節unknownを一組とし、最初一致の優先順位変更を差分に表示。選択前に移動先scopeを検査。共通unknownのauthoring modeは個別unknownと区別する。
- loop成功後続と理由handlerを別コネクタ/領域にする。handlerには終端表示、hard-stopは編集可能な復帰線を出さない。localDeadlineには「外部操作不可」を表示。
- 保存前/有効化前に全枝の型・静的エラーを検証。試運転は外部操作を行わず、選択枝、未評価条件、反復数、終了理由、固定乱数、残予算を確認できる。値を永続ログへ残さない。
- 旧定義は対応しない新modeへ勝手に移行せず、表示/保存round-tripを優先。旧非正規木は入れ子で編集でき、共通unknownへ自動統合しない。
- Undo/RedoはASTとauthoring対応表を同時復元。Tab/Enter/Escape、枝のキーボード並替、焦点復帰を試験する。狭い画面でも同じ構造の手順一覧を正本と同期する。
- 公式Scratch画像3枚はC字、条件/値ソケット、入れ子所属の参考。公式画像を製品assetへそのまま組み込まない。

## 10. 保存・再開・停止の代表トレース

| ケース | 保存と進行 | 許されない動作 |
|---|---|---|
| elif A=false、B=unknown | B選択・Bのunknown本文位置をcommit。B本文を一度実行し、既存木の親へ合流 | C/else評価、別unknownコピー実行、A再判定 |
| N番目本文後に条件成立 | completed=Nをcommit→最終guard→condition_satisfied→正常後続 | 条件前にlimit扱い |
| N番目本文後も継続 | 最終guard→limit選択commit→handler→非成功終端 | 通常後続、N+1回目本文 |
| Wait中に局所期限 | 待機取消/失効を保存。外部未確定がなければ純粋localDeadline handler→終端 | Wait再登録、外部送信、新しいRun継続 |
| Wait中にRun期限 | terminalAt/期限理由をcommit。handlerも通常処理も開始しない | 期限後wakeによる再開 |
| 変数更新直後crash | 変数・PC・反復・予算の同じ状態版から復帰 | 加算再適用、旧PC＋新値、予算回復 |
| 乱数確定応答消失 | 同じdynamicKeyの準備/結果を照合し確定値を再利用 | 現在変数で入力再計算、新しいentropyへ交換 |
| 外部送信結果不明 | 外部一意キー/証跡とunknownを保持しhard stop | handlerから別送信、失敗扱いで自動再送 |
| handler内Wait後crash | handler phase/選択理由/PCで復帰し終端へ | bodyや別handlerへ戻る |
| 終了後遅延callback | 既存保持内で許可済み証拠だけ補足。terminalAt不変 | 通常進行再開、削除期限延長 |
| 削除後callback/旧worker | tombstone等の既存失効判定で再作成を拒否 | 同Run状態復活、別Run自動再作成 |

削除判定用のメタデータを新規に無期限保持してよいという承認ではない。既存失効/保持設計で成立することを実装照合する。

## 11. R01–R09の決定と実装ゲート

| 指摘 | 本書の解決案 | 実装者が確認する点 |
|---|---|---|
| R01 | 全出口、理由handler終端、hard-stop優先、局所/Run期限分離 | 新版制御completion、並列停止/外部操作確定の原子性 |
| R02 | CT01木の表示連鎖＋旧unknown保持。新規共通templateは明示コンパイル | authoring対応表の保存、安定ID、scope/Wait/終了範囲、旧木round-trip |
| R03 | 型×演算子許可表、Boolean述語、3値短絡 | 実在型schema・比較descriptor・旧比較profile |
| R04 | 最大54bit棄却＋有限固定試行枠＋entropy事前保存 | bit源、CAS、bytes予算、失敗も不変、統計だけに依存しない試験 |
| R05 | scalar一致とEGC位置の操作別表 | Unicode/データ/build固定、旧text profile |
| R06 | 14関数全て、server固定数値エンジン、旧丸め維持 | 依存選定/ライセンス/全域/精度/性能。未達を黙って縮小しない |
| R07 | 全opcode個別追跡表 | 実在NEXUS opcodeと試験へのリンク |
| R08 | T01–T10/L01–L25等を継承、Record出力保持 | 旧sum/average/minmax/sort等の回帰 |
| R09 | IntegerはNumber制約 | 保存型追加なし、全入力方式で同じ検証 |

### 11.1 既存動作を守る版解決

定義Revisionにnumeric/text/comparison/random/compilerの意味版を結び付け、Run開始時に固定する。実際の保存フィールド名は現行schemaに合わせる。旧版にfieldがないときは、調査で確定した旧実装profileを識別する互換解決を行う。単なる欠落から最新profileを選ばない。旧profileの挙動が不明なら、旧opcodeの実装とfixtureを先に読み取り・記録する。

数値精度・Unicode版・丸めmode・compiler mappingを変更した新Revisionは既存Runへ遡及しない。旧定義を新profileへ明示移行するときは差分・検証・試運転が必要。実装の内部最適化で公開意味・保存ID・残予算を変えない。

### 11.2 ユーザーへの再承認が必要になる変更

次が必要になった場合だけ、理由・対象・旧新挙動・代替をまとめて親へ戻す。

- 共通unknown機能や理由handlerの省略、14数学関数の一部省略、全有限角度の縮小、精度目標の緩和、通常入力に対する恒常的な未対応失敗。
- 旧丸め/Unicode/比較/CT01合流の変更、既存定義の任意unknownの自動複製・統合・procedure化。
- handler終端を成功合流へ変える、hard-stop後の外部操作、外部結果不明の自動再送。
- 7日期限/削除の拡大、ログへの内容保存、Run跨ぎ永続化、今回除外した外部HTTP/危険操作。
- 実測根拠のない新しい製品制限、追加の有償/外部サービス、許可範囲の拡大。

新規意味版・内部整数・検証器・UI対応表・テスト等、承認済み範囲を安全に実装するための内部詳細はこの補足の提案として親が統合できる。ただし数値精度の達成、既存互換、性能を検証済みとは表示しない。

### 11.3 完了条件

正式132試験＋本補足S試験を、採用仕様に従い重複整理して実行する。T133〜T141の通常チャット提案は自動的な合格・採用ではなく、本補足S試験と対応付ける。型/全math選択/Unicode/List/elif/handler/Wait/CAS/乱数/削除/認可/UX/旧版fixtureに実結果を付け、機能一覧と未完を一致させる。実装開始前の仕様・互換ゲートと、実装後の受入試験合格ゲートを混同しない。
