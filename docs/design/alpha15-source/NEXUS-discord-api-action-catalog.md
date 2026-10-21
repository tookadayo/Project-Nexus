# NEXUS alpha15：Discord API操作・表示・起点カタログ

調査日：2026年10月14日。Discord公式ドキュメントによる設計調査。実装、権限変更、認証操作、実送信、実機試験は行っていない。

## 1. 結論

「Discordでできる操作を幅広く組み立てる」という方向は成立する。ただし、対象は**公開されたBot／Application APIで許される操作**であり、人間用クライアントの全操作を代行する意味ではない。操作、情報を読む処理、値を作る処理、きっかけを分ければ、少数のテンプレートに限定されないScratch型の自動化を設計できる。

特に設計へ反映すべき点は次のとおり。

1. 太字・改行・見出し・引用・コード・スポイラー等は「文字を整える値ブロック」として用意できる。埋め込み、ボタン、選択、モーダル、Components V2は別の型付き部品にする。任意HTMLや任意APIリクエストに置き換えない。[Markdown](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline)、[Components](https://docs.discord.com/developers/components/reference)
2. Components V2と従来の本文・埋め込み・投票・スタンプを同じ投稿へ混在させない。V2へ変更した投稿は旧形式へ戻せない。新規作成時から送信形式を明示する。[Using Message Components](https://docs.discord.com/developers/components/using-message-components)
3. APIが持つ操作と、NEXUSで採用済みの操作は別。権限変更、大量削除、モデレーション、本文・添付の取得等を「全部使える」の一言で有効にしない。自動BANは既存の非採用方針を維持する。
4. 現行資料には古い前提との差がある。ピンは現在 `PIN_MESSAGES`。モーダルはテキスト以外の選択・ラジオ・チェックボックスにも対応。Privileged Intent審査は2026年6月10日変更で、旧100サーバー基準からユニークユーザー数基準・年次再審査へ移っている。[Message](https://docs.discord.com/developers/resources/message)、[Modal Components](https://docs.discord.com/developers/components/using-modal-components)、[審査ガイド](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review)
5. 数値の直接入力／計算ブロック接続、多数の変数、共通手順はNEXUSの編集・実行設計で決められる。Discord API側の制約と取り違えない。

本書の「alpha15候補」は実装済み・採用確定・実行承認済みを意味しない。大型アップデートの実装開始はユーザー承認後とする。

## 2. 分類の読み方

| 記号 | NEXUSでの扱い |
|---|---|
| A | alpha15の通常機能として具体化する候補。通常のBot権限、対象・用途の許可、試運転、安全な送信基盤は必須 |
| G-P | 特権的・広範囲・破壊的な変更。個別の採用、安全設計、影響確認が必要 |
| G-D | 本文、添付、個人の入力、メンバー一覧、DM等の取得・保存・再送について、目的とデータ利用の採用判断が必要 |
| G-O | OAuth2、外部接続、継続アクセス等の別認可が必要。一般変数でトークンを扱わない |
| F | APIには存在するが、サーバー運営自動化として直近需要が確認されていない。操作カタログから存在を消さず、先に用途を確認 |
| X | 公開Bot APIで非対応、廃止、または規約上不可。代替できる範囲を説明 |
| N | 技術的可否とは別に、現行NEXUS方針で採用しない |

複数記号は複数条件を満たす必要がある。Aにも「権限不要」「無条件送信可」という意味はない。G-P/G-D/G-Oは、既存のG-PRIV/G-BODY/G-TEXT/G-EXT/G-RET等の判断と対応づけるための調査上の分類であり、新しい承認を得たことにはならない。

## 3. メッセージは「値を作る」と「送る」を分ける

### 3.1 推奨する型

以下はDiscordの公式型そのものではなく、APIの仕様に合わせたNEXUS設計案。

- `PlainText`：固定文・許可済み変数を連結した文字。出自・公開可能範囲を継承する。
- `RichText`：許可した文字装飾の構文木。見た目を整えても出自や公開範囲を変えない。
- `EmbedSpec`：タイトル、説明、色、項目、画像参照、作者、フッター等の型付き設定。
- `LegacyMessageSpec`：通常本文＋埋め込み＋必要に応じ従来のボタン／選択UI。
- `V2MessageSpec`：Text Display、Section、Container、Media Gallery等から作る別形式。
- `ModalSpec`：受付画面。投稿本文とは別の型。表示はInteractionへの応答で行う。
- `AttachmentRef`：許可済みファイルへの参照。任意URLを渡せば自動取得できる型にはしない。
- `MentionPolicy`：通知してよい対象IDの明示一覧。文字の見た目と通知の許可を分離する。

「送る」ブロックに渡す完成したメッセージ値を、変数や共通手順の戻り値として使えるようにする。ただし秘密、本文由来の一時値、未許可添付、非公開情報は通常文に変換しても持ち出せない。

### 3.2 文字を整える値ブロック

| UI上の候補 | 入力 → 出力 | 注意 |
|---|---|---|
| 文字／数値／日時をつなぐ | 許可済み値 → PlainText | 数値・日時の表示書式を明示 |
| 改行する／段落を分ける | 複数Text → RichText | 実際の改行を扱う。画面上の折返しと区別 |
| 太字／斜体／下線／取消線 | TextまたはRichText → RichText | 組合せの適用可否を検証 |
| 見出し／小さな補足 | Text＋段階 → RichText | 行頭規則をコンパイラが処理 |
| 箇条書き／番号付き一覧 | List&lt;Text&gt; → RichText | 各項目の改行・入れ子を制限 |
| 引用／複数行引用 | Text → RichText | 他人の原文を取得する機能ではない |
| インラインコード／複数行コード | Text＋許可された言語表示 → RichText | バッククォート衝突を処理。コードは表示のみ |
| ネタバレ表示 | Text → RichText | 閲覧権限制御ではない。コード内では隠れない |
| リンク表示 | HTTPSの検証済みURL＋Text → RichText | 表示名と実URLを確認できる。任意の外部通信はしない |
| 日時／相対日時表示 | Instant＋表示形式 → RichText | Discordのタイムスタンプ形式を生成 |
| 絵文字／チャンネル参照／コマンド参照 | 型付き参照 → RichText | IDを数値計算・自由文字で偽造させない |
| メンバー／ロールを表示 | 型付き参照 → RichText | 表示と通知を別々に設定 |

対応する表示機能の根拠：[Discord Markdown](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline)、[メンション・絵文字・日時等の形式](https://docs.discord.com/developers/reference#message-formatting)、[スポイラー](https://support.discord.com/hc/en-us/articles/360022320632-Spoiler-Tags)。装飾構文はAPIの文字列へ変換するだけであり、書式ブロックごとにAPIを呼ぶ必要はない。

自由文字の差込みは既定でMarkdownをエスケープする。意図して装飾したい場合だけ、型付きの装飾ブロックを使う。任意のHTML、CSS、JavaScript、自由なフォント・文字色・ピクセル単位配置を保証しない。コードの言語指定は文字色を自由に選ぶ機能ではない。

### 3.3 埋め込み・Components V2・モーダル

| 作る部品 | カタログに含める内容 | 区分 |
|---|---|---|
| 埋め込み | タイトル、説明、URL、色、時刻、作者、フッター、名前と値の項目、画像、サムネイル | A。画像の取得・アップロードはG-D/G-Oを別判定 |
| ボタン | Primary／Secondary／Success／Danger、リンク用、無効状態、ラベル・絵文字 | A。リンクボタンはクリックInteractionを返さない |
| 選択メニュー | 固定選択、ユーザー、ロール、ユーザー＋ロール、チャンネル | A。選択されたIDの現在権限を再検証 |
| V2の表示 | Text Display、Section、Thumbnail、Media Gallery、File、Separator、Container、Action Row | A。素材・ファイルは別許可 |
| モーダルの構造化受付 | Label、説明表示、各種Select、Radio Group、Checkbox Group、Checkbox | A。目的と保存期間は別途確定 |
| モーダルの自由入力 | 単行／複数行Text Input、File Upload | G-D。現在のG-TEXTを飛び越えない |
| プレミアム購入ボタン | SKUに結びつく専用ボタン | F。普通の処理ボタンとして流用しない |

[Component Reference](https://docs.discord.com/developers/components/reference)、[Modal Guide](https://docs.discord.com/developers/components/using-modal-components)、[Interaction callbacks](https://docs.discord.com/developers/interactions/receiving-and-responding)。

留意点：

- 通常本文／埋め込み方式とV2方式を明示的な選択肢にする。V2では添付をFileやMedia Gallery等に置かなければ表示されない。旧形式からV2へ切替える編集では失われる表示を確認する。
- V2の部品はDiscordが許す親子関係でのみ組み合わせる。Scratchの処理ブロックを投稿へそのまま差し込むものではない。
- Discordのモーダルに汎用の数値スピナー・日付ピッカーがあるとは扱わない。数値はスラッシュコマンドのINTEGER/NUMBER、構造化選択、または採用済みの検証付き入力で受ける。日時のUIは別設計。NEXUS WebフォームとDiscordモーダルは同一の部品数制限ではない。
- 期限付きの待機後に勝手にモーダルを開かない。表示には適切なInteractionへの応答が必要で、MODAL_SUBMITに直接次のMODALを返すこともできない。長い承認待ちなら、まずボタンを提示して、押下時に新しいInteractionで開く。
- Deferred初期応答ではEPHEMERAL以外のフラグを付けられないため、V2表示は元応答の編集段階で設定する。最初のACK、表示形式、処理完了を同一の送信操作とみなさない。
- 埋め込みはBotが作れるrich形式の範囲に限定する。受信オブジェクトにvideo／provider／自動計算の寸法があっても、任意に送信設定できるフィールドとは限らない。
- 画像・添付はメッセージ／添付IDと許可範囲を持つ参照で管理する。Discord添付の署名付きCDN URLには有効期限があり、永続のファイル識別子として扱わない。[CDN URL](https://docs.discord.com/developers/reference#signed-attachment-cdn-urls)

### 3.4 メンションの安全な既定

通常送信、返信、編集、Interaction応答、V2、Webhookを通じて、NEXUS側の既定を `allowed_mentions: {parse: [], replied_user: false}` とする提案。意図した通知だけ、権限確認済みのユーザー／ロールIDを明示して追加する。`@everyone`・`@here`、ロール通知、返信先通知は独立した目立つ設定にする。[Allowed Mentions](https://docs.discord.com/developers/resources/message#allowed-mentions-object)

「通知を抑える」フラグだけでは、メンションの解釈やプライバシーの安全策を代替できない。編集時も許可一覧を明示し、APIの省略時挙動に依存しない。プレビューで、表示される参照と実際に通知する対象を別々に確認できるようにする。

## 4. 数値入力・値ソケット・多数の変数

この章はNEXUSの設計提案であり、Discord公式制限ではない。

### 4.1 入力欄の共通契約

数値欄は原則として「直接入力」と「同じ型の値ブロックを入れる」を同じソケットで扱う。保存は `Literal`、`VariableRef`、`Expression` の区別を維持する。

- 例：「回数 [3]」「回数 [(参加人数 ÷ 2) の切上げ]」の両方を表現できる。
- 入力欄の整数／最小／最大／単位はブロックを差し込んでも失われない。
- 限界値は保存時と実行時の両方で検証。動的な値は実行直前に検証する。
- 秒・分・時間はDuration、時点はInstant、色はColor、Discord IDは専用Refで表す。見た目が数字でもSnowflakeを浮動小数点Numberへ変換しない。
- 欄ごとに有効な列挙値だけを選ばせる。例：アーカイブ期間は任意のNumberではなく許可値へ制限する。
- パーミッションの生ビット列、Webhookトークン、Interactionトークン、任意URL、任意JSONを「何でも入る値」にしない。
- 文章欄は、固定文の直接編集、RichTextブロック、許可済み変数を共存させる。結果の文字数・部品数は変数展開後に検査する。

### 4.2 変数を多数扱えるUX

ユーザー自身が数値、文字、真偽、日時、期間、参照、型付き一覧、定義済みRecord、MessageSpecを作成・命名・代入・参照できる。変数パネルには検索、型フィルター、スコープ表示、使用箇所一覧、名前変更、複製、未使用検出を設ける。大量時は仮想スクロールを用い、変数ごとのブロックを常時すべて描画しない。

「ユーザーが作る変数」と「Discord利用者ごとの永続プロフィール変数」を区別する。前者の充実を、後者の無断導入に結びつけない。並列枝は独立した変数を持ち、合流時に明示した結果だけ渡す。サーバー共有・利用者別・実行間永続の変数を増やす場合は、権限、競合、削除、保持を先に確定する。

既存案の64変数・永続値16KiB等はNEXUSの提案値であり、Discordの上限ではない。今回の「多数作りたい」という要望に対し、64を確定仕様として押し付けたり、試験なしに無制限へ拡張したりしない。変数数、式の大きさ、保存量、描画性能、実行予算を別々の上限として再評価する。

## 5. 操作ファミリー別カタログ

### 5.1 投稿・返信・リアクション・投票

下表の出力はNEXUSが返す最小の型。Discordの返却オブジェクト全体を、そのまま変数へ公開する提案ではない。`Result` は確認済み結果だけであり、結果不明を成功やfalseへ変換しない。

| 操作群／ブロック候補 | 入力 → 出力 | 権限・範囲の主な条件 | 区分 |
|---|---|---|---|
| チャンネルへ送る／スレッドへ送る | ChannelRef＋MessageSpec → MessageRef | VIEW_CHANNEL、送信先に応じSEND_MESSAGES／SEND_MESSAGES_IN_THREADS。埋め込み・添付等は追加権限 | A |
| 元投稿に返信 | MessageRef＋MessageSpec → MessageRef | READ_MESSAGE_HISTORYも必要。返信元の存在を確認 | A |
| 自分の投稿を編集 | OwnMessageRef＋変更Spec → MessageRef | 投稿所有者・変更可能形式・保持する添付を検証 | A |
| 自分の投稿を削除 | OwnMessageRef → Result | 対象固定、取り消せない削除の確認方式を別設計 | G-P |
| 他人の投稿を削除／まとめて削除 | MessageRef／有限List → Result | MANAGE_MESSAGES。個別承認・対象件数・非復元性 | G-P |
| お知らせを公開する | AnnouncementMessageRef → MessageRef | Crosspost。自投稿はSEND_MESSAGES、他人分はMANAGE_MESSAGESも必要 | A／G-P |
| ピンを付ける／外す／一覧を見る | MessageRef／ChannelRef → Result／List&lt;PinRef&gt; | 書込PIN_MESSAGES。読取は閲覧・履歴権限 | A |
| 自分のリアクションを付ける／外す | MessageRef＋EmojiRef → Result | 履歴閲覧。新しい絵文字反応の追加はADD_REACTIONSも必要 | A |
| 他人の反応を消す／全部消す／絵文字別に消す | MessageRef＋対象 → Result | MANAGE_MESSAGES。投票的利用を壊す可能性 | G-P |
| リアクション一覧を読む | MessageRef＋EmojiRef → 有限List&lt;MemberRef&gt; | 取得可能性と利用目的。個人評価へ転用しない | G-D |
| 投稿を取得／履歴取得／Guild内検索 | MessageRef／条件 → 最小メタデータまたは許可データ | 履歴・閲覧・MESSAGE_CONTENT等。検索は未索引202があり得る | A（自己投稿の照合等）／G-D |
| 投稿を転送 | MessageRef＋送信先 → MessageRef | 読める元本文が必要。別の公開先への再共有 | G-D |
| テーマ共有表示を送る | ThemeSpec → MessageRef | 現行Message APIにshared_client_themeが存在。受信者の設定を強制変更する機能ではない | F |
| 読上げ送信／音声メッセージ送信 | 許可済みText／音声 → MessageRef | SEND_TTS_MESSAGES／SEND_VOICE_MESSAGES等。通常音声分析とは別 | F＋G-D |
| 投票を作る／自分の投票を終了／結果を読む | PollSpec／OwnPollRef → MessageRef／PollResult | SEND_POLLS等。進行中結果と確定結果を区別 | A |
| 投票者一覧を読む | PollRef＋AnswerRef → 有限List&lt;MemberRef&gt; | 投票内容を個人データとして扱う | G-D |
| 他人として投票する／Bot自身が投票する | — | Appsによる投票は非対応 | X |

根拠：[Message resource](https://docs.discord.com/developers/resources/message)、[Poll resource](https://docs.discord.com/developers/resources/poll)、[Permissions](https://docs.discord.com/developers/topics/permissions)。

### 5.2 Interaction・コマンド

| 操作群 | 入力 → 出力 | 実装契約／制約 | 区分 |
|---|---|---|---|
| コマンド・ボタンに応答 | InteractionContext＋MessageSpec → ResponseRef | 公開／本人のみを先に固定 | A |
| 処理中を返す／元応答を更新 | InteractionContext → ResponseHandle | 初期応答期限内。後続処理とACKを分離 | A |
| 続きの応答を送る／取得／編集／削除 | 有効なResponseHandle → MessageRef／Result | 継続トークンの期限を確認。削除はG-P条件も適用 | A／G-P |
| ボタン・選択で元投稿を更新 | ComponentInteraction → MessageRef | NEXUSが所有するUI、actor・guild・版・期限を照合 | A |
| モーダルを開く／構造化回答を受ける | Interaction＋ModalSpec → SubmissionRef | 期限内の応答。本文・添付は別ゲート | A／G-D |
| オートコンプリート候補を返す | 部分入力 → 有限List&lt;Choice&gt; | 候補にない値も送られる前提で再検証 | A |
| スラッシュ／ユーザー／投稿のコマンドを登録・更新・削除・一覧取得 | CommandSpec → CommandRef／List | NEXUSアプリ所有の設定として管理。任意サーバーのフローから全体を変更させない | A（管理基盤） |
| コマンドの利用権限を個別変更 | CommandRef＋Overwrite → PermissionResult | Bot tokenだけでは不可。専用OAuth2 scopeと適格な利用者が必要 | G-P＋G-O |
| Activityを起動 | 対応Interaction → LaunchResult | 対応アプリ機能が必要 | F |

[Receiving and Responding](https://docs.discord.com/developers/interactions/receiving-and-responding)、[Application Commands](https://docs.discord.com/developers/interactions/application-commands)。他Botのコマンドを「文字として送る」と、そのコマンドのInteractionを実行することは同じではない。他BotのボタンをBot APIで人間の代わりに押す汎用機能は提供しない。

### 5.3 チャンネル・スレッド・フォーラム

| 操作群 | 入力 → 出力 | 権限・影響 | 区分 |
|---|---|---|---|
| チャンネル情報／一覧を読む | ChannelRef／GuildRef → ChannelInfo／有限List | 見えない項目・欠落をunknown扱い | A |
| チャンネル／カテゴリを作る | ChannelSpec → ChannelRef | MANAGE_CHANNELS。作成先・数・初期公開範囲を制限 | G-P、限定チケット用途はA候補 |
| 名前・トピック・低速モード・並び・カテゴリを変える | ChannelRef＋限定Patch → ChannelInfo | MANAGE_CHANNELS。変更対象項目を明示 | G-P |
| VCの人数上限・地域・ビットレートを変える | VoiceChannelRef＋設定 → ChannelInfo | MANAGE_CHANNELS。サーバー機能・契約の上限内 | G-P／F |
| チャンネル／スレッドを削除 | Ref → Result | MANAGE_CHANNELS／MANAGE_THREADS。過去投稿への影響 | G-P |
| チャンネル権限を付ける・変える・消す | ChannelRef＋Role/MemberRef＋Overwrite → Result | MANAGE_ROLES。公開範囲・権限昇格の審査必須 | G-P |
| 元投稿からスレッドを作る／新規スレッドを作る | MessageRef／ChannelRef＋ThreadSpec → ThreadRef | PUBLIC／PRIVATEの作成権限。元投稿1件につき1スレッド | A |
| フォーラム／メディアへ投稿を作る | ForumRef＋タイトル＋MessageSpec＋TagRef → ThreadRef＋MessageRef | SEND_MESSAGES。通常テキストのスレッド作成とは異なる | A |
| スレッドの名前・低速モード・タグを変える | ThreadRef＋Patch → ThreadInfo | 所有・管理権限、ロック状態、moderatedタグを検証 | A／G-P |
| アーカイブ／再開／ロック／解除 | ThreadRef＋目標状態 → ThreadInfo | MANAGE_THREADS等。閉鎖と削除を混同しない | A（自己管理範囲）／G-P |
| スレッドへ参加／退出／メンバー追加・削除 | ThreadRef＋MemberRef → Result | 自分の参加と他人のアクセス変更を分ける | A／G-P |
| 稼働中／公開アーカイブ／非公開アーカイブを読む | Scope → 有限List&lt;ThreadRef&gt; | 閲覧・加入・管理権限。無制限取得は不可 | A／G-D |
| フォーラムタグ、既定リアクション・並び・表示を管理 | ForumRef＋設定 → ChannelInfo | MANAGE_CHANNELS。タグ削除・置換の影響を確認 | G-P |
| お知らせチャンネルをフォロー | 元ChannelRef＋宛先 → FollowRef | 宛先MANAGE_WEBHOOKS。将来の投稿配信先が増える | G-P |
| 入力中表示 | ChannelRef → Result | ユーザー操作に即した短い表示だけ | A／F |
| VCステータスを設定・消去 | VoiceChannelRef＋Text → Result | SET_VOICE_CHANNEL_STATUS。未参加ならMANAGE_CHANNELSも必要 | A／G-P |

[Channel](https://docs.discord.com/developers/resources/channel)、[Threads](https://docs.discord.com/developers/topics/threads)、[Server management](https://docs.discord.com/developers/platform/server-and-channel-management)。

チケットはDiscord単体の専用APIではない。チャンネル／スレッド、権限、案内投稿、NEXUS側の受付状態を組み合わせる複合操作として定義する。途中まで成功した場合、作ったチャンネルを黙って削除して「なかったこと」にしない。

### 5.4 ロール・メンバー・モデレーション

| 操作群 | 入力 → 出力 | 条件／NEXUS判断 | 区分 |
|---|---|---|---|
| ロール情報・一覧・人数を読む | Guild/RoleRef → RoleInfo／件数 | 件数とメンバー名簿を分ける | A |
| 限定ロールを付与／解除 | MemberRef＋RoleRef → Result | MANAGE_ROLES＋Botより下位。特権・管理対象ロールを拒否 | A（既存許可一覧） |
| ロール作成・名前・色・表示・順序・権限変更・削除 | RoleSpec／RoleRef → RoleRef／Result | MANAGE_ROLES＋階層。権限付与・公開範囲・削除の影響 | G-P |
| 特定メンバーを取得 | MemberRef → 最小MemberInfo | 都度取得優先。不要な全員キャッシュをしない | A |
| メンバー一覧／検索 | GuildRef＋条件 → 有限List&lt;MemberRef&gt; | 全員一覧はGUILD_MEMBERS等の条件。必要性・用途・保持を確認 | G-D |
| 自分／他人のニックネーム変更 | MemberRef＋Text → MemberInfo | CHANGE_NICKNAME／MANAGE_NICKNAMES＋階層 | A（Bot自身）／G-P |
| タイムアウト設定／解除 | MemberRef＋期限 → MemberInfo | MODERATE_MEMBERS、対象制約。個別採用が必要 | G-P |
| キック | MemberRef＋理由 → Result | KICK_MEMBERS＋階層。加入状態と対象固定 | G-P |
| BAN／解除／一括BAN／BAN一覧 | MemberRef／有限List → Result／一覧 | BAN_MEMBERS等。API能力として存在 | N（自動BAN）、手動支援も別採用判断 |
| メンバー整理の件数見積り／実行 | 条件 → 件数／Result | 排除につながる。件数見積りと実行を別ブロックにする | G-P／F |
| ユーザーをサーバーへ追加 | UserRef＋本人のOAuth認可 → MemberInfo | guilds.join等の本人認可が必要 | G-O／F |
| VC移動／切断／サーバーミュート・解除／スピーカーミュート | MemberRef＋VoiceRef／状態 → MemberInfo | MOVE_MEMBERS／MUTE_MEMBERS／DEAFEN_MEMBERS | G-P |
| Discord AutoMod規則の読取／作成／編集／削除 | RuleRef／RuleSpec → RuleInfo | MANAGE_GUILD、操作による追加権限。本文利用・処罰方針と別審査 | G-P＋G-D |

[Guild](https://docs.discord.com/developers/resources/guild)、[権限階層](https://docs.discord.com/developers/topics/permissions#permission-hierarchy)、[Auto Moderation](https://docs.discord.com/developers/resources/auto-moderation)、[Privileged Intentを使わない設計](https://docs.discord.com/developers/gateway/you-might-not-need-a-privileged-intent)。

BotにAdministratorを付ければ全対象を操作できる、とは扱わない。階層、所有者、管理ロール、現在の所属などを別に確認する。ロール削除後に同名ロールを作っても同一IDへ戻らない。

### 5.5 イベント・招待・サーバー設定

| 操作群 | 入力 → 出力 | 主な条件 | 区分 |
|---|---|---|---|
| 予定イベントを作る／取得／一覧／編集／開始・完了・取消／削除 | EventSpec／ScheduledEventRef → EventInfo／Result | CREATE_EVENTS／MANAGE_EVENTSとイベント種別ごとの権限 | A（自身の許可済みイベント）／G-P |
| イベント参加希望者を取得 | ScheduledEventRef → 有限List&lt;MemberRef&gt; | 取得範囲・目的・保持を限定 | G-D |
| 招待作成／取得／一覧／削除 | ChannelRef＋InviteSpec → InviteRef／Result | CREATE_INSTANT_INVITE、管理操作の必要権限。公開・期限・利用回数を固定 | A（限定招待）／G-P |
| Guild概要・機能・概数を読む | GuildRef → GuildInfo | 概数を実数や個人名簿と混同しない | A |
| サーバー名・説明・画像・システム先・通知既定等を変更 | GuildRef＋限定Patch → GuildInfo | MANAGE_GUILD。機能によって追加要件 | G-P |
| Welcome Screen／Onboardingを取得・変更 | GuildRef＋設定 → 設定Result | Onboarding変更はMANAGE_GUILD＋MANAGE_ROLES | G-P |
| Widget／Vanity URL情報・画像を取得／Widget設定変更 | GuildRef → 設定／画像 | 公開範囲が変わる設定を区別 | G-P／F |
| 一時的な招待・DM保護を設定／解除 | GuildRef＋期限 → IncidentState | MANAGE_GUILD。緊急措置の目的・期限・解除 | G-P |
| Integration一覧・削除 | GuildRef／IntegrationRef → 一覧／Result | 他システムを停止させ得る | G-P／F |
| サーバーテンプレートを取得・作成・同期・更新・削除 | TemplateRef／GuildRef → TemplateInfo | MANAGE_GUILD等。設定が共有される範囲を確認 | G-P／F |
| 監査ログを読む／対象操作に理由を付ける | 条件 → 最小AuditEntry | VIEW_AUDIT_LOG。理由はDiscord管理者にも見える | A（自操作照合）／G-D |

[Scheduled Event](https://docs.discord.com/developers/resources/guild-scheduled-event)、[Invite](https://docs.discord.com/developers/resources/invite)、[Guild](https://docs.discord.com/developers/resources/guild)、[Guild Template](https://docs.discord.com/developers/resources/guild-template)、[Audit Log](https://docs.discord.com/developers/resources/audit-log)。

予定イベントの外部会場、通常VC、Stageは権限条件が違う。Stageを作成するイベントにはCREATE_EVENTSに加えMANAGE_CHANNELS・MUTE_MEMBERS・MOVE_MEMBERS等が必要。通常VCはVIEW_CHANNEL・CONNECT等も確認する。

### 5.6 Webhook・絵文字・スタンプ・音声

| 操作群 | 入力 → 出力 | 主な条件 | 区分 |
|---|---|---|---|
| Webhookを作る／読む／一覧／編集／削除 | 許可済み接続設定 → 秘密を含まないWebhookRef | MANAGE_WEBHOOKS等。トークンを通常の結果に返さない | G-P＋G-O |
| Webhook送信／取得／編集／削除 | WebhookRef＋MessageSpec → MessageRef／Result | 承認済み用途・先。確認可能な送信はwait=trueを優先 | G-O |
| GitHub／Slack互換Webhook | 承認済みイベント → MessageRef | 互換形式の範囲に限る。接続先別採用 | G-O／F |
| サーバー絵文字を一覧・取得・作成・編集・削除 | EmojiRef／素材 → EmojiInfo | CREATE_GUILD_EXPRESSIONS／MANAGE_GUILD_EXPRESSIONS、作成者条件 | A（読取・利用）／G-P＋G-D（管理） |
| アプリ絵文字を一覧・取得・作成・編集・削除 | ApplicationEmojiRef／素材 → EmojiInfo | NEXUSアプリ全体の資産管理。guild編集者に全体更新権を渡さない | A（利用）／F（管理） |
| スタンプを読む／送る／作成・編集・削除 | StickerRef／素材 → StickerInfo | 利用権限と管理権限を分離 | A（利用）／G-P＋G-D |
| Soundboardを読む／再生／作成・編集・削除 | SoundRef／素材 → Result | 再生はVC参加、SPEAK、USE_SOUNDBOARD等 | F＋G-P/G-D |
| Stageの作成／取得／編集／終了 | StageSpec → StageRef／Result | Stage管理権限・対象VC | G-P／F |
| Stageの発言要求／取下げ／抑制・解除 | StageRef＋状態 → Result | REQUEST_TO_SPEAK／MUTE_MEMBERS等 | G-P／F |
| BotがVCへ参加・退出／音声を送る | VoiceChannelRef＋許可素材 → VoiceSessionRef | Gateway＋Voice接続、CONNECT／SPEAK、現行暗号化プロトコル | F＋G-D |
| VC参加・退出等の状態を読む | MemberRef → 最小VoiceState | 状態と通話内容は別。監視目的へ拡大しない | A（明確な運営用途）／G-D |

[Webhook](https://docs.discord.com/developers/resources/webhook)、[Emoji](https://docs.discord.com/developers/resources/emoji)、[Sticker](https://docs.discord.com/developers/resources/sticker)、[Soundboard](https://docs.discord.com/developers/resources/soundboard)、[Stage Instance](https://docs.discord.com/developers/resources/stage-instance)、[Voice State](https://docs.discord.com/developers/resources/voice)、[Voice接続](https://docs.discord.com/developers/topics/voice-connections)。

Webhookの所有者によって利用できるインタラクティブ部品が違う。アプリ非所有のWebhookに任意ボタンを付けられると約束しない。また、現行Webhook資料のV2＋filesの注意書きと一般Componentsの添付説明には送信経路別の確認が必要な箇所がある。V2ファイル対応を全経路一律に有効化せず、採用する経路で契約試験をする。

通常音声・DM内容の分析は現行NEXUSの非目標。Voice APIが存在することを、通話の録音・文字起こし・人物評価への許可とみなさない。画面共有・Go Live等、人間用UIの操作をREST権限名だけから推測して追加しない。

### 5.7 APIにはあるが直近の運営フローとは別枠

| APIファミリー | 能力の概要 | 位置づけ・根拠 |
|---|---|---|
| Application／Bot自身 | アプリ情報・設定の取得と更新、Bot自身の名前・画像等、Botの状態表示 | F。全サーバーへ影響する運営者専用設定。[Application](https://docs.discord.com/developers/resources/application)、[User](https://docs.discord.com/developers/resources/user)、[Gateway Events](https://docs.discord.com/developers/events/gateway-events) |
| User OAuth2 | 本人情報、参加Guild、接続情報、本人のGuild Member情報、Guild参加・退出等の対応範囲 | G-O＋G-D。Botにユーザー全機能が付くわけではない。[OAuth2](https://docs.discord.com/developers/topics/oauth2)、[User](https://docs.discord.com/developers/resources/user) |
| DM | BotとのDMを開く・送る・応答する | G-D。相手の明示許可と機能目的が必要。一斉DM不可。[User](https://docs.discord.com/developers/resources/user)、[Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) |
| Group DM | 旧GameBridge向け作成・参加者操作の公開記載 | F＋G-O。gdm.join等の参加者別認可。通常Botの招待機能として採らない。[User](https://docs.discord.com/developers/resources/user) |
| Linked Roles | アプリのロール接続メタデータ定義、本人が許可した接続値の更新・削除 | F＋G-O。[Role Connection Metadata](https://docs.discord.com/developers/resources/application-role-connection-metadata) |
| Premium Apps | SKU／Subscription／Entitlementの読取、購入済み権利の消費・テスト権利管理等 | F。任意ユーザーの課金・返金・購読変更が自由にできる意味ではない。[SKU](https://docs.discord.com/developers/resources/sku)、[Subscription](https://docs.discord.com/developers/resources/subscription)、[Entitlement](https://docs.discord.com/developers/resources/entitlement) |
| Lobby・Social SDK | ゲームロビー、メンバー、リンクチャンネル等 | F＋G-O。サーバーBot自動化とは別プロダクト領域。[Lobby](https://docs.discord.com/developers/resources/lobby)、[Social SDK](https://docs.discord.com/developers/discord-social-sdk/overview) |
| Activities／Rich Presence | Discord内アクティビティ、ゲームの状態表示等 | F。別SDK・対応アプリ設定の範囲。[Activities](https://docs.discord.com/developers/platform/activities)、[Rich Presence](https://docs.discord.com/developers/platform/rich-presence) |
| Link Preview／Application Identity Profile | アプリ連携表示・プロフィール上のゲーム情報等 | F＋必要なG-O/G-D。通常メッセージの自由装飾とは別。[Link Previews](https://docs.discord.com/developers/link-previews/overview)、[Component Embeds](https://docs.discord.com/developers/link-previews/component-embeds)、[Application Identity Profile](https://docs.discord.com/developers/resources/application-identity-profile) |

## 6. きっかけとして提供できるイベント

REST操作が存在しても、同じ粒度のイベントが必ず存在するとは限らない。イベントにないactor、変更前状態、削除済み本文、完全な履歴を推定で生成しない。

| 起点候補 | 主なGateway Intent／経路 | 出力する最小値・留意点 |
|---|---|---|
| 投稿作成・更新・削除・一括削除 | GUILD_MESSAGES | MessageRef、ChannelRef、時刻等。本文・編集差分はG-D |
| リアクション追加・除去・全除去 | GUILD_MESSAGE_REACTIONS | MessageRef、EmojiRef、取得できるactor。件数の完全性を保証しない |
| ピンの変化 | GUILDS／CHANNEL_PINS_UPDATE | ChannelRef等。常に対象MessageRefが得られると仮定しない |
| チャンネル・スレッド・ロールの作成／更新／削除 | GUILDS | 型付き対象。更新前の値がなければ差分unknown |
| スレッド参加者の変化 | GUILDS、他人分はGUILD_MEMBERSの条件 | ThreadRefと確認できる対象 |
| メンバー参加・退出・更新 | GUILD_MEMBERS（Privileged） | MemberRef。退出をキックやBANと断定しない |
| BAN追加・解除／監査ログ | GUILD_MODERATION＋イベント固有権限 | 運営状況の確認用。自動BANへの接続はN |
| VC状態・効果 | GUILD_VOICE_STATES | 参加先、mute等の最小状態。音声内容なし |
| 予定イベント作成・更新・削除・参加希望 | GUILD_SCHEDULED_EVENTS | EventRef、状態。参加者データはG-D |
| 投票追加・取消 | GUILD_MESSAGE_POLLS | PollRef、AnswerRef、取得できるactor。個人保存はG-D |
| 招待・Webhook・Integration・絵文字等 | GUILD_INVITES／GUILD_WEBHOOKS／GUILD_INTEGRATIONS／GUILD_EXPRESSIONS | メタデータ。Webhook更新イベントは秘密や変更明細を返すものではない |
| AutoMod設定・実行 | AUTO_MODERATION_CONFIGURATION／AUTO_MODERATION_EXECUTION | 取得可能項目を最小化。本文フィールドは別ゲート |
| 自分のコマンド・ボタン・選択・フォーム | InteractionのGatewayまたはHTTP受付 | InteractionContext＋検証済みの型付き入力。受信方式はアプリ設定に従う |
| 本人のオンライン状態・アクティビティ | GUILD_PRESENCES（Privileged） | F／G-D。人物評価や関係性推定へ使わない |

[GatewayのIntent一覧](https://docs.discord.com/developers/events/gateway#list-of-intents)、[Gateway Eventsの個別payload](https://docs.discord.com/developers/events/gateway-events)。

NEXUS側の時刻、手動実行、受付状態、保存済み集計の変化は独自の起点として維持する。HTTPのWebhook EventsはGatewayの全イベントを置き換えるものではない。[Webhook Events](https://docs.discord.com/developers/events/webhook-events)

## 7. 重要な制限・現行仕様

以下は確認できたDiscord側の制約。NEXUSの回数・保持・処理量の上限とは別に扱う。変更され得るため、実装時にも採用API版と最新資料を照合する。

| 項目 | 確認した内容 | 出典 |
|---|---|---|
| Interaction | 最初の応答は3秒以内。継続トークンは15分。長時間の待機とは別 | [Interactions](https://docs.discord.com/developers/interactions/receiving-and-responding) |
| 通常投稿 | contentは2,000文字。最大リクエスト25MiBは「各ファイル25MiB」の保証ではない | [Message](https://docs.discord.com/developers/resources/message) |
| 埋め込み | 1投稿最大10個。対象文字フィールド合計6,000文字。タイトル256、説明4,096、項目25個、項目値1,024 | [Embed Limits](https://docs.discord.com/developers/resources/message#embed-limits) |
| V2 | 合計40コンポーネント。旧content/embeds/poll/stickersとの非互換。V2フラグ解除不可 | [Components](https://docs.discord.com/developers/components/reference) |
| 従来の部品 | 上位Action Rowは最大5。行ごとの子要素種別にも制限 | [Legacy component behavior](https://docs.discord.com/developers/components/reference#legacy-message-component-behavior) |
| モーダル構造 | 上位componentsは1〜5、タイトル45文字。NEXUS Webフォーム10項目案をそのまま1画面へ移せるとはしない | [Modal callback](https://docs.discord.com/developers/interactions/receiving-and-responding) |
| モーダルText Input | 最大4,000文字。これを採用するかはG-TEXTで別判断 | [Text Input](https://docs.discord.com/developers/components/reference#text-input) |
| ファイル | Interactionにattachment_size_limitがある。送信経路・サーバー条件とNEXUS制限の最小値で検査 | [Interaction Object](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-object) |
| 投票 | 最大10回答。最大32日。作成後の投票投稿は編集不可。終了できるのは自分の投票。Appsは投票不可 | [Poll](https://docs.discord.com/developers/resources/poll) |
| 一括投稿削除 | 2〜100件。2週間より古い投稿や重複IDが含まれると失敗 | [Bulk Delete](https://docs.discord.com/developers/resources/message#bulk-delete-messages) |
| スレッド | 自動アーカイブ設定は60／1,440／4,320／10,080分。アーカイブは削除ではない | [Channel](https://docs.discord.com/developers/resources/channel) |
| タイムアウト | 最大28日先。所有者・Administratorは対象にできない | [Modify Guild Member](https://docs.discord.com/developers/resources/guild#modify-guild-member) |
| 監査ログ | Discord側は45日保持。NEXUSが同期間コピーしてよい意味ではない | [Audit Logs](https://docs.discord.com/developers/resources/audit-log) |
| Rate limit | 通常Bot globalの記載は50req/s。経路・共有bucketは応答ヘッダーを読んで適応、429はretry_afterに従う。Interactionはglobalの例外 | [Rate Limits](https://docs.discord.com/developers/topics/rate-limits) |
| Voice接続 | 公式資料では2026-03-01から対象の音声・動画通話にE2EEを要求。DAVE対応SDK・接続試験が必要 | [Voice](https://docs.discord.com/developers/topics/voice-connections#end-to-end-encryption-dave-protocol) |
| 不正リクエスト | 現行記載はIPごと10分で10,000件。401/403/一部429等。失敗を連打せず停止する | [Rate Limits](https://docs.discord.com/developers/topics/rate-limits) |
| 再送のnonce | Create Messageのenforce_nonceは「過去数分」の同一作者・nonceに限定。長期exactly-once保証ではない | [Create Message](https://docs.discord.com/developers/resources/message#create-message) |
| 特権Intent審査 | 2026-06-10変更。アプリが見えるユニークユーザーが10,000を超える基準、年次再審査。Portal通知・適用状況も確認する | [新審査ガイド](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review) |

投票が32日、タイムアウトが28日まで作れることと、NEXUSがその期間の個別実行を保持してよいことは別。既存の7日以内待機や保持ゲートをこれらで上書きしない。

Gatewayの一部には旧100サーバー基準の説明が残る。Intent審査については変更日を明示した新ガイドを優先し、アプリ検証制度全体まで同じ閾値に変わったとは推論しない。

## 8. 認可・データ・再試行の実行契約

### 8.1 アクションごとの登録情報

全操作を次の登録情報で実装する案とする。ここが欠けた操作を「高度な任意APIブロック」で逃がさない。

- 安定したoperationId、型付き入力・出力、対応するAPIと公式リンク
- 対応するインストール方式、guild／DM／channel種別、必要権限・Intent・scope
- actor、フロー有効化者、必要な承認者、Botの権限を別々に確認する規則
- 参照の所属・所有・鮮度、本文／個人情報／添付等の出自、保存可能性
- 作成・置換・追加・削除の区別、破壊的影響、最大件数、承認範囲
- 戻り値、照合可能性、再試行条件、取り消し／補償の可否
- Gatewayで起こり得るイベント、自己イベントの除外、連鎖・再帰の抑止
- 送信版・設定版・API適合版、試運転表示、必要な契約試験

### 8.2 Intent、権限、データ利用は別の条件

`MESSAGE_CONTENT`は送信権限ではなく、APIから取得する本文等の情報に関するアクセス条件。自分の投稿、BotとのDM、Botへのメンション、投稿コンテキストコマンド等の例外があっても、NEXUSの利用目的・保持・再送に対する承認を代替しない。[Message Content Intent](https://docs.discord.com/developers/events/gateway#message-content-intent)

限定された個別Member取得やInteraction内の解決済みデータで足りるなら、全員名簿やPresenceを常時収集しない。[代替設計](https://docs.discord.com/developers/gateway/you-might-not-need-a-privileged-intent)

本文を保存しない設定であっても、添付・埋め込み・Components・poll・転送snapshot・エラーログ・試運転表示・監査理由へ写せば迂回になる。公開先変更、削除要求、停止、バックアップへの波及を一貫させる。

### 8.3 結果不明と冪等性

以下はAPIの保証ではなく、NEXUSとして必要な安全設計。

| 操作の性質 | 推奨する扱い |
|---|---|
| メッセージ・チャンネル・イベント等の新規作成 | 操作計画を先に保存。タイムアウト直後に新規作成を繰り返さない。結果ID／nonce等で確定できる範囲だけ照合 |
| ロール追加・解除、ピン等の目標状態変更 | 操作前の状態と目標を保存。後で同じ状態になっていても「自分の操作が成功した」とは限らない |
| 本文・権限・タグ一覧等の置換 | 変更したフィールドと保持するフィールドを明示。古い全体スナップショットで他者の変更を上書きしない |
| 削除・BAN・権限剥奪 | 正確な対象、件数、影響、理由、固定ハッシュを確認。自動ロールバックや自動再試行で影響を増やさない |
| 複合チケット／複数対象変更 | 成功済みの個別結果を残し、部分成功を表示。APIをまたぐ原子的取引があるとは見せない |
| Webhook送信 | wait=trueでMessage結果を要求しても通信切断時は結果不明になり得る。Webhook URLは秘密扱い |
| Gatewayの再配信・重複・欠落 | 安定キーで重複防止、権限直前確認、取得できない差分はunknown。新規加入や再接続を通常のユーザー操作と混同しない |

権限不足403は自動リトライで解決しない。429も既存の実行期限・中止条件の範囲で待つ。期限切れのInteraction tokenを別用途で再利用しない。既存のC-AUTH/C-ACTION/C-RECOVERY/C-CANCELの契約を維持する。

## 9. 非対応・禁止・非採用を明記する

- 一般ユーザーのトークンを使うself-bot、非公開クライアントAPIの模倣、通常アカウントの無断自動操作は採用しない。[Self-Bots](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots)
- Botは他人のメッセージ本文を自由に編集できない。他人のflags操作など限定されたAPI能力と本文編集を混同しない。
- 読めない投稿の転送、アクセスできないDM・非公開チャンネルの取得、削除済み本文の復元、他人になりすましたInteraction、任意の他Bot操作を提供しない。
- Botの投票、既存投票の自由編集、V2投稿を旧形式へ戻すこと等のAPI非対応をUIで偽装しない。
- 個人学習、性格・関係性推定、個人スコア、自動BAN、通常音声／DM内容分析、任意コード実行は現行の非目標。単に「承認待ち」の便利機能として並べない。
- Discord Developer Policyには利用者・サーバーの許可、無断DM、個人プロファイリング、スクレイピング、AI学習への利用等の制限がある。単なるAPIアクセス可能性を用途承認とみなさない。[Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)
- 廃止されたコマンド権限一括編集や旧ピンAPIなど、古い記事の機能を新規ブロックに採らない。公開一覧にないサーバー作成・削除等も過去の記憶だけで提供すると約束しない。[Application Commands](https://docs.discord.com/developers/interactions/application-commands)、[公式API一覧](https://docs.discord.com/llms.txt)

## 10. 設計へ戻す際の優先事項

1. alpha15の範囲を、4つ程度の例で打ち止めにせず、上の操作カタログと条件・変数・繰返し・共通手順を横断して定義する。
2. 「全部」の対象を公開Bot/App APIへ明示し、A/G/F/X/Nを検索・フィルターできる。提供しない理由を操作ごとに表示する。
3. メッセージ作成器を、太字や改行だけの装飾欄で終わらせず、RichText・EmbedSpec・LegacyMessageSpec・V2MessageSpec・ModalSpecへ分ける。
4. 全数値欄で、直接入力と型の合うブロック差込みの可否を一覧化する。固定値のみの例外には理由を示す。
5. 多数の変数を管理できる画面を設計し、実行内の変数と個人を長期追跡する変数を分ける。
6. APIのreturn object、トークン、個人情報を丸ごと出す汎用ブロックを作らず、最小の型付き結果を返す。
7. 普通の作成・返信・自投稿編集・選択受付・限定ロール・スレッド・投票等を広く設計しつつ、破壊的／特権／データ取得の採用判断を抜け落とさない。
8. 実装着手前にユーザー承認を得る。採用済み機能についても最新APIの契約試験、権限不足、削除済み対象、通信結果不明、重複イベント、停止後の遅延成功、文字展開後超過、V2形式切替等を検証する。

## 11. 検証の範囲と未確定事項

公式の現行ページを2026年10月14日に参照して整理した。実装対象SDKの対応版、NEXUS Botの実際の権限・Intent・インストール状況、各サーバーの機能、データ保持へのユーザー承認、負荷試験結果は未確認。カタログはAPIファミリーを広くカバーするが、Discordの将来追加機能や人間用UIの全項目を網羅する保証ではない。

旧資料との明確な差分は、特権Intentの審査基準、PIN_MESSAGES、モーダルの新しい選択・チェック部品、Guild内メッセージ検索、V2の非互換を優先して反映した。仕様説明が送信経路で食い違う箇所は上記のとおり未検証として残した。

