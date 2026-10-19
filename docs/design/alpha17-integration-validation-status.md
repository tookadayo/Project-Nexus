# alpha17 運用PC・統合検証記録

> 履歴注記（2026-10-19）: 以下は2026-10-18の合成検証時点の記録です。当時はcommit/pushを実施していません。後続のローカル保存整理は、新たな実認証・本番稼働・正式Security scan完了の証拠ではありません。現在の保存状態はbranch/commit履歴を参照してください。

2026-10-18 UTC。既存 `C:/Users/pc-ad/NEXUS-SERVICE`、保存版 `8d23caeacecd6b09672f5f8a5ef6901ad1e9271c` と承認済みローカル変更を対象とする。別clone/worktree、commit/push、実資格入力、実Discord認証・配信、本番migration、Tunnel/DNS公開、お名前.com転送は行っていない。[検証計画](alpha17-integration-validation-plan.md)に対応する、限定した合成local試験の記録である。

配置方針は、お名前.comの `withnexus.net` にPUBLIC静的公式サイト、運用PCにNext/BFF/API/DB/分析/Automation/Worker/Scheduler。利用者は同一originのNextだけへTunnel経由で接続する。OperatorとDBは公開しない。実公開・本番運転の受入は未完了。

## 追加修正4件

1. VERIFIEDカードを既存の認可済みserver選択へ接続し、READ-only利用者にも既存権限別導線を使う。
2. OAuth取消は有効state確認後に表示する。失敗時に新sessionを作らず、試行用cookieだけを消し、既存sessionを保持する。
3. 静的記事・法的文書の言語切替を同一文書の翻訳へ接続し、未翻訳時のfallbackとhref escapingを保持する。
4. setupナビへのglobal CSS衝突を2箇所で修正。wizard内はdesktop1列、760px以下は既存4列とし、Review操作の重なりを解消する。

最初の3件はauth/card10件とpublication16件の対象回帰が成功。CSSは構文・指定値・diffcheckを確認した。CSS用lint ruleはなく、CSSlint成功とは数えない。CSS後のNext production buildはexit0、静的37/37、`next-env.d.ts` hash不変。以後の変更は試験と文書のみで、このbuildを再利用した。

## 実測した結果

| 範囲 | 結果 | 条件と限界 |
|---|---|---|
| PC基盤 | Node24.22.0、Git2.56.0.windows.2、pnpm11.19.0。WSL3.0.3/Docker Desktop4.95.0導入・初期化、Engine29.8.2 linux/amd64応答 | 公式署名/checksum確認。長時間・再起動後の本番受入ではない |
| 電源 | 本人のAC sleep無効化後、AC0秒/DC3600秒を読取確認。蓋閉じはSleep | エージェントによる電源変更なし |
| Linux PG18.6接続 | raw SELECT cold/warm、PublicSessions cold/warmの4条件が各8/8成功 | 固定digest、max10/各取得500ms不変。coldは新pool idle1→8並列。OS/disk cache coldではない |
| 分析・自動化・API | 既存3filesの対象8件のassertionが8成功、未選択77 | 元wrapperはJSON集計先を誤認してFAIL。別receiptで同runを復元、子exitcodeはUNKNOWNのまま保持 |
| Rule Worker | task-only1件PASS、exit0/skip0 | CASE18/typed facts→実Worker→永続proposal→別poolの認可済みlist/detail。合成policy/controlのみ |
| OAuth | 3/3 PASS、exit0/skip0/retry0、通常30秒/件 | 20.751/2.518/5.151秒。実Next/API/DB、provider同意・token交換はmock。live Discord grantは未確認 |
| 設定・権限 | 2/2 PASS、exit0/skip0/retry0、通常30秒/件 | core21.242秒/permission8.456秒。実UI保存・適用・Web設定再読込と権限喪失拒否 |
| operations独立phase英日 | 10/10 PASS、exit0/skip0/retry0、各60秒/worker1 | 5機能×英日の10case、実測7.666〜31.497秒。元30/60秒の巨大smokeとは別結果 |
| 通常security review | bounded source review1回、検査境界で悪用可能な確定脆弱性なし。関連既存unit6files 93/93成功 | 正式scan・全経路の安全証明ではない。後続UX5file差分も追加read-review済み |
| リポジトリ最終チェック | 全体type0、全体lint0＋型修正file lint0、CRLF考慮diff0。通常source1479filesの限定heuristic候補0、保護source/UX SHA不変 | runtime/test source固定・全fixture停止後に実行。baseline全DB/UI/unit再実施ではない |

