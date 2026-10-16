import {describe, expect, it} from "vitest";
import {ruleIssueMutation} from "../../apps/web/app/rules/issues/model";
const id = "11111111-1111-4111-8111-111111111111";
const input = {operation: "UPSERT", id, expectedVersion: 0, issueCode: "ONB-001", baseTarget: {targetType: "ONBOARDING_FLOW", targetId: id, liveVersion: "1"}, experimentIds: [], playbookIds: [], experimentsComplete: false, playbooksComplete: false, validForSeconds: 3600, inventoryHashes: {experiments: "a".repeat(64), playbooks: "b".repeat(64)}};
describe("alpha16 rule issue browser contract", () => {
  it("preserves empty undeclared inventories separately from declared completeness", () => {
    expect(ruleIssueMutation.parse(input)).toMatchObject({experimentIds: [], experimentsComplete: false, playbookIds: [], playbooksComplete: false});
    expect(ruleIssueMutation.parse({...input, experimentsComplete: true})).toMatchObject({experimentsComplete: true});
  });
  it("requires both displayed inventory fingerprints and the bounded validity", () => {
    for (const value of [{...input, inventoryHashes: undefined}, {...input, inventoryHashes: {experiments: "a".repeat(64)}}, {...input, validForSeconds: 0}, {...input, validForSeconds: 172801}]) expect(ruleIssueMutation.safeParse(value).success).toBe(false);
  });
  it("rejects browser authority, scope, content and unknown operations", () => {
    for (const extra of [{actorHash: "fixture"}, {guildId: "222222222222222222"}, {approved: true}, {factValue: 1}, {body: "DO_NOT_ACCEPT"}]) expect(ruleIssueMutation.safeParse({...input, ...extra}).success).toBe(false);
    expect(ruleIssueMutation.safeParse({...input, operation: "APPLY"}).success).toBe(false);
    expect(ruleIssueMutation.parse({operation: "DELETE", id, expectedVersion: 1})).toEqual({operation: "DELETE", id, expectedVersion: 1});
    expect(ruleIssueMutation.safeParse({operation: "DELETE", id, expectedVersion: 0}).success).toBe(false);
  });
});
