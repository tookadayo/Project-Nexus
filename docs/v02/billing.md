# Plans, entitlements and MTM

料金・機能の実行時source of truthは`packages/settings/src/entitlements.ts`です。価格は今回の製品仕様の設定値であり、決済を実行したものではありません。

| Plan | 月額USD | 含むMTM | Guild上限の定義 |
| --- | ---: | ---: | ---: |
| Free | 0 | 250 | 1 |
| Starter | 15 | 1,000 | 1 |
| Growth | 49 | 5,000 | 1 |
| Scale | 149 | 25,000 | 5 |
| Enterprise | 個別 | 個別 | 100 |

Freeは既定の基本Activationを初回設定でき、custom ActivationはStarter以上、施策・実験はGrowth以上です。公開時と実行時に同じEntitlementServiceで確認します。expired/past_dueの契約はFreeへfail closedします。保存済み設定を消すことはありません。

MTMはそのUTC月に追跡したguild限定member HMACのdistinct数です。再加入、signal重複、複数活動を重複請求しません。使用数、含有枠、120% soft limit、当月予測を表示します。自動超過課金はありません。soft limitは表示値であり、観測や安全処理を遮断しません。

`BillingProvider`はcheckout / subscription取得 / cancel / entitlement検証のinterfaceです。Stripe / Discord Premium Appsは未設定adapterとして明示的に失敗します。外部決済、webhook同期、カード情報、実請求はP1です。guild上限の組織横断執行も今後の組織管理で扱います。

開発・design partner向け契約付与は運用者がDB接続を管理して行います。一般ユーザーの設定APIからプランを書き換える機能はありません。プラン変更を行う場合は対象guild、有効期限、承認者、理由を別途運用記録に残してください。テストでは独立したfixture DBだけにGrowthを付与しています。
