# NEXUS 運用入口

このフォルダはユーザー向け入口だけです。運用ツール・設定・ログの既定先は物理ユーザーフォルダ %USERPROFILE%/NEXUS-RUNTIME（このPCでは C:/Users/pc-ad/NEXUS-RUNTIME）です。MSIXの %LOCALAPPDATA% aliasは使いません。プログラム本体は `scripts/production/`、開発用入口は `開発用/` に分離しています。

- `事前確認.cmd`: Node・依存・production build・ディレクトリと設定ファイルの存在・実行ポリシーだけを診断します。設定内容・秘密は読みません。DB/Redis接続・port bind・migration・アプリ起動も行いません。
- `開始.cmd` / `停止.cmd` / `再起動.cmd` / `状態確認.cmd`: API・Discord・Worker・Schedulerとproduction Webを一組として制御します。
- `運営者開始.cmd` / `運営者停止.cmd` / `運営者状態確認.cmd`: Operatorだけを別プロセスで制御します。127.0.0.1:3210限定です。
- 開発用のSETUP/STARTは `開発用/` に移しました。開発SETUPは秘密生成・自動migration・開発サーバー起動を含むため、本番導入に使用しません。

初回準備が終わるまでは起動を拒否します。PostgreSQL 127.0.0.1:55432 と認証付きRedis 127.0.0.1:56379は別途承認された基盤で既に稼働している必要があります。このrunnerはDocker、WSL、開発用infra、Tunnelを起動・設定しません。

設定は `%USERPROFILE%/NEXUS-RUNTIME/config/production.env`、Operator policyは同dirの `operator-policy.json`、資格情報は `operator-credentials.json` です。設定はソースの `.env` から自動流用しません。config、runtime、logsの各dirと秘密ファイルには既存 `scripts/operator-acl.ps1 -Verify` が通るprivate ACLが必要です。この入口はACLを変更せず、秘密生成・入力もしません。ログは同baseの `logs/`、lock/heartbeatは `runtime/`、DB等のデータと別媒体backupはさらに別管理です。

公式portable Node24.22.0（固定パス、fallbackなし）と固定版pnpm11.19.0で依存導入・production buildが必要です。通常起動はmigrationを一切適用せず、schema_migrationsに1〜82が過不足なくある場合だけ起動します。migrationはbackup/検証を伴う別承認手順です。OAuth・HTTPS originと既存Beta admissionを必須にし、開発認証や未承認Rule runtimeへ切り替えません。

監視runnerは、独占lock取得後に自分でspawnした子だけを管理します。子の標準出力・標準エラーは保存せず、安全な固定イベント・エラーコードのみJSONLへ記録します（2MiBで1世代rotate）。PIDは表示専用であり、PID再利用、ghost listener、他プロセス、開発プロセスをkillしません。子の異常終了では全子を停止して1秒/5秒/15秒の最大3回だけ再起動します。設定・schema・依存の不備では再試行しません。停止はIPCで正常終了を依頼し、15秒後にも残る自分の子handleだけを終了し、その終了を確認します。親IPCが切れた子も停止します。

OSサービス登録・自動ログイン・OS再起動後の自動復帰は実装/設定していません。OS再起動や強制終了で残ったlockは自動削除せず `STALE_RUNTIME_REQUIRES_REVIEW` で停止します。所有者による停止確認と診断を経た復旧手順が必要です。Docker Desktopのログオン前復帰も未保証なので、常時無人運用の完成を意味しません。

公式静的サイトの転送・DNS/Firewall/Tunnel変更・資格設定・ACL変更はこの入口から実施しません。公開されるNextは127.0.0.1:3100だけを将来Tunnelへ接続し、API3001・Operator3210・DB/Redisは公開しません。
本番の.cmd入口は検証済みの公式Node24.22.0を %USERPROFILE%/NEXUS-RUNTIME/tools/node-v24.22.0-win-x64/node.exe から直接呼びます。system/Codex版へのfallbackやPowerShell入口、ExecutionPolicyの変更・Bypassは使いません。Nodeの場所・版・依存をbootstrapで確認し、常にソースrootをcwdとして実行します。状態確認・事前確認は秘密ファイルを読まずにNode、依存、build、dir/fileの有無と実行ポリシーを診断できます。

このPCのWindows PowerShellは現在Restrictedです。ACL検査は既存 scripts/operator-acl.ps1 -Verify をそのまま用いるため、ACL_VERIFIER_EXECUTION_POLICY_BLOCKED と対象・理由を表示して本番起動を閉じます。既存検査をinline化して制限を回避しません。署名済み検査の用意や実行ポリシーに関する具体的な承認が別途必要です。開発用PowerShell入口も現在の実行ポリシーでは開始前に拒否されるため、利用可能と検証済みにはしていません。
人向け事前確認は diagnose だけを呼びます。設定内容・資格情報・DB/Redis・schema・private ACLの完全検証は、この診断の成功をもって完了したとは扱わず、承認された開始処理の内部 strict preflight で行います。production.envはWindows同様にキー名を大文字へ正規化し、大小文字重複、Node/OpenSSL/TLS trustや秘密鍵ログ出力、実行ファイル探索先のoverrideを拒否します。未知の通常appキーは全排除しません。
