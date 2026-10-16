import {describe,expect,it} from 'vitest';
import {assertValueMatchesType,evaluateValue,typeEquals,validateValueInput} from '../../packages/automation/src/expression';
import {compileFlowDefinition,flowDefinitionSchema,semanticHash} from '../../packages/automation/src/definition';
import {expressionCardsFor,instantiateExpressionCard} from '../../packages/automation/src/expression-cards';
import {END_DAY_TYPE,OCCURRENCE_TYPE,WEEKDAY_TYPE,composeZonedValue,instantInTimeZone,validateTemporalValue} from '../../packages/automation/src/temporal-values';
import {INSTANT_RANGE_V2_TYPE,isInstantRangeV2Type,isLocalTimeDescriptor,localTimeType,parseLocalTimeForPrecision,parseUserDateInput,parseUserInstantInput,temporalValueKey} from '../../packages/automation/src/temporal-types';
import type {EvaluationContext,ExpressionOperator,FlowDefinition,JsonValue,ValueInput,ValueType} from '../../packages/automation/src/types';

const guildId='123456789012345678',context:EvaluationContext={guildId,semanticProfile:'scratch.v1',variables:{}};
const minute=localTimeType('minute'),second=localTimeType('second');
const lit=(type:ValueType,value:unknown):ValueInput=>({kind:'literal',type,value:value as JsonValue});
const exp=(type:ValueType,operator:ExpressionOperator,args:ValueInput[]):ValueInput=>({kind:'expression',type,expression:{operator,args}});
const run=(value:ValueInput,options:Partial<EvaluationContext>={})=>evaluateValue(value,{...context,...options}).value;
const number=(value:number)=>lit('Number',value);
const compare=(type:ValueType,a:unknown,b:unknown,operator:ExpressionOperator='compare.less')=>exp('Boolean',operator,[lit(type,a),lit(type,b)]);
const instant=(value='2026-10-15T00:00:00Z')=>lit('Instant',value);
const flow=(value:ValueInput):FlowDefinition=>({schemaVersion:1,semanticProfile:'scratch.v1',id:'datetime',guildId,name:'Datetime',trigger:{kind:'manual',inputs:[]},variables:[],body:[{id:'declare',kind:'declare',variable:{id:'value',name:'Value',type:value.type},value}]});

