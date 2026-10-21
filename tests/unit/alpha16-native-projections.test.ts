import {describe, expect, it} from "vitest";
import {nativeSourceRequest, nativeRuntimeOutcomes, nativeReportDeliveryOutcomes, NATIVE_SOURCE_READERS} from "../../packages/rules/src/native-projections";
import {SOURCE_ADAPTER_CATALOG} from "../../packages/rules/src/source-adapters";
import {nativeDeliveryProjectionFixture, nativeRunProjectionFixture} from "../fixtures/alpha16-native-projections";
describe("alpha16 bounded native rule projection contracts", () => {
  it("counts one native Run once and preserves unknown, approval waits and excluded outcomes", () => {
    expect(nativeRuntimeOutcomes(nativeRunProjectionFixture)).toEqual({kind: "outcomes", succeeded: "1", failed: "1", unknown: "1", unfinished: "1", cancelled: "1", expired: "1"});
    expect(() => nativeRuntimeOutcomes([...nativeRunProjectionFixture, nativeRunProjectionFixture[0]!])).toThrow("RULE_RUN_DUPLICATE");
    expect(nativeRunProjectionFixture[0]!.status).toBe("COMPLETED");
  });
  it("uses confirmed outbound states rather than report generation state or a missing action", () => {
    expect(nativeReportDeliveryOutcomes(nativeDeliveryProjectionFixture)).toEqual({kind: "outcomes", succeeded: "1", failed: "1", unknown: "2", unfinished: "1", cancelled: "0", expired: "0"});
  });
  it("refuses two outbound identities for the same report and unregistered delivery states", () => {
    expect(() => nativeReportDeliveryOutcomes([{...nativeDeliveryProjectionFixture[0]!, deliveryId: "second-outbound"}])).toThrow("RULE_NATIVE_DELIVERY_AMBIGUOUS");
    expect(() => nativeReportDeliveryOutcomes([{...nativeDeliveryProjectionFixture[0]!, actionState: "SUCCEEDED_INFERRED"}])).toThrow("RULE_NATIVE_DELIVERY_STATE_UNVERIFIED");
    expect(() => nativeReportDeliveryOutcomes([nativeDeliveryProjectionFixture[0]!, nativeDeliveryProjectionFixture[0]!])).toThrow("RULE_NATIVE_REPORT_ROWS_INVALID");
  });
  it("keeps source implementation separate from projection approval and does not add unbounded sources", () => {
    expect(NATIVE_SOURCE_READERS.map(value => value.sourceType)).toEqual(["runtime_run_outcome_v1", "ReportOperationalStatusAdapter", "experiment_registry_v1", "playbook_mapping_registry_v1", "source_health_observation_v1","ONBOARDING_AGGREGATE_V1","INTAKE_STATUS_AGGREGATE_V1","PERMITTED_ENGAGEMENT_AGGREGATE_V1","ChannelParticipationAggregateAdapter","EventParticipationAggregateAdapter","runtime_execution_observation_v1","permission_observation_v1","permission_requirement_registry_v1","structured_issue_registry_v1"]);
    for (const row of NATIVE_SOURCE_READERS) {
      expect(row).not.toHaveProperty("approved");
      expect(SOURCE_ADAPTER_CATALOG.find(value => value.sourceType === row.sourceType)?.compatibility).toBe("EXPLICIT_PROJECTION_REQUIRED");
    }
  });
  it("does not accept browser approval, arbitrary SQL, content or source IDs as native projection inputs", () => {
    const valid = {kind: "AUTO_RUN_OUTCOMES", flowId: "flow", liveRevision: 3, windowStart: "2026-10-15T00:00:00Z", windowEnd: "2026-10-16T00:00:00Z", periodRole: "CURRENT", healthRefs: [{observationId: "a1681000-0000-4000-8000-000000000001", revision: "1"}]};
    expect(nativeSourceRequest.safeParse(valid).success).toBe(true);
    for (const extra of [{approved: true}, {sql: "SELECT *"}, {content: "PRIVATE_BODY"}, {sourceType: "arbitrary_source"}]) expect(nativeSourceRequest.safeParse({...valid, ...extra}).success).toBe(false);
    expect(nativeSourceRequest.safeParse({...valid, liveRevision: 0}).success).toBe(false);
  });
});
