import { describe, expect, it } from "vitest";
import { publicationManifestExpiryDecision, purgeExpiredStaticPublicationManifests } from "../../packages/operations/src/alpha16-publication";
import type { Database } from "../../packages/db/src/index";
const now = new Date("2026-10-16T12:00:00Z"), later = new Date("2026-10-16T13:00:00Z");
const head = { publication_id: "11111111-1111-4111-8111-111111111111", generation: 3, active_generation: 3, pending_generation: null,
  withdrawn_generation: 2, withdrawn_source_version: 1, sync_state: "CONFIRMED", expires_at: later };
const row = { publication_id: head.publication_id, generation: 1, source_version: 1, source_row_revision: 1, previous_generation: 0,
  operation: "PUBLISH" as const, schema_version: 1 as const, artifact_hash: "a".repeat(64), state: "RETIRED" as const,
  effect_state: "CONFIRMED" as const, created_at: new Date("2026-10-16T10:00:00Z"), published_at: new Date("2026-10-16T10:01:00Z"), expires_at: now };
describe("alpha16 publication expiry keeps independent safety barriers", () => {
  it("deletes obsolete retired history below a retained generation without falsely blocking a newer active generation", () => {
    expect(publicationManifestExpiryDecision(head, row, now)).toEqual({ blockHead: false, withdrawalRequired: false });
    expect(publicationManifestExpiryDecision(head, { ...row, operation: "WITHDRAW", state: "RETRACTED" }, now)).toEqual({ blockHead: false, withdrawalRequired: false });
  });
  it("blocks active, admitted and unknown expired generations without assuming remote absence", () => {
    for (const expired of [{ ...row, state: "ACTIVE" as const }, { ...row, effect_state: "ADMITTED" as const }, { ...row, effect_state: "UNKNOWN" as const }])
      expect(publicationManifestExpiryDecision(head, expired, now)).toEqual({ blockHead: true, withdrawalRequired: true });
  });
  it("preserves the last unconfirmed generation and orphaned sources as blocked rather than reusing an identity", () => {
    expect(publicationManifestExpiryDecision({ ...head, generation: 0, active_generation: null, withdrawn_generation: 0 }, { ...row, state: "STAGED", effect_state: "PREPARED" }, now).blockHead).toBe(true);
    expect(publicationManifestExpiryDecision(null, row, now).blockHead).toBe(true);
    expect(publicationManifestExpiryDecision({ ...head, expires_at: now }, row, now)).toEqual({ blockHead: true, withdrawalRequired: true });
  });
  it("rejects unbounded batches and invalid clocks before accessing a DB", async () => {
    for (const limit of [0, 201, 1.5, NaN]) await expect(purgeExpiredStaticPublicationManifests({} as Database, now, limit)).rejects.toThrow();
    await expect(purgeExpiredStaticPublicationManifests({} as Database, new Date(NaN), 1)).rejects.toThrow("INVALID_REQUEST");
  });
});
