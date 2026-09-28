import {execFileSync} from 'node:child_process';
import {RELEASE_CHANNEL,VERSION,shortSha} from './version';

let cachedSha:string|undefined;
export function buildSha(){
 if(cachedSha===undefined){
  try{const supplied=shortSha(process.env.NEXUS_BUILD_SHA);cachedSha=supplied==='unknown'?shortSha(execFileSync('git',['rev-parse','--short=7','HEAD'],{encoding:'utf8',timeout:1500}).trim()):supplied;}
  catch{cachedSha='unknown';}
 }
 return cachedSha;
}
export function releaseInfo(){return {version:VERSION,buildSha:buildSha(),releaseChannel:RELEASE_CHANNEL};}
export type RuntimeInfo=ReturnType<typeof releaseInfo>&{
 databaseConnected:boolean;redisConnected:boolean;gatewayConnected:boolean;interactionTransport:'gateway'|'webhook';commandsRegistered:boolean;
 lastInteraction:string|null;lastAck:string|null;ackLatencyMs:number|null;lastCompleted:string|null;lastActivity:string|null;
};
export function runtimeInfo(state:Omit<RuntimeInfo,'version'|'buildSha'|'releaseChannel'>):RuntimeInfo{return {...releaseInfo(),...state};}
