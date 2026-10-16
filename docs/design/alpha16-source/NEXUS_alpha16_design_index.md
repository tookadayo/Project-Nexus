# NEXUS alpha16 設計・移行計画 索引

更新: 2026-10-16 06:22 UTC。実装・設定変更・試験は行っていない。

## 最初に読む正本

1. [移行と実装計画](NEXUS_alpha16_migration_plan.md)：17作業、全機能対応、依存、完了条件、alpha17引継ぎ。
2. [契約の優先訂正](NEXUS_alpha16_contract_decisions.md)：旧仕様の失効と採用する契約。
3. [判断事項と停止ゲート](NEXUS_alpha16_decision_gate.md)：承認・保持・稼働方針と実装担当が止まる条件。

以下の原文は参照付録であり、上記正本の訂正を優先する。単純に原文を新しい順に連結して実装しない。

## ソースと優先順位

- 旧通常チャット: https://chatgpt.com/c/6ad081d5-2d78-83e8-ad9d-7ada76ef0fa1 （長さ上限到達）
- 継続通常チャット: https://chatgpt.com/c/6ad1abf0-d13c-83ee-a484-307ae6b5e52b （NEXUS alpha16 実装計画確定）
- 最新の利用者決定 → 統合正本の明示訂正 → 該当分野の後続補遺 → 分野別契約 → 基本仕様 → 初期比較案の順。新しい文章でも利用者決定や安全不変条件を暗黙に上書きしない。
- A配置ではPCのNext/BFF内server-side DB処理を維持できる。初期監査の「全DB操作をAPI橋渡しへ」という配置前提は失効。
- RESULT_UNKNOWNの同一外部作用再送禁止、Run終端後7日以内削除、backup7日、Operator非公開、提案の非自動適用は固定。
- 30日/24か月保持の初期提案は失効。48h/14d等を含む新しい保持値・閾値・予算は未検証候補であり、承認済みとみなさない。

## 成果物

