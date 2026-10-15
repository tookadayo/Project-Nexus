# alpha15 外部受入・追加判断に必要なもの

確認日: 2026-10-15。コードの未実装、追加採用の判断、実環境での受入は別である。
ローカルの合成Windows試験は、実Discord・OAuth・公開HTTPS・バックアップの
受入結果ではない。この資料自体はデプロイ、本番変更、認証情報生成、
セキュリティ設定変更を許可しない。

## 実環境で確認する全7領域

| 領域 | 必要な入力・管理された検証環境 | 確認すること／現在の制約 |
| --- | --- | --- |
| Discord導入・OAuth | 認可された使い捨てテストguild、同意済みの操作担当者、既存Application ID、登録済み公開origin/callback。秘密は既存の秘密管理から参照し、会話や報告へ貼らない。 | Guild InstallとUser Install、現在の所属・権限、callback/stateの再利用拒否、Bot参加、既存設定の維持、初回導入案内、安全な宛先がない場合のWeb継続。実導入は未実施。 |
| 通常ロール操作 | 明示した通常ロール・対象allowlist、既存のBot/requester/approver階層。Gateway/API/workerが同じ現在coverage proofを共有できる構成。 | 全channelの可視性証拠、審査・承認・送信間の権限変更、不可視channel、deny除去による権限増加、保護ロール、拒否・期限切れ、429・UNKNOWN・再送なし。別プロセス間で揮発proofを共有する基盤は未実装で、その構成ではロール操作を拒否する。Administrator付与は求めない。 |
| 公開Web・お名前.com | 既存HTTPS origin、reverse proxyの経路、実際のお名前.com契約の配置構成、Windows上の動的Web/API経路。運営者画面は既存loopback境界に置く。 | deep link、OAuthからの復帰、Cookie/Origin/Host、公開画面とローカル運営画面の分離、再起動・再接続。静的ページの表示だけで設定保存の成功としない。実配置の適合確認は未実施。 |
| バックアップ・削除 | 既存暗号化backupの一覧・寿命、最新の保護済み削除tombstone、対応するkey版、隔離したoffline復元先。 | snapshot/PITR/exportなど全回復コピーが最大7日。最新の追加migrationを適用してから最新削除情報を反映。復元したsession・Run・待機・event・buttonを再利用せず、member/guild削除を再適用。合成DB試験は実backup復元drillの代わりではない。 |
| 利用条件・資格 | 運営者の既存eligibility手続、採用する場合の版付き利用規約同意設計。 | 招待やDiscord管理資格を年齢・成年・契約能力の証明にしない。新たな生年月日、身分証、個人申告、保持目的は追加していない。必要な運営判断を別途行う。 |
| アクセシビリティ・容量 | 実Windowsスクリーンリーダー、IME/touch機器、現在の有限枠内で代表的な合成利用を試す環境。 | focus/読み上げ、200%倍率、長い日英、burst admission、停止・再起動後の復旧。少数の算術測定とブラウザfixtureは、実Discord/API遅延や本番容量を保証しない。 |
| 運営者credential ACL | 現在のWindows PowerShellポリシーで正式に動く検証経路。 | owner-privateな実regular fileの受入は未確認。子Windows PowerShellがRestrictedで元のACLスクリプトを拒否する。合成7ケース・メモリ内descriptor5ケースは代替確認に限る。policy回避・ACL変更は行わない。[Windows検証記録](alpha15-windows-verification.md)。 |

## 追加の採用契約が必要な候補

66機能族／74具体形は候補の整理であり全件採用ではない。フォーム、投稿metadata、
追加Gatewayイベント、集計窓、EventRefを使う追随予約、追加Discord操作、
V2・Modal・添付・ユーザー作成メッセージ部品、対象状態の追加読取りは、
操作／起点ごとの登録schema、現在認可、対象、用途、必要最小項目、保持、
失敗／UNKNOWN／重複防止を決めてから個別に採用する。
一般的なAPI許可やIntentの存在だけで、この採用を済ませたとは扱わない。
全IDと部分提供の境界は[設計・実装対応表](alpha15-design-coverage.md)に記載する。

Runをまたぐ可変変数、外部HTTP送信／外部イベント受信は今回見送り。
本文の継続収集・人物評価・任意コード・無限loop・self-bot、BAN/kick/大量削除、
管理者権限付与を追加しない。ルールベースAIはalpha16に留保する。

## 新Scratch設計との切り分け

専用multi-elif、全条件・算術・値ソケットの形と直接配置UIは別途レビュー待ちで、
今回拡張しない。現在のtrue/false/unknownとfalse側に入れる順序付きifは維持する。
既存仕様に定義されたイベント待機、有界再確認、型付き結果、日時や一覧の不足を、
一律に「新Scratch待ち」へ置き換えない。実装依存と追加判断を対応表で区別する。

ローカルの実装・試験結果と修正済み失敗は[実装・検証記録](alpha15-implementation.md)
を参照する。実環境の7領域は、ローカルの成功件数へ加算しない。
