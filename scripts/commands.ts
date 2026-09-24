import {SlashCommandBuilder} from 'discord.js';
const commands=[
 ['panel','Open the NEXUS guided launchpad','パネル','NEXUS のガイド付きホームを開きます'],
 ['personalize','Set your community preferences','パーソナライズ','コミュニティ設定を自分向けに調整します'],
 ['privacy','View privacy settings and request deletion','プライバシー','プライバシー設定の確認と削除依頼を行います'],
 ['setup','Continue Guided Setup from the next safe step','セットアップ','ガイド付きセットアップを次の安全な手順から続けます'],
 ['settings','Configure NEXUS for this community','設定','このコミュニティの NEXUS 設定を変更します'],
 ['status','Run configuration and permission checks','状態','設定と権限のチェックを実行します']
] as const;
export function buildNexusCommand(){
 const command=new SlashCommandBuilder().setName('nexus').setDescription('Understand and improve your community').setDescriptionLocalizations({ja:'コミュニティの状況を確認し、改善します'}).setContexts(0).setIntegrationTypes(0);
 for(const [name,description,jaName,jaDescription] of commands)command.addSubcommand(sub=>sub.setName(name).setNameLocalizations({ja:jaName}).setDescription(description).setDescriptionLocalizations({ja:jaDescription}));
 return command;
}
