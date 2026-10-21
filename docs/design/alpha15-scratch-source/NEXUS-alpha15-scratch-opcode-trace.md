# NEXUS alpha15：Scratch opcode対応表（R07補完）

2026-10-15 UTC。設計文書の補完のみ。NEXUSのコード・設定・公開パレット・実装・受入試験は変更していない。ユーザーは条件/計算等・Web編集UX・互換と試験の範囲の補完後実装を承認済み。範囲の著しい縮小・変更は再承認が必要。本表から新機能・新権限・保持目的・安全境界の変更を承認済みと解釈しない。

## 結果とファイル

- [主対応表 CSV](NEXUS-alpha15-scratch-opcode-trace.csv)：236行。公開212 opcodeを各1行で対応付け、定義・引数・編集構造・指定メニューの24行を別種別で併記。
- [非表示・互換 opcode台帳 CSV](NEXUS-alpha15-scratch-excluded-opcode-ledger.csv)：24行。公開分母に足さない。
- [件数検算 JSON](NEXUS-alpha15-scratch-opcode-trace-check.json)：入力集合との一致、公開opcode重複なし、表示対象、拡張別件数の検算結果。

R07の「各opcodeから機能族・具体形・代替・非採用理由を追跡する」ための文書成果。通常チャットの再レビュー合格、利用者による仕様採用、実装準備完了や実機合格を示すものではない。全行に出典、既存設計の参照節、対応理由と制約を付けた。元の機能族を増やしていない。

## 分母と数え方

| 区分 | 和集合 | Sprite | Stage | 主表のrecord_kind |
|---|---:|---:|---:|---|
| 静的な標準7カテゴリ | 105 | 103 | 65 | standard_static |
| 変数5＋リスト12 | 17 | 17 | 17 | standard_dynamic_data |
| My Blocksの手順呼出し | 1 | 1 | 1 | standard_dynamic_call |
| 標準公開opcode小計 | 123 | 121 | 83 | 上記3種 |
| 公式12拡張の公開opcode | 89 | 89 | 77 | extension_public |
| 公開opcode合計 | 212 | 210 | 160 | public_opcode_count=1 |

標準カテゴリは9個。リストはVariables内であり第10カテゴリではない。変数・リスト・手順呼出しは対応する宣言/定義が存在した場合、拡張は追加した場合の利用可能な形の数。全部が新規プロジェクトの初期パレットへ同時に表示されるという主張ではない。

静的105の内訳はMotion18、Looks21、Sound9、Events9、Control11、Sensing19、Operators18。LooksのStage専用 `looks_switchbackdroptoandwait` と、対象依存のSprite/Stageクリックhatをそれぞれ含む。`sensing_online` も含む。

公開212の外に、手順定義1、引数reporter2、署名/編集補助4、mathopメニュー14、stopメニュー3を収録した。主表の追加24行はすべてpublic_opcode_count=0。procedure定義・引数reporterのpalette列はnoだが、availability_conditionにSprite/Stage双方のworkspaceで使用できることを記した。非表示/非対応と同義ではない。

拡張別の公開数：Music7、Pen9、Video Sensing4、Face Sensing9、Text to Speech3、Translate2、Makey Makey2、micro:bit10、Force and Acceleration9、EV3 11、BOOST12、WeDo2 11。Sprite専用12はPen8＋Face Sensing4。拡張追加・表示可は機器接続/サービス稼働/取得権限の証明ではない。

## 対応判断の読み方

| disposition | 意味 | 公開212行中 |
|---|---|---:|
| adopted_design | 既存のNEXUS設計に具体的な対応候補がある。承認/実装済みを意味しない | 36 |
| bounded_alternative | 有界反復・型付き入力・固定子処理等の既存設計へ目的を限定して対応 | 12 |
| ui_alternative | 認可された一時確認UIで代替。runtime機能族に加算しない | 4 |
| reference_only | UX/考え方の参考だけ。元opcodeの機能を提供する判断ではない | 15 |
| nonapplicable | スプライト/舞台等の実行対象がNEXUSにない | 55 |
| excluded | 今回の範囲から除外。新しい外部取得/機器制御等を追加しない | 90 |