Linux接続8要求全体はraw cold97.064ms/warm13.130ms、session cold335.455ms/warm781.876ms。全体時間と各接続取得500msの期限を混同しない。Windows native側の失敗と比較条件は[DB接続診断](alpha17-db-connection-diagnosis.md)を参照。

OAuthでは、生成した公式サイトのログインリンク→実login307/state cookie→実callback→永続session→認可POST/dashboard、無権限guild拒否とデータ不変、実browser logout303・cookie消去・コピーした旧参照拒否を確認。token交換は1回、取消・不正/期限切stateでは交換/新sessionなし。provider同意画面・遷移とexact token endpointは合成であり、実Discord認証の成功には数えない。

設定試験では、通常のReview hit-testと横overflow無しを1280/761/760/360pxで確認。draft保存では設定不変、実BFF apply200、二重操作でもrevision+1、timezone/setupVersion反映、他設定・他guild不変、scope不一致409を確認した。dashboardから実SettingsリンクでWeb setup編集画面へ移動し、値→reload→同値・revision不変を確認した。既存test titleにあるdashboard reloadを、console view4の表示確認とは扱わない。

operationsは英日とも、FREEのPNG出力・CSV拒否・受付設定、STARTERの保存view/CSV・イベント作成編集/ICS・FREE降格時の停止、GROWTH/SCALEのAPI境界、SCALE全8画面の360px表示を確認した。元46か所のassertionとの対応を独立レビューし、各caseは別context・本人CSRF・明示plan・独自作成物を使用した。元の一括smokeを置換せず、独立した機能診断10件として記録する。

WorkerはSTOPPED/期限切れ/無権限の拒否、重複NOT_CLAIMED、TARGET_UNKNOWN/REVIEW_ONLY、適用/draft禁止も確認。Web RulePlatform本番policyやCASE03/04等の情報不足gatesを開いていない。

## 失敗記録と未完了を保持

- **FAIL: Windows native cold**。embedded PG18.4 beta系で6成功/2timeout。全8成功assert、max10/500msを既定integrationに保持。Linux成功で取り消していない。
- 初回の最終typecheckは固定配列indexの`string | undefined`でexit2だった。2箇所の非null型指定だけを追加し、生成JavaScriptの前後完全一致を確認した。初回diffcheckの9files/521警告は全て行末CRで、CR以外の末尾空白は0、厳密UTF-8読込も成功した。ソース改行とGit保存設定は変更せず、通常3空白規則に`cr-at-eol`を加えた一時指定で再確認した。初回FAIL receipt/logは書き換えず、修正後type0・変更file lint0・差分0を別receiptに記録した。
- **FAIL: operations巨大smoke英日**。元30秒と、追加60秒診断の両方がtimeout。後者はen60.319秒/ja60.348秒。複数BFF読取は2.5〜3.8秒、enはGROWTH開始52.5秒、jaはSCALE開始53.927秒となり、全workflowの累積で期限に到達した。各取得500msとは別条件。独立phaseの成功を元smoke成功に付け替えず、性能受入とも扱わない。
- 旧HTTP/HTTPS transport・CSRF fixture・setup CSS・test手順の各FAILを保存した。native起動失敗はbody0件、初期OAuthのserial skipは未実施と区別する。最終の選択group成功は、旧8件一括runや全CI成功を意味しない。
- OAuthのAPIRequestContextによるlogout代行はCSRF_REJECTED403になった。手動のguard header補完は行わず、通常browser POSTと実応答の観測へ修正した。相対Locationは実応答URLを基準に解決してURL全体を完全一致で検証する。本文長0の仮説はDB無し再現で成立せず、そのvalid=false記録も保持する。
- **BLOCKED: 実strict preflight**。既存NEXUS-SERVICEでの `scripts/production/bootstrap.mjs preflight app` は、資格情報を読み得ることを理由に自動承認レビューが実行前に拒否した。再試行・間接実行なし。独立したmetadata-only `diagnose app` は未設定とPowerShell RestrictedによるACL verifier停止を報告し、本番起動成功ではない。
- **BLOCKED: 正式Security Standard scan**。必須Security MCPが未提供。[security-scan SKILL.md](C:/Users/pc-ad/.codex/plugins/cache/openai-curated-remote/codex-security/0.1.32/skills/security-scan/SKILL.md) と [artifact-storage.md](C:/Users/pc-ad/.codex/plugins/cache/openai-curated-remote/codex-security/0.1.32/references/artifact-storage.md:7) に従い、scan ID/canonical artifactsを作成していない。通常reviewを正式scan完了と扱わない。

