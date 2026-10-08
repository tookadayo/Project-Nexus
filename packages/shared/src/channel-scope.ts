import { z } from "zod";
import { surfaceFor, type CommunityModel, type Surface } from "./community-model";
const id = z.string().regex(/^\d{17,20}$/);
// Bounded at twice the documented 500 guild channels, with category expansion and
// paginated editing. Private threads never become extra selectable locations.
const ids = z.array(id).max(1000).refine(v => new Set(v).size === v.length);
export const analysisScopeSchema = z.object({
  mode: z.enum(["all", "include", "exclude"]).default("all"),
  channelIds: ids.default([]),
  excludedChannelIds: ids.optional(),
}).strict();
export type AnalysisScope = z.infer<typeof analysisScopeSchema>;
export type ScopeChannel = {
  id: string; type: number; parentId: string | null; observable: boolean;
  deleted?: boolean; collectionForbidden?: boolean;
};
export type CollectionEligibility = "ELIGIBLE" | "DELETED" | "FORBIDDEN" | "PERMISSION_MISSING" | "PRIVATE_THREAD" | "CATEGORY" | "UNSUPPORTED_TYPE" | "PARENT_UNKNOWN" | "UNKNOWN";
export type ChannelResolution = {
  actualChannelId: string; parentChannelId: string | null; categoryId: string | null;
  channelType: number | null; effectivePurpose: CommunityModel["channels"][number]["purpose"];
  surface: Surface; collectionEligibility: CollectionEligibility; selected: boolean;
};
export function isPublicThread(type: number | null | undefined) { return type === 10 || type === 11; }
export function resolveChannel(model: CommunityModel, scope: AnalysisScope, channels: readonly ScopeChannel[], actualChannelId: string): ChannelResolution {
  const c = channels.find(c => c.id === actualChannelId),
    thread = isPublicThread(c?.type),
    parent = thread ? channels.find(p => p.id === c?.parentId) : undefined,
    categoryId = thread ? parent?.parentId ?? null : c?.type === 4 ? c.id : c?.parentId ?? null,
    parentChannelId = thread ? c?.parentId ?? null : null;
  const collectionEligibility: CollectionEligibility = !c ? "UNKNOWN" : c.deleted ? "DELETED" : c.collectionForbidden ? "FORBIDDEN" : c.type === 12 ? "PRIVATE_THREAD" : c.type === 4 ? "CATEGORY" : ![0,2,5,10,11,13,15,16].includes(c.type) ? "UNSUPPORTED_TYPE" : !c.observable ? "PERMISSION_MISSING" : thread && (!parent || ![0,5,15,16].includes(parent.type)) ? "PARENT_UNKNOWN" : thread && (parent!.deleted || parent!.collectionForbidden) ? parent!.deleted ? "DELETED" : "FORBIDDEN" : thread && !parent!.observable ? "PERMISSION_MISSING" : "ELIGIBLE";
  const purposes = new Map(model.channels.map(p => [p.channelId,p.purpose]));
  const effectivePurpose = purposes.get(actualChannelId) ?? (parentChannelId ? purposes.get(parentChannelId) : undefined) ?? (categoryId ? purposes.get(categoryId) : undefined) ?? "OTHER";
  const excluded = new Set([...(scope.excludedChannelIds ?? []), ...(scope.mode === "exclude" ? scope.channelIds : [])]);
  const exclusion = [actualChannelId,parentChannelId,categoryId].some(id => id !== null && excluded.has(id));
  const inclusion = scope.mode !== "include" || scope.channelIds.includes(actualChannelId) || Boolean(parentChannelId && scope.channelIds.includes(parentChannelId)) || Boolean(categoryId && scope.channelIds.includes(categoryId));
  return { actualChannelId,parentChannelId,categoryId,channelType:c?.type ?? null,effectivePurpose,surface:collectionEligibility === "ELIGIBLE" ? surfaceFor(c?.type,parent?.type) : "UNKNOWN",collectionEligibility,selected:collectionEligibility === "ELIGIBLE" && !exclusion && inclusion && effectivePurpose !== "STAFF" };
}
export function resolveAnalysisScope(model: CommunityModel, scope: AnalysisScope, channels: readonly ScopeChannel[]) {
  const resolutions = channels.map(c => resolveChannel(model,scope,channels,c.id)),
    selected = resolutions.filter(c => c.selected);
  return { resolutions, actualChannelIds:selected.map(c => c.actualChannelId).sort(),
    selectedChannelIds:selected.filter(c => !c.parentChannelId || (scope.mode === "include" && scope.channelIds.includes(c.actualChannelId)) || model.channels.some(p=>p.channelId===c.actualChannelId)).map(c => c.actualChannelId).sort(),
    missingChannelIds:scope.mode === "include" ? scope.channelIds.filter(id => !channels.some(c => c.id === id)) : [] };
}
// Persist expanded children, never a category wildcard, for new configurations.
export function expandCategorySelection(channels: readonly ScopeChannel[], categoryIds: readonly string[]) {
  return channels.filter(c => c.parentId && categoryIds.includes(c.parentId) && !isPublicThread(c.type) && resolveChannel({channels:[],modes:[],confirmed:false,forumTags:[],voiceThresholdSeconds:300},{mode:"all",channelIds:[]},channels,c.id).selected).map(c => c.id).sort();
}