`nexus_family`に「参考」「代替例」とあるものは機能互換を主張しない。familyが「—」でも理由・非採用の形を必ず記録した。例えば音楽の休符をtempo抜きで時間Waitへ置き換えたり、Scratchの発言をDiscord投稿の承認とみなしたりしていない。

制御11・演算18・変数5・リスト12・手順呼出し/定義/引数を個別に対応付けた。mathop14選択はabs/floor/ceiling/sqrt/sin/cos/tan/asin/acos/atan/ln/log/e ^/10 ^を省略せず、stop3選択も公開opcodeとは別に追跡する。その他全メニュー値・実行境界を網羅したという意味ではない。

## 出典と固定版

- [scratch-editor commit](https://github.com/scratchfoundation/scratch-editor/commit/eccdbed86086e7f7c77d7302dc3c811f830f242d)：eccdbed86086e7f7c77d7302dc3c811f830f242d（元棚卸しの2026-10-14 17:57:31 UTC snapshot）。
- [scratch-blocks固定版](https://github.com/scratchfoundation/scratch-blocks/commit/054c45ddd9b904d82a7d8fd0e60c2359084f1bc8)：2.1.34、054c45ddd9b904d82a7d8fd0e60c2359084f1bc8。
- [scratch-l10n日本語辞書](https://github.com/scratchfoundation/scratch-l10n/blob/c08c6625bb5166a64cce690ad1ac3cc6dbbe20b6/editor/blocks/ja.json)：6.1.133、c08c6625bb5166a64cce690ad1ac3cc6dbbe20b6。

元の[公式棚卸し](canonical/NEXUS-scratch-official-inventory.md)、scratch-palette-extracted.json、scratch-extension-per-block-inventory.jsonと、同じ固定版の保存済みブロック定義を使用した。新しいdevelop版への更新、本番配備commitの確認はしていない。CSVの公式URLはすべて固定commitで、拡張は元の行範囲URLを維持した。

標準のscratch_inputsは入力/fieldキーの参照用。Scratchの静的型保証、既定値、全メニュー網羅ではない。拡張は元getInfoの引数キー・ArgumentType・menuを保持し、Video SensingのNUMBER宣言を意味からSTRINGに変更していない。省略blockTypeからCOMMANDとなる2行には既定値根拠も付記した。日本語/英語表示は元資料の照合範囲を継承し、全文の日本語UI実機一致を保証しない。

## 分離した除外台帳と残る検証

非表示台帳は元棚卸しで特定された標準互換17（Control6＋その他11）と拡張hideFromPalette7。全VM内部primitive・全shadow/menuを新たに完全棚卸ししたものではない。作成ボタン、入力shadow、menu生成opcode、separator、開発用coreExampleを公開分母に含めない。編集補助4は非表示互換と混同せず主表で独立分類した。

関連する受入試験IDは既存試験への参照だけで、単独opcodeの全境界を試験済みと主張しない。新試験追加・試験番号変更・正式試験総数更新はしていない。すべてのNEXUS実機結果は未検証。

設計対応は[正式Scratch追加設計](canonical/NEXUS-alpha15-scratch-full-coverage-design.md)と今回の[優先補足](NEXUS-alpha15-scratch-final-supplement-R01-R09.md)を使い、機能族名は[実用ブロック統合設計](canonical/prior-six-documents/NEXUS-alpha15-practical-blocks-integrated.md)から継承した。古い統合設計の「Run期限未承認」を復活させず、現行のRun/単一Wait最大7日・終了後7日以内の再開データ削除・永続変数/任意外部HTTPの除外等を維持する。数値精度の実装可能性ゲートや他のR01〜R09審議を、この対応表だけで解決済みにしない。採用範囲や契約を変える場合は再承認が必要。
