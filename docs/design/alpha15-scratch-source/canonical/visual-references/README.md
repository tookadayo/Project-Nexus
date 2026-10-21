# Scratch公式視覚参考（Codex向け）

取得日：2026-10-15 UTC。PNG 3点。すべて目視確認済み。

## 用途と境界

NEXUSの追加設計を読むCodex向けに、ブロックの形状・差込み先・分岐の所属を具体化する最小限の参考画像です。製品用素材ではありません。コード実装は含みません。

原作者：Scratch Foundation  
原題：Scratch Learning Resource: Conditional Statements / Making Interactive Projects with Conditional Statements  
公式ページ：https://www.scratchfoundation.org/learn/learning-library/conditional-statements  
公式PDF：https://cms.scratchfoundation.org/assets/df93e4b9-8cae-4d83-b903-1a18cba3a7f6  
ライセンス表示：CC BY-SA 4.0（元PDF各ページ下端で確認）  
ライセンス：https://creativecommons.org/licenses/by-sa/4.0/

変更点：元PDFの第2・6・7ページをページ全体のPNGへ変換。長辺1800px。切抜き、色変更、図形の作り替えなし。元の出典・ライセンス表示を画像内に残しました。元PDFも同梱しています。

教材画像の利用条件と、NEXUS製品にロゴ・キャラクター等を再利用できるかの判断は別です。製品への素材流用の権利確認や承認を済ませたものとして扱わないでください。

## 参考画像

### 01-control-block-shapes.png
制御ブロック形状と空の条件ソケット（元PDF 第2ページ）

出典ページ：https://cms.scratchfoundation.org/assets/df93e4b9-8cae-4d83-b903-1a18cba3a7f6#page=2

- 上段：wait untilの縦接続、repeat untilとifのC字、if/elseの二つの本文領域。
- 六角形の条件穴と、下段のBooleanブロックを差し込んだ状態。
- 下段：開始hat、順次stack、C字コンテナの境界を見分ける。

NEXUS対応：第5章 条件・elif・短絡評価、第6章 制御ブロック、第11章 差込みUI。

### 02-nested-conditional-branches.png
if/else入れ子と分岐順序（元PDF 第6ページ）

出典ページ：https://cms.scratchfoundation.org/assets/df93e4b9-8cae-4d83-b903-1a18cba3a7f6#page=6

- 右上・中央：外側else内に別のif/elseが所属する段差と囲み。
- 条件と本文を一組で移動する必要が分かる二つの並べ方。
- 分岐順序により結果が変わる。NEXUSで連鎖表示を作る際も所属と順序を保持する。

NEXUS対応：第5.1節 if/elif/else、第5.2節 保存構造を壊さないelif UI、第11章 差込みUI。

### 03-reporter-and-boolean-sockets.png
値reporter・比較Boolean・制御ソケット（元PDF 第7ページ）

出典ページ：https://cms.scratchfoundation.org/assets/df93e4b9-8cae-4d83-b903-1a18cba3a7f6#page=7

- 右上：丸いdistance reporterと、そのreporterを抱く六角形の比較式。
- 同じreporterの数値プレビューと、比較結果trueのプレビューを区別する。
- 下段：wait until・if・if/elseの本文所属と差込み先の違い。

NEXUS対応：第3章 共通型、第4章 演算、第11章 差込みUI・試運転。

## NEXUSで引き継がない点

- Scratch画像はNEXUSの静的型保証や実行意味の正本ではない。NEXUSの型、unknown経路、短絡評価、保存・承認境界は設計本文を優先する。
- Scratchにはこの資料上で単独elifブロックはない。入れ子if/elseを参考に、NEXUSのelifは別途設計された連鎖UIとして扱う。
- 教材のforeverループをNEXUSへ無制限実行として移植しない。NEXUSの予算・期限・明示読取り契約を維持する。

## 再確認

各PNGは `manifest.json` に寸法・SHA-256・出典ページ番号を記録。PDFの形状の観察だけに使い、静的型や実行意味の根拠にはしないでください。
