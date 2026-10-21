import {z} from "zod";
import {issueRegistryInput, issueRegistryRemoval} from "../../../../../packages/rules/src/issue-registry-contract";
export const ruleIssueMutation = z.discriminatedUnion("operation", [
  issueRegistryInput.extend({operation: z.literal("UPSERT")}).strict(),
  issueRegistryRemoval.extend({operation: z.literal("DELETE")}).strict(),
]);
export type IssueTarget = z.infer<typeof issueRegistryInput>["baseTarget"];
export interface RuleIssueEntry {id: string; version: number; issueCode: string; baseTarget: IssueTarget; experimentIds: string[]; playbookIds: string[]; experimentsComplete: boolean; playbooksComplete: boolean; expiresAt: string;}
export interface RuleIssueList {items: RuleIssueEntry[]; inventory: {experiments: {id: string; version: number; state: string}[]; playbooks: {id: string; version: number; state: string}[]};
  inventoryHashes: {experiments: string; playbooks: string};
  issueCodes: {issueCode: string; ruleId: string; targetType: string}[]; baseTargets: {issueCode: string; baseTarget: IssueTarget}[]; observedAt: string;}
