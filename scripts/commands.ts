import {SlashCommandBuilder} from 'discord.js';
const commands=[
 ['panel','Open the NEXUS guided launchpad','パネル','NEXUS のガイド付きホームを開きます'],
 ['personalize','Set your community preferences','パーソナライズ','コミュニティ設定を自分向けに調整します'],
 ['privacy','View privacy settings and request deletion','プライバシー','プライバシー設定の確認と削除依頼を行います'],
 ['overview','View community activation metrics','概要','コミュニティ活性化指標を表示します'],
 ['setup','Continue Guided Setup from the next safe step','セットアップ','ガイド付きセットアップを次の安全な手順から続けます'],
 ['lifecycle','Open Journey (legacy alias)','ライフサイクル','ジャーニーを開きます（互換エイリアス）'],
 ['activation','Define the community activation signal','アクティベーション','コミュニティのアクティベーションシグナルを定義します'],
 ['cohorts','View cohort measurement behavior','コホート','コホート測定の動作を表示します'],
 ['diagnose','Open Opportunities (legacy alias)','診断','改善機会を開きます（互換エイリアス）'],
 ['interventions','Open Actions (legacy alias)','施策','アクションを開きます（互換エイリアス）'],
 ['experiments','Open Results (legacy alias)','実験','結果を開きます（互換エイリアス）'],
 ['reports','View reporting availability','レポート','レポートの利用状況を表示します'],
 ['settings','Configure NEXUS for this community','設定','このコミュニティの NEXUS 設定を変更します'],
 ['billing','View plan and tracked-member usage','プラン','プランと追跡メンバー利用状況を表示します'],
 ['status','Run configuration and permission checks','状態','設定と権限のチェックを実行します']
] as const;
export function buildNexusCommand(){
 const command=new SlashCommandBuilder().setName('nexus').setDescription('Community growth and activation').setDescriptionLocalizations({ja:'コミュニティ成長・活性化プラットフォーム'}).setContexts(0).setIntegrationTypes(0);
 for(const [name,description,jaName,jaDescription] of commands)command.addSubcommand(sub=>sub.setName(name).setNameLocalizations({ja:jaName}).setDescription(description).setDescriptionLocalizations({ja:jaDescription}));
 return command;
}
