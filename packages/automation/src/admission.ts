import type { AutomationAdmissionLimits } from "./quota";

/** Initial invitation Beta guardrails, not commercial plan entitlements.
 * The local synthetic probe is recorded in docs/alpha15-implementation.md.
 * One host execution slot limits burst load; durable waits release that slot.
 */
export const ALPHA15_BETA_ADMISSION: Readonly<AutomationAdmissionLimits> = Object.freeze({
  activeFlows: 3, monthlyRuns: 100, guildConcurrent: 1, globalConcurrent: 1,
  guildPending: 20, globalPending: 100,
  measurementId: "alpha15-local-synthetic-20261015",
});
export const ALPHA15_ADOPTED_ACTIONS: ReadonlySet<string> = new Set([
  "discord.sendMessage",
  "discord.editOwnMessage", "nexus.readTicket",
  "discord.addRole", "discord.removeRole",
  "discord.createChannel", "discord.createThread",
]);

export interface AutomationStoragePolicy {
  maxFlowsPerGuild:number;maxRevisionsPerFlow:number;maxGuildDefinitionBytes:number;maxHostDefinitionBytes:number;
}
/** Conservative storage guardrails for the initial local invitation Beta.
 * These bound retained JSON definitions, including old revisions and deleted
 * definitions awaiting erasure. They are not paid-plan limits or disk sizing. */
export const ALPHA15_AUTOMATION_STORAGE: Readonly<AutomationStoragePolicy> = Object.freeze({
  maxFlowsPerGuild:20,maxRevisionsPerFlow:20,maxGuildDefinitionBytes:8*1024*1024,maxHostDefinitionBytes:64*1024*1024,
});
