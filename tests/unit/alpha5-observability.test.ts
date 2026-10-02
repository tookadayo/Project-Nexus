import { it, expect } from "vitest";
import {
  safeTraceAttributes,
  traceStep,
} from "../../packages/shared/src/observability";
import { redactSecrets } from "../../packages/shared/src/diagnostics";
import {
  refreshPriority,
  refreshJitter,
} from "../../packages/lifecycle/src/discovery";
it("exports only operation categories, never secrets or Discord identifiers", async () => {
  expect(
    safeTraceAttributes({
      "signal.kind": "MESSAGE_CREATE",
      token: "secret",
      content: "body",
      guildId: "111111111111111111",
      stage: "111111111111111111",
    }),
  ).toEqual({ "signal.kind": "MESSAGE_CREATE" });
  expect(
    redactSecrets("member 111111111111111111 hash " + "a".repeat(64)),
  ).toBe("member [DISCORD_ID] hash [PSEUDONYM]");
  expect(await traceStep("event.project", {}, async () => 42)).toBe(42);
});
it("prioritizes manual, install and permissions and spreads periodic work deterministically", () => {
  expect(refreshPriority("manual")).toBeGreaterThan(refreshPriority("install"));
  expect(refreshPriority("install")).toBeGreaterThan(
    refreshPriority("permission"),
  );
  expect(refreshPriority("permission")).toBeGreaterThan(
    refreshPriority("periodic"),
  );
  const a = {
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      guildId: "111111111111111111",
    },
    b = { ...a, organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
  expect(refreshJitter(a, 0, 300000)).toBe(refreshJitter(a, 0, 300000));
  expect(refreshJitter(a, 0, 300000)).not.toBe(refreshJitter(b, 0, 300000));
});
