/** User-edit boundary only. Runtime clocks and previously saved precision remain intact. */
import {assert} from '../../shared/src/index';
import {BUILTIN_RECORD_SCHEMAS} from './expression';
import {structuredRecordSchema} from './structured-values';
import {temporalValueKey} from './temporal-types';
import type {FlowDefinition,JsonValue,ValueType} from './types';

const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fractional=(value:unknown)=>typeof value==='string'&&/\.\d*[1-9]\d*Z$/.test(value);
const messageType=(type:ValueType)=>typeof type==='string'&&['RichText','RichTextSpec','EmbedSpec','LegacyMessageSpec'].includes(type);
function messageInstants(value:unknown,visit:(value:string)=>void) {
  if(Array.isArray(value))value.forEach(item=>messageInstants(item,visit));
  else if(object(value))for(const [key,child] of Object.entries(value)){
    if((key==='timestamp'||key==='instant')&&typeof child==='string')visit(child);
    else messageInstants(child,visit);
  }
}
function typed(type:ValueType,value:JsonValue,visit:(type:ValueType,value:JsonValue)=>void) {
  visit(type,value);
  if(messageType(type))messageInstants(value,instant=>visit('Instant',instant));
  if(typeof type==='string'&&object(value)){
    if(type==='ZonedDateTimeSpec'&&typeof value.instant==='string')visit('Instant',value.instant);
    if(type==='InstantRange')for(const key of ['start','end'])if(typeof value[key]==='string')visit('Instant',value[key] as string);
  }
  if(typeof type==='object'&&type.kind==='InstantRange'&&object(value))for(const key of ['start','end'])if(typeof value[key]==='string')visit('Instant',value[key] as string);
  if(typeof type==='string'||!object(value)){
    if(typeof type!=='string'&&type.kind==='List'&&Array.isArray(value))value.forEach(item=>typed(type.element,item,visit));
    return;
  }
  if((type.kind==='Optional'||type.kind==='ParseResult'||type.kind==='OperationOutcome')&&Object.hasOwn(value,'value'))typed(type.value,value.value as JsonValue,visit);
  if(type.kind==='Record'){
    const schema=structuredRecordSchema(type)??BUILTIN_RECORD_SCHEMAS[type.schemaId];
    if(schema)for(const [key,field] of Object.entries(schema.fields))if(Object.hasOwn(value,key))typed(field.type,value[key] as JsonValue,visit);
  }
}
function literals(value:unknown,visit:(type:ValueType,value:JsonValue)=>void) {
  if(Array.isArray(value)){value.forEach(item=>literals(item,visit));return;}
  if(!object(value))return;
  if(value.kind==='literal'&&Object.hasOwn(value,'type')&&Object.hasOwn(value,'value'))typed(value.type as ValueType,value.value as JsonValue,visit);
  for(const child of Object.values(value))literals(child,visit);
}
const scheduleKey=(value:unknown)=>JSON.stringify({schedule:value});
/** Must only receive an authenticated, same-flow persisted revision. */
export function collectFixedTemporalValues(definition:FlowDefinition):ReadonlySet<string> {
  const result=new Set<string>();
  literals(definition,(type,value)=>result.add(temporalValueKey(type,value)));
  if(definition.trigger.kind==='schedule'){
    const schedule=definition.trigger.schedule;result.add(scheduleKey(schedule));
    if(schedule.kind==='once')result.add(temporalValueKey('ZonedDateTimeSpec',schedule.at as unknown as JsonValue));
    if(schedule.kind==='elapsed')for(const value of [schedule.anchor,schedule.end])result.add(temporalValueKey('Instant',value));
  }
  return result;
}
function editChecker(fixed:ReadonlySet<string>) {
  return (type:ValueType,value:JsonValue)=>{
    if(fixed.has(temporalValueKey(type,value)))return;
    const freshFraction=(item:unknown)=>fractional(item)&&!fixed.has(temporalValueKey('Instant',item as string));
    let invalid=type==='Instant'&&freshFraction(value);
    if(messageType(type))messageInstants(value,instant=>{invalid=invalid||freshFraction(instant);});
    if(object(value)){
      if(type==='ZonedDateTimeSpec')invalid=freshFraction(value.instant);
      if(type==='InstantRange'||typeof type==='object'&&type.kind==='InstantRange')invalid=freshFraction(value.start)||freshFraction(value.end);
    }
    assert(!invalid,'AUTOMATION_TEMPORAL_INPUT_PRECISION');
  };
}
export function assertTemporalLiteralInput(type:ValueType,value:JsonValue) {
  typed(type,value,editChecker(new Set()));
}
export function assertTemporalUserEdits(definition:FlowDefinition,fixed:ReadonlySet<string>=new Set()) {
  const checked=editChecker(fixed);
  literals(definition,checked);
  if(definition.trigger.kind==='schedule'){
    const schedule=definition.trigger.schedule;
    if(!fixed.has(scheduleKey(schedule))){
      if(schedule.kind==='elapsed')for(const value of [schedule.anchor,schedule.end])checked('Instant',value);
      if(schedule.kind==='once')checked('ZonedDateTimeSpec',schedule.at as unknown as JsonValue);
    }
  }
}
