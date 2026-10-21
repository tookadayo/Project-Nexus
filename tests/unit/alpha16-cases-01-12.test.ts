import {describe, expect, it,vi} from "vitest";
import {ACTIONS_01_12, CASES_01_12, COMMUNITY_REQUEST_STATUSES, validCommunityRequest, validSuggestionConsumption} from "../../packages/rules/src/cases-01-12";
import {canonicalCaseHash, createAggregateBudget, evaluateCase, validateCaseCatalog,arbitrateCaseActions,caseWindowContains,validCohortWindow} from "../../packages/rules/src/case-engine";
import {all, any, cmp, eq, f, literal,ACTION_PRIORITY_BANDS, type CaseDefinition, type CaseFixture,type CaseEvaluation,type ActionCandidate} from "../../packages/rules/src/case-types";
import {CASE_FIXTURES_01_12, CASE_CALENDAR_FIXTURES_01_12,caseFixture} from "../fixtures/alpha16-cases-01-12";

const definition = (id: string) => CASES_01_12.find(item => item.id === id)!;
const evaluate = (fixture: CaseFixture, catalog: CaseDefinition = definition(fixture.caseId)) => evaluateCase(catalog, fixture.context, fixture.profile, fixture.registry, {now: () => Date.parse(fixture.context.evaluationAsOf)});
const fixture = (id: string) => structuredClone(CASE_FIXTURES_01_12.find(item => item.id === id)!);

