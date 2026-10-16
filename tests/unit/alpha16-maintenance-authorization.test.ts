import {expect,it} from "vitest";
import {assertMaintenanceAuthorization} from "../../packages/operations/src/maintenance-authorization";
import type {Actor} from "../../packages/settings/src/index";
const scope={organizationId:'11111111-1111-4111-8111-111111111111',guildId:'123456789012345678'},actor={key:'fixture-actor'} as Actor,now=new Date('2026-10-16T12:00:00Z');
it('binds a current server observation to scope, actor and strict expiry',()=>{
 const proof={scope,actorHash:actor.key,expiresAt:new Date(now.getTime()+1)};
 expect(()=>assertMaintenanceAuthorization(proof,scope,actor,now)).not.toThrow();
 for(const invalid of [undefined,{...proof,actorHash:'other'},{...proof,scope:{...scope,guildId:'987654321012345678'}},{...proof,expiresAt:now},{...proof,expiresAt:new Date(NaN)}])expect(()=>assertMaintenanceAuthorization(invalid,scope,actor,now)).toThrow('CURRENT_AUTHORIZATION_REQUIRED');
});
