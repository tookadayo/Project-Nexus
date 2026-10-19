# alpha17 運用PC準備と未完了事項

2026-10-18。source checkpoint: `8d23caeacecd6b09672f5f8a5ef6901ad1e9271c`。この記録は準備と実稼働を区別する。commit/push、実資格入力、実認証、Discord実配信、公開、production migrationは未実施。

## 現在の到達点（導入後の更新）

以下の未導入・待機・初期化前という記述は各時点の履歴である。ユーザーの追加承認と2回目の手動再起動を経て、WSL 3.0.3 / VirtualMachinePlatform の有効化、Docker Desktop 4.95.0 の導入と初回 WSL2 初期化が完了した。現在は Engine 29.8.2 の local named-pipe `/version` が HTTP 200、linux/amd64、API 1.56 を返し、docker-desktop distro は WSL2 Running。導入後の追加再起動、Docker アカウント作成、docker-users 追加、手動のサービス権限変更は行っていない。実ユーザーの Docker credentials は読んでいない。初回の CLI 応答待ち3回の timeout と、その後の正常応答は別証跡として保存した。

ユーザーが AC 接続中のスリープを無効化した後に、AC sleep 0 秒 / DC 3600 秒を読み取り確認した。蓋を閉じる動作は Sleep のままである。エージェントによる電源設定変更はない。長時間の温度・回線・スリープ復帰・再起動後の自動運転・別媒体 backup/restore の受入はまだ行っていない。

明示承認された使い捨て Linux PostgreSQL 18.6 の試験では、固定 image digest、synthetic-only 認証、127.0.0.1 listener、max10 / 各取得500ms のまま、raw SELECT と PublicSessions の cold/warm 4条件で各8/8成功した。cold は「新しい pool の idle1 接続から8並列」であり、OS/disk cache cold の意味ではない。試験専用 container / volume / CLI config の停止・削除を照合済み。Windows native PG18.4 beta の cold 6成功・2timeout の FAIL は既定 integration 試験に残り、Linux 成功で取り消していない。[接続診断](alpha17-db-connection-diagnosis.md)を参照。

実資格情報・ACL/運用権限・実 Discord OAuth / 配信・本番初期化・Tunnel / DNS・お名前.com転送は引き続き別工程で保留。今回の画面・分析・自動化・認証 seam は synthetic local 検証であり、production 稼働成功とは区別する。詳細は[連携検証計画](alpha17-integration-validation-plan.md)と[統合検証記録](alpha17-integration-validation-status.md)を基準にする。秘密を読み得る strict preflight の実行前拒否は維持し、再試行していない。

証跡: task/alpha17-docker-install-result.json、alpha17-docker-desktop-start.json、alpha17-docker-engine-ready.json、alpha12-linux-pg-c2094cd0-d680-4b42-9d99-c7deec4264c2/{run.json,measurement.json}。
## 物理配置

- source checkout: `C:/Users/pc-ad/NEXUS-SERVICE`。別clone/worktreeは作成していない。
- runtime/tools: `C:/Users/pc-ad/NEXUS-RUNTIME`。Nodeの`fs.realpath`で通常の物理パスと一致することを確認した。Codex MSIX内に仮想化されるAppData aliasを起動入口に使わない。
- source内の入口: `起動用/`。設定・秘密・実行状態・log・backupはsourceとは別管理。実設定・秘密は作成していない。

## ツール

公式配布物を取得し、配置後もAuthenticode Validを確認した。Node 24.22.0、Git 2.56.0.windows.2、pnpm 11.19.0を実行し、固定lockfileの依存導入を完了した。WinSCP 6.7 Portableを配置したが実接続には使っていない。cloudflared 2026.10.1はversion表示のみ成功し、login、Tunnel作成、service登録、DNS変更は行っていない。

