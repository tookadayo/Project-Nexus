# Discord capability contract

仕様確認日: 2026-09-22。公式資料に記載された読み取り契約を使用します。

| 項目 | 実装と境界 |
| --- | --- |
| Community / Screening | Guild featuresで検出 |
| Native Onboarding | GET guild onboardingのenabled/prompts。取得失敗はunavailable |
| Member flags | REST member snapshotのStartedOnboarding=8、CompletedOnboarding=2、StartedHomeActions=32、CompletedHomeActions=64 |
| Gateway member update | rolesを処理。flagsが送られることを前提にしない |
| Native完了時刻 | `first_observed_*`。実際の完了時刻と称しない |
| Server Guide | 設定全体の検出はunknown。Home Actions flagsを独立して観測 |
| Reply | message_referenceによる明示返信。本文解析なし |
| Voice | join/leaveの既知ペア。欠測中の滞在は推定しない |
| Scheduled event | user add/removeの購読シグナル。参加の証明ではない |
| 観測できないもの | Nativeの回答全文、チャンネル閲覧、DM閲覧、主観的満足度 |

GatewayはGuilds、GuildMembers、GuildMessages、GuildMessageReactions、GuildVoiceStates、GuildScheduledEventsを要求します。privileged intentはGuildMembersのみです。Message ContentとPresenceは要求しません。接続成功時に要求intentsを能力profileへ反映します。未確認時はnullです。

BotにはAdministratorを要求しません。基本権限はViewChannel / SendMessages / ManageRoles。対象チャンネルのoverrideとrole hierarchyは実行時に検査します。Native読み取りが権限不足ならfallbackへ自動破壊的変更せず、能力不足を表示します。

autoは利用可能なNativeがあればnative、それ以外はfallback。明示native/hybridは勝手にfallbackへ変えません。Native Onboardingの書き込みAPIは使用しません。既存guildはmigrationでfallbackを明示します。

Snapshotは0分、5分、1時間、24時間、7日、および活動時の間引き取得です。REST失敗は429/5xxに限った既知retryと最大試行数を持ちます。再加入でjoin timestampが一致しない応答は旧episodeへ適用しません。

公式資料: [Guild / Member / Onboarding](https://docs.discord.com/developers/resources/guild)、[Gateway events](https://docs.discord.com/developers/events/gateway-events)、[Rate limits](https://docs.discord.com/developers/topics/rate-limits)。fixtureはこれらの契約を検証しますが、実Discord応答を取得した記録ではありません。
