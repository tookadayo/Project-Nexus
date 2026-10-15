# alpha15 Windows 資格情報検証の記録

確認日: 2026-10-15。対象は既存の `D:\Project Nexus`。本番資格情報、実行ポリシー、ファイルの実 ACL は変更していない。

## 元の失敗と原因

既存試験 `tests/unit/alpha12-configuration.test.ts` の **stores a salted operator hash and accepts only an owner-private regular credential file** は、81 行目の次の子プロセス起動で失敗している。

```text
powershell.exe -NoProfile -File D:\Project Nexus\scripts\operator-acl.ps1 -Path <OS temporary directory>\nexus-synthetic-operator-*\credentials.json
```

実際にはパスを個別の引数として渡している。既存ログ `.local/alpha15-latest-unit.log` の 23–31 行に非ゼロ終了と該当行が残っている。試験が `stdio: "ignore"` を指定しているため、そのログには PowerShell の標準エラー本文はない。記録されていない例外型やエラー全文は推定していない。今回、ブロックされた試験・スクリプトを再実行していない。

読み取り専用の `powershell.exe -NoLogo -NoProfile -NonInteractive -Command Get-ExecutionPolicy` で、**試験が起動する Windows PowerShell の実効値は `Restricted`** と確認した。`-List` の MachinePolicy / UserPolicy / Process / CurrentUser / LocalMachine はすべて `Undefined`。一方、ツールの現在の PowerShell ホストは LocalMachine が `RemoteSigned`。ホスト側の値だけでは、試験が固定名で起動する別の `powershell.exe` の動作を説明できない。

Microsoft の説明では、Windows クライアントで全スコープが `Undefined` の場合は `Restricted` が実効値となり、個別コマンドは許可してもスクリプトファイルは実行しない。この確認値は既存の `-File` 失敗を説明する。[Microsoft: about_Execution_Policies](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1#powershell-execution-policies)

`readOperatorCredentials` は通常ファイル・シンボリックリンクの検査を先に行い、Windows では `operator-acl.ps1 -Verify` が成功した場合だけ JSON を読む。`-Verify` が非ゼロ終了した場合は `OPERATOR_CREDENTIALS_UNSAFE` で停止する。元の試験は一時ファイルに対する ACL 設定モードを先に呼ぶため、今回はその入口で止まっており、所有者限定ファイルの受理まで到達していない。Windows の `writeFile(..., {mode: 0o600})` だけを、所有者限定 ACL の証拠として扱わない。

## 安全な代替確認

新規試験 `tests/unit/alpha15-windows-credential-alternatives.test.ts` を既存試験と分けて追加した。子プロセス境界はテスト内で完全にモックし、ブロックされた `.ps1` を読み込まない。実際の資格情報として使えない固定プレースホルダー JSON は専用の一時ディレクトリだけで使用し、試験後に個別削除する。

| 確認 | 証明する範囲 |
| --- | --- |
| メモリ内の合成パスワードから独立した salt / hash / epoch / CSRF key を生成し、既存の scrypt パラメーターで正誤を照合 | ハッシュ生成、同一入力への salt の独立性、平文非保存。生成物は保存しない |
| 短すぎる・長すぎる入力を拒否 | パスワード長の検証 |
| 実ディレクトリと既存依存関係 junction を拒否し、子プロセス呼び出し 0 回を確認 | 実際の `lstat` による通常ファイル／再解析点の入口検査 |
| 検証器の拒否・タイムアウトを模擬 | Node 側が `-Verify` の失敗を受理に変えず停止すること。実 ACL の判定は模擬 |
| 検証器の成功を模擬した後に固定 JSON を解析し、余分なキーと不正な hash を拒否 | 検証器成功後の厳密な形式検証。実ファイルの安全性を受理できたという証明ではない |

加えて、`.NET RawSecurityDescriptor` に合成 SDDL をメモリ上で渡し、次の **5 ケース**の解析結果を確認した。実ファイルに対して記述子を適用していない。元のスクリプト本体をコマンド文字列や ScriptBlock にして実行していない。

- 保護された DACL と許可済みの合成人物 / SYSTEM / Administrators。
- 継承保護がない DACL。
- Everyone に対する想定外の Allow。
- 想定外の所有者。
- Everyone の Deny がアクセス許可の追加にならないこと。

これらは記述子の構造と期待する検査条件の補助確認であり、`operator-acl.ps1` 自体の実行成功・実 ACL 検証を置き換えない。

## 結果と未検証

合成単体試験 **7 件**とメモリ内記述子 **5 ケース**が成功した。証跡は `.local/alpha15-windows-verification.log`、単体試験の原本出力は `.local/alpha15-windows-alternatives-unit.log`。

元の owner-private regular credential file 試験は、**成功に変更していない**。この PC での実 ACL の設定、実 ACL 検証器による所有者限定の通常ファイルの受理、実 ACL だけを理由にした通常ファイルの拒否は未検証として残る。これらを確認するには、既存ポリシーのままで動作する正式な検証経路について別途判断が必要である。

今回、`Set-ExecutionPolicy`、`-ExecutionPolicy Bypass`、`Unblock-File`、`Set-Acl`、`icacls`、本番資格情報の生成・読み書き、セキュリティ設定変更を行っていない。既存の本番検証処理と元の失敗試験も変更していない。
