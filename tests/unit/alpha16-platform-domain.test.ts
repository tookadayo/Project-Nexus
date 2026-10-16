import { describe,expect,it } from "vitest";
import { canonicalJson,digest,lineageKey,retentionExpiry,encodeCursor,decodeCursor,expectedVersion,type PlatformPolicy } from "../../packages/rules/src/domain";
const now=new Date("2026-10-16T12:00:00.000Z");
// Synthetic policy only; never imported by runtime configuration.
const fixturePolicy:PlatformPolicy={kind:"OPERATIONAL",revision:"synthetic-only",approved:true,visibilityApproved:true,retention:{FACT:{seconds:120,approvalReference:"SYNTHETIC_NOT_OPERATIONAL"}}};
describe("alpha16 platform invariants",()=>{
 it("does not invent retention approvals or extend evidence expiry",()=>{
  expect(()=>retentionExpiry(undefined,"FACT",now)).toThrow("RETENTION_NOT_APPROVED");
  expect(()=>retentionExpiry({...fixturePolicy,approved:false},"FACT",now)).toThrow("RETENTION_NOT_APPROVED");
  expect(()=>retentionExpiry(fixturePolicy,"HISTORY",now)).toThrow("RETENTION_NOT_APPROVED");
  expect(retentionExpiry(fixturePolicy,"FACT",now,new Date(now.getTime()+15000)).getTime()).toBe(now.getTime()+15000);
 });
 it("canonicalizes key order, preserves arrays and rejects non-json values",()=>{
  expect(digest({b:1,a:[true,null,"x"]})).toBe(digest({a:[true,null,"x"],b:1}));
  expect(canonicalJson({minus:-0})).toBe('{"minus":0}');
  expect(()=>canonicalJson({bad:NaN})).toThrow();expect(()=>canonicalJson(new Date())).toThrow();
  expect(digest([1,2])).not.toBe(digest([2,1]));
 });
 it("separates absent, stale and state preconditions",()=>{
  expect(()=>expectedVersion(null)).toThrow("PRECONDITION_REQUIRED");
  expect(expectedVersion('"12"')).toBe(12);
  expect(()=>expectedVersion('*')).toThrow("INVALID_REQUEST");
 });
 it("keeps lineage independent of config/window versions",()=>{
  const identity={organizationId:"org",guildId:"guild",targetType:"CHANNEL",targetId:"channel",issueCode:"GAP",metricScope:"registered-scope"};
  expect(lineageKey(identity)).toBe(lineageKey({...identity}));
  expect(lineageKey(identity)).not.toBe(lineageKey({...identity,targetId:"other"}));
 });
 it("binds cursor to actor/guild/filter/endpoint and an expiry",()=>{
  const key="synthetic-key-not-used-by-runtime".repeat(2),binding={organizationId:"org",guildId:"guild",actorHash:"actor",endpoint:"suggestions",filter:"ACTIVE",sort:"CREATED_DESC_ID_DESC" as const};
  const position={snapshotAt:now.toISOString(),createdAt:now.toISOString(),id:"00000000-0000-4000-8000-000000000001",expiresAt:new Date(now.getTime()+60000).toISOString()},token=encodeCursor(key,binding,position);
  expect(decodeCursor(key,token,binding,now)).toEqual(position);
  for(const altered of [{...binding,guildId:"other"},{...binding,actorHash:"other"},{...binding,filter:"EXPIRED"},{...binding,endpoint:"history"}])expect(()=>decodeCursor(key,token,altered,now)).toThrow("INVALID_CURSOR");
  expect(()=>decodeCursor(key,token+"x",binding,now)).toThrow("INVALID_CURSOR");
  expect(()=>decodeCursor(key,token,binding,new Date(now.getTime()+60000))).toThrow("INVALID_CURSOR");
 });
});
