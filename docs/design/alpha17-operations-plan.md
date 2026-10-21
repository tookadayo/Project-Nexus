# alpha17 運用PCセットアップ設計

基準: 8d23caeacecd6b09672f5f8a5ef6901ad1e9271c。2026-10-18の利用者承認により、本番起動・停止・復帰、Operator policy接続、静的publisherを実装する。単一checkoutを維持し、今回の実行範囲は秘密なしの準備・ローカル検証までとする。

## 配置と起動

ユーザー向け入口は `起動用/` に集約する。既存の開発入口は同フォルダの `開発用/` に移し、本番入口と明確に区別する。実装は `scripts/production/`。秘密・設定・runtime state・logは `%USERPROFILE%/NEXUS-RUNTIME/` の別ディレクトリ、DB/Redisは個別volume、backupは承認された別媒体に分離する。実際の資格生成・ACL・サービス登録はこの実装に含めない。

本番起動は production build、設定、依存、schema互換性、loopback、二重起動を先に検証する。通常起動はmigrationを実行しない。既存core処理を再利用し、dev起動の自動migrationと本番起動を分離する。所有を検証できる子だけ停止し、PID再利用・別process・ghost listenerをkillしない。正常停止、異常終了、再起動競合、bounded retry、秘密を含めない状態・logを扱う。OS自動起動登録は別工程で、Docker Desktopのログオン前復帰は未保証と明記する。

## Operator設定

別loopback listener、既存認証/Host/Origin/CSRF/step-up/current permissionを維持する。有限の承認済みpolicyと最小grantを、厳格なローカル設定loaderから既存 `Alpha16OperatorOptions` に接続する。設定欠落・不正・期限切れ・権限変更でfail closed。権限や保持日数を自動採用しない。特にwriter coverage、独立safety/restore、public publicationの成立を単なるJSON booleanから捏造しない。現在READと危険操作のgateは分離する。

## 静的公開

既存の公開projection/manifest/世代CAS/hash/withdrawalを再利用する。専用generatorは承認済み公開入力だけを扱い、入口・秘密・法務候補・Next/API/DBを配布しない。転送はimmutable stagingとreadback、現在世代の条件付き原子的切替、公開route/manifestの整合、cache/撤回の確認を必要とする。FTP逐次上書きや任意の確認booleanでpublish成功にしない。ホスティングが原子的切替を提供しない場合、公開前で停止して正確な不足を返す。未確認の実接続、cache、PC停止中の期限強制はローカル試験と区別する。

## 維持する制約と検証

公式静的siteだけお名前.com、Next/BFF/API/DB/Rules/Worker/SchedulerはPC。TunnelはNext 127.0.0.1:3100のみ。内部API 3001、Operator 3210、DB/Redisは公開しない。DiscordはPC outbound。CASE03/04、UNKNOWN、REVIEW_ONLY、未承認保持・実測profile・外部Applyの既存gateを緩めない。

型/lint、今回変更した境界・failure/競合・秘密なしlocal fixture、Next production buildを実行し結果を記録する。実DB移行・Discord送信・資格入力・公開・DNS/Firewall/ACL/サービス権限はまだ行わない。WSL/必要仮想化は承認済みだが、再起動は親へ理由と復帰手順を伝えて区切る。Docker license/新契約同意は別確認。自動ログインは採用しない。