|ファイル|内容|
|---|---|
|[alpha16-normal-chat-A-approved-final-specification.txt](alpha16-normal-chat-A-approved-final-specification.txt)|A配置承認後の基本仕様（後続補遺優先）|
|[alpha16-normal-chat-all-features-revised-response.txt](alpha16-normal-chat-all-features-revised-response.txt)|全機能配置・A/B比較（履歴、A承認優先）|
|[alpha16-normal-chat-annex-IA-feature-matrix.txt](alpha16-normal-chat-annex-IA-feature-matrix.txt)|全機能→UI/API/DB/権限/移行/受入の対応表|
|[alpha16-normal-chat-annex-IA-supplement.txt](alpha16-normal-chat-annex-IA-supplement.txt)|不足機能の追加mapping・旧危険例外の失効|
|[alpha16-normal-chat-annex-IB-api-contracts.txt](alpha16-normal-chat-annex-IB-api-contracts.txt)|API request/response・error・idempotency・版契約|
|[alpha16-normal-chat-annex-IC1-consistency.txt](alpha16-normal-chat-annex-IC1-consistency.txt)|初期6整合修正|
|[alpha16-normal-chat-annex-IC2-fact-suggestion-db.txt](alpha16-normal-chat-annex-IC2-fact-suggestion-db.txt)|Fact/Suggestion系DB・transaction・lineage|
|[alpha16-normal-chat-annex-IC3-runtime.txt](alpha16-normal-chat-annex-IC3-runtime.txt)|永続Runtime・lease・send admission・UNKNOWN|
|[alpha16-normal-chat-annex-IC4-retention-privacy.txt](alpha16-normal-chat-annex-IC4-retention-privacy.txt)|保持・FK切離し・削除・receipt・restore|
|[alpha16-normal-chat-annex-ID-public-migration.txt](alpha16-normal-chat-annex-ID-public-migration.txt)|公開route境界・静的publication・status・移行|
|[alpha16-normal-chat-annex-II0-rule-common.txt](alpha16-normal-chat-annex-II0-rule-common.txt)|13基礎Ruleの共通型・決定論・予算|
|[alpha16-normal-chat-annex-IIA-onb-help-ret.txt](alpha16-normal-chat-annex-IIA-onb-help-ret.txt)|ONB/HELP/RET|
|[alpha16-normal-chat-annex-IIB-eng-event-report.txt](alpha16-normal-chat-annex-IIB-eng-event-report.txt)|ENG/EVENT/REPORT|
|[alpha16-normal-chat-annex-IIC-auto-perm.txt](alpha16-normal-chat-annex-IIC-auto-perm.txt)|AUTO-001/AUTO-002/PERM|
|[alpha16-normal-chat-annex-IID-exp-play-data.txt](alpha16-normal-chat-annex-IID-exp-play-data.txt)|EXP/PLAY/DATA（DATA修正はIV-0優先）|
|[alpha16-normal-chat-annex-IIE-comm.txt](alpha16-normal-chat-annex-IIE-comm.txt)|COMM（IV-0/IV-Aの修正優先）|
|[alpha16-normal-chat-annex-IIIA-operator-privacy.txt](alpha16-normal-chat-annex-IIIA-operator-privacy.txt)|Operatorからの個人情報削除|
|[alpha16-normal-chat-annex-IIIB-operator-minimal-ui.txt](alpha16-normal-chat-annex-IIIB-operator-minimal-ui.txt)|最小運営UI/APIと削除replay修正|
|[alpha16-normal-chat-annex-IV0-branch-common.txt](alpha16-normal-chat-annex-IV0-branch-common.txt)|事例ベースdecision tree・action・説明組立|
|[alpha16-normal-chat-annex-IVA-cases-01-04.txt](alpha16-normal-chat-annex-IVA-cases-01-04.txt)|事例01–04（IV-B訂正優先）|
|[alpha16-normal-chat-annex-IVB-cases-05-08.txt](alpha16-normal-chat-annex-IVB-cases-05-08.txt)|事例05–08（統合正本の訂正を優先）|
|[alpha16-normal-chat-annex-IVC-cases-09-12.txt](alpha16-normal-chat-annex-IVC-cases-09-12.txt)|事例09–12（統合正本の訂正を優先）|
|[alpha16-normal-chat-annex-IVD-cases-13-16-source.md](alpha16-normal-chat-annex-IVD-cases-13-16-source.md)|事例13–16のCopy原文（表示欠落した数式を保持）|
|[alpha16-normal-chat-annex-IVD-cases-13-16.txt](alpha16-normal-chat-annex-IVD-cases-13-16.txt)|事例13–16（表数式はsource.mdを優先）|
|[alpha16-normal-chat-architecture-response.txt](alpha16-normal-chat-architecture-response.txt)|初回の配置検討（履歴）|
|[alpha16-normal-chat-annex-IVE-cases-17-20.md](alpha16-normal-chat-annex-IVE-cases-17-20.md)|事例17–20（統合正本の訂正を優先）|
|[alpha16-normal-chat-annex-VA-contract-corrections.md](alpha16-normal-chat-annex-VA-contract-corrections.md)|型・三値評価・数値比較の統合補遺。V-B/VIで訂正される箇所は失効|
|[alpha16-normal-chat-annex-VB-final-corrections.md](alpha16-normal-chat-annex-VB-final-corrections.md)|分岐・文書の統合差分。CASE02の誤記はVIで失効|
|[alpha16-normal-chat-annex-VI-migration-review.md](alpha16-normal-chat-annex-VI-migration-review.md)|17作業の最終レビュー、lock/token/UNKNOWN安全状態。工程省略と判断事項は統合正本で訂正|


## 別の根拠・レビュー

- [コード監査](alpha16-readonly-code-audit.txt): 実ファイル所在・既存機能の根拠。実稼働/配備の検証ではない。
- [実運営事例調査](NEXUS_discord_operating_cases_2026-10-16.md): 20パターン、出典、観測可能性、採用しない危険策。
- [契約の優先訂正](NEXUS_alpha16_contract_decisions.md): 分岐順・cohort/metric比較・source UNKNOWN・ID等の統合正本。

## 区分

- 確定: A配置、全業務PC配置、same-origin境界、alpha16構造/機能とalpha17環境設定、試験時期、非学習/プライバシー境界、最小Operator UI方針。
- 候補: 数値閾値/minN/鮮度/cooldown/予算/新規データ保持、個別case action/説明文、未承認の運営方針。
- コード照合待ち: 提案route/table/typed editor、各source adapterとauthorized aggregate、Operator step-up、backup実運用、static publish能力、実domain/鍵/接続設定。

## 回収・統合状態と残るgate

- 13基礎Rule、20事例、API/DB/Runtime/Privacy/Public/Operator、V-A/V-B/VIの回答回収・保存は完了。
- VIと最新方針を統合し、CASE02、evaluationAsOf、lock、key/token/receipt、UNKNOWN保持後の迂回、受入IDの訂正を正本化した。
- IA境界はA16-OP-BASE-01/02、III-B画面はA16-OP-UI-01..07。旧IDは出典付きaliasだけ。
- 実装開始承認、現コード照合、目的別保持と稼働config承認、実装後の一括試験、alpha17実環境確認は未実施・未通過。
- 未承認保持class、利用不能source、未登録target/action等の解除条件を満たさない機能は無効のままにする。

13基礎Ruleと20事例の設計取得だけで全状況の網羅・実装完了・本番準備完了とはしない。現在は計画確定までであり、実装開始には別途承認が必要。
