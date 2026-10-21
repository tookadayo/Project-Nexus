import {describe, expect, it} from "vitest";
import {configMutation} from "../../apps/web/app/rules/config/model";
import {ruleMutationEnvelope} from "../../packages/rules/src/communication";
describe("alpha16 exact operating configuration choices", () => {
  it("binds the displayed draft hash and current native head without authorizing a profile", () => {
    const value = configMutation({operation: "CONFIG_ACTIVATE", configVersion: 4, contentHash: "a".repeat(64)}, 6);
    expect(value).toEqual({operation: "CONFIG_ACTIVATE", expectedVersion: 6, payload: {baseConfigVersion: 6, draftConfigVersion: 4, draftContentHash: "a".repeat(64)}});
    expect(ruleMutationEnvelope.parse(value)).toEqual(value);
    expect(value).not.toHaveProperty("targetId"); expect(value?.payload).not.toHaveProperty("profile"); expect(value?.payload).not.toHaveProperty("approved");
  });
  it("keeps retirement distinct and rejects unavailable heads, versions and hashes", () => {
    expect(configMutation({operation: "CONFIG_RETIRE", configVersion: 5, contentHash: "b".repeat(64)}, 6)).toEqual({operation: "CONFIG_RETIRE", expectedVersion: 6, payload: {baseConfigVersion: 6, activeConfigVersion: 5, activeContentHash: "b".repeat(64)}});
    for (const head of [-1, NaN, 0.5]) expect(configMutation({operation: "CONFIG_RETIRE", configVersion: 5, contentHash: "b".repeat(64)}, head)).toBeNull();
    expect(configMutation({operation: "CONFIG_ACTIVATE", configVersion: 0, contentHash: "a".repeat(64)}, 0)).toBeNull();
    expect(configMutation({operation: "CONFIG_ACTIVATE", configVersion: 1, contentHash: ""}, 0)).toBeNull();
    expect(() => ruleMutationEnvelope.parse({operation: "CONFIG_ACTIVATE", payload: {}, actorHash: "injected"})).toThrow();
  });
});
