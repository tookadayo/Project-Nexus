import type {ErrorCategory,UserFailure} from '../../../shared/src/error-types';
const text:Record<'ja'|'en',Record<ErrorCategory,[string,string,string]>>={
 ja:{
  PERMISSION:['この操作を行う権限がありません','必要なDiscord権限またはNEXUS管理ロールを確認してください。','権限を確認'],
  CHANNEL_PERMISSION:['このチャンネルに送信できません','NEXUSのチャンネル表示・送信権限を確認するか、別の通知先を選んでください。','通知先を変更'],
  REVISION_CONFLICT:['設定が更新されています','別の操作で設定が変更されました。最新状態を読み込んでから操作してください。','再読み込み'],
  COMPONENT_EXPIRED:['この操作は期限切れです','最新のパネルを開いて操作してください。','パネルを開く'],
  DISCORD_TIMEOUT:['Discordの応答を確認できませんでした','Discordへのリクエストが時間内に完了しませんでした。少し待って状態を確認してください。','状態を確認'],
  DISCORD_RATE_LIMIT:['Discordへのリクエストが制限されています','少し待ってから状態を確認してください。','状態を確認'],
  DISCORD_UNAVAILABLE:['Discordから情報を取得できませんでした','Discordへのリクエストを完了できませんでした。少し待って状態を確認してください。','状態を確認'],
  DATABASE_FAILURE:['NEXUSでデータを処理できませんでした','データの読み込みまたは保存を完了できませんでした。','状態を確認'],
  VALIDATION:['この内容では操作できません','入力内容と選択した項目を確認してください。','入力内容を確認'],
  ENTITLEMENT:['現在のプランでは利用できません','この機能の利用条件をプラン画面で確認してください。','プランを見る'],
  WEB_CONNECTION:['Web接続を確認できませんでした','最新の接続状態を確認してください。接続コードが届かなかった場合は /nexus link で発行し直してください。','接続状態を確認'],
  AUTH_SESSION:['もう一度ログインしてください','ログインの有効期限が切れたか、セッションを確認できません。','ログイン'],
  VERIFICATION:['接続できませんでした','コードと発行したDiscordアカウントを確認してください。新しいコードは /nexus link で発行できます。','コードを入力'],
  INTERNAL:['処理を完了できませんでした','操作結果を確認できませんでした。参照IDをサポートへお伝えください。','状態を確認'],
 },
 en:{
  PERMISSION:['You do not have permission for this action','Check the required Discord permissions or NEXUS manager role.','Check permissions'],
  CHANNEL_PERMISSION:['NEXUS cannot send to this channel','Check View and Send permissions, or choose another notification channel.','Choose another channel'],
  REVISION_CONFLICT:['Settings have changed','Another operation updated these settings. Load the current state before continuing.','Reload'],
  COMPONENT_EXPIRED:['This action has expired','Open the latest panel before continuing.','Open panel'],
  DISCORD_TIMEOUT:['Discord did not respond in time','The Discord request did not finish in time. Wait briefly and check the current state.','Check state'],
  DISCORD_RATE_LIMIT:['Discord requests are being limited','Wait briefly before checking the current state.','Check state'],
  DISCORD_UNAVAILABLE:['Could not retrieve information from Discord','The Discord request could not be completed. Wait briefly and check the current state.','Check state'],
  DATABASE_FAILURE:['NEXUS could not process the data','Data could not be read or saved.','Check state'],
  VALIDATION:['This input cannot be used','Check the entered values and selected items.','Review input'],
  ENTITLEMENT:['This feature is unavailable on the current plan','Check the plan page for this feature’s requirements.','View plan'],
  WEB_CONNECTION:['Could not confirm the Web connection','Check the current connection state. If a code was not delivered, issue another with /nexus link.','Check connection'],
  AUTH_SESSION:['Sign in again','The session expired or could not be verified.','Sign in'],
  VERIFICATION:['Could not connect the server','Check the code and the Discord account that issued it. Run /nexus link for a new code.','Enter code'],
  INTERNAL:['Could not complete the operation','The result could not be confirmed. Give the reference ID to support.','Check state'],
 }
};
export function failureCopy(locale:'ja'|'en',failure:UserFailure){
 const [title,detail,action]=text[locale][failure.category];
 const effect=failure.effect==='NOT_STARTED'?(locale==='ja'?'変更処理は開始していません。':'No change operation was started.'):(locale==='ja'?'変更が行われたか確認できません。同じ操作を繰り返す前に最新状態を確認してください。':'Whether a change was applied could not be confirmed. Check the current state before repeating the action.');
 return {title,detail,action,effect};
}
