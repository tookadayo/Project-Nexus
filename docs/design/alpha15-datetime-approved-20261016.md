# alpha15 日時仕様補完：2026-10-16承認と実装対応

## 実装時の互換性と保証範囲の補足

旧確定Zoned値のoffset表示には歴史的な秒端数を分へ省略していたものがある。信頼済み・timePrecision欠落・旧offset形の完全一致値に限り、旧計算式から導かれる分表示の整合を認め、保存Instantは変えない。新しい明示precision値は厳密な秒offset整合を要求する。値のobject key順は実行意味に含めず、固定値照合はcanonical key順で行う。

新規ユーザー入力の小数秒制限は定義保存に加え、手動実行入力、模擬入力・出力、明示模擬時計、模擬イベント発生日時へ適用する。内部イベント発生日時、内部時計、既存Run/Waitの小数秒を丸めない。保存式から作る内部の模擬抽選結果と、ユーザーが送った模擬入力の信頼を区別する。

固定の対象は保存された確定Instant/offset、評価済み変数、Run開始・Wait再開時刻、予定受理snapshotである。DateOnlyとDateRangeの所属判定は暦日だけを比較する。一方、未評価のDateRange→Instant変換、明示的な表示地域変更・暦日加算・時間帯窓の解決は現在のIntlを用いる。旧TZデータ一式を保持して将来の全日時演算を同じTZ版に固定する保証は今回追加していない。その保証やTZ版変更時の未評価計算の停止を必要とする場合は、追加設計判断として親へ報告する。

実装前設計。承認は2026-10-16 00:01 UTC「1,msは含めない。処理が重くなるため。2,OK 3,OK 4,OK 5,OK」。本書は旧正本・前回188/192の結果を書き換えず、今回の差分を扱う。

## 作業基準と保護

既存 `D:\Project Nexus`、branch `codex/alpha15-web-blocks`、HEAD `e37fd32d4f7bcfabcc34d3a682de1a8e5910a92d` を継続する。開始照合は前回158ファイル、元変更34項目、旧資料6件、正本17件すべて一致。index SHA256は `9da9b1ff68c47e8a468d095fe9d6b6696bd22ee2af603757a08d919d03207395`。基準は `.local/alpha15-datetime-20261016/baseline.json`。新たなプロジェクト複製・Git書込・本番配置・実Discord・認証情報やOS設定変更を行わない。今回変更する既存ファイルは事前byte snapshotを保存し、前回差分の削除や初期化を行わない。前回受入表と原資料は凍結のまま保持する。

## 型と値の決定

| 対象 | 既存契約 | 今回の対応 |
|---|---|---|
| DateOnly | 文字列タグ、正規化ISO日付、暗黙の固定ISO暦 | 同じ固定ISO calendar schemaとして明記。地域・時刻を付けない。新日付専用入力は厳密YYYY-MM-DD。普通のPlainText変換とは別経路 |
| LocalTime | 文字列タグ、HH:MMのみ | 既存タグは分精度を維持。新descriptor `{kind:'LocalTime',schemaId:'iso8601.local-time.v1',precision:'minute'|'second'}` を追加し、値は各精度のHH:MM/HH:MM:SS。旧タグや異なる精度との暗黙変換はしない。変換は明示ブロック |
| Instant | UTC、既存保存は1〜3桁の小数秒も可能 | parse/保存単位・内部時計・Waitの精度を維持。新規ユーザー入力helperは分または秒のみ。canonical `.000Z` は秒の表現であり、既存非ゼロ小数秒は未編集なら保持 |
| ZonedDateTimeSpec | 日付・分時刻・地域・occurrence、確定instant/offset | `timePrecision?` を追加、欠落は旧minute。secondは明示保存。表示の桁省略で確定Instantを丸めない |
| DateRange | 両日包含、境界rule firstValidEarlier | 同日は1日。終了日の翌日日境界が排他的終端。新作成時には選択した日自体の不存在も検出。旧保存値を無言で置換しない |
| InstantRange | 旧文字列タグは非空 [start,end) | 一般値用 `{kind:'InstantRange',schemaId:'nexus.instant-range.v2'}` を追加し、同時刻は空区間として表せる。旧タグの拒否契約は維持。予約・受付窓は別途非空を要求 |
| Duration | 秒基準の有限Number、小数秒も既存に存在 | 型・既存待機処理・内部計測は変更しない。新日時UIにミリ秒精度選択を追加しない |

R03の比較はDateOnly同calendar、LocalTime同schema/precision、Instant同時点への正規化を保つ。InstantやDurationへ一律の「同精度」制約を広げない。Choiceの未定義ordinalは今回の対象外で、日付部分をそれとまとめて未対応にはしない。

## 解決・範囲・予定

- 単発DST欠落は修正要求。重複は早い/遅い方を明示選択。繰返しの欠落回skip・重複earlier1回・past skipを保存/表示する。
- 日境界は0時欠落なら当日の最初の有効時刻、重複なら早い方、暦日不存在なら修正要求。現在の分刻み探索は歴史的な秒単位遷移で不足するため、有限な秒境界の補完を行う。日付範囲の選択終了日も検証する。
- 毎月31日の欠落月skipと毎月末日は別指定。年次month/dayを追加し、2月29日は存在する年だけ生成。既存daily/weekly/monthlyの意味は変更しない。
- 夜間窓は `endDayOffset:0|1` を明示し、同日22→02は補正しない。境界は開始包含・終了除外。地域毎日とelapsed24時間を別定義のまま維持する。
- 次5回を現地日時、IANA地域、UTC差分、確定Instantで表示する。地域変更は旧/新の意味差を表示し、保存・新Revision・既存3段階reviewを経て有効化する。

