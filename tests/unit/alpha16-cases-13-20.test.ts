import { describe, expect, it } from "vitest";
import {
  ACTIONS_13_20, ACTION_PRIORITY_13_20, CASES_13_20, EXPLANATIONS_13_20,
  deriveDutyConcentration,
  deriveDiscussionTags,
  deriveFilterReview,
  type DutyAssignmentBucket,
} from "../../packages/rules/src/cases-13-20";
import { createAggregateBudget, evaluateCase, validateCaseCatalog } from "../../packages/rules/src/case-engine";
import { targetTypes } from "../../packages/rules/src/domain";
import {ACTION_PRIORITY_BANDS} from "../../packages/rules/src/case-types";
import { CASE_FIXTURES_13_20, CASE_BRANCH_FIXTURES_13_20 } from "../fixtures/alpha16-cases-13-20";

describe("alpha16 CASE13–20 corrected operational-context catalog", () => {
  it("declares eight operational roots and 32 review-only leaves with bilingual explanation and provenance", () => {
    expect(CASES_13_20.map((entry) => entry.id)).toEqual([
      "CASE13", "CASE14", "CASE15", "CASE16", "CASE17", "CASE18", "CASE19", "CASE20",
    ]);
    expect(validateCaseCatalog(CASES_13_20)).toEqual([]);
    expect(ACTIONS_13_20).toHaveLength(32);
    expect(EXPLANATIONS_13_20).toHaveLength(32);
    expect(Object.keys(ACTION_PRIORITY_13_20).sort()).toEqual(ACTIONS_13_20.map((action) => action.id).sort());
    for (const definition of CASES_13_20) {
      expect(definition.rootTriggers).toEqual(["AUTHORIZED_OPERATIONAL_CONTEXT"]);
      expect(definition.sourceMappings[0]?.confirmed).toBe(false);
      expect(definition.sourceMappings.some((source) => source.confirmed && source.id.endsWith(".operator") && source.codeRefs.includes("packages/rules/src/operational-context.ts:readStoredOperationalCase"))).toBe(true);
      expect(definition.provenance.some((source) => source.provenance === "OFFICIAL_GUIDANCE")).toBe(true);
      expect(definition.provenance.some((source) => source.provenance === "DESIGN_INFERENCE")).toBe(true);
      expect(definition.provenance.every((source) => source.effectMeasurement === "NOT_REPORTED")).toBe(true);
      for (const action of definition.actions) {
        expect(action.mode).toBe("REVIEW_ONLY");
        expect(targetTypes).toContain(action.targetType);
        expect(ACTION_PRIORITY_BANDS).toContain(action.priorityBand);
        expect(["ENTITY", "POLICY", "GUILD"]).toContain(action.targetSpecificity);
      }
      for (const explanation of definition.explanations) {
        for (const language of ["ja", "en"] as const) {
          const slots = explanation.translations?.[language];
          expect(slots?.observation.length).toBeGreaterThan(0);
          expect(slots?.branchReason.length).toBeGreaterThan(0);
          expect(slots?.action.length).toBeGreaterThan(0);
          expect(slots?.caution.length).toBeGreaterThan(0);
          expect(slots?.reviewCondition.length).toBeGreaterThan(0);
        }
      }
    }
  });

  for (const fixture of CASE_FIXTURES_13_20) {
    it(fixture.id, () => {
      const definition = CASES_13_20.find((entry) => entry.id === fixture.caseId)!;
      const result = evaluateCase(definition, fixture.context, fixture.profile, fixture.registry, {
        now: () => Date.parse(fixture.context.evaluationAsOf),
      });
      expect(result.branchPath).toEqual(fixture.expected.branchPath);
      expect(result.outcome).toBe(fixture.expected.outcome);
      expect(result.reasonCode).toBe(fixture.expected.reasonCode);
      expect(result.action?.actionId ?? null).toBe(fixture.expected.actionId);
      expect(result.action?.mode ?? null).toBe(fixture.expected.mode);
      expect(result.explanation?.explanationId ?? null).toBe(fixture.expected.explanationId);
      expect(result.publishable).toBe(false);
      if (result.action) {
        expect(result.action.evidenceRefs.length).toBeGreaterThan(0);
        expect(Date.parse(result.action.actionableUntil)).toBeLessThanOrEqual(Date.parse("2026-10-15T18:00:00Z"));
        expect(result.explanation?.branchPath).toEqual(result.branchPath);
        expect(result.explanation?.observationRefs.length).toBeGreaterThan(0);
      }
    });
  }

  it("fixes input/version/as-of deterministically without mutating the sealed fixture", () => {
    const fixture = structuredClone(CASE_BRANCH_FIXTURES_13_20.find((entry) => entry.id === "IV-D16-F04")!);
    const before = structuredClone(fixture);
    const definition = CASES_13_20.find((entry) => entry.id === fixture.caseId)!;
    const options = {now: () => Date.parse(fixture.context.evaluationAsOf)};
    const first = evaluateCase(definition, fixture.context, fixture.profile, fixture.registry, options);
    const second = evaluateCase(definition, fixture.context, fixture.profile, fixture.registry, options);
    expect(second).toEqual(first);
    expect(fixture).toEqual(before);
  });

  it("keeps restricted case results away from ordinary engagement audiences", () => {
    for (const definition of CASES_13_20.filter((entry) => Number(entry.id.slice(4)) <= 17)) {
      const fixture = structuredClone(CASE_BRANCH_FIXTURES_13_20.find((entry) => entry.caseId === definition.id)!);
      fixture.context.audience = "GUILD_AUTHORIZED";
      const result = evaluateCase(definition, fixture.context, fixture.profile, fixture.registry, {now: () => Date.parse(fixture.context.evaluationAsOf)});
      expect(result.outcome).toBe("INELIGIBLE");
      expect(result.reasonCode).toBe("AUDIENCE_RESTRICTED");
      expect(result.action).toBeNull();
    }
  });

  it("charges only executed work to the separate aggregate budget and stops incomplete publication", () => {
    const fixture = CASE_BRANCH_FIXTURES_13_20.find((entry) => entry.id === "IV-D13-F02")!;
    const definition = CASES_13_20.find((entry) => entry.id === fixture.caseId)!;
    const aggregate = createAggregateBudget({maxSteps: 1, maxOperations: 256, maxInputs: 128});
    expect(aggregate.steps).toBe(0);
    const result = evaluateCase(definition, fixture.context, fixture.profile, fixture.registry, {
      aggregateBudget: aggregate, now: () => Date.parse(fixture.context.evaluationAsOf),
    });
    expect(result.reasonCode).toBe("AGGREGATE_BUDGET_EXCEEDED");
    expect(result.action).toBeNull();
    expect(result.publishable).toBe(false);
  });
});

