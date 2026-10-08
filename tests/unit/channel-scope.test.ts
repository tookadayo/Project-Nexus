import { expect, it } from "vitest";
import { communityModelSchema, surfaceFor,forumTagResolution,meaningfulActivityKinds } from "../../packages/shared/src/community-model";
import { resolveChannel, resolveAnalysisScope } from "../../packages/shared/src/channel-scope";
import { stabilizationServers } from "../fixtures/stabilization-servers";
const category = "100000000000000001", a = "100000000000000002", b = "100000000000000003", forum = "100000000000000004", post = "100000000000000005";
const channels = [
  { id: category, type: 4, parentId: null, observable: true },
  { id: a, type: 0, parentId: category, observable: true },
  { id: b, type: 0, parentId: category, observable: true },
  { id: forum, type: 15, parentId: category, observable: true },
  { id: post, type: 11, parentId: forum, observable: true },
];
const model = communityModelSchema.parse({channels:[{channelId:a,purpose:"ANNOUNCEMENT"},{channelId:forum,purpose:"SUPPORT"}]});
it("retains actual text channel under a category and honors an excluded sibling", () => {
  const scope = {mode:"include" as const,channelIds:[category],excludedChannelIds:[b]};
  expect(resolveChannel(model,scope,channels,a)).toMatchObject({actualChannelId:a,parentChannelId:null,categoryId:category,effectivePurpose:"ANNOUNCEMENT",selected:true});
  expect(resolveAnalysisScope(model,scope,channels).actualChannelIds).toEqual([a,forum,post]);
});
it("selects A without B, and supports channels without a category", () => {
  const scope = {mode:"include" as const,channelIds:[a]};
  expect(resolveAnalysisScope(model,scope,channels).actualChannelIds).toEqual([a]);
  expect(resolveChannel(model,scope,[{...channels[1]!,parentId:null}],a).selected).toBe(true);
});
it("inherits forum scope and purpose once and keeps a channel mapping through moves", () => {
  expect(resolveChannel(model,{mode:"include",channelIds:[forum]},channels,post)).toMatchObject({parentChannelId:forum,categoryId:category,effectivePurpose:"SUPPORT",surface:"FORUM_POST",selected:true});
  expect(resolveChannel(model,{mode:"all",channelIds:[]},channels.map(c=>c.id===a?{...c,parentId:null}:c),a).effectivePurpose).toBe("ANNOUNCEMENT");
});
it("fails closed for missing parents, private threads, unknown types and deleted channels", () => {
  for (const channel of [{...channels[4]!,parentId:b},{...channels[4]!,type:12},{...channels[1]!,type:255},{...channels[1]!,deleted:true}])
    expect(resolveChannel(model,{mode:"all",channelIds:[]},[channel],channel.id).selected).toBe(false);
});
it("does not interpret arbitrary parent types as Forum posts", () => {
  expect(surfaceFor(0,15)).toBe("TEXT");
  expect(surfaceFor(12,15)).toBe("UNKNOWN");
});
it("keeps observed basic activity available when purposes are confirmed without a server mode",()=>{
 const kinds=meaningfulActivityKinds(communityModelSchema.parse({confirmed:true,modes:[],channels:[{channelId:a,purpose:"SUPPORT"}]}));
 expect(kinds.has("message.sent")).toBe(true);expect(kinds.has("reaction.added")).toBe(true);expect(kinds.has("voice.started")).toBe(true);
});
it("preserves explicit thread anchors while inherited new threads do not alter semantic roots",()=>{
 expect(resolveAnalysisScope(model,{mode:"include",channelIds:[post]},channels).selectedChannelIds).toEqual([post]);
 expect(resolveAnalysisScope(model,{mode:"include",channelIds:[forum]},channels).selectedChannelIds).toEqual([forum]);
});
it("requires stable parent/tag IDs and reports contradictory administrator status meanings",()=>{
 const tagged=communityModelSchema.parse({forumTags:[{channelId:forum,tagId:a,meaning:"RESOLVED"},{channelId:forum,tagId:b,meaning:"UNRESOLVED"}]});
 expect(forumTagResolution(tagged,forum,[a,b])).toEqual({resolved:false,conflict:true});
 expect(forumTagResolution(tagged,forum,[a])).toEqual({resolved:true,conflict:false});
 expect(forumTagResolution(tagged,post,[a])).toEqual({resolved:false,conflict:false});
 expect(forumTagResolution(tagged,forum,[post])).toEqual({resolved:false,conflict:false});
});
it.each(stabilizationServers)("$id resolves actual mixed structure and excludes response duties by purpose", f => {
  const channels=[...f.source.channels,...f.source.threads.map(t=>({...t,observable:true}))], resolved=resolveAnalysisScope(f.model,f.scope,channels);
  expect(resolved.actualChannelIds.length).toBeGreaterThan(0);
  expect(resolved.resolutions.filter(c=>c.selected).every(c=>![4,12].includes(c.channelType!))).toBe(true);
  for(const c of resolved.resolutions.filter(c=>c.selected && ["SHOWCASE","ANNOUNCEMENT","ONBOARDING","GENERAL_CONVERSATION","OTHER"].includes(c.effectivePurpose)))
    expect(["SUPPORT","BUG_REPORT","LFG"].includes(c.effectivePurpose)).toBe(false);
  const added={id:"199999999999999999",type:0,parentId:f.source.channels.find(c=>c.type===4)?.id??null,observable:true};
  expect(resolveChannel(f.model,f.scope,[...channels,added],added.id).selected).toBe(false);
});
