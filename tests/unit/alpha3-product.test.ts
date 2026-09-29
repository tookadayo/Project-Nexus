import {expect,it} from 'vitest';
import {buildNexusCommands} from '../../scripts/commands.js';
import {features,featureAvailability,planCurrency,planRegistry} from '../../packages/settings/src/plan-registry.js';
import {controlPanel} from '../../packages/discord-panels/src/views/control.js';
import {t} from '../../packages/discord-panels/src/i18n/index.js';

const issue=async()=> 'control:unit';
it('registers permission-gated message and user context actions',()=>{
 const commands=buildNexusCommands().map(command=>command.toJSON());
 expect(commands.map(command=>command.type)).toEqual([1,3,3,3,2]);
 expect(commands.slice(1).map(command=>command.default_member_permissions)).toEqual([null,null,null,null]);
 expect(commands.map(command=>command.name)).toContain('NEXUS: Explain Detection');
});
it('renders plan prices and feature availability from one registry',()=>{
 expect(planCurrency).toBe('USD');
 expect(planRegistry.FREE.price).toBe(0);
 expect(planRegistry.GROWTH.features).toContain('experiments');
 expect(features.every(feature=>feature in featureAvailability)).toBe(true);
 expect(featureAvailability.ai_explanation).toBe('planned');
});
it('keeps visible goal names aligned to observed activity',()=>{
 expect(t('ja','control.goalEvent')).toContain('参加登録');
 expect(t('en','experience.eventRule')).toContain('Actual attendance is not measured');
 expect(t('ja','control.goalPlaytest')).toContain('募集に反応');
 expect(t('en','experience.reactionWeak')).toContain('does not count as a first connection');
});
it('distinguishes zero live attention from unavailable observations',async()=>{
 const live=await controlPanel(issue,'overview',{community:{daily:{ready:true,todayJoined:0,todayConnected:0,attentionCount:0},attention:[],suggestion:null} as never},'en');
 const waiting=await controlPanel(issue,'overview',{community:{daily:{ready:false},attention:[],suggestion:null} as never},'en');
 expect(JSON.stringify(live)).toContain('No posts need a reply right now');
 expect(JSON.stringify(live)).toContain('No new members today');
 expect(JSON.stringify(waiting)).toContain('Recent activity is unavailable');
 expect(JSON.stringify(waiting)).not.toContain('**Joined**\\n0');
});