describe("alpha16 restricted operational aggregate adapters", () => {
  it("preserves explicit tag state while deriving bounded membership", () => {
    expect(deriveDiscussionTags("NOT_SET")).toEqual({state: "NOT_SET", containsCasualChat: false});
    expect(deriveDiscussionTags("UNASSESSED")).toEqual({state: "UNASSESSED", containsCasualChat: null});
    expect(deriveDiscussionTags(["CASUAL_CHAT", "HELP"])).toEqual({state: "DECLARED", containsCasualChat: true});
    expect(deriveDiscussionTags(["HELP"])).toEqual({state: "DECLARED", containsCasualChat: false});
    expect(() => deriveDiscussionTags(["INFERRED_SOLVED"] as never)).toThrow("CASE20_TAG_INVALID");
  });
  it("derives concentration across registered role/duty buckets, never people", () => {
    expect(
      deriveDutyConcentration([
        { bucketKind: "ROLE", bucketRef: "moderation", openAssignments: 8 },
        { bucketKind: "DUTY", bucketRef: "event-support", openAssignments: 2 },
      ]),
    ).toEqual({ state: "DEFINED", numerator: 8, denominator: 10, ratio: 0.8 });
    expect(deriveDutyConcentration(null).state).toBe("SOURCE_UNKNOWN");
    expect(deriveDutyConcentration([])).toEqual({
      state: "UNDEFINED", numerator: 0, denominator: 0, ratio: null,
    });
    expect(
      deriveDutyConcentration([
        { bucketKind: "DUTY", bucketRef: "queue", openAssignments: 0 },
      ]).state,
    ).toBe("UNDEFINED");
  });

  it("rejects unsupported individual buckets, duplicates, invalid counts and unbounded input", () => {
    const role: DutyAssignmentBucket = {
      bucketKind: "ROLE", bucketRef: "moderation", openAssignments: 1,
    };
    expect(() => deriveDutyConcentration([role, role])).toThrow("CASE14_BUCKET_DUPLICATE");
    expect(() => deriveDutyConcentration([
      { ...role, bucketKind: "USER" } as unknown as DutyAssignmentBucket,
    ])).toThrow("CASE14_BUCKET_INVALID");
    for (const count of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000])
      expect(() => deriveDutyConcentration([{ ...role, openAssignments: count }]))
        .toThrow("CASE14_BUCKET_INVALID");
    expect(() => deriveDutyConcentration([
      { ...role, openAssignments: 0xffff_ffff },
      { ...role, bucketRef: "other", openAssignments: 1 },
    ])).toThrow("CASE14_TOTAL_INVALID");
    expect(() => deriveDutyConcentration(Array.from({ length: 129 }, (_, index) => ({
      ...role, bucketRef: `bucket-${index}`,
    })))).toThrow("CASE14_BUCKET_LIMIT");
  });

  it("uses one immutable review set and exact unrounded false-positive ratio", () => {
    const result = deriveFilterReview({
      reviewSetRef: "review-17-v3", staffFpCount: 6, totalReviewed: 30,
      triggeredRuleIds: ["R17", "R17"], declaredTriggeredRuleCount: 1,
    });
    expect(result.fpRate).toBe(0.2);
    expect(result.triggeredRuleIds).toEqual(["R17"]);
    expect(result.triggeredRuleCount).toBe(1);
    expect(deriveFilterReview({
      reviewSetRef: "empty-v1", staffFpCount: 0, totalReviewed: 0,
      triggeredRuleIds: [],
    })).toMatchObject({ fpRateState: "UNDEFINED", fpRate: null });
  });

  it("rejects impossible review counts and disagreement with the corresponding trigger set", () => {
    const input = {
      reviewSetRef: "review-17-v3", staffFpCount: 5, totalReviewed: 30,
      triggeredRuleIds: ["R17", "R21"],
    };
    expect(() => deriveFilterReview({ ...input, staffFpCount: 31 }))
      .toThrow("CASE15_REVIEW_SET_INVALID");
    expect(() => deriveFilterReview({ ...input, totalReviewed: -1 }))
      .toThrow("CASE15_REVIEW_SET_INVALID");
    expect(() => deriveFilterReview({ ...input, declaredTriggeredRuleCount: 1 }))
      .toThrow("CASE15_TRIGGER_COUNT_MISMATCH");
  });
});
