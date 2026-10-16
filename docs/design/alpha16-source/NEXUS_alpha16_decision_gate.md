# NEXUS alpha16 判断事項と停止ゲート

2026-10-16。詳細は [移行と実装計画](NEXUS_alpha16_migration_plan.md)、優先訂正は [契約正本](NEXUS_alpha16_contract_decisions.md)。

## 現時点の到達点

A配置、全機能の配置と認証境界、17段階の実装順、13基礎Rule・20事例の分岐と説明契約、最小Operator、削除・保持・UNKNOWN、alpha17引継ぎを計画として統合した。コード実装・migration・設定変更・試験は実施していない。

現在のコード・DBとの対応、認可済みsourceの実在、運用PCとホスティングの能力、保持と稼働configの承認は別のgateである。これらが残るため「すぐ本番で全機能が使える」とはしない。

## 利用者判断は3束

### 1. 大型更新の実装開始

推奨：統合計画と未決を確認した後、alpha16の実装範囲として承認する。

今回の計画確定依頼やA配置の承認は、実装開始の承認を兼ねない。承認前はコード・migration・設定・試験へ進まない。既存の未commit変更を保護し、alpha15の192項目を入口台帳に残す。

### 2. 目的別の保持・閲覧・削除方針

推奨：目的ごとに最小の有限期間を設定し、履歴表示期間と適用可能期間を分離する。必要なclassが未承認ならその永続化・外部作用を有効化しない。

|対象|確定/候補と推奨境界|
|---|---|
|Run最小状態|終端後7日以内削除は確定。子intent/result/evidence等を別保存で延命しない|
|backup|7日保持は確定。live purgeと別に期限失効・復元拒否を実証する|
|Fact/evaluation/source health|48h等は過去の候補で未承認。再現性とプライバシーの必要最小期間で承認する|
|Suggestion/history/evidence|14d等は履歴期間候補で、適用可能期間ではない。必要根拠の最短期限でnon-actionable化|
|audit/lineage suppression/公開履歴|目的と最小fieldを分け、保持・閲覧対象・期限後の扱いを同時に承認。一律7日/30日/24か月にしない|
|deletion receipt|削除statusだけ。既存7〜30日候補は未承認。通常権限や削除済みデータ閲覧は与えない|
|TARGET_LIVE_SAFETY|target/live版/epoch/gateの最小安全状態を推奨。Run履歴は持たず、保持・削除・失効時fail-closedを独立して承認。無期限保存を暗黙採用しない|
|閲覧範囲|guildの現在権限を基本とし、個人状態と共有提案を分離。Operator削除は専用権限/step-up/対象scope確認を要求|

表は承認済み期間の一覧ではない。未検証候補を本番既定値へ昇格させない。具体値がまだ決まらないclassは実装を無効状態で用意できるが、使用可能・受入済みとは呼ばない。

### 3. 評価・公開・運用開始の方針

推奨：認可済み入力が揃ったscopeと承認済みconfigだけを有効化し、初期事例ActionはREVIEW_ONLY。typed editor、権限、版検証が成立した対象だけCREATE_DRAFTへ進める。自動適用・自動activationは行わない。

閾値/minN/freshness/cooldown/budget/TTLは検証用profileと稼働profileを分け、まとめた設定案として承認する。科学的に実証済みのbenchmarkとは説明しない。

公開Statusは必要最小限の状態と更新時刻を表示し、期限切れはUNKNOWN。Legal/Contactは承認文面・受付先・保持・運用が揃ってから公開。課金・外部送信・新サービス契約・権限拡張の開始は、その具体的な範囲で別途必要な承認を得る。

一般利用者ダッシュボードからの新たなself-service削除範囲は未確定。現在の追加実装計画はlocal Operatorからの削除である。

## 担当者が止まる条件

|gate|必要な証拠|未成立時|
|---|---|---|
|G0 設計正本|統合訂正、旧新mapping、完全fixtureの定義要件、矛盾の解消（fixture実装・試験完了ではない）|未確定仕様を推測して実装しない|
|G1 実装開始承認|利用者の明示承認|実装・migration・設定・試験へ進まない|
|G2 現コード照合|baseline、実route/table/type/permission/source/target/actionと全機能対応|該当変更単位や有効化を確定しない。保存監査を現在事実として流用しない|
|G3 永続化/評価有効化|TARGET_LIVE_SAFETYを含む承認保持class、config、対象scope、認可済みsource、外部作用の安全保存|未承認classやRule、依存する外部作用を無効のまま維持|
|G4 全機能組立|全操作の実装差分、互換、UI、受入仕様、blocked理由、契約freeze|一部完成を全実装完了と呼ばない|
|G5 一括受入|全実装完了後の試験・集約修正・再確認の証拠|partial/blocked/notrunをpassにしない。契約変更ならN16-14へ戻す|
|G6 alpha17稼働|実PC/外部接続/公開/保持/restore/障害/実環境受入|構造完成を本番稼働可能と呼ばない|

## 利用者へ丸投げしない事項

PG中心のtransaction/lock方式、型registry、物理schema、route mapping、branch修正、scope lock実装、fixture正規化、通常の実装順は担当側の設計・照合事項。A配置とalpha16/17境界も既決なので再選択を求めない。料金・契約・公開・権限・保存範囲が変わる部分だけ、具体的な影響を添えて利用者判断へ戻す。
