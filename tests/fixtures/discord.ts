import {DiscordFailure,type DiscordPort,type Member} from '../../packages/discord/src/rest.js';
export class FakeDiscord implements DiscordPort {
 async registerCommands(_guildId:string,_commands:unknown[]){this.calls.push('registerCommands');}
 members=new Map<string,Member>();panels=new Map<string,unknown>();calls:string[]=[];failure:DiscordFailure|Error|null=null;mutationFailure:DiscordFailure|Error|null=null;
 async member(_guildId:string,userId:string){const member=this.members.get(userId);if(!member)throw new DiscordFailure(404);return structuredClone(member);}
 async roles(){return [];}
 async checkChannel(_guildId:string,_channelId:string){if(this.failure)throw this.failure;}
 async validateRole(_guildId:string,_roleId:string){if(this.failure)throw this.failure;}
 async addRole(_guildId:string,userId:string,roleId:string){this.calls.push(`add:${roleId}`);if(this.mutationFailure)throw this.mutationFailure;if(this.failure)throw this.failure;this.members.get(userId)!.roles.push(roleId);}
 async removeRole(_guildId:string,userId:string,roleId:string){this.calls.push(`remove:${roleId}`);if(this.failure)throw this.failure;const m=this.members.get(userId)!;m.roles=m.roles.filter(id=>id!==roleId);}
 async sendPanel(_channelId:string,body:unknown,nonce:string){this.calls.push('sendPanel');if(this.failure)throw this.failure;this.panels.set(nonce,body);return nonce;}
 async editPanel(_channelId:string,messageId:string,body:unknown){if(!this.panels.has(messageId))throw new DiscordFailure(404);this.panels.set(messageId,body);}
 async editReply(_appId:string,_token:string,body:unknown){this.calls.push('editReply');if(this.failure)throw this.failure;this.panels.set('reply',body);}
}
