# alpha15 日時補完の実装・検証記録

2026-10-16。承認仕様は [設計記録](alpha15-datetime-approved-20261016.md)。既存 `D:\Project Nexus`、branch `codex/alpha15-web-blocks`、HEAD `e37fd32d4f7bcfabcc34d3a682de1a8e5910a92d` で継続した。指定モデル・思考量は GPT-6.1 Sol / Ultra。Git書込み、別チェックアウト、本番操作、実Discord操作、認証情報・OS設定変更は行っていない。

## 実装結果

- DateOnlyは固定ISO暦、LocalTimeは分/秒の明示descriptorと変換に対応。ISO直入力、年月移動、今日、カレンダー、キーボード操作を共通化した。
- 新規の小数秒入力をUI・定義保存・手動入力・模擬入力境界で拒否する。旧Instantの小数秒、Duration、内部時計、Waitは保持する。旧値の全文表示、明示置換と取消を用意した。
- DateRangeは両日を含み同日1日。一般InstantRange v2は空区間を表現し、旧rangeと予約窓の非空契約を維持する。翌日指定・曜日・地域・分秒精度を持つ時間帯窓の値ブロックを追加した。
- 単発DSTの欠落・重複、日境界、歴史的な秒offset、月31日のskip、月末、年次2月29日に対応する。次5回の地域日時・offset・Instantと、地域変更の確認/取消を表示する。
- 実保存guild地域、旧互換既定値、未保存、取得失敗を区別する。Intl候補は明示採用/確認を要し、保存済み予約地域を上書きしない。地域設定の確認は既存Setup保存経路を使う。
- 認可済み同一guild・Flow・Revisionの不変値だけを固定値として保持する。固定値keyはobject順に依存しない。予定受理時の発生回・世代・Revision・地域・日時・確定Instantを既存Runの最小状態へ保持する。世代照合・一意発生回・同一TXを維持する。

## 今回の限定試験

以下は別々の限定実行を重複なく集計した結果であり、全件を一つの最終コマンドで再実行したという意味ではない。前回の1011/363/137や受け入れ188/192を今回の実績として再計上・書換えしていない。

| 区分 | 新規 | 既存関連 | 合計 |
|---|---:|---:|---:|
| 単体 | 86 | 123 | 209 |
| 隔離DB/API | 24 | 43 | 67 |
| ブラウザーUI | 30 | 3 | 33 |

型チェック、対象ESLint、変更範囲の差分空白検査、Next 16.3.5のWeb buildは成功。UIは日英・320px、ISO不正値、保存/再読込/Undo、取消/Escape、候補確認、取得失敗、地域変更、年次5回、秒精度と翌日窓を確認した。自作fixtureの画面を目視した。元提供画像の再現確認や実Discordの成功を意味しない。

主な新規試験と設計IDの対応:

| 試験ファイル | 主な対応 |
|---|---|
| `tests/unit/alpha15-datetime-contract-v2.test.ts` | DT01/02/03/04/05/06/07/11、R03の日時比較部分 |
| `tests/unit/alpha15-datetime-schedule-v2.test.ts` | DT04/05/06/07/08/09 |
| `tests/unit/alpha15-datetime-controls.test.ts` | DT01/02/03/13 |
| `tests/unit/alpha15-datetime-edit.test.ts` | DT03/11、入れ子・保持key・新規精度境界 |
| `tests/unit/alpha15-datetime-simulation-trust.test.ts` | DT03/11、内部抽選と新規mockの信頼分離 |
| `tests/unit/alpha15-datetime-setup.test.ts` | DT10 |
| `tests/integration/alpha15-datetime-schedule-v2.test.ts` | DT03/11/12、発生回snapshot・再開・競合 |
| `tests/integration/alpha15-datetime-service.test.ts` | DT03/10/11/12、認可・API入力境界 |
| `tests/integration/alpha15-datetime-setup.test.ts` | DT10、保存地域と候補確認 |
| `tests/e2e/alpha15-datetime-{controls,setup,v2}.spec.ts` | DT01/02/03/04/05/06/08/09/10/13 |

生の結果、実行履歴、最終hashは `.local/alpha15-datetime-20261016/final-evidence.json`。当該フォルダーはローカル証拠でありGit管理対象外。core/setup/controlsそれぞれのproofと、個別Vitest/Playwright JSONを含む。

初回sandboxでSSR一時ファイル、Postgres loopback、Next junctionの制限があった。製品assertion未実行の障害を成功に数えず、同じローカル試験を許可されたhost経路で再実行した。UI期待操作と新DBfixtureのcheckpoint期待値の誤りは修正前結果も保存した。既存イベント回帰は模擬時刻に新規msを渡していたfixture2値だけを秒へ変更し、実イベント精度・assertionは維持して15件を再確認した。既存Setup UIも地域変更後の確認操作4行を新仕様へ合わせ、元byteを保存した。

## 保護と残る範囲

開始時は前回158パス、元変更34項目、旧資料6件、正式資料17件が一致した。今回変更した既存ファイルは変更前byteを保存し、前回158パスの変更分は開始hashと照合した。workerの1ファイルは正確な1箇所の逆変換で旧byteを復元し、開始hash一致を確認したことを別記録した。Nextが自動更新する`next-env.d.ts`は検証済み元byteへ戻した。Git indexと保護対象の最終照合は上記機械証拠を参照。

保存済み確定Instant・評価済み変数・開始/Wait/予定受理時刻は保持する。未評価のDateRange変換、表示地域変更、暦日加算、時間帯窓解決には現在のIntlを使う。**全日時演算を旧TZ版へ固定する保証は未実装**。それを要求する場合のTZデータ保持や未評価計算停止は追加設計判断として親へ報告する。Choiceのordinalは今回の日時比較と別の未完了項目のままで、旧受け入れ表を一括で完了へ変更していない。

Scratch風の値入力は型の合うブロックを再帰的に入れ子にできるが無限ではない。既存のUI深さ制限、式depth 8 / root tree 128 nodes、Run評価5000、statement 100、展開1000などの上限を維持した。今回これらの上限変更や全境界の再試験は行っていない。
