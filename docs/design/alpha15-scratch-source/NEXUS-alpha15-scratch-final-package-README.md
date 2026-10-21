# NEXUS alpha15：Scratch追加設計 最終補足パッケージ

更新：2026-10-15 UTC。

## 先に読む

1. `NEXUS-alpha15-scratch-final-decisions.md`：決定案と残る技術ゲート。
2. `NEXUS-alpha15-scratch-final-supplement-R01-R09.md`：実装用の具体仕様。既存6資料・正式132件設計への優先差分。
3. `NEXUS-alpha15-scratch-supplement-acceptance-tests.md`：追加S001–S060、全件未実施。
4. `NEXUS-alpha15-scratch-opcode-trace.md` / CSV / 除外台帳 / 検算JSON：全opcode個別追跡。
5. `NEXUS-alpha15-CT01-code-evidence-supplement.md` と `NEXUS-alpha15-numeric-unicode-feasibility-note.md`：実装読取り根拠と技術選定資料。
6. `canonical/`：ユーザー再添付から回収した正式引継ぎZIPの42ファイルを改変せず収録。
7. `normalchat-evidence/`：第1回回答全文/要約、第2回送信原文/エラー。新しい通常チャット回答を装っていない。

## 現在の実績

ユーザーは条件/elif/反復/計算/文字/一覧/変数/自作ブロック、Web編集UX、旧互換と試験の3範囲について、補完後の実装を承認済み。大幅な縮小・既存意味の変更等は再承認する。

通常ChatGPT正常レビューは第1回1件。第2回は極高表示で送信したがModel not found、第3回未実施。以後再送なし。今回の仕様補完・相互点検は独立作業であり、通常チャットで第2・3回を完了したとは説明しない。NEXUSコード変更はしていない。

正式132件試験と補足60件試験は全件未実施。単純合計192件の固有網羅性を保証するものではなく、実装時に重複を対応付けて検証する。数値精度・性能・schema互換を実機確認済みとしない。

## 原文の歴史的記述

canonicalには当時の「レビュー0件」「実装承認前」「共通unknown辺」等が残る。証拠保全のため改変していない。現在の状態と仕様は本README・最終補足・最新ユーザー承認を優先する。旧丸めの保持はcanonicalの正式版§4.2にも既に修正済み。作業領域に残る初期128件版を正本に使わない。

CT01はHEAD e37fd32の読取り報告。木構造、unknownRefなし、ID重複禁止、通常unknown合流を確認。任意旧unknownの共通化等価性は未証明のまま。実装時には現行HEADと差分を再確認する。

## 正式ZIP検証

再添付名：NEXUS-alpha15-scratch-review-handover-package(2).zip
取得：2026-10-15 08:49 UTC
42ファイル、5,250,722 bytes
SHA-256：c16d85517066dc059d8b62e7996372ac5c6a016616c92a85c8a9c335dba7af1c
T001〜T132：132件、連番、重複なし

今回の全ファイルhashはmanifest.jsonを参照。canonicalファイルは元ZIP内の各内容とbyte単位で一致確認した。

## 参考画像

canonical/visual-referencesに公式Scratch教材のPNG3枚、原PDF、出典・取得日・参考対象のREADME/manifestを同梱。ブロック形・型ソケット・入れ子・条件分岐の視覚参考。製品画像assetへの無断複製・コード流用の許可ではない。
