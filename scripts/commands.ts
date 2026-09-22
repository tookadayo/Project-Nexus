import {SlashCommandBuilder} from 'discord.js';
const commands=[
 ['panel','Create or reopen the NEXUS control panel','パネル','NEXUS コントロールパネルを作成または再表示します'],
 ['personalize','Set your community preferences','パーソナライズ','コミュニティ設定を自分向けに調整します'],
 ['privacy','View privacy settings and request deletion','プライバシー','プライバシー設定の確認と削除依頼を行います'],
 ['overview','View community activation metrics','概要','コミュニティ活性化指標を表示します'],
 ['setup','Check Discord and Native Onboarding readiness','セットアップ','Discord と Native Onboarding の準備状況を確認します'],
 ['lifecycle','View the observable member lifecycle','ライフサイクル','観測可能なメンバーライフサイクルを表示します'],
 ['activation','Define the community activation signal','アクティベーション','コミュニティのアクティベーションシグナルを定義します'],
 ['cohorts','View cohort measurement behavior','コホート','コホート測定の動作を表示します'],
 ['diagnose','Diagnose community performance changes','診断','コミュニティ成果の変化を診断します'],
 ['interventions','Manage controlled community interventions','施策','制御されたコミュニティ施策を管理します'],
 ['experiments','View randomized Control and Treatment experiments','実験','ランダム化された対照群・施策群の実験を表示します'],
 ['reports','View reporting availability','レポート','レポートの利用状況を表示します'],
 ['settings','Configure NEXUS for this community','設定','このコミュニティの NEXUS 設定を変更します'],
 ['billing','View plan and tracked-member usage','プラン','プランと追跡メンバー利用状況を表示します'],
 ['status','Run configuration and permission checks','状態','設定と権限のチェックを実行します']
] as const;
export function buildNexusCommand(){
 const command=new SlashCommandBuilder().setName('nexus').setDescription('Community activation and experimentation').setDescriptionLocalizations({ja:'コミュニティ活性化・実験プラットフォーム'}).setContexts(0).setIntegrationTypes(0);
 for(const [name,description,jaName,jaDescription] of commands)command.addSubcommand(sub=>sub.setName(name).setNameLocalizations({ja:jaName}).setDescription(description).setDescriptionLocalizations({ja:jaDescription}));
 return command;
}
