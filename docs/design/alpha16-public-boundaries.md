# alpha16 A配置・公開境界と静的成果物

2026-10-16。N16-03 / N16-12 の実装記録。基準は `35b0d22398c1463e2c88d7f49d960fa8a065002a`。本書は構造・コードの説明であり、試験合格、実公開、ホスティング能力確認を表さない。

## 正本とコードの対応

最新の開始承認と、[契約正本](alpha16-source/NEXUS_alpha16_contract_decisions.md)・[移行計画](alpha16-source/NEXUS_alpha16_migration_plan.md)を優先する。IA/IA追補、IB、IDの提案URLを、既存実routeへ対応付ける。VA/VB/VIの後続訂正を優先し、初期監査の全面API橋渡しは採用しない。原文37ファイルは変更していない。

|契約|実装|境界|
|---|---|---|
|AUTH-01/02/03、PUB-01、N16-03|`apps/web/app/auth/session.ts`、`server-access.ts`、`public-session-store.ts`、既存DB session|PC上Next/BFFを維持。Discord現在ID・guild所属・権限をserverで確認。cookieはhost-only、HttpOnly、HTTPS時Secure、SameSite=Lax。実OAuth callbackは既存GET/state方式を保持|
|ID 1.2 / 1.3|`auth/public-boundary.ts`、`apps/web/proxy.ts`|canonical Hostを設定originと照合。Forwarded情報からcanonical URLを作らない。未知route・内部API・Operator・debugは拒否。既存実routeと新Rule BFFだけを明示登録|
|Browser変更のCSRF|`auth/csrf.ts`、`csrf-client.ts`、`csrf-bridge.tsx`、root layout|signed double-submit tokenを現在のopaque sessionへ束縛。未認証の既存checkout/localeはHttpOnly匿名browser binding。cookie/headerまたはnative form fieldとOrigin/Fetch Metadataを両方確認。GETのguild選択は確認表示、変更はPOST|
|IBの内部署名|`security/public-api.ts`、`auth/api-proof.ts`、既存各caller|HMAC v2へmethod/path/canonical query/canonical JSON body hash/keyId/nonce/actor/guild/session/発行期限を束縛。v1 fallbackなし。nonceを既存session行lock内で一度だけ消費。既存30秒proof寿命で拒否・pruneしsession削除と同時消去|
|外部callback|既存`auth/callback`、`billing/webhooks/stripe`|exact route/methodだけを公開。OAuth state、Stripe adapter署名は各handlerで必須。Browser sessionをprovider認証へ流用しない|
|PUB-07|既存別loopback Operator|公開NextからOperatorへproxyしない。Operator listener・step-up・専用権限は別担当。公開Operationsはguild利用者用の別機能|
|ANN-01 / PUB-06 / N16-12|`operations/publication.ts`、`operations/alpha16-publication.ts`、migration063|既存immutable source revisionを維持。read-only PUBLIC projection、世代/hash/manifest/head CAS、撤回世代・source版の防壁、admission後UNKNOWN非再送。反映確認後にだけPC正本を公開状態へ移す|
|STATUS-01|`presentation/alpha16-publication.ts`|PC/Tunnel/Worker/Discord outboundを別fieldに限定。generatedAt/validUntil・観測時刻・品質を検証。期限切れ、未来、欠測、staleはUNKNOWN。script無効時もUNKNOWN|
|LEGAL-01 / CONTACT-01|同pure moduleとstatic renderer|LegalはAPPROVED_PUBLICのallowlistだけ。承認版が無ければリンク・本文を出さず承認待ちと表示。ContactはUNAVAILABLEだけを表現し送信form・成功表示を作らない|

内部proofはAPI受付で一度だけ消費する。Bot導入前 `/web-setup/status` のDiscord403/404 fallbackは、同requestの `publicApiContext.onValidatedIdentity` から受けた検証済みidentityだけをhandlerローカルに保持し、nonceを二度消費しない。新request・別guild・新bodyへこの状態を共有せず、fallbackでも現在OAuth guild管理権限・Bot不存在・Beta admissionをread-onlyで再確認する。一般mutationへこのfallbackを広げない。

## 配置と通信

公式Web成果物は `scripts/build-official-static.ts` が、承認済み公開JSONだけから新しいgeneration directoryへ排他的に作る。Next実行、cookies/headers、DB、Operator、認証情報、環境変数の読取りを必要としない。HTML/CSS/JSとpublic manifestだけを出力し、各assetは内容hashを含む名前にする。スクリプトはローカルの準備だけを行い、配信・active pointer切替を行わない。

公式top/product/demo/pricingを日本語 `/.../` と英語 `/en/.../` へ生成し、cookieを使わず対応言語への通常linkで切り替える。`version.json` と各footerは公開説明のソース版・生成世代を区別し、製品の公開版は明示の承認済みrelease入力がある場合だけ表示する。releaseを未確認のままruntimeの現行版と推測しない。

