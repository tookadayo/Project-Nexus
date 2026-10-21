import {performance} from 'node:perf_hooks';
import {cpus,totalmem} from 'node:os';
import {evaluateValue} from './expression';
import type {ValueInput} from './types';

/** Small synthetic CPU/serialization probe. It makes no Discord requests and
 * proves neither production throughput nor commercial plan capacity. */
export function measureAutomationRuntime(samples=100) {
  if(!Number.isSafeInteger(samples)||samples<10||samples>1000)throw new Error('AUTOMATION_MEASUREMENT_LIMIT');
  const expression:ValueInput={kind:'expression',type:'Number',expression:{operator:'number.divide',args:[{kind:'literal',type:'Number',value:30},{kind:'literal',type:'Number',value:10}]}};
  const started=performance.now(),cpu=process.cpuUsage(),before=process.memoryUsage(),times:number[]=[];
  let serializedBytes=0;
  for(let sample=0;sample<samples;sample++){
    const at=performance.now(),budget={evaluations:0};
    const result=evaluateValue(expression,{guildId:'884000000000000001',variables:{},budget});
    const synthetic={result,sequence:sample,deadline:'2026-10-22T00:00:00.000Z',counts:{steps:25,evaluations:budget.evaluations}};
    serializedBytes=Math.max(serializedBytes,Buffer.byteLength(JSON.stringify(synthetic)));times.push(performance.now()-at);
  }
  times.sort((a,b)=>a-b);const used=process.cpuUsage(cpu),after=process.memoryUsage();
  return {kind:'SYNTHETIC_LOCAL_PROBE',samples,platform:process.platform,node:process.version,cpuModel:cpus()[0]?.model??'unknown',logicalCpus:cpus().length,totalMemoryBytes:totalmem(),elapsedMs:performance.now()-started,cpuMicroseconds:used.user+used.system,p50Ms:times[Math.floor(samples*.5)]!,p95Ms:times[Math.floor(samples*.95)]!,maxMs:times.at(-1)!,maxSerializedBytes:serializedBytes,heapDeltaBytes:Math.max(0,after.heapUsed-before.heapUsed),rssDeltaBytes:Math.max(0,after.rss-before.rss),externalRequests:0,productionCapacityVerified:false};
}
