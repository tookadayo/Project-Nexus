# NEXUS Scratch追加：統合する決定案と引継ぎ

2026-10-15 UTC。ユーザーの3範囲承認を受けた仕様補完。通常チャット正常レビューは第1回1件のみ。第2回はModel not foundで停止、第3回未実施。独立補足と内部相互点検を通常チャットレビューとして数えない。今回コード変更なし。

## 推奨する決定

1. 新while/untilはN回body・最大N+1回guard。limit/条件unknown/評価失敗/局所期限は別理由handlerを持ち、handler末尾は非成功Run終端。普通の後続へ落とさない。break/continue/Returnは目的通り区別。
2. Run期限・取消・全体予算・外部結果不明はhandlerも停止。局所期限handlerだけは所有loopの外にある純粋終端領域とし、外部操作・Wait禁止。ネスト期限の所有者を明示。
3. elif UIは既存CT01のfalse側入れ子を表示する。旧unknownは節別に保存し、任意共通化をしない。新規共通unknownだけ版付きauthoringから固有IDのCT01木へ展開し、対応表とscopeを検証。共有参照が既存schemaにあるとは言わない。
4. IntegerはNumberの安全整数制約。型別比較表とBoolean一覧述語を固定し、新ルールを旧定義へ遡及しない。
5. 整数乱数は最大54bitの棄却方式。有限試行枠・entropy tape・入力を初回一意保存し、成功も失敗も再開で変えない。範囲写像の一様性とbit源の前提を分ける。
6. Contains/Replace/Split/前後一致はscalar一致、Length/Letter/Slice/Find位置はEGC。全操作を同じ単位と誤説明しない。Unicode版と旧Runの意味を固定。
7. 数学14種を維持。MPFR等の版固定サーバー数値基盤を評価し、全有限度数・domain・subnormal・代表値を検証。4 ULPと小数桁域は未検証の技術目標であり、旧実装の保証として宣伝しない。旧roundを保存し、新2modeを明示。
8. D6の文字T01–T10、一覧L01–L25、average/minmaxのRecord出力を継承。純粋値とRun状態変更を分け、型ソケット・カテゴリ色・接続・入れ子所属・キーボードUXを共通化。
9. 公開212 opcodeを個別追跡。数学14選択などの分母外行を分離。132既存試験＋60補足試験は全件未実施で、採用対応表に結び付けて検証する。

## そのまま変更してよいことと、戻すべきこと

承認済み範囲内の新profile、内部BigInt、検証器、理由別終了機構、authoring metadata、UI、試験の実装判断を補う。既存を黙って変えない。

再承認が必要なのは、旧丸め/Unicode/比較/unknown合流の変更、共通unknownや理由handlerの省略、数学関数の省略や範囲/精度縮小、7日制約/保持/ログ/外部操作境界の拡大など。技術ゲートが満たせない場合は具体差分を親へ戻す。

## 実装者のチェックポイント

- 正式132件版と既存6資料を読む。HEAD e37fd32の旧numeric/text/comparison挙動を読取りfixture化してから新profileを追加する。
- handler終端・新規commonunknownコンパイル・既存Run再開について保存構造と原子性を検証する。既存schemaだけで足りなければ必要な新版構造を追加し、旧構造を無言で上書きしない。
- 数値ライブラリ選定と性能・ライセンス・wrapperの技術検証は実装工程内で行い、未通過の数値機能を完成/有効化済みとしない。全作業を実機試験前に完了扱いにしない。
- 全テストの実結果、未完、変更ファイルを親へ返す。追加の通常チャット送信は行わない。

## 正式資料の回収

ユーザー再添付の `NEXUS-alpha15-scratch-review-handover-package(2).zip` を正規取得。42ファイル、5,250,722 bytes、SHA-256 `c16d85517066dc059d8b62e7996372ac5c6a016616c92a85c8a9c335dba7af1c`。T001〜T132の連番・重複なしを検算。最終統合ZIPにはcanonicalフォルダとして全42ファイルを改変せず同梱する。
