import {describe,expect,it} from 'vitest';
import {nextElapsedOccurrences,validateElapsedSchedule} from '../../packages/automation/src/elapsed-schedule';
import {changedScheduleMeaning,currentScheduleMeaningReader,snapshotScheduleMeaning} from '../../packages/automation/src/schedule-rules';
import {validateFlowDefinition} from '../../packages/automation/src/definition';
import type {ElapsedScheduleSpec,FlowDefinition,RecurrenceSpec} from '../../packages/automation/src/types';

const elapsed:ElapsedScheduleSpec={kind:'elapsed',anchor:'2026-03-07T12:00:00Z',intervalSeconds:86400,end:'2026-03-12T12:00:00Z',pastOccurrences:'skip'};
describe('anchored elapsed schedules',()=>{
  it('starts exactly at the anchor and uses an exclusive finite end',()=>{
    const items=nextElapsedOccurrences(elapsed,'2026-03-06T12:00:00Z',10);
    expect(items.map(item=>item.instant)).toEqual(['2026-03-07T12:00:00.000Z','2026-03-08T12:00:00.000Z','2026-03-09T12:00:00.000Z','2026-03-10T12:00:00.000Z','2026-03-11T12:00:00.000Z']);
    expect(items.every(item=>item.timeZone==='UTC'&&item.offset==='+00:00')).toBe(true);
    expect(nextElapsedOccurrences(elapsed,elapsed.end)).toEqual([]);
  });
  it('skips missed occurrences without shifting the fixed anchor',()=>{
    expect(nextElapsedOccurrences(elapsed,'2026-03-10T12:00:00.001Z',1)[0]!.instant).toBe('2026-03-11T12:00:00.000Z');
    expect(nextElapsedOccurrences({...elapsed,intervalSeconds:1},'2026-03-07T12:00:00.999Z',1)[0]!.instant).toBe('2026-03-07T12:00:01.000Z');
  });
  it('allows intervals longer than a seven-day Run and bounds arithmetic without overflow',()=>{
    const long={...elapsed,intervalSeconds:8*86400,end:'2026-04-01T00:00:00Z'};
    expect(nextElapsedOccurrences(long,elapsed.anchor,1)[0]!.instant).toBe('2026-03-15T12:00:00.000Z');
    expect(nextElapsedOccurrences({...long,intervalSeconds:Number.MAX_SAFE_INTEGER},elapsed.anchor)).toEqual([]);
  });
  it.each([0,-1,1.1,Number.NaN,Infinity,Number.MAX_SAFE_INTEGER+1])('rejects invalid elapsed seconds %s',intervalSeconds=>{
    expect(()=>validateElapsedSchedule({...elapsed,intervalSeconds})).toThrow('positive whole');
  });
  it('rejects blank, reversed, non-UTC and excessive ranges in the canonical definition',()=>{
    const base:FlowDefinition={schemaVersion:1,id:'elapsed',guildId:'884111111111111111',name:'Elapsed',trigger:{kind:'schedule',schedule:elapsed},variables:[],body:[{id:'end',kind:'end'}]};
    expect(validateFlowDefinition(base).valid).toBe(true);
    for(const schedule of [{...elapsed,anchor:''},{...elapsed,end:elapsed.anchor},{...elapsed,anchor:'2026-03-07T12:00:00+09:00'},{...elapsed,end:'9999-12-31T00:00:00Z'}])expect(validateFlowDefinition({...base,trigger:{kind:'schedule',schedule}}).valid).toBe(false);
  });
});
describe('calendar schedule meaning',()=>{
  const recurring:RecurrenceSpec={kind:'recurring',frequency:'weekly',time:'09:00',timeZone:'America/New_York',startDate:'2026-01-01',endDate:'2027-12-31',weekdays:[1],missingTime:'skip',repeatedTime:'earlier',pastOccurrences:'skip'};
  it('saves actual local, offset and instant probes and compares the same fixed meanings',()=>{
    const snapshot=snapshotScheduleMeaning(recurring,new Date('2026-01-01T00:00:00Z'));
    expect(snapshot.probes.length).toBeGreaterThan(16);expect(snapshot.probes.length).toBeLessThan(50);
    expect(snapshot.probes.some(probe=>probe.offset==='-04:00')).toBe(true);expect(snapshot.probes.some(probe=>probe.offset==='-05:00')).toBe(true);
    expect(changedScheduleMeaning(snapshot)).toBeNull();
    const reader=currentScheduleMeaningReader();
    expect(changedScheduleMeaning(snapshot,{...reader,resolve:local=>({...reader.resolve(local),offset:'+03:00'})})).toBe('TIME_ZONE_MEANING_CHANGED');
    expect(changedScheduleMeaning(snapshot,{...reader,version:'synthetic-updated-database'})).toBe('TIME_ZONE_DATABASE_CHANGED');
  });
});
