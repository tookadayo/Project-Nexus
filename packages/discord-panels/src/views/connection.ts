import type {UiLocale} from '../i18n/index.js';
import {actionRow,callout,divider,nexusPanel} from '../primitives.js';
import type {Issue} from '../types.js';
export function connectionCodePanel(code:string,expiresAt:Date,url:string,locale:UiLocale){
 const ja=locale!=='en';
 return nexusPanel({title:ja?'Web Dashboardを接続':'Connect Web Dashboard',children:[divider(),callout(ja?'接続コード':'Verification code',`\`${code}\`\n${ja?'有効期限':'Expires'}: <t:${Math.floor(expiresAt.getTime()/1000)}:R>\n${ja?'発行したDiscordアカウントでログインしてください。コードは1回だけ使用できます。':'Sign in with the Discord account that issued this code. It can only be used once.'}`),callout('Web Dashboard',url)]});
}
export async function disconnectPanel(issue:Issue,version:string|null,locale:UiLocale){
 const ja=locale!=='en';
 return nexusPanel({title:ja?'Web接続を解除しますか？':'Disconnect Web Dashboard?',children:[divider(),callout(ja?'データは保持されます':'Your data is preserved',ja?'未使用コードも無効になります。Bot、分析データ、履歴、設定は保持され、再接続には /nexus link が必要です。':'Unused codes will also be revoked. The bot, analytics, history, and settings are preserved. Run /nexus link to reconnect.')],rows:[await actionRow(issue,[{label:ja?'接続解除を確定':'Confirm disconnect',action:'unlinkConfirm',data:{version},style:4},{label:ja?'キャンセル':'Cancel',action:'unlinkCancel'}])]});
}
