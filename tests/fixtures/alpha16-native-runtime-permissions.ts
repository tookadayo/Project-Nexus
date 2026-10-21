import type {NativeExecutionObservationRow} from '../../packages/rules/src/native-execution-permission-projections';
import type {CapabilitySnapshot} from '../../packages/shared/src/community-model';

export const nativeObservationAsOf='2026-10-16T12:00:00.000000Z';
export function nativeExecutionFixture(id:string,status='RUNNING',change:Partial<NativeExecutionObservationRow>={}):NativeExecutionObservationRow{
 return {id,revision:1,status,started_at:new Date('2026-10-16T11:00:00Z'),deadline_at:new Date('2026-10-17T11:00:00Z'),wake_at:null,ended_at:null,
  observation_revision:'1',observation_status:status,due_at:null,observation_deadline:new Date('2026-10-17T11:00:00Z'),terminal_at:null,heartbeat_at:new Date('2026-10-16T11:59:55Z'),observed_at:new Date('2026-10-16T11:59:55Z'),retention_expires_at:new Date('2026-10-24T11:00:00Z'),...change};
}
/** These are synthetic saved capabilities, not live Discord requests or an
 * operational engine/retention approval. */
export function nativePermissionFixture():Pick<CapabilitySnapshot,'botPermissions'|'channels'|'capabilities'|'coverage'>{
 return {botPermissions:{manageGuild:false,manageRoles:false,sendMessages:true,highestRolePosition:null},capabilities:{onboarding:{status:'PERMISSION_MISSING',availableSince:null}},
  channels:[{id:'123456789012345679',type:0,parentId:null,observable:true,tagIds:[]},{id:'123456789012345680',type:0,parentId:null,observable:false,tagIds:[]},{id:'123456789012345681',type:0,parentId:null,observable:true,tagIds:[],collectionForbidden:true}],
  coverage:{totalState:'KNOWN',knownTotalChannels:3,coverageState:'PARTIAL',observableChannels:2,totalRelevantChannels:3,ratio:null,blindSpots:[],privateThreads:'PARTIAL'}};
}
