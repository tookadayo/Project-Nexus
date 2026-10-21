import {DateTimeError,parseInstant} from './datetime';
import type {ElapsedScheduleSpec,ScheduleOccurrence} from './types';

/** Elapsed recurrence starts a new Run at each fixed UTC occurrence. It is
 * independent of local calendar days and the seven-day lifetime of each Run. */
export function validateElapsedSchedule(spec:ElapsedScheduleSpec):void {
  const start=Date.parse(parseInstant(spec.anchor)),end=Date.parse(parseInstant(spec.end));
  if(spec.kind!=='elapsed'||spec.pastOccurrences!=='skip'||!Number.isSafeInteger(spec.intervalSeconds)||spec.intervalSeconds<=0)
    throw new DateTimeError('ELAPSED_INTERVAL','Choose a positive whole number of elapsed seconds.');
  if(end<=start||end-start>36600*86400000)
    throw new DateTimeError('ELAPSED_RANGE','Choose a finite end after the anchor, within 100 years.');
}
export function nextElapsedOccurrences(spec:ElapsedScheduleSpec,after:Date|string,count=5):ScheduleOccurrence[] {
  validateElapsedSchedule(spec);
  if(!Number.isInteger(count)||count<0||count>100)throw new DateTimeError('PREVIEW_LIMIT','Choose a finite preview size.');
  const afterMs=after instanceof Date?after.getTime():Date.parse(parseInstant(after));
  if(!Number.isSafeInteger(afterMs))throw new DateTimeError('INSTANT_INVALID','A valid preview start is required.');
  const anchor=BigInt(Date.parse(spec.anchor)),end=BigInt(Date.parse(spec.end)),step=BigInt(spec.intervalSeconds)*1000n,current=BigInt(afterMs);
  let index=current<anchor?0n:(current-anchor)/step+1n;
  const result:ScheduleOccurrence[]=[];
  for(;result.length<count;index++){
    const next=anchor+index*step;if(next>=end)break;
    const instant=new Date(Number(next)).toISOString();
    result.push({instant,localDate:instant.slice(0,10),localTime:instant.slice(11,19),timeZone:'UTC',offset:'+00:00'});
  }
  return result;
}
