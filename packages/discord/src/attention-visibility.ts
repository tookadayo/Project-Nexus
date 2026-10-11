import { PermissionFlagsBits } from "discord-api-types/v10";
import type { Member } from "./rest";
import type { RawChannel } from "./discovery";
/** Apply Discord's everyone, aggregate role, then member overwrites in order. */
export function canReadPostMetadata(
  channel: RawChannel,
  guildId: string,
  userId: string,
  member: Member,
) {
  let bits = BigInt(member.permissions);
  if (member.bot || ![0, 5, 15, 16].includes(channel.type)) return false;
  if ((bits & PermissionFlagsBits.Administrator) !== 0n) return true;
  if (!channel.permission_overwrites) return false;
  const everyone = channel.permission_overwrites.find(
    (o) => o.type === 0 && o.id === guildId,
  );
  if (everyone) bits = (bits & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n,
    deny = 0n;
  for (const o of channel.permission_overwrites)
    if (o.type === 0 && member.roles.includes(o.id)) {
      allow |= BigInt(o.allow);
      deny |= BigInt(o.deny);
    }
  bits = (bits & ~deny) | allow;
  const personal = channel.permission_overwrites.find(
    (o) => o.type === 1 && o.id === userId,
  );
  if (personal) bits = (bits & ~BigInt(personal.deny)) | BigInt(personal.allow);
  const required =
    PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;
  return (bits & required) === required;
}