describe("alpha16 corrected cases 01–12: synthetic contracts, not operational acceptance", () => {
  it("registers twelve distinct case/branch/action definitions with explicit unknown paths", () => {
    expect(CASES_01_12).toHaveLength(12); expect(validateCaseCatalog(CASES_01_12)).toEqual([]);
    expect(new Set(CASES_01_12.map(item => item.id)).size).toBe(12);
    expect(ACTIONS_01_12.every(action => action.mode === "REVIEW_ONLY")).toBe(true);
    expect(CASES_01_12.every(item => item.sourceMappings[0]?.confirmed === false && item.sourceMappings.some(source => source.confirmed && source.id.endsWith(".operator")))).toBe(true);
  });

  it.each(CASE_FIXTURES_01_12)("$id has a complete baseline and the independently declared path/action", row => {
    const result = evaluate(row);
    expect(result.branchPath).toEqual(row.expected.branchPath); expect(result.outcome).toBe(row.expected.outcome); expect(result.reasonCode).toBe(row.expected.reasonCode);
    expect(result.action?.actionId ?? null).toBe(row.expected.actionId); expect(result.action?.mode ?? null).toBe(row.expected.mode); expect(result.explanation?.explanationId ?? null).toBe(row.expected.explanationId);
    expect(result.publishable).toBe(false);
    expect(Object.keys(row.context.fields).sort()).toEqual([...new Set(definition(row.caseId).fields.map(field => field.observationField ?? field.id))].sort());
    if (result.action) {
      expect(result.explanation?.hypothesis === null || result.explanation?.hypothesis.isHypothesis).toBe(true);
      expect(Date.parse(result.action.actionableUntil)).toBeLessThanOrEqual(Math.min(...result.action.evidenceRefs.map(ref => Date.parse(ref.expiresAt))));
      expect(result.action.typedFields).toEqual({});
      expect(result.explanation?.sourceRefs.every(ref => ["CASE_OBSERVATION", "OFFICIAL_GUIDANCE", "DESIGN_INFERENCE"].includes(ref.provenance))).toBe(true);
    }
  });

  it.each(CASES_01_12)("$id keeps unapproved policy and unconfirmed sources disabled", item => {
    const row = structuredClone(CASE_FIXTURES_01_12.find(value => value.caseId === item.id)!);
    row.profile.kind = "OPERATIONAL";
    expect(evaluate(row).reasonCode).toBe("APPROVAL_REQUIRED");
    row.profile.approved = true; row.profile.retentionApproved = true;
    row.registry.sources.forEach(source => {source.confirmed = false;});
    const result = evaluate(row); expect(result.outcome).toBe("DISABLED"); expect(result.reasonCode).toBe("SOURCE_DISABLED"); expect(result.action).toBeNull();
  });

  it.each(["cancelled", "tombstoned"] as const)("does not publish partial evaluation after %s", flag => {
    const row = fixture("CASE02-BOT-ONLY"); row.context[flag] = true;
    const result = evaluate(row); expect(result.complete).toBe(false); expect(result.publishable).toBe(false); expect(result.action).toBeNull(); expect(result.reasonCode).toBe(flag.toUpperCase());
  });

  it("rejects permission, scope, target version, source and evidence expiry changes", () => {
    const original = fixture("CASE02-BOT-ONLY");
    for (const change of [
      (row: CaseFixture) => {row.context.permissions = [];},
      (row: CaseFixture) => {row.context.fields["welcome.channelPurpose"]!.authorityScope.guildId = "884000000000000002";},
      (row: CaseFixture) => {row.context.fields["welcome.channelPurpose"]!.authorityScope.liveVersion = "wrong-version";},
      (row: CaseFixture) => {row.registry.sources = [];},
      (row: CaseFixture) => {row.context.fields["welcome.channelPurpose"]!.expiresAt = row.context.evaluationAsOf;},
    ]) {
      const row = structuredClone(original); change(row); const result = evaluate(row);
      expect(result.action).toBeNull(); expect(result.publishable).toBe(false);
    }
  });

  it("keeps missing source separate from normally observed unconfirmed support outcomes", () => {
    for (const id of ["CASE03-OBSERVED-UNCONFIRMED", "CASE04-OBSERVED-UNCONFIRMED"]) {
      const row = fixture(id), first = definition(row.caseId).fields[0]!.id;
      expect(evaluate(row).outcome).toBe(row.caseId === "CASE03" ? "DIAGNOSTIC" : "ACTION");
      delete row.context.fields[first]; expect(evaluate(row)).toMatchObject({outcome: "INELIGIBLE", reasonCode: "INPUT_UNKNOWN", action: null});
    }
  });

  it("preserves three-valued FALSE AND UNKNOWN and TRUE OR UNKNOWN without unrelated missing suppression", () => {
    const row = fixture("CASE02-BOT-ONLY"), catalog = structuredClone(definition(row.caseId));
    const first = catalog.branches[0]!;
    first.predicate = any(eq("welcome.noContact", false), eq("welcome.channelPurpose", "INTRO")); delete row.context.fields["welcome.channelPurpose"];
    expect(evaluate(row, catalog).action?.actionId).toBe("CASE02-SUPPRESS-PRESSURE");
    first.predicate = all(eq("welcome.noContact", true), eq("welcome.channelPurpose", "INTRO"));
    expect(evaluate(row, catalog).action?.actionId).toBe("CASE02-HUMAN-WELCOME-REVIEW");
  });

  it("uses only the declared same-series four cohort points, permits differing cohort IDs and rejects incompatible metadata", () => {
    const row = fixture("CASE05-NEW-ONLY");
    expect(row.context.fields["cohort.newCurrent"]!.cohort!.cohortId).not.toBe(row.context.fields["cohort.newPrior"]!.cohort!.cohortId);
    expect(evaluate(row).reasonCode).toBe("NEW_ONLY_DECLINE");
    for (const field of ["cohort.newPrior", "cohort.establishedPrior"]) {
      for (const key of ["cohortDefinitionVersion", "campaignClass", "windowContractId"] as const) {
        const changed = structuredClone(row); changed.context.fields[field]!.cohort![key] = "incompatible";
        expect(evaluate(changed).action).toBeNull();
      }
    }
    const missingConfig = structuredClone(row); missingConfig.profile.metricConfigs = {}; expect(evaluate(missingConfig).action).toBeNull();
    const zero = structuredClone(row); zero.context.fields["cohort.newCurrent"]!.value = {numerator: 0, denominator: 0, coverage: 1}; expect(evaluate(zero).action).toBeNull();
  });

  it("keeps CASE07 enum-only and prioritizes CASE11 access despite missing unrelated repeat data", () => {
    expect(definition("CASE07").fields.every(field => field.type === "enum")).toBe(true);
    const row = fixture("CASE11-ACCESS-FIRST"); delete row.context.fields["event.repeatPoint"]; delete row.profile.metricConfigs["EVENT.DEDICATED_REPEAT_RATE"];
    expect(evaluate(row).action?.actionId).toBe("CASE11-EVENT_LOGISTICS_REVIEW");
    const dedicated = fixture("CASE11-DEDICATED"); delete dedicated.profile.metricConfigs["EVENT.DEDICATED_REPEAT_RATE"];
    expect(evaluate(dedicated).action).toBeNull();
    expect(evaluate(fixture("CASE11-FEEDBACK-ONLY")).action?.actionId).toBe("CASE11-OPTIONAL_FEEDBACK_REVIEW");
  });

  it("keeps community request and AI Suggestion states/identities separate", () => {
    const row = fixture("CASE09-OWNER-WITHOUT-CANONICAL"); expect(row.context.fields["request.canonicalRef"]!.value).toBeNull(); expect(evaluate(row).action?.target.targetId).toBe("R-CASE09");
    expect(COMMUNITY_REQUEST_STATUSES).not.toContain("CONSUMED"); expect(COMMUNITY_REQUEST_STATUSES).not.toContain("ACTIVE");
    expect(validCommunityRequest({requestId: "R-001", status: "SUBMITTED", duplicateOfRequestId: null, canonicalRef: null, ownerRoleId: null, ownerAssigned: false})).toBe(true);
    expect(validCommunityRequest({requestId: "R-001", status: "UNDER_REVIEW", duplicateOfRequestId: null, canonicalRef: null, ownerRoleId: null, ownerAssigned: true})).toBe(false);
    expect(validSuggestionConsumption("CONSUMED", "NONE")).toBe(false); expect(validSuggestionConsumption("CONSUMED", "DB_COMMIT_CONFIRMED")).toBe(true); expect(validSuggestionConsumption("ACTIVE", "NONE")).toBe(true);
  });

  it("keeps domain UNCLASSIFIED separate from quality UNKNOWN and never treats protected restriction as an obstruction", () => {
    expect(evaluate(fixture("CASE10-PROTECTED-RESTRICTED")).reasonCode).toBe("PRESERVE");
    const row = fixture("CASE10-UNCLASSIFIED"); expect(evaluate(row).action?.actionId).toBe("CASE10-CHANNEL_PURPOSE_CONFIRM");
    row.context.fields["channel.purpose"]!.quality = "UNKNOWN"; expect(evaluate(row)).toMatchObject({outcome: "INELIGIBLE", reasonCode: "INPUT_QUALITY", action: null});
  });

  it("does not charge catalog static size as runtime and enforces separate per-case/aggregate budgets", () => {
    const row = fixture("CASE01-ACCESS"); row.profile.budget.maxSteps = 1; expect(evaluate(row).outcome).toBe("ACTION");
    row.profile.budget.maxOperations = 1; expect(evaluate(row)).toMatchObject({complete: false, action: null, reasonCode: "CASE_BUDGET_EXCEEDED"});
    const normal = fixture("CASE01-ACCESS"), aggregateBudget = createAggregateBudget({maxSteps: 1, maxOperations: 100, maxInputs: 100}), options = {aggregateBudget, now: () => Date.parse(normal.context.evaluationAsOf)};
    expect(evaluateCase(definition(normal.caseId), normal.context, normal.profile, normal.registry, options).outcome).toBe("ACTION");
    expect(evaluateCase(definition(normal.caseId), normal.context, normal.profile, normal.registry, options)).toMatchObject({complete: false, action: null, publishable: false, reasonCode: "AGGREGATE_BUDGET_EXCEEDED"});
  });

  it("fixes asOf/hash/references across retries and normalizes timestamp spelling and set order", () => {
    const row = fixture("CASE02-BOT-ONLY"), before = structuredClone(row), result = evaluate(row);
    expect(evaluate(row)).toEqual(result); expect(row).toEqual(before);
    const reordered = structuredClone(row); reordered.context.permissions.reverse(); reordered.context.sourceHealth.reverse(); reordered.context.evaluationAsOf = "2026-10-15T12:00:00Z";
    expect(evaluate(reordered).canonicalHash).toBe(result.canonicalHash);
    expect(canonicalCaseHash({a: 1, b: 2})).toBe(canonicalCaseHash({b: 2, a: 1}));
  });

  it("rejects undeclared fields/enums, missing unknown paths, duplicate IDs, incompatible units and branch cycles", () => {
    const original = definition("CASE01");
    const malformed: CaseDefinition[] = [];
    const field = structuredClone(original); field.branches[0]!.predicate = eq("missing.field", true); malformed.push(field);
    const enumeration = structuredClone(original); enumeration.branches[0]!.predicate = eq("onb.actualAccess", "invented"); malformed.push(enumeration);
    const unknown = structuredClone(original); delete (unknown.branches[0] as Partial<CaseDefinition["branches"][number]>).unknownNext; malformed.push(unknown);
    const cycle = structuredClone(original); cycle.branches[0]!.trueNext = {branchId: cycle.entryBranchId}; malformed.push(cycle);
    const duplicate = structuredClone(original); duplicate.branches.push(structuredClone(duplicate.branches[0]!)); malformed.push(duplicate);
    const units = structuredClone(definition("CASE03")); units.branches[0]!.predicate = cmp("<", f("support.unansweredAgeSeconds"), literal(1, "count")); malformed.push(units);
    for (const catalog of malformed) expect(validateCaseCatalog([catalog]).length).toBeGreaterThan(0);
    expect(validateCaseCatalog([original, original]).some(issue => issue.code === "CASE_ID")).toBe(true);
  });

  it("rejects completed-evaluation bypass and deadline overrun without a partial suggestion", () => {
    const row = caseFixture("CASE01", "incomplete", {"onb.actualAccess": "NO_ACCESS"}, ["ACCESS"], "ACCESS-REVIEW"); row.context.evaluationComplete = false;
    expect(evaluate(row)).toMatchObject({outcome: "INELIGIBLE", reasonCode: "EVALUATION_INCOMPLETE", action: null});
    row.context.evaluationComplete = true; row.context.deadlineAt = row.context.evaluationAsOf;
    expect(evaluate(row)).toMatchObject({outcome: "INELIGIBLE", reasonCode: "DEADLINE_EXCEEDED", action: null});
  });

  it("classifies every registered action and applies the exact IV0 cross-case precedence",()=>{
    expect(ACTIONS_01_12.every(a=>ACTION_PRIORITY_BANDS.includes(a.priorityBand))).toBe(true);
    const first=evaluate(fixture("CASE03-SOLVED")),second=evaluate(fixture("CASE04-UNCLEAR")),window=fixture("CASE03-SOLVED").context.window;
    const candidate=(result:CaseEvaluation,priority:Partial<ActionCandidate["priority"]>):CaseEvaluation=>({...structuredClone(result),action:{...structuredClone(result.action!),target:{targetType:"ISSUE_TARGET",targetId:"shared-issue",liveVersion:"1"},priority:{band:"PENDING_TASK",targetSpecificity:"ENTITY",satisfiedConditions:1,explicitPriority:0,branchId:result.caseId+"-BRANCH",...priority}}});
    const arbitrate=(left:CaseEvaluation,right:CaseEvaluation)=>arbitrateCaseActions([right,left],{CASE03:window,CASE04:window});
    for(let index=0;index<ACTION_PRIORITY_BANDS.length-1;index++){
      const result=arbitrate(candidate(first,{band:ACTION_PRIORITY_BANDS[index]!,satisfiedConditions:1}),candidate(second,{band:ACTION_PRIORITY_BANDS[index+1]!,satisfiedConditions:100,explicitPriority:-100}));
      expect(result.valid).toBe(true);expect(result.results.find(r=>r.caseId==="CASE03")?.arbitration?.status).toBe("SELECTED");expect(result.results.find(r=>r.caseId==="CASE04")).toMatchObject({outcome:"NO_ACTION",reasonCode:"CONFLICT_SUPPRESSED",action:null,publishable:false});
    }
    for(const [left,right] of [
      [candidate(first,{targetSpecificity:"POLICY"}),candidate(second,{targetSpecificity:"ENTITY"})],
      [candidate(first,{satisfiedConditions:1}),candidate(second,{satisfiedConditions:2})],
      [candidate(first,{explicitPriority:10}),candidate(second,{explicitPriority:1})],
      [candidate(first,{branchId:"Z-last"}),candidate(second,{branchId:"A-first"})],
    ])expect(arbitrate(left!,right!).results.find(r=>r.caseId==="CASE04")?.arbitration?.status).toBe("SELECTED");
    const isolated=candidate(second,{});isolated.action!.target.targetId="other-issue";expect(arbitrate(candidate(first,{}),isolated).results.filter(r=>r.action)).toHaveLength(2);
    const missing=candidate(first,{});delete (missing.action!.priority as Partial<ActionCandidate["priority"]>).band;expect(arbitrate(missing,candidate(second,{}))).toMatchObject({valid:false,reasonCode:"CASE_PRIORITY_UNCLASSIFIED"});
    const version=candidate(second,{});version.action!.target.liveVersion="2";expect(arbitrate(candidate(first,{}),version)).toMatchObject({valid:false,reasonCode:"CASE_TARGET_VERSION_AMBIGUOUS"});
  });
  it("compares declared calendar days across DST and UTC day crossings with an exclusive end",()=>{
    for(const row of CASE_CALENDAR_FIXTURES_01_12){
      expect(evaluate(row).reasonCode).toBe("NEW_ONLY_DECLINE");
      const current=row.context.fields["cohort.newCurrent"]!,prior=row.context.fields["cohort.newPrior"]!;
      expect(validCohortWindow(current,true)).toBe(true);expect(validCohortWindow(prior,true)).toBe(true);
      expect(caseWindowContains(current.window,current.window.start)).toBe(true);expect(caseWindowContains(current.window,current.window.end)).toBe(false);
      expect(caseWindowContains(current.window,new Date(Date.parse(current.window.end)-1).toISOString())).toBe(true);
      if(row.id.includes("DST"))expect(current.cohort!.metricWindowSeconds).not.toBe(prior.cohort!.metricWindowSeconds);
    }
    const spring=structuredClone(CASE_CALENDAR_FIXTURES_01_12[0]!);spring.context.fields["cohort.newPrior"]!.cohort!.timeZone="Europe/London";expect(evaluate(spring).action).toBeNull();
    const boundary=structuredClone(CASE_CALENDAR_FIXTURES_01_12[0]!);boundary.context.fields["cohort.newCurrent"]!.window.start="2026-03-08T05:00:01Z";expect(evaluate(boundary).action).toBeNull();
    const missing=structuredClone(CASE_CALENDAR_FIXTURES_01_12[0]!);delete (missing.context.fields["cohort.newCurrent"]!.cohort!.resolvedCalendar as {confirmed?:true}).confirmed;expect(evaluate(missing).action).toBeNull();
  });
  it("keeps confirmed calendar instants fixed on replay instead of re-resolving current Intl rules",()=>{
    const observation=structuredClone(CASE_CALENDAR_FIXTURES_01_12[0]!.context.fields["cohort.newCurrent"]!);
    const clock=vi.spyOn(Intl,"DateTimeFormat").mockImplementation(()=>{throw new Error("changed runtime rules");});
    try{expect(validCohortWindow(observation)).toBe(true);expect(validCohortWindow(observation,true)).toBe(false);}finally{clock.mockRestore();}
  });
});
