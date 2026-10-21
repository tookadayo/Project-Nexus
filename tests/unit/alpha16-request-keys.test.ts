import { expect,it } from "vitest";
import { issueRuleRequestKey,verifyRuleRequestKey } from "../../packages/rules/src/request-keys";
it("expired/purged request keys cannot become new requests and never grant operation authority",()=>{
 const key="synthetic-component-key-only".repeat(2),now=new Date("2026-10-16T12:00:00Z"),end=new Date(now.getTime()+1000),binding={organizationId:"org",guildId:"guild",actorHash:"actor",operationClass:"EVALUATE",bodyHash:"a".repeat(64)};
 const wire=issueRuleRequestKey(key,binding,now,end);expect(wire.length).toBeLessThanOrEqual(128);expect(verifyRuleRequestKey(key,binding,wire,now)).toEqual(end);
 expect(()=>verifyRuleRequestKey(key,binding,wire,end)).toThrow("IDEMPOTENCY_KEY_EXPIRED");
 for(const changed of [{...binding,guildId:"other"},{...binding,actorHash:"other"},{...binding,operationClass:"APPLY"},{...binding,bodyHash:"b".repeat(64)}])expect(()=>verifyRuleRequestKey(key,changed,wire,now)).toThrow("INVALID_IDEMPOTENCY_KEY");
 expect(()=>verifyRuleRequestKey(key,binding,wire.replace("rk1.","receipt."),now)).toThrow("INVALID_IDEMPOTENCY_KEY");
});
