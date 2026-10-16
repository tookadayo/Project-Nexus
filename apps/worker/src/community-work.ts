import type {Database} from "../../../packages/db/src/index";
import type {Scope} from "../../../packages/shared/src/index";
import {betaWork} from "../../../packages/security/src/hosted-beta";

/** Legacy work owns a separate-connection privacy/Beta fence. Community work
 * must acquire its canonical locks only after that fence has been released.
 * Each native community transaction retains its own current authority checks. */
export async function runCommunityMaintenance<T>(
  db:Database,
  scope:Scope,
  legacyWork:()=>Promise<void>,
  communityWork:()=>Promise<T>,
):Promise<T>{
  await betaWork(db,scope,legacyWork);
  return communityWork();
}
