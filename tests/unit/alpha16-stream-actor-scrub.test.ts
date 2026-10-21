import {describe, expect, it, vi} from "vitest";
import type {Redis} from "ioredis";
import type {IdentityVault} from "../../packages/identity/src/index";
import type {Envelope} from "../../packages/events/src/index";
vi.mock("../../apps/gateway/src/index.js", () => ({STREAM: "synthetic-stream"}));
import {scrubStream} from "../../apps/worker/src/streams";
const scope = {organizationId: "a1680000-0000-4000-8000-000000000002", guildId: "333333333333333333"}, actorHash = "a".repeat(64);
const base: Envelope = {...scope, shardId: 0, gatewaySessionId: "synthetic-session", sequence: 1, kind: "channel.post_observed", at: "2026-10-16T12:00:00Z", context: "PRODUCTION", channelId: "444444444444444444", messageId: "555555555555555555"};
const vault = {open: (_s: unknown, value: string) => value, hash: (_s: unknown, value: string) => value === "synthetic-deleted" ? actorHash : "b".repeat(64)} as unknown as IdentityVault;
function fixture(events: Envelope[]) {
  let read = false;
  const redis = {xrange: vi.fn(async () => {if (read) return []; read = true; return events.map((event, index) => [`${index + 1}-0`, ["event", JSON.stringify(event)]]);}), xdel: vi.fn(async (_stream: string, _id: string) => 1), xadd: vi.fn(), xack: vi.fn()};
  return {redis, scrub: (hash: string | null) => scrubStream(redis as unknown as Redis, vault, scope, hash)};
}
describe("alpha16 conservative nonhuman reply-reference actor scrub", () => {
  it("deletes same-guild BOT/WEBHOOK references without an actor while preserving unrelated humans and scopes", async () => {
    const events: Envelope[] = [
      {...base, authorKind: "BOT", referenceId: "666666666666666666"},
      {...base, authorKind: "WEBHOOK", referenceId: "666666666666666666"},
      {...base, authorKind: "BOT"},
      {...base, kind: "message.sent", encryptedUserId: "synthetic-deleted", referenceId: "666666666666666666"},
      {...base, kind: "message.sent", encryptedUserId: "synthetic-other", referenceId: "666666666666666666"},
      {...base, authorKind: "BOT", referenceId: "666666666666666666", guildId: "777777777777777777"},
      {...base, authorKind: "WEBHOOK", referenceId: "666666666666666666", organizationId: "a1680000-0000-4000-8000-000000000003"},
      {...base, authorKind: "BOT", targetHash: actorHash},
    ];
    const f = fixture(events); await f.scrub(actorHash);
    expect(f.redis.xdel.mock.calls.map(call => call[1])).toEqual(["1-0", "2-0", "4-0", "8-0"]);
    expect(f.redis.xadd).not.toHaveBeenCalled(); expect(f.redis.xack).not.toHaveBeenCalled();
  });
  it("preserves full-guild scrubbing and does not add nonhuman author identity", async () => {
    const events: Envelope[] = [{...base, authorKind: "BOT"}, {...base, kind: "message.sent", encryptedUserId: "synthetic-other"}, {...base, authorKind: "WEBHOOK", guildId: "777777777777777777"}];
    const f = fixture(events); await f.scrub(null);
    expect(f.redis.xdel.mock.calls.map(call => call[1])).toEqual(["1-0", "2-0"]);
    expect(f.redis.xadd).not.toHaveBeenCalled(); expect(events[0]).not.toHaveProperty("encryptedUserId");
  });
});
