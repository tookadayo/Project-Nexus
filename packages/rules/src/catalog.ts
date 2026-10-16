import { RULE_CATALOG,REGISTERED_SOURCE_TYPES } from "./rule-catalog";
import { CASES_01_12 } from "./cases-01-12";
import { CASES_13_20 } from "./cases-13-20";
import { validateCaseCatalog } from "./case-engine";
import type { CaseDefinition } from "./case-types";
export const CASE_CATALOG:readonly CaseDefinition[]=Object.freeze([...CASES_01_12,...CASES_13_20]);
export function catalogView(){
 return {rules:RULE_CATALOG,sourceTypes:REGISTERED_SOURCE_TYPES,cases:CASE_CATALOG.map(c=>({id:c.id,revision:c.revision,rootTriggers:c.rootTriggers,sourceMappings:c.sourceMappings,actions:c.actions.map(a=>({id:a.id,mode:a.mode,ownerRole:a.ownerRole,explanationId:a.explanationId,explanation:c.explanations.find(e=>e.id===a.explanationId)})),audience:c.requiredAudience??"GUILD_AUTHORIZED"})),scope:"INITIAL_CATALOG",automaticApplicationAllowed:false};
}
/** Called explicitly at activation. Importing the catalog performs no I/O. */
export function assertCaseCatalogReady(){const issues=validateCaseCatalog(CASE_CATALOG);if(issues.length)throw new Error("CASE_CATALOG_INVALID");}
