import {expect,it} from 'vitest';
import {rootPanel,settingsPanel} from '../../packages/discord-panels/src/index.js';
it('uses Components V2 without mentions or identifiers in custom IDs',async()=>{
 let counter=0;const issue=async()=>`opaque-${counter++}`;
 const root=await rootPanel(issue);expect(root.flags).toBe(32768);expect(root.allowed_mentions).toEqual({parse:[]});
 const settings=await settingsPanel(issue,{enabled:false,onboardingEnabled:false,template:'Gaming',startChannelId:null,revision:0});
 expect(JSON.stringify(settings)).toContain('Choose community template');expect(JSON.stringify(settings)).not.toContain('Administrator');
});
