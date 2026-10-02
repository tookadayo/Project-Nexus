import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {infrastructure} from '../fixtures/infrastructure';
import {connect,migrate,ensureGuild,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/index';
import {IdentityVault} from '../../packages/identity/src/index';
import {projectMemberFlags} from '../../packages/lifecycle/src/adaptive-projector';
import {memberEligibility,type MemberObservation} from '../../packages/shared/src/member-observation';
let counter=0;
let infra:Awaited<ReturnType<typeof infrastructure>>,db:Database;
beforeAll(async()=>{infra=await infrastructure();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32)),s=scopeForGuild('111111111111111155');
async function episode(){await ensureGuild(db,s);const id=randomUUID(),identity=await vault.resolve(db,s,String(222222222222222200n+BigInt(++counter)));await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${identity}::uuid,now(),'PRODUCTION')`.execute(db);return id;}
async function observation(id:string){return (await sql<MemberObservation&{flags_observed_at:Date|null;engagement_started_at:Date|null}>`SELECT * FROM membership_episodes WHERE ${tenant(s)} AND id=${id}::uuid`.execute(db)).rows[0]!;}
async function flags(id:string,fields:{pending?:boolean;memberFlags?:number},at='2026-10-02T00:00:00.000Z'){await db.transaction().execute(tx=>projectMemberFlags(tx,s,{...s,shardId:0,gatewaySessionId:'alpha5',sequence:0,context:'PRODUCTION',kind:'member.roles_updated',at,...fields},id,vault.hash(s,'222222222222222222')));}
it('keeps legacy default-false rows UNKNOWN with independent proof clocks',async()=>{
 const id=await episode();expect(memberEligibility(await observation(id))).toBe('UNKNOWN');
 await flags(id,{pending:false});const row=await observation(id);expect(row.flags_observed_at).toBeNull();expect(row.guest_observed_at).toBeNull();expect(memberEligibility(row)).toBe('UNKNOWN');
 await flags(id,{memberFlags:0});expect(memberEligibility(await observation(id))).toBe('ELIGIBLE');
});
it('starts the engagement clock only on an observed screening transition',async()=>{
 const id=await episode();await flags(id,{pending:true,memberFlags:0});expect(memberEligibility(await observation(id))).toBe('SCREENING_PENDING');
 await flags(id,{pending:false},'2026-10-02T00:01:00.000Z');expect((await observation(id)).engagement_started_at?.toISOString()).toBe('2026-10-02T00:01:00.000Z');
 await flags(id,{pending:true},'2026-10-02T00:00:30.000Z');expect(memberEligibility(await observation(id))).toBe('ELIGIBLE');
});
it('observes guest true/false without allowing pending packets to reset guest',async()=>{
 const id=await episode();await flags(id,{memberFlags:16});expect(memberEligibility(await observation(id))).toBe('GUEST');
 await flags(id,{pending:false},'2026-10-02T00:02:00.000Z');expect(memberEligibility(await observation(id))).toBe('GUEST');
 await flags(id,{memberFlags:0},'2026-10-02T00:01:00.000Z');expect(memberEligibility(await observation(id))).toBe('ELIGIBLE');
 await flags(id,{memberFlags:16},'2026-10-02T00:00:30.000Z');expect(memberEligibility(await observation(id))).toBe('ELIGIBLE');
});
