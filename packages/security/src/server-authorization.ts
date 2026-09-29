import type {DiscordPort} from '../../discord/src/rest';
import type {Tx} from '../../db/src/index';
import type {IdentityVault} from '../../identity/src/index';
import {SettingsService,type Actor} from '../../settings/src/index';
import {assert,type Scope} from '../../shared/src/index';
import {canOperatePanel} from './index';

// Bot member lookup includes current ownership and Discord role permissions.
// Verification never substitutes for this current, shared administration policy.
export class ServerAuthorization {
 constructor(private readonly discord:DiscordPort,private readonly settings:SettingsService,private readonly vault:IdentityVault){}
 async actor(s:Scope,userId:string,source:Actor['source'],requestId:string,tx?:Tx):Promise<Actor>{
  assert(/^\d{17,20}$/.test(userId),'ADMIN_REQUIRED',403);
  const [member,current]=await Promise.all([this.discord.member(s.guildId,userId),this.settings.get(s,tx)]);
  assert(canOperatePanel(member.permissions,member.roles,[current.adminRoleId,...current.managerRoleIds]),'ADMIN_REQUIRED',403);
  return {key:this.vault.hash(s,userId),encryptedUserId:this.vault.seal(s,userId),permissions:member.permissions,roles:member.roles,source,requestId};
 }
}
