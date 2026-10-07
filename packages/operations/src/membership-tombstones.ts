import { sql, type Tx } from "../../db/src/index";
import type { IdentityVault } from "../../identity/src/index";
import type { Scope } from "../../shared/src/index";

export async function revokedCredentialActor(
  tx: Tx,
  vault: IdentityVault,
  scope: Scope,
  actorHash: string,
) {
  const members = (
    await sql<{
      organization_id: string;
      home_guild_id: string;
      user_ciphertext: string;
    }>`SELECT m.organization_id,o.home_guild_id,m.user_ciphertext FROM operations_org_guilds g JOIN operations_org_members m ON m.organization_id=g.root_organization_id JOIN operations_organizations o ON o.id=m.organization_id WHERE g.organization_id=${scope.organizationId}::uuid AND g.guild_id=${scope.guildId} AND m.state='REVOKED'`.execute(
      tx,
    )
  ).rows;
  return members.some(
    (member) =>
      vault.hash(
        scope,
        vault.open(
          {
            organizationId: member.organization_id,
            guildId: member.home_guild_id,
          },
          member.user_ciphertext,
        ),
      ) === actorHash,
  );
}

/** Caller holds the organization lock. Denial never depends on Discord membership. */
export async function bindRevokedMembers(
  tx: Tx,
  vault: IdentityVault,
  root: string,
) {
  const organization = (
    await sql<{
      home_guild_id: string;
    }>`SELECT home_guild_id FROM operations_organizations WHERE id=${root}::uuid`.execute(
      tx,
    )
  ).rows[0];
  if (!organization) return;
  const members = (
    await sql<{
      id: string;
      user_ciphertext: string;
    }>`SELECT id,user_ciphertext FROM operations_org_members WHERE organization_id=${root}::uuid AND state='REVOKED'`.execute(
      tx,
    )
  ).rows;
  const guilds = (
    await sql<{
      organization_id: string;
      guild_id: string;
    }>`SELECT organization_id,guild_id FROM operations_org_guilds WHERE root_organization_id=${root}::uuid`.execute(
      tx,
    )
  ).rows;
  for (const member of members) {
    const userId = vault.open(
      { organizationId: root, guildId: organization.home_guild_id },
      member.user_ciphertext,
    );
    for (const guild of guilds) {
      const scope = {
        organizationId: guild.organization_id,
        guildId: guild.guild_id,
      };
      await sql`INSERT INTO operations_role_bindings(organization_id,guild_id,root_organization_id,member_id,actor_hash) VALUES(${scope.organizationId}::uuid,${scope.guildId},${root}::uuid,${member.id}::uuid,${vault.hash(scope, userId)}) ON CONFLICT DO NOTHING`.execute(
        tx,
      );
    }
  }
}