demoは固定の合成観測だけで7/30日切替・リセット・測定根拠を示す。欠測と0を区別し、API呼出し・保存・analysis利用枠消費なし。価格入力はNEXUS dynamic catalogから既に投影された公開allowlistだけで、provider ID/secret/曖昧mapping/候補価格は受け付けない。snapshot版・観測・期限を表示し、期限外/未来/未公開/欠測は価格payloadを生成物へコピーしない。有効な価格もbrowserの時計確認までは隠し、期限到来で消去する。購入formは生成せず、PC側動的canonical `/pricing` で現在の条件を再確認する。価格や販売を実際に有効化していない。

公開Statusは同じstatic hostingの `/status/status.json` だけをread-only pollingし、認証cookieを送らない。観測失敗/期限切れ/未来/不正形/品質不明はUNKNOWNへ落とす。PC/Tunnel/Worker/outboundは別fieldのまま、実probeの存在を捏造しない。

Browser → app hostname → Tunnel → PC Next/BFF → PC domainまたは内部API/DB。既存Nextのserver-side DB処理を維持する。Browser用成果物へDB接続文字列、内部API URL、署名鍵、Operator URL、credentialを出さない。Discord Gateway/RESTはPCから直接outboundで、Tunnel断だけをDiscord操作UNKNOWNの理由にしない。

実domain値は設定していない。設計例の `www.nexus.example` / `app.nexus.example` はfixtureだけである。公式originとapp originは別のHTTPS originとして検証する。内部APIの旧scoped-bearer-only GETは内部互換経路のまま公開allowlistへ含めない。Tunnelが内部APIを公開しないことはalpha17の実設定確認が必要。

## Publication lifecycle

既存`official_publications` / `official_publication_revisions`が原稿正本。063のhead/manifestは本文を複製せず、source版・source row版・generation・hash・状態・期限だけを保存する。準備 → DB admission commit → verified publisherのconditional generation switch → hash/read-back確認 → ACTIVEとsource公開状態の同一transaction確定を分離する。外部通信中はDB lockを保持しない。

古いgeneration、別source、source版の差し替え、hash不一致を拒否する。withdrawは新しいgenerationを確定しactive参照を外す。同じ撤回済みsource版をgenerationだけ増やして再公開しない。新しい明示改訂が必要である。更新中に失敗した場合は旧ACTIVEを維持する。admission後の応答不明はUNKNOWNを保持し再dispatchせず、read-onlyのgeneration/hash照合だけを許可する。

staged/admitted世代が未解決の間は既存原稿writerも同じpublication lock下でsource変更を拒否する。外部反映中に原稿だけ別版へ変えて、確定結果を不整合にしない。

`OfficialPublications.prepareChange` / `changeInTransaction`、`prepareLegalChange` / `saveLegalInTransaction`はOperatorのreviewed/step-up transactionに接続するためのnative adapterである。既存のtyped allowlist、immutable原稿、CAS、request fingerprint、auditを維持する。現時点のpublish/withdrawは未設定publisherをDB-only成功にしないため503で閉じる。draft保存・破棄、Legal設定保存の実行権限・保持承認・step-upはOperator側が検査する。

## 有効化前のゲート

- 実配信先のatomic switch、conditional generation、hash読戻し、撤回時のorigin route除外、cache挙動は未確認。実adapterを同梱せず`PUBLIC_PUBLISH_DISABLED` / `PUBLISHER_CAPABILITY_UNVERIFIED`を維持する。
- PUBLICATION_HISTORYは目的別の有限保持とenforcement確認が必要。未承認のまま新manifest/headを永続化しない。期限切れheadはfail-closedとしgeneration zeroへ再生成しない。期限後の安全な削除・remote generation照合と実cache消去能力は、実adapter/保持承認の一部として確認する。
- Legalの最終文面・運営者情報・公開承認、Contactの受付先・保持・実運用は未成立。完成・受付可能と表示しない。
- 実DNS、Tunnel ingress/listener、TLS、OAuth redirect実値、PC停止中の保持強制、公開artifact期限・世代switchをalpha17で確認する。新しい実資格情報・domain・DNS・Tunnel設定を生成/変更していない。
- nonceの有効期限判定は各requestで行い、期限済みentryの物理pruneは既存session maintenanceで行う。PC停止中の物理消去を保証したとは記録しない。

## 追加fixtureと未実施の検証

`tests/unit/alpha16-publication.test.ts`は公開allowlist、二言語、hash、世代/withdraw競合、status境界、未設定publisherの副作用前拒否を定義する。`alpha16-publication-boundaries.test.ts`は実route inventory、Host/Forwarded、callback分離、session束縛CSRF、body/query署名、v1拒否、nonce replay/期限を定義する。

`alpha16-publication-site.test.ts` はproduct/demo/価格/日英切替/文面・release版、無作用合成デモ、価格snapshot期限とprivate field拒否、Status独立pollingを追加する。`alpha16-analysis-bff.test.ts` と `alpha16-explore-crud.test.ts` はG2で発見した接続不足に対応する。経路・全機能の残件は [全機能mapping](alpha16-feature-mapping.md) へ記録する。

