import { describe, expect, it, vi } from "vitest";
import { PermissionFlagsBits as P } from "discord-api-types/v10";
import { canReadPostMetadata } from "../../packages/discord/src/attention-visibility";
import {
  DiscordRest,
  DiscordFailure,
  type Member,
} from "../../packages/discord/src/rest";
import type { RawChannel } from "../../packages/discord/src/discovery";
const guild = "111111111111111111",
  user = "222222222222222222",
  role = "333333333333333333",
  channel = "444444444444444444",
  parent = "555555555555555555";
const member: Member = {
  permissions: String(P.ViewChannel | P.ReadMessageHistory),
  roles: [role],
  joinedAt: "",
  bot: false,
};
const raw: RawChannel = { id: channel, type: 0, permission_overwrites: [] };
describe("current Attention channel visibility", () => {
  it("requires both view and message-history access", () => {
    expect(canReadPostMetadata(raw, guild, user, member)).toBe(true);
    expect(
      canReadPostMetadata(raw, guild, user, {
        ...member,
        permissions: String(P.ViewChannel),
      }),
    ).toBe(false);
    expect(
      canReadPostMetadata(
        { ...raw, permission_overwrites: undefined },
        guild,
        user,
        member,
      ),
    ).toBe(false);
  });
  it("applies everyone, combined role and member overwrites in Discord order", () => {
    const overwrites = [
      { id: guild, type: 0, deny: String(P.ViewChannel), allow: "0" },
      { id: role, type: 0, deny: "0", allow: String(P.ViewChannel) },
    ];
    expect(
      canReadPostMetadata(
        { ...raw, permission_overwrites: overwrites },
        guild,
        user,
        member,
      ),
    ).toBe(true);
    expect(
      canReadPostMetadata(
        {
          ...raw,
          permission_overwrites: [
            ...overwrites,
            {
              id: user,
              type: 1,
              deny: String(P.ReadMessageHistory),
              allow: "0",
            },
          ],
        },
        guild,
        user,
        member,
      ),
    ).toBe(false);
    expect(
      canReadPostMetadata(
        {
          ...raw,
          permission_overwrites: [
            ...overwrites,
            {
              id: user,
              type: 1,
              deny: String(P.ReadMessageHistory),
              allow: "0",
            },
          ],
        },
        guild,
        user,
        { ...member, permissions: String(P.Administrator) },
      ),
    ).toBe(true);
  });
  it.each([10, 11])(
    "checks a public thread type %i through current parent metadata without fetching posts",
    async (type) => {
      const rest = new DiscordRest("synthetic", "999999999999999999"),
        request = vi
          .spyOn(
            rest as unknown as { request: (path: string) => Promise<unknown> },
            "request",
          )
          .mockImplementation(async (path) =>
            path === `/channels/${channel}`
              ? { ...raw, type, parent_id: parent, guild_id: guild }
              : { ...raw, id: parent, type: 15, guild_id: guild },
          );
      expect(
        await rest.canReadAttentionChannel(guild, channel, user, member),
      ).toBe(true);
      expect(request.mock.calls.map((call) => call[0])).toEqual([
        `/channels/${channel}`,
        `/channels/${parent}`,
      ]);
    },
  );
  it("fails closed for private threads, other guilds, deleted channels and missing parents", async () => {
    for (const data of [
      { ...raw, type: 12, guild_id: guild },
      { ...raw, guild_id: "another-guild" },
      { ...raw, type: 11, guild_id: guild },
    ]) {
      const rest = new DiscordRest("synthetic", "999999999999999999");
      vi.spyOn(
        rest as unknown as { request: (path: string) => Promise<unknown> },
        "request",
      ).mockResolvedValue(data);
      expect(
        await rest.canReadAttentionChannel(guild, channel, user, member),
      ).toBe(false);
    }
    const rest = new DiscordRest("synthetic", "999999999999999999");
    vi.spyOn(
      rest as unknown as { request: (path: string) => Promise<unknown> },
      "request",
    ).mockRejectedValue(new DiscordFailure(404));
    expect(
      await rest.canReadAttentionChannel(guild, channel, user, member),
    ).toBe(false);
  });
  it("does not turn a Discord outage into an empty authorized list", async () => {
    const rest = new DiscordRest("synthetic", "999999999999999999");
    vi.spyOn(
      rest as unknown as { request: (path: string) => Promise<unknown> },
      "request",
    ).mockRejectedValue(new DiscordFailure(503));
    await expect(
      rest.canReadAttentionChannel(guild, channel, user, member),
    ).rejects.toThrow();
  });
});
