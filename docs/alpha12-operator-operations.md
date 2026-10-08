# alpha12 ローカル運営手順

この手順は所有者が後で、承認された環境に対して行うためのものです。
alpha12の開発では、実パスワード・鍵・OAuth grantを作成していません。
本番migration、外部設定、公開、実データ操作は実施していません。
開発はMacBook、将来のホストはWindows 11です。Windows実機の起動・ACL・
停止確認はNOT RUNです。サービス登録やネットワーク変更は含みません。

## 初回設定

1. Node.js 24、repo指定のpnpm、承認されたPostgreSQL/Redis環境を確認します。
   対象DBが試験用か本番か不明なまま接続・migrationを行いません。
2. 別途承認された更新では、Gateway・worker・公開Web/APIを停止し、同じ
   alpha12版でmigration 051まで適用します。alpha11 workerとの混在では
   招待制限を保証できません。運営プロセスは自動migrationしません。
3. 所有者が保護したローカル環境へ既存の秘密を設定します。
   `NEXUS_SESSION_SECRET`は公開セッション用、運営credential fileは運営用、
   `NEXUS_TOMBSTONE_KEY`は削除記録の暗号化用です。共有・チャット貼付け・
   Git登録・ログ出力をしません。DBと同じbackupへ平文鍵を同梱しません。
4. `NEXUS_HOSTED_BETA=on`を設定します。productionで`off`は拒否されます。
   nonproductionの`off`は既存の合成fixture向けの互換設定です。
5. repo rootで所有者が直接ローカルTTYを開き、次を実行します。
   パスワードをコマンド引数や環境変数へ書かず、非表示の入力と再入力を行います。

```powershell
corepack pnpm operator:password --init
```

14文字以上・最大1024文字のパスワードを所有者が選びます。既定値はありません。
保存先は既定で`.local/operator/credentials.json`、
`NEXUS_OPERATOR_CREDENTIALS`で所有者の保護した場所へ変更できます。
POSIXではdirectory 700 / file 600で、symlinkや広い権限を拒否します。
Windowsでは同梱の`operator-acl.ps1`が継承を外し、現在の所有者・SYSTEM・
Administratorsだけに許可を限定します。読取り時にもACLを検証します。
ACLの実機適合とバックアップ側の権限は公開前に確認してください。

初回設定画面は手順の案内だけです。ブラウザーから初期秘密やresetを設定する
APIはありません。CLIは認証epochを更新し、DBが使える場合は全運営セッション
の永続失効と監査も行います。DBの失効記録が一時的に書けなくても、古いepochの
セッションは運営プロセスのファイル照合で拒否されます。その場合はDB復旧後に
同じローカルreset手順を完了して監査・失効処理を確認します。

## 起動と停止

repo rootから別のターミナルで起動します。

```powershell
corepack pnpm operator
```

Windowsでは`START NEXUS OPERATOR.cmd`も同じforeground処理を開きます。
ブラウザーで`http://127.0.0.1:3210`を開きます。`localhost`やLANアドレスは
許可先ではありません。ポート変更は`NEXUS_OPERATOR_PORT`、1024–65535の
範囲で、公開Web/API/Interactionのポートと重複できません。bind先を広げる
設定はありません。

停止は運営ターミナルのCtrl+Cです。`START NEXUS.cmd`の公開構成へ運営を
追加していません。通常のSTOP/STATUSが運営プロセスまで管理するとは扱わず、
運営ターミナルの終了とlistener消失を実機で確認します。Tunnel・proxy・
ポート転送の宛先へ運営ポートを追加してはいけません。既存のTunnel設定は
この実装では変更していません。

ローカルHTTPでは専用CookieをHttpOnly / SameSite=Strict / `/operator` /
Domainなしで扱います。Secure=falseはこのloopback限定HTTPの選択です。
公開HTTPS Cookieの設定は下げません。別ポートだけではCookieは分離されない
ため、公開OAuth Cookieではログインできません。Host/Origin/CSRF違反、
proxyヘッダー、外部IP、GETによる変更は拒否されます。

## 日常操作

画面上でJA/ENを選択できます。日時はUTCです。登録と状態変更には理由が必要で、
監査には要求ID、対象、結果と最小限の変更前後を残します。理由に秘密や本文を
入力しないでください。

| 操作                    | 確認すること・結果                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 招待候補を追加          | DiscordサーバーのGuild IDとBot参加・閲覧権限を照合。名前だけで対象を決めません。登録だけでは収集しません。               |
| 有効化                  | 初めて成功した時点から30日。Bot、現在状態、grantと10件上限をDBで確認します。11件目の例外はありません。                   |
| 一時停止                | 新しい通常利用を停止。古い分析を取消し、未使用予約を一度だけ解放。履歴の権限・保持条件と削除専用経路は維持します。       |
| 再開                    | 元の期限を維持。期限切れなら先に延長し、別途再開。空き枠とBotを再照合します。                                            |
| 期限延長                | UTC日時と変更前後を確認。一度に最大30日を加算。期限切れの延長だけでは再開しません。                                      |
| 利用上限                | 月1–20、日1–3、Guild待機1–2、全体待機1–10。全体は有効Guildの最小設定が適用されます。0/nullによる無制限設定はありません。 |
| 招待を取り消す          | 参加許可を終了。保持権限を一律に仮定せず、今回の実装は速やかな対象Guild削除を開始します。                                |
| 連携を解除 / データ削除 | 停止とは別の操作。通常利用・対象grant/APIアクセスを失効し、原データ・派生物・queueの消去へ進みます。30日待ちません。     |
| 削除を再試行            | PENDING/ERASEDの限定ジョブのみ。対象・状態番号・理由を確認して試行期限を再設定します。収集やgrantは再開しません。        |