N16-14で旧 `alpha13-server-boundary` / `alpha15-setup-bff` / `alpha15-public-api` とAPI integration callerをv2の本文・query束縛へ更新した。`v02` fixtureは署名するpayloadと実際のinject payloadを一つの入力から構成する。`alpha15-runtime-api` はbody/query改変・nonce replay・正しいMACを持つv1拒否、`alpha15-web-setup` は導入前fallbackの一度だけconsume・別request/guild/権限失効を追加する。これも実行結果ではない。

現段階では試験、型チェック、lint、build、static generator、migrationを実行していない。G4後のrootの一括実行を待つ。実hosting、実Discord/Stripe、DNS/Tunnel、deployment、mergeは未実施。

既存`apps/web/next-env.d.ts`の未commit差分を維持する。着手時SHA256は `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000`。

## N16-06: manifest期限処理の追加接続（未実行）

`operations/alpha16-publication.ts` の `purgeExpiredStaticPublicationManifests(db, now, limit)` は063 manifest履歴専用の内部APIである。workerの `Alpha16RetentionMaintenance.tickGlobal()` に接続し、guild scope transactionを保持せず、既存publication advisory lockとrow lockの同一transactionで処理する。profileは既定無効で、startup deletion reconciliation・writer coverage・policy revision・明示batch設定が成立するまで呼び出さない。

`limit` は1～200。1回につき期限切れheadを最大limit件閉鎖し、期限切れmanifestを最大limit件物理削除する。撤回要求の返却も最大limit件で、残りの期限処理は `moreExpired` で返す。manifest本文は元から複製せず、削除対象は063のsource参照・hash・状態・期限等の履歴行のみである。052の既存immutable source本文をこのAPIから削除せず、既存の別保持目的をPUBLICATION_HISTORYへ混同しない。

ACTIVE・ADMITTED・UNKNOWN・active/pending参照・最後のgeneration境界・期限切れheadに関係する履歴を削除する場合は、先にheadをUNKNOWNへ閉じる。head期限は延長せず必要なら現在時刻へ短縮し、generation/withdrawn世代/source版/active/pendingの最小境界は残す。head欠落時も閉鎖済み・期限切れの境界だけを再構成し、OPENや新規sourceへ戻さない。stage/dispatch/preparedArtifactと旧PC public-news読取から期限切れsourceの再露出を防ぐ。

`withdrawalRequirements` の `WITHDRAW_OR_CONFIRM_ABSENCE` は実artifact撤回または不存在照合が必要という結果であり、外部送信や自動再試行の許可ではない。manifest削除後もheadから次tickに要求が残る。要求が1件でもある場合、またUNKNOWN/期限切れheadが残る場合は `ready: false` / `PUBLICATION_WITHDRAWAL_OR_SAFETY_UNRESOLVED` とする。historyを消したことを撤回成功・安全head保持期限の承認・運用準備完了へ読み替えない。

新unit4件とintegration5件のfixtureコードを `alpha16-publication-purge.test.ts` に追加した。期限切れACTIVE/ADMITTED、UNKNOWN/orphan、旧履歴のみの削除、batch分割、head期限先行、次tickでもready=false、旧PC public-news遮断を対象とする。これらを含め試験/type/lint/build/DB/generatorは未実行。実publisher/期限内cache撤回/PC停止中の保持強制/独立安全headの期限と回復手順は未検証または未確定であり、profile activationとG4は引き続きblockedである。

### 後続074: 有限の独立withdrawal安全root（上記063単独記述より優先）

後続の安全state実装は `PUBLICATION_HISTORY` と独立 `PUBLICATION_WITHDRAWAL` の承認・有限期限を分離した。`IndependentSafetyAuthority` の現在世代・完全な独立source・policy revision・期限・publication highwater/hashが成立するときだけ、stage/dispatch/confirmがnative stateと照合する。provider/profileは未設定であり、APIや画面の型があることを実source確認済みと数えない。

headは独立 `safety_expires_at` まで必要最小状態を保持し、その期限に達すればbounded purgeで物理消去する。063履歴を消した時点では独立期限内のrootを残せるが、無期限保存にはしない。欠落/期限切れのlocal headは新規generation 0やOPENではなく、再初期化には独立した最新sourceの確認が必須である。052 sourceには `delivery_mode=STATIC` を保持し、head物理消去後もlegacy reader経由で再露出させない。

返却 `cleanupComplete` はlocal期限処理の完了だけを示す。`ready` / `externalPublicationReady` はfalseで、local削除や次tickの要求空を外部撤回成功へ読み替えない。期限rootを消すbatchの `withdrawalRequirements` はtransientな撤回/不存在確認要求であり、新しい長期安全履歴ではない。実adapter/cache/独立source/停止中強制/復元照合は依然未検証である。既存purge fixtureは独立期限内の保持と期限到達時のroot消去、STATICの再露出拒否、history承認だけではpublish不可へ追随した。試験実行は行っていない。