> If the required MCP is unavailable or the selected baseline is unsupported, report the blocker; do not fall back to shell-authored canonical files.

## 試験の隔離と片付け

画面試験は所有loopback TLS/proxyと隔離Chromiumを使用し、外部redirectを接続前に拒否する。OS DNS/proxy/truststore変更や証明書登録はしていない。実環境の資格ファイル・Docker credentialsは読まず、whitelist環境と合成鍵・認証だけを使った。ログ/JSONはcookie/state/code等を伏字にし、redactionの前後hashを記録した。最初の旧redactionはbefore hash未収録の制約を明記している。

最終のOAuth・設定・operations各groupで所有PID停止、3150..3155拒否、PGclient0、UUID/label/ID/image/mountに一致するcontainer/volume/CLI config、発行SHA一致の専用bootstrapとprofile/temp/config削除を確認した。fixtureのREADY receiptをCLOSEDへ書き換えず、外wrapperの停止証明を別記した。最後にreview済みhelperを1回実行し、合成TLS鍵・証明書2件を含む既知の所有一時物24件を削除した（exit0/complete=true/errors0、metadata再確認で残留0）。固定image cache・承認済みportable toolsと検証証跡は保持する。所有を確定できなかった過去shared bootstrapは指示どおり保持しており、PC全体の一時物削除とは主張しない。

17:24 UTCの一時切断はhash読取のCreateProcess前で、当時新mutating操作は未開始だった。再接続後に独立hash一致を確認して再開し、重複起動・不明結果の成功扱いはしていない。

## 次に本人操作・別途受入が必要な工程

- runtime秘密の安全な入力とprivate ACL、Operator本人grant/保持期間、運用サービス権限・起動方式、production DB初期化とbackup/restore受入。秘密はチャットに求めない。
- Discord application/callback origin設定、本人OAuth同意、実guild権限・実接続の確認。
- Cloudflare Tunnel認証・公開origin/DNS。同一originのNextだけを公開し、Operator・DBは公開しない。
- お名前.com既存サイトbackup、接続先/SFTP host検証、承認済みPUBLIC静的配布物の内容確認。個人住所・電話番号・秘密を無断公開しない。
- 実転送・世代切替・撤回/cache/期限の実証。FTPS driverはstrict pin未保証でclosed。WinSCP配置・合成stagingは実配信ではない。
- 長時間温度/回線/容量、再起動復帰・スリープ/停電、別媒体backup復元の実測。合成試験から本番の継続稼働を推定しない。

## 証跡

local task root: `C:/Users/pc-ad/Documents/Codex/2026-10-18/task`。

- PC: `alpha17-docker-install-result.json`、`alpha17-docker-engine-ready.json`。repoの[PC準備記録](alpha17-pc-setup-status.md)を参照。
- 接続: `alpha12-linux-pg-c2094cd0-d680-4b42-9d99-c7deec4264c2/{run,measurement}.json`。
- 分析8: `alpha17-core-run-38d0cfed-df16-4262-a715-bd4196f5857d/{run,recovered-assertions}.json`。Worker: `alpha17-core-run-017ad46b-88c3-47b6-b6d5-94425e1b14e9/run.json`。
- OAuth: `alpha17-screen-run-60cf81ee-edf9-4136-9743-51dc815759c1/run.json`。設定: `alpha17-screen-run-6cbd4c80-9a58-45d2-91ff-1ce6236dedf4/run.json`。
- operations独立phase: `alpha17-screen-run-44c1d0ea-e114-41b1-82f8-664225965db6/run.json`。全assert対応表: `alpha17-operations-phases-coverage.md`。旧60秒FAIL: `alpha17-screen-run-c069d52e-9871-406a-854f-921f1abb604b/run.json`。
- 画面の旧FAIL/制約/cleanup詳細: `alpha17-browser-validation-evidence.md`。CSS/build: `alpha17-setup-css-change.json`、`alpha17-verification-css-build/{build-provenance.json,next-build.log}`。
- 通常review: `alpha17-offline-security-review.md`、`alpha17-security-unit-results.json`。正式scan artifactsではない。
- 初回最終check FAIL: `alpha17-integrated-final-validation.json`、`alpha17-integrated-final-*.log`。修正後check: `alpha17-integrated-final-repair-validation.json`、`alpha17-integrated-repair-*.log`。型のみ修正/改行診断: `alpha17-types-only-repair.json`、`alpha17-line-ending-diagnosis.json`。
- 入口文書: `alpha17-docs-entry-update.json`。最終TLS等cleanup: `alpha17-verification-final-cleanup.json`。
