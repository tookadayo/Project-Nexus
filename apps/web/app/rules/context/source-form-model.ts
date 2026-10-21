/** Browser-only finite source forms. The server's strict parser remains the
 * authority; this model never supplies placeholder numbers, observations,
 * approval flags, executable expressions or unrecognized object properties. */
export interface SourceSchema {type?:string|string[];const?:unknown;enum?:unknown[];oneOf?:SourceSchema[];anyOf?:SourceSchema[];properties?:Record<string,SourceSchema>;required?:string[];items?:SourceSchema;minimum?:number;maximum?:number;exclusiveMinimum?:number;exclusiveMaximum?:number;minItems?:number;maxItems?:number;minLength?:number;maxLength?:number;pattern?:string;format?:string;$ref?:string;$defs?:Record<string,SourceSchema>;definitions?:Record<string,SourceSchema>;title?:string;"x-case-ids"?:string[];}
export interface SourcePluginDescriptor {id:string;supportedFields:Record<string,readonly string[]>;editorSchema?:SourceSchema;}
export interface NativeSourceOptions {asOf:string;queue:{complete:boolean;truncated:boolean;expiredSourcePending:boolean;items:{attentionKey:string;itemType:string;expectedVersion:number;openedAt:string}[]};autoMod:{truncated:boolean;events:{factId:string;ruleHash:string;occurredAt:string}[]};filters:{contextId:string;version:number;ruleHash:string;configuredLanguage:string;expiresAt:string}[];}
export interface SourceReferenceOptions {native?:NativeSourceOptions|null;roles?:{id:string;name:string}[];channels?:{targetId:string;targetType:string;liveVersion:string|null}[];events?:{targetId:string;targetType:string}[];}
export function sourceSchemaForCase(schema:SourceSchema,caseId:string):SourceSchema{
 const filter=(choices:SourceSchema[])=>choices.filter(choice=>!choice["x-case-ids"]||choice["x-case-ids"]!.includes(caseId));
 const decorate=(value:SourceSchema,name="",depth=0):SourceSchema=>{
  if(depth>16)throw new Error("SOURCE_FORM_DEPTH");
  return {...value,...(value.type==="string"&&!value.format&&["start","end"].includes(name)?{format:"date-time"}:{}),...(value.type==="string"&&["calendarStartDate","calendarEndDateExclusive"].includes(name)?{format:"date"}:{}),
   ...(value.properties?{properties:Object.fromEntries(Object.entries(value.properties).map(([key,child])=>[key,decorate(child,key,depth+1)]))}:{}),...(value.items?{items:decorate(value.items,"",depth+1)}:{}),
   ...(value.oneOf?{oneOf:value.oneOf.map(child=>decorate(child,name,depth+1))}:{}),...(value.anyOf?{anyOf:value.anyOf.map(child=>decorate(child,name,depth+1))}:{}),
   ...(value.$defs?{$defs:Object.fromEntries(Object.entries(value.$defs).map(([key,child])=>[key,decorate(child,"",depth+1)]))}:{}),...(value.definitions?{definitions:Object.fromEntries(Object.entries(value.definitions).map(([key,child])=>[key,decorate(child,"",depth+1)]))}:{})};
 };
 return decorate({...schema,...(schema.oneOf?{oneOf:filter(schema.oneOf)}:{}),...(schema.anyOf?{anyOf:filter(schema.anyOf)}:{})});
}
type Choice={__sourceChoice:number;value:unknown};
export function resolveSourceSchema(schema:SourceSchema,root:SourceSchema,depth=0):SourceSchema{
 if(depth>16)throw new Error("SOURCE_FORM_DEPTH");
 if(!schema.$ref)return schema;
 const parts=schema.$ref.split("/");if(parts.length!==3||parts[0]!=="#"||!["$defs","definitions"].includes(parts[1]!))throw new Error("SOURCE_FORM_SCHEMA_UNSUPPORTED");
 const target=(parts[1]==="$defs"?root.$defs:root.definitions)?.[parts[2]!];if(!target)throw new Error("SOURCE_FORM_SCHEMA_UNSUPPORTED");return resolveSourceSchema(target,root,depth+1);
}
export function sourceAlternatives(schema:SourceSchema){return schema.oneOf??schema.anyOf??(Array.isArray(schema.type)?schema.type.map(type=>({...schema,type})):null);}
export function sourceSchemaMatches(raw:unknown,schema:SourceSchema,root:SourceSchema):boolean{
 const value=resolveSourceSchema(schema,root),alternatives=sourceAlternatives(value);if(alternatives)return alternatives.some(item=>sourceSchemaMatches(raw,item,root));
 if(Object.hasOwn(value,"const"))return raw===value.const;
 if(value.type==="null")return raw===null;
 if(value.type==="object")return !!raw&&typeof raw==="object"&&!Array.isArray(raw)&&Object.entries(value.properties??{}).every(([key,field])=>!Object.hasOwn(field,"const")||(raw as Record<string,unknown>)[key]===field.const);
 return value.type==="array"?Array.isArray(raw):value.type==="number"||value.type==="integer"?typeof raw==="number":typeof raw===value.type;
}
export function sourceChoice(schema:SourceSchema,value:unknown,root:SourceSchema):{index:number;value:unknown}{
 const alternatives=sourceAlternatives(resolveSourceSchema(schema,root));if(!alternatives)return {index:-1,value};
 if(value&&typeof value==="object"&&Object.hasOwn(value,"__sourceChoice")){const choice=value as Choice;return {index:choice.__sourceChoice,value:choice.value};}
 if(value===undefined)return {index:-1,value:undefined};return {index:alternatives.findIndex(item=>sourceSchemaMatches(value,item,root)),value};
}
export function compileSourceConfig(schema:SourceSchema,draft:unknown,root=schema,depth=0):unknown{
 if(depth>16)throw new Error("SOURCE_FORM_DEPTH");const current=resolveSourceSchema(schema,root),alternatives=sourceAlternatives(current);
 if(alternatives){const choice=sourceChoice(current,draft,root);if(choice.index<0||!alternatives[choice.index])throw new Error("SOURCE_FORM_REQUIRED");return compileSourceConfig(alternatives[choice.index]!,choice.value,root,depth+1);}
 if(Object.hasOwn(current,"const"))return current.const;
 if(current.type==="null"){if(draft!==null)throw new Error("SOURCE_FORM_REQUIRED");return null;}
 if(draft===undefined||draft==="")throw new Error("SOURCE_FORM_REQUIRED");
 if(current.type==="object"){
  if(!draft||typeof draft!=="object"||Array.isArray(draft))throw new Error("SOURCE_FORM_REQUIRED");const values=draft as Record<string,unknown>,result:Record<string,unknown>={};
  for(const key of Object.keys(values))if(!Object.hasOwn(current.properties??{},key))throw new Error("SOURCE_FORM_SCHEMA_UNSUPPORTED");
  for(const [key,child] of Object.entries(current.properties??{})){
   const required=current.required?.includes(key)??false,present=Object.hasOwn(values,key)&&values[key]!==undefined&&values[key]!=="";
   if(!present&&!required&&!Object.hasOwn(child,"const"))continue;
   result[key]=compileSourceConfig(child,values[key],root,depth+1);
  }return result;
 }
 if(current.type==="array"){
  if(!Array.isArray(draft)||!current.items)throw new Error("SOURCE_FORM_REQUIRED");if(draft.length<(current.minItems??0)||draft.length>(current.maxItems??500))throw new Error("SOURCE_FORM_RANGE");
  return draft.map(value=>compileSourceConfig(current.items!,value,root,depth+1));
 }
 if(current.enum){const found=current.enum.find(value=>String(value)===String(draft));if(found===undefined)throw new Error("SOURCE_FORM_RANGE");return found;}
 if(current.type==="boolean"){if(draft===true||draft==="true")return true;if(draft===false||draft==="false")return false;throw new Error("SOURCE_FORM_REQUIRED");}
 if(current.type==="number"||current.type==="integer"){
  if(typeof draft!=="number"&&typeof draft!=="string"||typeof draft==="string"&&!draft.trim())throw new Error("SOURCE_FORM_REQUIRED");
  const value=Number(draft);if(!Number.isFinite(value)||current.type==="integer"&&!Number.isSafeInteger(value)||current.minimum!==undefined&&value<current.minimum||current.maximum!==undefined&&value>current.maximum||current.exclusiveMinimum!==undefined&&value<=current.exclusiveMinimum||current.exclusiveMaximum!==undefined&&value>=current.exclusiveMaximum)throw new Error("SOURCE_FORM_RANGE");return value;
 }
 if(current.type==="string"){
  if(typeof draft!=="string")throw new Error("SOURCE_FORM_REQUIRED");let value=draft;
  if(current.format==="date-time"){
   const originalUtc=value.endsWith("Z");if(!originalUtc)value+="Z";
   if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?Z$/.test(value))throw new Error("SOURCE_FORM_RANGE");
   const withSeconds=value.length===17?value.slice(0,-1)+":00Z":value,date=new Date(withSeconds);
   if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,19)!==withSeconds.slice(0,19))throw new Error("SOURCE_FORM_RANGE");value=originalUtc?withSeconds:date.toISOString();
  }
  if(current.format==="date"&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+"T00:00:00Z"))||new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value))throw new Error("SOURCE_FORM_RANGE");
  if(value.length<(current.minLength??0)||value.length>(current.maxLength??512)||current.pattern&&!new RegExp(current.pattern).test(value))throw new Error("SOURCE_FORM_RANGE");return value;
 }
 throw new Error("SOURCE_FORM_SCHEMA_UNSUPPORTED");
}