describe('2026-10-16 approved temporal descriptors and preserved values',()=>{
  it('DT01 accepts only complete strict ISO user dates without changing their calendar day',()=>{
    expect(parseUserDateInput('2028-02-29')).toBe('2028-02-29');
    for(const value of ['03/04','2026/10/15','2026-2-03','2026-02-30','2027-02-29','0000-01-01','2026-10-15T00:00:00Z'])expect(()=>parseUserDateInput(value)).toThrow();
    expect(run(lit('DateOnly','2026-10-15'))).toBe('2026-10-15');
  });
  it('DT02 keeps legacy minute, explicit minute and explicit second types distinct',()=>{
    expect(typeEquals('LocalTime',minute)).toBe(false);expect(typeEquals(minute,second)).toBe(false);expect(typeEquals(second,{...second})).toBe(true);
    expect(isLocalTimeDescriptor(second)).toBe(true);expect(isInstantRangeV2Type(INSTANT_RANGE_V2_TYPE)).toBe(true);
    expect(run(lit('LocalTime','18:30'))).toBe('18:30');expect(run(lit(minute,'18:30'))).toBe('18:30');expect(run(lit(second,'18:30:01'))).toBe('18:30:01');
    for(const [type,value] of [[minute,'18:30:00'],[second,'18:30'],[second,'18:30:00.001']] as const)expect(()=>run(lit(type,value))).toThrow();
  });
  it('DT02 rejects unregistered schemas and forged precision fields at schema and value boundaries',()=>{
    const bad={kind:'LocalTime',schemaId:'unregistered',precision:'second'} as unknown as ValueType;
    expect(()=>assertValueMatchesType(bad,'12:00:00',context)).toThrow();
    const input=flow(lit(second,'12:00:00'));
    expect(flowDefinitionSchema.safeParse(input).success).toBe(true);
    expect(flowDefinitionSchema.safeParse({...input,variables:[{id:'bad',name:'Bad',type:bad}]}).success).toBe(false);
    expect(()=>parseLocalTimeForPrecision('24:00:00','second')).toThrow();
  });
  it.each([minute,second])('DT02 implements all six comparisons only within descriptor %j',type=>{
    const a=type.precision==='second'?'18:30:00':'18:30',b=type.precision==='second'?'18:30:01':'18:31';
    for(const [op,expected] of [['equal',false],['notEqual',true],['less',true],['lessOrEqual',true],['greater',false],['greaterOrEqual',false]] as const)
      expect(run(compare(type,a,b,`compare.${op}`))).toBe(expected);
    expect(()=>run(exp('Boolean','compare.equal',[lit(minute,'18:30'),lit(second,'18:30:00')]))).toThrow();
    expect(()=>run(exp('Boolean','compare.equal',[lit('LocalTime','18:30'),lit(minute,'18:30')]))).toThrow();
  });
  it('DT02 preserves ISO calendar comparison and normalizes Instant independently of input fraction digits',()=>{
    expect(run(compare('DateOnly','2026-10-15','2026-10-16'))).toBe(true);
    expect(run(compare('Instant','2026-10-15T00:00:00Z','2026-10-15T00:00:00.000Z','compare.equal'))).toBe(true);
    expect(run(compare('Instant','2026-10-15T00:00:00.1Z','2026-10-15T00:00:00.123Z'))).toBe(true);
    expect(run(compare('Duration',0.001,0.002))).toBe(true);
    expect(()=>run(exp('Boolean','compare.equal',[lit('DateOnly','2026-10-15'),instant()]))).toThrow();
  });
  it('DT02 composes typed seconds and converts precision only through the explicit operation',()=>{
    expect(run(exp(second,'time.compose',[number(18),number(30),number(45)]))).toBe('18:30:45');
    expect(run(exp(minute,'time.compose',[number(18),number(30)]))).toBe('18:30');
    expect(run(exp(second,'time.convertPrecision',[lit(minute,'18:30')]))).toBe('18:30:00');
    expect(run(exp(minute,'time.convertPrecision',[lit(second,'18:30:45')]))).toBe('18:30');
    expect(run(exp('LocalTime','time.convertPrecision',[lit(second,'18:30:45')]))).toBe('18:30');
    expect(()=>run(exp(second,'time.compose',[number(18),number(30)]))).toThrow();
  });
  it('DT02 applies the same descriptors to list sort, equality and fixed lookup',()=>{
    const list={kind:'List',element:second} as const;
    expect(run(exp(list,'list.sort',[lit(list,['18:30:02','18:30:01'])]))).toEqual(['18:30:01','18:30:02']);
    expect(run(exp(list,'list.unique',[lit(list,['18:30:01','18:30:01'])]))).toEqual(['18:30:01']);
    expect(run(exp('Number','value.lookup',[lit(second,'18:30:01'),lit(list,['18:30:01']),number(0),number(7)]))).toBe(7);
  });
  it('DT02 preserves historical temporal selector contracts while new window selectors keep their registered schema',()=>{
    const legacyChoice:ValueType={kind:'Enum',values:['requireUnique','earlier','later'],schemaId:'legacy-time-selection',schemaRevision:1};
    expect(run(exp('ZonedDateTimeSpec','zoned.compose',[lit('DateOnly','2026-10-15'),lit('LocalTime','18:30'),lit('TimeZone','Asia/Tokyo'),lit(legacyChoice,'requireUnique')]))).toMatchObject({instant:'2026-10-15T09:30:00.000Z'});
    const foreignEndDay:ValueType={kind:'Enum',values:['sameDay','nextDay'],schemaId:'unrelated-end-day',schemaRevision:1};
    expect(()=>run(exp('LocalTimeWindowSpec','window.build',[lit(second,'18:00:00'),lit(second,'19:00:00'),lit(foreignEndDay,'sameDay'),lit({kind:'List',element:WEEKDAY_TYPE},['friday']),lit('TimeZone','Asia/Tokyo')]))).toThrow();
  });
  it('DT03 rejects every new fractional input including zero fractions and keeps omitted seconds explicit',()=>{
    expect(parseUserInstantInput('2026-10-15T18:30')).toBe('2026-10-15T18:30:00.000Z');
    expect(parseUserInstantInput('2026-10-15T18:30:45Z')).toBe('2026-10-15T18:30:45.000Z');
    for(const value of ['2026-10-15T18:30:00.000Z','2026-10-15T18:30:00.123','2026-10-15T18:30:00+09:00','2026-02-30T18:30','2026-10-15T24:00'])expect(()=>parseUserInstantInput(value)).toThrow();
  });
  it('DT03 keeps existing millisecond Instant, fractional Duration and serialized semantic values intact',()=>{
    const at='2027-11-07T06:30:42.123Z',value=lit('ZonedDateTimeSpec',instantInTimeZone(at,'America/New_York'));
    expect(run(instant(at))).toBe(at);expect(run(lit('Duration',0.123))).toBe(0.123);
    expect(run(exp('Instant','zoned.resolve',[value]))).toBe(at);
    const original=flow(value),saved=JSON.parse(JSON.stringify(original)) as FlowDefinition;
    expect(compileFlowDefinition(saved).definition).toEqual(original);expect(semanticHash(saved)).toBe(semanticHash(original));
  });
  it('DT05 permits a v2 empty interval with no members and preserves the old nonempty contract',()=>{
    const empty=exp(INSTANT_RANGE_V2_TYPE,'instantRange.build',[instant(),instant()]);
    expect(run(empty)).toEqual({start:'2026-10-15T00:00:00.000Z',end:'2026-10-15T00:00:00.000Z'});
    expect(run(exp('Boolean','range.contains',[instant(),empty]))).toBe(false);
    expect(()=>run(exp('InstantRange','instantRange.build',[instant(),instant()]))).toThrow();
    expect(()=>run(exp(INSTANT_RANGE_V2_TYPE,'instantRange.build',[instant('2026-10-16T00:00:00Z'),instant()]))).toThrow();
  });
  it('DT05 keeps v2 intervals half-open and refuses generic range comparisons',()=>{
    const range=exp(INSTANT_RANGE_V2_TYPE,'instantRange.build',[instant(),instant('2026-10-15T00:00:01Z')]);
    expect(run(exp('Boolean','range.contains',[instant(),range]))).toBe(true);
    expect(run(exp('Boolean','range.contains',[instant('2026-10-15T00:00:01Z'),range]))).toBe(false);
    expect(()=>run(exp('Boolean','compare.equal',[range,range]))).toThrow();
  });
  it('DT06 connects explicit next-day weekday windows with second precision and excluded ends',()=>{
    const window=exp('LocalTimeWindowSpec','window.build',[lit(second,'22:00:10'),lit(second,'02:00:20'),lit(END_DAY_TYPE,'nextDay'),lit({kind:'List',element:WEEKDAY_TYPE},['friday']),lit('TimeZone','Asia/Tokyo')]);
    expect(run(window)).toMatchObject({endDayOffset:1,weekdays:[5],timePrecision:'second'});
    expect(run(exp('Boolean','window.contains',[instant('2026-10-16T13:00:10Z'),window]))).toBe(true);
    expect(run(exp('Boolean','window.contains',[instant('2026-10-16T17:00:19.999Z'),window]))).toBe(true);
    expect(run(exp('Boolean','window.contains',[instant('2026-10-16T17:00:20Z'),window]))).toBe(false);
    const same=structuredClone(window);if(same.kind==='expression')same.expression.args[2]=lit(END_DAY_TYPE,'sameDay');expect(()=>run(same)).toThrow();
    const mismatch=structuredClone(window);if(mismatch.kind==='expression')mismatch.expression.args[1]=lit(minute,'23:00');expect(()=>run(mismatch)).toThrow();
  });
  it('DT07 composes seconds without rounding and still rejects a single gap or unresolved fold',()=>{
    expect(composeZonedValue('2026-10-15','18:30:45','Asia/Tokyo','requireUnique','second')).toMatchObject({time:'18:30:45',timePrecision:'second',instant:'2026-10-15T09:30:45.000Z'});
    const args=(date:string,time:string,occurrence='requireUnique')=>[lit('DateOnly',date),lit(second,time),lit('TimeZone','America/New_York'),lit(OCCURRENCE_TYPE,occurrence)];
    expect(()=>run(exp('ZonedDateTimeSpec','zoned.compose',args('2027-03-14','02:30:01')))).toThrow();
    expect(()=>run(exp('ZonedDateTimeSpec','zoned.compose',args('2027-11-07','01:30:42')))).toThrow();
    expect(run(exp('ZonedDateTimeSpec','zoned.compose',args('2027-11-07','01:30:42','later')))).toMatchObject({instant:'2027-11-07T06:30:42.000Z'});
  });
  it('DT11 validates a trusted fixed snapshot without re-resolving current zone rules',()=>{
    const saved={date:'2026-10-15',time:'10:00:42',timePrecision:'second',timeZone:'Asia/Tokyo',instant:'2026-10-15T09:00:42.123Z',offset:'+01:00'} as JsonValue;
    expect(()=>validateTemporalValue('ZonedDateTimeSpec',saved)).toThrow();
    expect(validateTemporalValue('ZonedDateTimeSpec',saved,{temporalResolution:'fixed'})).toBe(true);
    expect(run(exp('Instant','zoned.resolve',[lit('ZonedDateTimeSpec',saved)]),{temporalResolution:'fixed'})).toBe('2026-10-15T09:00:42.123Z');
    expect(()=>validateTemporalValue('ZonedDateTimeSpec',{...(saved as object),instant:'2026-10-15T10:00:42.123Z'} as JsonValue,{temporalResolution:'fixed'})).toThrow();
  });
  it('DT11 permits only exactly matching same-scope retained literals through an edit capability',()=>{
    const saved={date:'2026-10-15',time:'10:00',timeZone:'Asia/Tokyo',instant:'2026-10-15T09:00:42.123Z',offset:'+01:00'} as JsonValue;
    const value=lit('ZonedDateTimeSpec',saved),input=flow(value),fixedTemporalValues=new Set([temporalValueKey(value.type,saved)]);
    expect(()=>compileFlowDefinition(input)).toThrow();
    expect(compileFlowDefinition(input,{fixedTemporalValues}).definition).toEqual(input);
    const reordered=Object.fromEntries(Object.entries(saved as Record<string,JsonValue>).reverse());
    expect(temporalValueKey(value.type,reordered)).toBe(temporalValueKey(value.type,saved));
    expect(validateTemporalValue('ZonedDateTimeSpec',reordered,{fixedTemporalValues})).toBe(true);
    expect(temporalValueKey({kind:'List',element:'Number'},[1,2])).not.toBe(temporalValueKey({kind:'List',element:'Number'},[2,1]));
    const other=structuredClone(saved) as Record<string,JsonValue>;other.timeZone='UTC';
    expect(()=>validateTemporalValue('ZonedDateTimeSpec',other,{fixedTemporalValues})).toThrow();
  });
  it('DT11 keeps a previously accepted date-range snapshot structural in fixed mode',()=>{
    const saved:JsonValue={start:'2011-12-29',end:'2011-12-30',timeZone:'Pacific/Apia',boundaryRule:'firstValidEarlier'};
    expect(()=>validateTemporalValue('DateRange',saved)).toThrow();
    expect(validateTemporalValue('DateRange',saved,{temporalResolution:'fixed'})).toBe(true);
    expect(run(exp('InstantRange','dateRange.toInstants',[lit('DateRange',saved)]),{temporalResolution:'fixed'})).toEqual({start:'2011-12-29T10:00:00.000Z',end:'2011-12-30T10:00:00.000Z'});
    expect(()=>validateTemporalValue('DateRange',{...saved,start:'2012-01-01'},{temporalResolution:'fixed'})).toThrow();
  });
  it('DT11 keeps a trusted fixed single schedule structural instead of resolving it under new rules',()=>{
    const input:FlowDefinition={...flow(number(1)),trigger:{kind:'schedule',schedule:{kind:'once',at:{date:'2027-03-14',time:'02:30',timeZone:'America/New_York'}}}};
    expect(()=>compileFlowDefinition(input)).toThrow();
    expect(compileFlowDefinition(input,{temporalResolution:'fixed'}).definition).toEqual(input);
    const invalid=structuredClone(input);if(invalid.trigger.kind==='schedule'&&invalid.trigger.schedule.kind==='once')invalid.trigger.schedule.at.time='25:30';
    expect(()=>compileFlowDefinition(invalid,{temporalResolution:'fixed'})).toThrow();
  });
  it('DT11 preserves genuine old offsetAt display shapes only through trusted compatibility',()=>{
    // Reproduce the before-files datetime.ts offsetAt and temporal-values.ts
    // instantInTimeZone algorithms: precise local parts, offset minutes truncated.
    const oldSnapshot=(instant:string,timeZone:string):JsonValue=>{
      const at=Math.floor(Date.parse(instant)/1000)*1000;
      const fields=Object.fromEntries(new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(at).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
      const date=`${fields.year}-${fields.month}-${fields.day}`,time=`${fields.hour}:${fields.minute}`;
      const seconds=Math.round((Date.parse(`${date}T${time}:${fields.second}Z`)-at)/1000),absolute=Math.abs(seconds);
      return {date,time,timeZone,instant,offset:`${seconds<0?'-':'+'}${String(Math.floor(absolute/3600)).padStart(2,'0')}:${String(Math.floor((absolute%3600)/60)).padStart(2,'0')}`};
    };
    for(const [at,zone,offset] of [['1972-01-06T00:44:10.123Z','Africa/Monrovia','-00:44'],['1900-01-01T00:00:55.123Z','Asia/Kolkata','+05:21']]) {
      const old=oldSnapshot(at!,zone!);expect((old as Record<string,JsonValue>).offset).toBe(offset);
      expect(()=>validateTemporalValue('ZonedDateTimeSpec',old)).toThrow();
      expect(validateTemporalValue('ZonedDateTimeSpec',old,{temporalResolution:'fixed'})).toBe(true);
      expect(run(exp('Instant','zoned.resolve',[lit('ZonedDateTimeSpec',old)]),{temporalResolution:'fixed'})).toBe(at);
      expect(()=>validateTemporalValue('ZonedDateTimeSpec',{...(old as object),timePrecision:'minute'} as JsonValue,{temporalResolution:'fixed'})).toThrow();
      const invalid={...(old as Record<string,JsonValue>),time:'12:00'};
      expect(()=>validateTemporalValue('ZonedDateTimeSpec',invalid,{temporalResolution:'fixed'})).toThrow();
    }
  });
  it('DT02/DT05/DT06 advertises executable typed cards with missing inputs and fixed output schemas',()=>{
    for(const type of [minute,second,INSTANT_RANGE_V2_TYPE,'LocalTimeWindowSpec'] as ValueType[]) {
      const cards=expressionCardsFor(type,{semanticProfile:'scratch.v1'});expect(cards.length).toBeGreaterThan(0);
      for(const card of cards){const value=instantiateExpressionCard(card,()=> 'local');expect(()=>validateValueInput(value,context)).not.toThrow();}
    }
    const cards=expressionCardsFor('Boolean',{semanticProfile:'scratch.v1'});
    expect(cards.some(card=>card.operator==='compare.less'&&typeEquals(card.inputs[0]!.type,second))).toBe(true);
    expect(cards.some(card=>card.operator==='window.contains')).toBe(true);
  });
});
