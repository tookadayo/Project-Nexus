import {expect,it} from 'vitest';
import {normalize} from '../../packages/events/src/index.js';
import {IdentityVault} from '../../packages/identity/src/index.js';
import {gatewayIntents} from '../../apps/gateway/src/index.js';
import {GatewayIntentBits} from 'discord.js';
const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32));
it('drops content, attachments, embeds, DMs and bot messages before publishing',()=>{
 const d={guild_id:'111111111111111111',id:'222222222222222222',channel_id:'333333333333333333',author:{id:'444444444444444444'},type:0,timestamp:'2026-09-20T00:00:00.000Z',content:'SECRET',attachments:['SECRET'],embeds:['SECRET']};
 const event=normalize({t:'MESSAGE_CREATE',s:1,d},0,'session',vault);expect(event?.kind).toBe('message.sent');
 expect(JSON.stringify(event)).not.toContain('SECRET');expect(JSON.stringify(event)).not.toContain(d.author.id);
 expect(normalize({t:'MESSAGE_CREATE',s:1,d:{...d,guild_id:undefined}},0,'session',vault)).toBeNull();
 expect(normalize({t:'MESSAGE_CREATE',s:1,d:{...d,author:{...d.author,bot:true}}},0,'session',vault)).toBeNull();
 expect(gatewayIntents).not.toContain(GatewayIntentBits.MessageContent);
});