## 確定値・移行・地域

時間帯の翌日指定は既存 `LocalTimeWindowSpec` を値型として公開し、純粋な `window.build` / `window.contains` ブロックで扱う。開始・終了は同じ LocalTime 精度を要求し、同日/翌日、曜日、地域を明示する。同日逆転や空の予約窓を補正せず拒否する。新しい実行権限や外部操作は追加しない。

新入力の地域解決と、信頼済み保存Revision/開始済みRunの確定値検証を分離する。後者は保存済みInstantとoffset/date/timeの内部整合を検査し、現在のIntlで再解決して上書きしない。新しい編集値を信頼済み扱いにはしない。同一Flowの既存保存値と完全一致する値だけ、保存時に旧確定値として保持できる。新規非ゼロ小数秒のliteral挿入はユーザー編集境界で拒否し、既存同値literal・内部時計や演算結果を一律拒否しない。

予定受理時に発生回・FlowRevision・地域・現地日時・解決済みInstantの最小snapshotを固定する。既存Runへ推測した地域を追加しない。時計取得は既存dynamic identityの確定結果を再利用する。Wait、開始時刻、7日期限を再起動で読み直さず、世代/expectedAt/一意occurrenceと同一TXの既存重複防止を維持する。結果不明の再送は禁止のまま。

新しい共有予定の地域候補は、実保存guild地域→確認可能なブラウザIntl候補の順。候補は確認・変更でき、既存予定を旅行・表示言語・端末設定変更で変えない。IP/位置情報権限は使わない。保存地域の取得失敗や不明時は選択を求め、UTCを暗黙採用しない。SettingsService既存の互換fallback（旧保存rowのAsia/Tokyoやschema default）は既存利用者向けのまま変更せず、確認済み保存属性との由来を別に示す。新規確認は既存guild設定保存経路を利用し、追加保持目的は作らない。

## 実装先と責任範囲

| 範囲 | 現行ファイルと差分 |
|---|---|
| 型/比較/ブロック | types.ts、definition.ts、expression.ts、scratch-comparison.ts、structured-values.ts、temporal-values.ts、temporal-cards.ts、expression-cards.ts、新temporal-types.ts。新descriptorと明示精度変換、旧契約保護 |
| 日付解決/予定/復旧 | datetime.ts、scheduler.ts、schedule-rules.ts、runtime.ts、store.ts。秒/年次/境界と固定snapshot、現行世代CAS維持 |
| 入力/プレビュー | value-slot.tsx、type-picker.tsx、temporal-value-input.tsx、trigger-editor.tsx、model.ts、共通calendar/input helper。ISO直接入力、今日、年/月移動、分秒、翌日、5回 |
| guild地域/編集境界 | automation service/API/client、automation page/workspace、web-setup status/SetupWizard。保存地域由来、Intl候補確認、旧確定literal保持、新入力ms拒否 |
| 模擬/メッセージ日時 | simulation-inputs.tsx、message-builder.tsx。新入力は秒まで、旧高精度表示と未編集保存 |

## 今回の差分受入（過去188/192と別集計）

| ID | 必須確認 |
|---|---|
| DT01 | ISO厳密日付、欠年/03/04/不正日拒否、地域を変えてもDateOnly日ずれなし |
| DT02 | 分/秒descriptor・同schema/precision比較、異型拒否、明示変換、Instant/Duration既存契約 |
| DT03 | 新入力ms拒否、既存42.123秒Instant/小数Duration/Waitの無編集保存・再読込保持 |
| DT04 | 両日包含・同日1日・終了翌日境界、23/25時間日、終了日不存在拒否 |
| DT05 | v2一般同時刻空区間・包含false、旧range拒否保持、予約窓は空不可 |
| DT06 | 22→翌02の明示、同日逆転拒否、終端除外 |
| DT07 | 単発DST欠落修正/重複選択、日境界欠落/重複/歴史的秒端点/不存在日 |
| DT08 | 繰返しgap skip/fold earlier1回、31日skip/末日別指定、年次閏日 |
| DT09 | 次5現地日時/地域/UTC差分、地域毎日と24h間隔の差 |
| DT10 | 言語と端末地域不一致、保存guild地域優先、候補確認/変更、取得失敗の選択必須 |
| DT11 | 端末地域変更・tzdb/表示地域変更でも既存予定/開始Run/Wait/確定Instant不変 |
| DT12 | 予定変更/取消/開始の世代競合、再試行/再起動の同発生回二重起動なし、時計結果固定 |
| DT13 | 保存/再読込/取消/Undo、calendar年/月/今日/直接入力、キーボード、日英/320px |

実績は別の実装証拠へ記録し、未実施と成功を区別する。既存関連テストの差分を優先し、全1011/363/137の不必要な再実行は行わない。実Discord・本番配置・未提供原画像の確認とは区別する。
