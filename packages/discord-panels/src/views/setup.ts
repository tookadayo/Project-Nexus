import {ButtonStyle} from 'discord-api-types/v10';
import type {SetupState} from '../../../presentation/src/types.js';
import type {UiLocale} from '../i18n/index.js';
import {actionRow,callout,divider,nexusPanel,type ButtonSpec,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';
export async function guidedSetupPanel(issue:Issue,setup:SetupState,locale:UiLocale='en'):Promise<Panel>{
 const ja=locale!=='en',label=(en:string,jp:string)=>ja?jp:en,connect=setup.steps.find(step=>step.key==='connect'),goal=setup.steps.find(step=>step.key==='activation');
 const actions:ButtonSpec[]=[];
 if(!connect?.complete)actions.push({label:label('Check again','再確認'),action:'setup',style:ButtonStyle.Primary});
 else if(!goal?.complete)actions.push({label:label('Choose first success','最初の成功を選ぶ'),action:'activation',style:ButtonStyle.Primary});
 else actions.push({label:label('View newcomers','新規メンバーを見る'),action:'lifecycle',style:ButtonStyle.Primary});
 actions.push({label:label('Settings','設定'),action:'settings'});
 const checks=connect?.complete?label('✓ Discord connected\n✓ Data connection working\n✓ Channels checked\n✓ Permissions checked','✓ Discord に接続済み\n✓ データ接続は正常\n✓ チャンネルを確認済み\n✓ 権限を確認済み'):label('Checking your server…\nDiscord connection or data collection needs attention. Check bot permissions and try again.','サーバーを確認中…\nDiscord 接続またはデータ取得を確認してください。Bot の権限を確認して再試行してください。');
 const onboardingText=setup.nativeOnboardingEnabled?label('Discord onboarding is already in use. NEXUS will observe it without changing it.','Discord のオンボーディングを使用中です。NEXUS は変更せずに観測します。'):label('Discord onboarding is not currently in use. You can add a simple NEXUS welcome flow later.','Discord のオンボーディングは現在使われていません。簡単な歓迎フローは後で追加できます。');
 return nexusPanel({title:label('NEXUS · Setup','NEXUS · セットアップ'),subtitle:label('Start measuring in a few minutes','数分で測定を開始'),accent:connect?.complete?'healthy':'collecting',children:[divider(),callout(label('Checking your server','サーバーを確認中'),checks),callout(label('What should a successful newcomer do first?','新規メンバーの最初の成功は何ですか？'),goal?.complete?label('Your choice is saved. New members use this goal; earlier results keep their original definition.','選択を保存しました。新規メンバーにはこの目標を使い、過去の結果は元の定義を維持します。'):label('Receive a reply, send a first message, or join an event. Choose the one that matters to your community.','返信を受ける、最初のメッセージを送る、イベントに参加する。コミュニティに合うものを選んでください。')),callout(label('Welcome flow · optional','歓迎フロー · 任意'),onboardingText)],rows:[await actionRow(issue,actions)]});
}
