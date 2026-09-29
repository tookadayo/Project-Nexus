import {SlashCommandBuilder,ContextMenuCommandBuilder,ApplicationCommandType} from 'discord.js';
const commands=[
 ['panel','Open the NEXUS control panel','パネル','コミュニティ管理パネルを開きます'],
 ['personalize','Choose what you want to see','自分の設定','参加時の設定を選びます'],
 ['privacy','View privacy settings and request deletion','プライバシー','プライバシー設定の確認と削除依頼を行います'],
 ['status','Check connection and permissions','状態','接続と権限を確認します']
] as const;
export function buildNexusCommand(){
 const command=new SlashCommandBuilder().setName('nexus').setDescription('Understand and improve your community').setDescriptionLocalizations({ja:'コミュニティの状況を確認し、改善します'}).setContexts(0).setIntegrationTypes(0);
 for(const [name,description,jaName,jaDescription] of commands)command.addSubcommand(sub=>sub.setName(name).setNameLocalizations({ja:jaName}).setDescription(description).setDescriptionLocalizations({ja:jaDescription}));
 return command;
}
export function buildNexusCommands(){
 const context=(name:string,type:ApplicationCommandType.User|ApplicationCommandType.Message,ja:string)=>new ContextMenuCommandBuilder().setName(name).setNameLocalizations({ja}).setType(type).setDefaultMemberPermissions(null).setContexts(0).setIntegrationTypes(0);
 return [buildNexusCommand(),
  context('NEXUS: Add to Attention',ApplicationCommandType.Message,'NEXUS: 対応対象に追加'),
  context('NEXUS: Mark Resolved',ApplicationCommandType.Message,'NEXUS: 対応済みにする'),
  context('NEXUS: Explain Detection',ApplicationCommandType.Message,'NEXUS: この投稿の判定を見る'),
  context('NEXUS: New Member Status',ApplicationCommandType.User,'NEXUS: 新規メンバー状態を見る')];
}