確認画面を開いてから状態が変わると操作は拒否されます。最新状態を読み込み、
対象と影響を再確認してください。再送は同じ要求IDの結果を取得し、二重付与・
二重解放しません。概要の「削除の要対応」から該当Guildへ移動できます。
DBや現在権限が確認できない状態を正常扱いして新しい仕事を許可しません。

停止が返るまで、既に許可された短い外部処理の完了を待つ場合があります。
停止後に届く旧世代の仕事は拒否されます。外部へ確定済みの送信をrollbackした
とは扱いません。成否不明な外部作用は既存のUNKNOWN/照合経路で扱い、新規送信
として再実行しません。削除ジョブは通常のBeta停止とは独立して継続します。

## ログインと復旧

既定は無操作15分・絶対8時間。再起動後もDBの期限・失効を参照します。
失敗は単一運営アカウントで15分に5回まで。永久lockではありません。
画面を再読込みしてCSRFを更新し、抑制窓の経過後に再試行します。
短いsession期限、少ない失敗許容、長い抑制窓は環境設定で適用できます。

パスワード忘れ・侵害疑いは所有者がホスト上で実行します。

```powershell
corepack pnpm operator:password --reset
```

これで全運営sessionが失効します。公開OAuthとは別のため公開sessionまで一括
失効しません。ファイル破損・不正ACLでは、安全側に運営ログインを拒否します。
所有者がプロセスを止め、正しいOS所有権・保護directoryを確認し、壊れたfileを
保護したローカル場所へ退避して`--init`で復旧できます。旧epochは再利用しません。
未認証Web reset、チャット経由のパスワード受け渡しはありません。

公開ダッシュボードはDiscord OAuth、無操作12時間・絶対7日が既定です。
access token期限から必要なrefreshを行い、失敗・撤回・不明なrotationは再ログイン
を案内します。refresh tokenの寿命を固定日数で仮定しません。通常Logoutはその
sessionだけの永続失効です。「自分のDiscord接続を解除」はその人の全public
session/tokenを失効し、provider revocationを一度だけ試みます。provider側の
結果が不明なら画面の案内に従いDiscord Authorized Appsで確認します。
他の管理者のGuild権限・grantを自動削除しません。

## 削除・保持とバックアップ

削除の段階は消去待ち(PENDING)、DB消去済みでqueue消去待ち(ERASED)、完了(DONE)
です。自動再試行は最大5回かつ受付から1日、30秒から最大1時間のbackoffです。
終了した試行を無制限に回しません。要対応を所有者が調査し、対象を確認して
ローカル画面から再試行します。この数値は検証済みの削除SLAではありません。

日々の既存purgeは通常利用の停止中も動作します。raw/detailの7/14/30日、
aggregateと現行entitlementの短い期限を維持します。終了後最大30日の履歴猶予
は既存データを保持できる場合だけで、rawを60日残すルールは追加しません。

削除記録の暗号化exportは、所有者の独立した`NEXUS_TOMBSTONE_KEY`を用います。
body/name/token/復元可能なmember IDは含めず、Guild scopeとmember lookup HMACを
最小限保存します。以下は後日の承認済みbackup/restore作業用です。

```powershell
corepack pnpm operator:tombstones --export <new-protected-file>
```

新しいファイルを作る方式で既存archiveは上書きしません。backupの直前と、
新しい削除の後に最新archiveを保護した別媒体へ保管します。DBだけを古いbackup
に戻してはいけません。exportは自動off-host複製ではありません。最新削除記録を
失っていない証拠がない復元はNO GOです。継続的な記録保全とbackup失効・鍵権限の
実環境運用をalpha14–15で検証し、それまでは公開可と判断しません。

offline復元ではGateway・全outbound・公開受付を閉じたまま、対応鍵と051 schemaを
確認し、最新の保護archiveを適用します。`NEXUS_RESTORE_OFFLINE=1`は実際に
サービスが閉じていることを所有者が確認した上で設定します。

```powershell
corepack pnpm operator:tombstones --apply <latest-protected-file>
```

全復元sessionを失効し、Guild消去とmember消去を再適用します。memberの対応identity
や鍵が不足した場合は成功扱いせず、offlineを維持します。鍵やarchiveが不明な
ままskipして受付を再開しません。外部作用はDBrestoreでは取り消せません。
その後の[復元受入手順](backup-restore-operations.md)と所有者判断が必要です。

## 公開前に必要な証拠

Windows 11のforeground/TTY/ACL/listener停止、公開側のroute一覧とTunnel/proxy
宛先、real OAuth、実Discord権限、real Redis scrub、保持・削除監視、最新tombstone
を含むencrypted off-host restore、実測capacity、SHOWCASEと40P01を確認します。
初回は別途GO判断後に1 Guildから段階的に開始します。10 Guild同時運用の性能
保証ではありません。Live決済、Purchase Pack販売、商用機能や権限の追加は
この運営プロセスから行いません。
