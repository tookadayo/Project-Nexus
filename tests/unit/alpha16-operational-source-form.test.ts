import {describe,expect,it} from "vitest";
import {compileSourceConfig,sourceSchemaForCase,type SourceSchema} from "../../apps/web/app/rules/context/source-form-model";
describe("typed operational source form authoring (source only)",()=>{
 it("never promotes a blank or whitespace placeholder into a numeric value",()=>{
  for(const value of [undefined,""," ","NaN","Infinity"])expect(()=>compileSourceConfig({type:"integer",minimum:0},value)).toThrow();
  expect(compileSourceConfig({type:"integer",minimum:0},"0")).toBe(0);
  expect(()=>compileSourceConfig({type:"integer",exclusiveMinimum:0},"0")).toThrow();
 });
 it("distinguishes unselected booleans and explicit false",()=>{
  expect(()=>compileSourceConfig({type:"boolean"},undefined)).toThrow();expect(compileSourceConfig({type:"boolean"},"false")).toBe(false);
 });
 it("requires an explicit empty-set choice, preserving finite record limits",()=>{
  const schema:SourceSchema={type:"array",items:{type:"string",minLength:1},maxItems:1};
  expect(()=>compileSourceConfig(schema,undefined)).toThrow();expect(compileSourceConfig(schema,[])).toEqual([]);
  expect(()=>compileSourceConfig(schema,["a","b"])).toThrow();expect(()=>compileSourceConfig(schema,[undefined])).toThrow();
 });
 it("only fills schema constants after an explicit input branch is selected",()=>{
  const schema:SourceSchema={oneOf:[{type:"object",properties:{kind:{const:"FINITE_SOURCE"},version:{type:"integer",minimum:1}},required:["kind","version"]}]};
  expect(()=>compileSourceConfig(schema,undefined)).toThrow();expect(compileSourceConfig(schema,{__sourceChoice:0,value:{version:"3"}})).toEqual({kind:"FINITE_SOURCE",version:3});
 });
 it("keeps cancel/unselected branch data out and uses the same case-filtered branch index at submit",()=>{
  const schema:SourceSchema={anyOf:[{type:"object",properties:{kind:{const:"QUEUE"}},required:["kind"],"x-case-ids":["CASE13"]},{type:"object",properties:{kind:{const:"POSTING"}},required:["kind"],"x-case-ids":["CASE19"]}]};
  const filtered=sourceSchemaForCase(schema,"CASE19");expect(compileSourceConfig(filtered,{__sourceChoice:0,value:{}})).toEqual({kind:"POSTING"});
  expect(()=>compileSourceConfig(filtered,{kind:"QUEUE"})).toThrow();
 });
 it("uses UTC explicitly, preserves unedited microseconds and rejects invalid calendar dates",()=>{
  const schema:SourceSchema={type:"string",format:"date-time"};expect(compileSourceConfig(schema,"2026-10-16T10:00")).toBe("2026-10-16T10:00:00.000Z");
  expect(compileSourceConfig(schema,"2026-10-16T10:00:00.123456Z")).toBe("2026-10-16T10:00:00.123456Z");
  expect(()=>compileSourceConfig(schema,"2026-02-31T10:00")).toThrow();expect(()=>compileSourceConfig(schema,"2026-10-16T10:00+09:00")).toThrow();
 });
 it("rejects arbitrary properties and executable or external schema references",()=>{
  const schema:SourceSchema={type:"object",properties:{recordId:{type:"string",pattern:"^[a-z]+$"}},required:["recordId"]};
  expect(()=>compileSourceConfig(schema,{recordId:"native",body:"message"})).toThrow();expect(()=>compileSourceConfig(schema,{recordId:"native",approved:true})).toThrow();
  expect(()=>compileSourceConfig({$ref:"https://example.invalid/schema"},{})).toThrow();
 });
});
