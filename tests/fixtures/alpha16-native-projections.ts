import type {NativeReportDeliveryRow} from "../../packages/rules/src/native-projections";
export const nativeProjectionClock = new Date("2026-10-16T12:00:00.000Z");
export const nativeRunProjectionFixture = [
  {id: "a1681000-0000-4000-8000-000000000001", revision: 3, status: "COMPLETED", ended_at: nativeProjectionClock, deadline_at: nativeProjectionClock, updated_at: nativeProjectionClock},
  {id: "a1681000-0000-4000-8000-000000000002", revision: 3, status: "FAILED", ended_at: nativeProjectionClock, deadline_at: nativeProjectionClock, updated_at: nativeProjectionClock},
  {id: "a1681000-0000-4000-8000-000000000003", revision: 3, status: "UNKNOWN", ended_at: nativeProjectionClock, deadline_at: nativeProjectionClock, updated_at: nativeProjectionClock},
  {id: "a1681000-0000-4000-8000-000000000004", revision: 3, status: "WAITING_APPROVAL", ended_at: null, deadline_at: nativeProjectionClock, updated_at: nativeProjectionClock},
  {id: "a1681000-0000-4000-8000-000000000005", revision: 3, status: "CANCELLED", ended_at: nativeProjectionClock, deadline_at: nativeProjectionClock, updated_at: nativeProjectionClock},
  {id: "a1681000-0000-4000-8000-000000000006", revision: 3, status: "EXPIRED", ended_at: nativeProjectionClock, deadline_at: nativeProjectionClock, updated_at: nativeProjectionClock},
];
export const nativeDeliveryProjectionFixture: NativeReportDeliveryRow[] = [
  {id: "confirmed-success", actionId: "outbox-1", deliveryId: null, actionState: "SUCCEEDED", deliveryState: null},
  {id: "confirmed-failure", actionId: null, deliveryId: "delivery-1", actionState: null, deliveryState: "FAILED"},
  {id: "uncertain", actionId: "outbox-2", deliveryId: null, actionState: "UNKNOWN", deliveryState: null},
  {id: "generation-not-delivery", actionId: null, deliveryId: null, actionState: null, deliveryState: null},
  {id: "missing-retained-outbox", actionId: "missing", deliveryId: null, actionState: null, deliveryState: null},
];