WSL 3.0.3 x64 MSIを`NEXUS-RUNTIME/installers/`へ取得・検証済み。SHA256は`ae977286974255bd26bf925f00f40f5692c6b2084155cbc0563c09aea091f211`。インストール・機能有効状態・再起動は以下の実施記録を基準とする。

## 秘密を読まない実診断

新しい`bootstrap.mjs diagnose app`だけを実行した。Node/依存/buildの存在を確認した。config/runtime/log directoriesとproduction.envは未作成。Windows PowerShellの有効ポリシーRestrictedによりACL verifierを実行できず、起動はblocked。診断のexit1はこの未準備状態を正しく報告した結果。設定/資格の内容読取、DB/Redis接続、port bind、アプリ起動は行っていない。

以前のstrict preflightは自動承認レビューで実行前に拒否された。再実行せず、診断actionを独立させた。RestrictedをBypassしたり、実行ポリシーやACLを変更したりしていない。

## 次段階の個別確認

再開前の記録ではDocker Desktopは未導入・規約未同意だった。現在の承認・取得状況は末尾の再起動後記録を参照。必要な確認は、利用主体のライセンス条件と[Docker Subscription Service Agreement](https://www.docker.com/legal/docker-subscription-service-agreement/)への同意、Windows HomeでのWSL2/Linux containers導入。個人利用等または従業員250人未満かつ年間売上1,000万米ドル未満の小規模事業は無料条件がある。他の業務利用・政府機関は有料条件の確認が必要。[公式ライセンス説明](https://docs.docker.com/subscription-billing/desktop-license/)。これは利用資格の判定や規約同意の代行ではない。

同意後の具体的操作は公式署名済みDesktop installerでWSL2 backendを選択して導入し、初回のAcceptを利用者が行うこと。`--accept-license`や自動loginは使用していない。WSL2 Linux containers用途でdocker-users追加は不要なので、同group付与は提案しない。[公式Windows導入手順](https://docs.docker.com/desktop/setup/install/windows-install/)。sourceのCompose準備は[datastore operations](alpha17-datastore-operations.md)を参照。

資格入力・private ACL・実grant/保持期間・DB初期化/backup/restore・電源/スリープ・再起動復帰・Tunnel認証と公開originは未設定。お名前.comは既存site backup、接続先と安全なユーザー入力、公開対象の承認、atomic switchと期限/cache強制の確認が必要。逐次FTP上書きだけで世代整合を成功扱いにしない。FTPSは現在のdriverではstrict pinを保証できないため閉じている。SFTPも実host検証前はclosed。

## Windows導入の実施記録

WSL optional featureはMicrosoft署名済みDISM `/Online /Enable-Feature /FeatureName:Microsoft-Windows-Subsystem-Linux /All /NoRestart`をUAC付きで実行し、exit 3010（成功・再起動必要）。Win32_OptionalFeatureでもInstallState 1を確認した。続くVirtualMachinePlatformの同様の要求はWindows管理者確認で取り消され、Start-Process error、ExitCode null。専用DISM logは未作成、機能はInstallState 2のまま。この取り消された操作を再試行していない。WSL MSIは未実行、再起動も未実施。WSL2利用可能とは認定しない。

再開時は、取り消されたVirtualMachinePlatform追加の意図と続行可否を確認し、有効化を完了する。署名とhashを再確認したWSL MSIを導入し、親が直前連絡してから計画再起動。復帰後はoptional features、`wsl --version`/status、仮想化の実状態を確認し、Docker規約同意と導入へ進む。自動loginや電源設定変更は含めない。MSIは読取専用metadataでDialog/Controlテーブル無しを確認したが、インストール成功の証拠ではない。

## ローカル検証の記録

固定lock依存導入、全体typecheck、全体lint、Next production build、source secret scan（1600 files、値は非出力）が成功した。機能別の詳細件数は各alpha17文書を参照する。全baseline DB/UI/unit件数をこのPCで再実施したものではない。alpha12の接続準備とcold回帰を分離した。準備済みpoolの元4試験は4/4成功（first test全体866.03ms）。別cold8回帰は6成功・2timeout、burst514.04msで全成功assertがFAILのまま既定integrationに残る。500msは各接続取得ごとの期限、max10と本番認証は変更なし。新規physical接続の完了が最大約536msとなり、割当済みnewClient待ち中に元queue deadlineが発火する経路を特定。明白な接続leakはなく、計装を外したstandalone/raw SELECTでも再現した。先行の速い計装runは無計装baselineの成功証拠として使わない。詳しい条件・証拠は[接続診断](alpha17-db-connection-diagnosis.md)を参照。計測対象はWindows native embedded PG18.4 betaで、予定する本番Linux PG18.6の性能は未検証。今回の接続診断用cluster・最終cold回帰・warm試験2回分は停止・削除を確認した。warmの2件も生成時刻とpg_ctl status 3を照合して対象だけを削除し、証跡alpha12-sessions-warm-cleanup-verification.jsonを保存した。転送helperはcurrent C# sourceからfresh compileして合成13件成功、転送stagingはFTPS停止回帰を含む25件成功。実WinSCP接続の証拠ではない。最終helper差分を含む全体型検査もexit 0。担当の対象lint成功と独立read-only reviewで、確認範囲に未解決の確定指摘なし。

| 検証範囲 | 結果 |
|---|---|
| 本番runner・入口・関連既存unit | 56件成功 |
| Operator関連unit | 58件成功 |
| 新Operator隔離DB／既存privacy／既存publication | 4件／9件／14件成功 |
| static publisher unit／関連隔離DB | 37件／13件成功 |
| WinSCP staging unit／Windows Job helper unit | 25件／13件成功 |
| 旧PowerShell runtime試験 | Restrictedでscript実行前に停止。Bypassなし |

## 2026-10-18 再起動後の再開記録

ユーザー自身の再起動後、LastBootUpTime UTC 2026-10-18T14:34:57.5000000Zを読み取り確認した。変更前はWSL optional feature InstallState 1、VirtualMachinePlatform 2、WSL本体未導入だった。ユーザーはVirtualMachinePlatformの管理者確認再表示と、Docker Desktop利用規約への同意・無料利用範囲での導入にそれぞれ「はい」と明示承認した。

その新しい承認に基づき、Microsoft署名ValidのDISMでVirtualMachinePlatformを /All /NoRestart 付きで有効化し、exit 3010（追加再起動が必要）を得た。続いてSHA256とMicrosoft署名を再確認した公式WSL 3.0.3 x64 MSIをWindows Installer /passive /norestartで導入し、exit 0。両optional featureは現在InstallState 1、製品登録とwsl --versionでWSL 3.0.3.0 / kernel 6.18.54.1-1を確認した。wsl --statusはdefault version 2を返すが、WSL2開始不可の仮想化要件警告も出ている。追加再起動前なので、firmware無効という結論やWSL2稼働成功とは扱わない。WSL distro・Linuxアカウントは作成していない。

Docker Desktop 4.95.0.242831 x64公式installer（636,811,696 bytes）をNEXUS-RUNTIME/installers/Docker-Desktop-4.95.0-x64-Installer.exeへ取得した。公式checksum一致のSHA256は73431db38491f770543880366228a23c993f84d1e8e045f56d83b8a98940cf76、Authenticode Valid / Docker Inc。installerは未実行。Codex MSIX由来のLOCALAPPDATA仮想化を避けるため、all-users既定C:\Program Files\Docker\Docker、WSL2 backend、Windows containers無効の導入を選択している。ユーザーの規約同意は取得済み。all-users導入では追加のWindows UAC画面承認が必要になる。EXEの公式flagに再起動抑止の保証が見つからず、現在のWSL2前提も追加再起動待ちなので、親が再起動を事前通知し、再接続後に要件を確認するまでinstaller実行を待つ。Docker login・新規アカウント・課金・docker-users追加は行っていない。

電源はAC接続を読み取り確認した。当初はAC/DCともsleep 3600秒だったが、ユーザー自身の変更後にAC 0秒（なし）/DC 3600秒を再確認した。蓋を閉じる動作はAC/DCともSleepのまま。夜間の継続作業ではAC接続と蓋を開いた状態が必要。エージェントは電源設定を変更していない。

追加再起動は実行していない。次は親の事前通知、追加再起動、再接続・WSL2確認、Docker導入時のUAC画面承認。既取得の規約同意を再確認する必要はない。実資格情報の安全な入力・秘密ファイルACL/運用権限・公開origin/Tunnel/DNS・静的Web配布物/接続/既存site backup等は従来どおり別工程で保留。厳密preflightの拒否済み操作は再試行していない。既存コード・cold/warm検証記録は保持した。

証跡: task/alpha17-post-reboot-setup.json、task/docker-desktop-4.95.0-download-verification.json。公式参照: https://learn.microsoft.com/en-us/windows/wsl/install#offline-install 、https://github.com/microsoft/WSL/releases/tag/3.0.3 、https://docs.docker.com/desktop/release-notes/#4950 、https://docs.docker.com/desktop/setup/install/windows-install/#installer-flags 。

## 2回目のユーザー再起動後・Docker管理者確認の待機記録

LastBootUpTime UTC 2026-10-18T14:50:00.5000000Zを確認。両optional featureはInstallState 1、wsl --statusはexit 0 / default version 2のみとなり、前回の仮想化警告は消えた。Docker公式installerのSHA256・署名Valid/Docker Inc・4.95.0.242831を再検証した。

承認済みall-users/WSL2/Linux用のinstaller起動をWindows UAC付きで要求した。引数はinstall --quiet --backend=wsl-2 --no-windows-containers --accept-license。起動要求は現在まだ戻っておらずexit code未取得。直近のmetadata確認ではinstaller processと導入先Desktop.exeは未確認で、Windows管理者確認の完了待ちとみられる。実行が既に始まった可能性も含め、状態確定前に再実行しない。対応するtool sessionは97767、証跡はtask/alpha17-second-reboot-docker-pending.json。追加再起動・Docker login・権限追加・公開設定は要求していない。

導入後の秘密不要確認では、実ユーザーのDocker設定/credentialsを読まない隔離CLI設定を使い、client版・Server応答の有無・Linux/amd64等の必要項目だけを確認する。Desktop初回起動はread-onlyではなく内部WSL distribution/VHD初期化を伴うため、別工程として明示する。既存の実資格情報や追加アクセス・ACL/サービス権限を要求された場合は停止して報告する。

Linux PG18.6 cold試験の次段階に必要な条件は、Desktop初回起動とEngine正常応答、既確認digestの公式PG18.6 image取得、試験専用synthetic認証と使い捨てcontainer/data領域・loopbackポート作成/終了後削除の明示された範囲での承認。本番compose・本番秘密・本番volume・本番migrationは使用しない。同じNode/pg、max10/500ms、idle1接続から8並列の全件成功assertを維持し、warm8接続の結果と分離する。既存Windows native PG18.4 betaのcold FAILは保持する。Linux試験はこの段階では実施していない。

## Docker導入要求の完了

既存tool session 97767を再開して結果だけを確認し、2026-10-18T14:58:12.5841699ZにDocker Desktop 4.95.0 x64 all-users / WSL2 Linux containers用installerがexit code 0で正常終了した。重複起動していない。承認済みの規約同意を適用し、追加再起動は実行していない。証跡はtask/alpha17-docker-install-result.json。

この時点ではDesktop初回起動・内部WSL初期化・Engine接続確認・image取得・使い捨て検証DB作成/試験/削除は実行していない。親がユーザーへ具体的範囲を確認中であり、回答まで待つ。installer正常終了とEngine/本番稼働成功を区別する。
