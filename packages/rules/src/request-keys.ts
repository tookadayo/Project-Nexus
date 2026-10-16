import { createHmac,randomBytes,timingSafeEqual } from "node:crypto";
import { assert } from "../../shared/src/index";
import { digest } from "./domain";
export interface RuleRequestKeyBinding {organizationId:string;guildId:string;actorHash:string;operationClass:string;bodyHash:string;}
function signature(secret:string,binding:RuleRequestKeyBinding,header:string){
 assert(secret.length>=32,"REQUEST_KEY_UNAVAILABLE",503);
 return createHmac("sha256",secret).update(digest({purpose:"RULE_COMMUNICATION_REQUEST_KEY_V1",binding,header})).digest("hex");
}
/** An expiring wire form of Idempotency-Key. It grants no domain permission,
 * operation admission or receipt access. Its own expiry prevents a purged key
 * from becoming a new request, without an indefinitely retained key tombstone. */
export function issueRuleRequestKey(secret:string,binding:RuleRequestKeyBinding,now:Date,expiresAt:Date){
 assert(expiresAt>now&&Number.isSafeInteger(expiresAt.getTime()),"INVALID_REQUEST_KEY_EXPIRY");
 const header=`rk1.${expiresAt.getTime().toString(36)}.${randomBytes(16).toString("hex")}`;
 return header+"."+signature(secret,binding,header);
}
export function verifyRuleRequestKey(secret:string,binding:RuleRequestKeyBinding,key:string,now:Date){
 const match=/^(rk1\.([0-9a-z]{1,11})\.[a-f0-9]{32})\.([a-f0-9]{64})$/.exec(key);
 assert(match,"INVALID_IDEMPOTENCY_KEY");const actual=Buffer.from(match[3]!,"hex"),expected=Buffer.from(signature(secret,binding,match[1]!),"hex");
 assert(actual.length===expected.length&&timingSafeEqual(actual,expected),"INVALID_IDEMPOTENCY_KEY");
 const expires=Number.parseInt(match[2]!,36);assert(Number.isSafeInteger(expires),"INVALID_IDEMPOTENCY_KEY");assert(expires>now.getTime(),"IDEMPOTENCY_KEY_EXPIRED",409);
 return new Date(expires);
}
