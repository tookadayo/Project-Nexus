import {it,expect} from "vitest";
import {ComponentType,ButtonStyle} from "discord-api-types/v10";
import {nexusPanel,validatePanel,escapeUserText,actionRow,text} from "../../packages/discord-panels/src/primitives";
import {workflowHome} from "../../packages/discord-panels/src/views/workflow-home";
import {basicAnalysisPanel} from "../../packages/discord-panels/src/views/basic-analysis";
import {analysisHistoryPanel,analysisResultPanel,analysisPreviewPanel,metricValue,analysisAttentionConfirmationPanel} from "../../packages/discord-panels/src/views/analysis";
import {setupPlacesPanel} from "../../packages/discord-panels/src/views/setup-wizard";
import {run,result} from "../fixtures/analysis-panels";
import {localized} from "../../packages/discord-panels/src/i18n/analysis";
const capture=()=>{const intents:Record<string,unknown>[]=[];return{intents,issue:async(data:Record<string,unknown>)=>{intents.push(data);return`opaque-${intents.length}`;}};};
it.each(["ja","en"] as const)("separates basic activity from counted detailed analysis with stable entries (%s)",async locale=>{
 const {issue,intents}=capture(),home=await workflowHome(issue,{analysis:{remaining:0,latest:null,attentionCount:0}},locale);
 validatePanel(home);
 expect(intents.map(i=>[i.action,i.page])).toEqual([["controlNavigate","analysis"],["controlNavigate","attention"],["analysisMenu",undefined],["controlNavigate","settings"],["controlNavigate","settings"]]);
 const sections=(home.components![0] as unknown as {components:Record<string,unknown>[]}).components.filter(c=>c.type===ComponentType.Section);
 expect(JSON.stringify(sections[0])).not.toContain(locale==="ja"?"0回":"remaining");
 expect(JSON.stringify(sections[2])).toContain(locale==="ja"?"0回":"remaining: 0");
 const shared=JSON.stringify(await workflowHome(issue,{sharedEntry:true,analysis:{remaining:8,latest:new Date(),attentionCount:4}},locale));
 expect(shared).not.toContain(locale==="ja"?"8回":"remaining: 8");
});
it("validates recursive components, complete text and select limits without trimming IDs or actions",async()=>{
 expect(()=>nexusPanel({title:"x",rows:[{type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:"x".repeat(101),options:[{label:"x",value:"x"}]}]}]})).toThrow("DISCORD_CUSTOM_ID_LIMIT");
 expect(()=>nexusPanel({title:"x",children:[text("x".repeat(4000))]})).toThrow("DISCORD_MESSAGE_TEXT_LIMIT");
 expect(()=>nexusPanel({title:"x",rows:[{type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:"id",options:Array.from({length:26},(_,i)=>({label:String(i),value:String(i)}))}]}]})).toThrow("DISCORD_SELECT_LIMIT");
 await expect(actionRow(capture().issue,Array.from({length:6},(_,i)=>({label:String(i),action:String(i)})))).rejects.toThrow("DISCORD_ACTION_GROUP_LIMIT");
 expect(escapeUserText("**@everyone** <@123> [a](https://x) #name")).toBe("\\*\\*@\u200beveryone\\*\\* \\<@\u200b123\\> \\[a\\]\\(https://x\\) #name");
 expect(localized("en",undefined)).toBe("Data is unavailable");
});
it("keeps stable server-managed history cursors and every result action on a five-row page",async()=>{
 const {issue,intents}=capture();
 const runs=Array.from({length:5},(_,i)=>({...run,id:`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`}));
 const panel=await analysisHistoryPanel(issue,{runs,nextCursor:"next-token",previousCursor:"previous-token"},"en",{type:"OVERALL"});
 validatePanel(panel);expect(intents.filter(i=>i.action==="analysisResult")).toHaveLength(5);
 expect(intents.find(i=>i.direction==="next")).toMatchObject({cursor:"next-token",type:"OVERALL"});
 expect(intents.find(i=>i.direction==="previous")).toMatchObject({cursor:"previous-token",type:"OVERALL"});
 expect(JSON.stringify(panel)).toContain("2026-09-08");
 const invalidated=await analysisHistoryPanel(issue,[{...run,invalidated_at:new Date(),recipe_version:"v1-legacy"}],"en");
 expect(JSON.stringify(invalidated)).toContain("Result unavailable after data removal");
 expect(JSON.stringify(invalidated)).toContain("earlier calculation method");
 expect(JSON.stringify(invalidated)).toContain('"disabled":true');
 await expect(analysisHistoryPanel(issue,[...runs,run],"en")).rejects.toThrow("DISCORD_HISTORY_PAGE_LIMIT");
});
it("pages selected places beyond 100 without losing later controls or purposes",async()=>{
 const {issue,intents}=capture(),ids=Array.from({length:230},(_,i)=>String(777777777777777770n+BigInt(i)));
 const panel=await setupPlacesPanel(issue,{id:run.id,settings_revision:1,version:1,step:4,applied_at:null,draft:{analysisScope:{mode:"include",channelIds:ids},helperEnabled:false,helperChannelId:null,managerRoleIds:[],newMemberGoals:[],skipped:[]}},"en",22);
 validatePanel(panel);expect(JSON.stringify(panel)).toContain(ids[229]);expect(JSON.stringify(panel)).not.toContain(`<#${ids[0]}>`);expect(intents.find(i=>i.action==="setupWizardResume")).toBeTruthy();
});
it.each(["ja","en"] as const)("renders units, verified zero, unknown and expandable result details (%s)",async locale=>{
 const {issue,intents}=capture();
 expect(metricValue(locale,"new_members",2)).toContain(locale==="ja"?"人":"people");
 expect(metricValue(locale,"first_reply_seconds",2)).toContain(locale==="ja"?"秒":"seconds");
 const metrics=Array.from({length:12},(_,i)=>({...result.metrics[0]!,key:i===0?"observed_posts":"internal_unknown_"+i,quality:"COMPLETE" as const,evidence:{...result.metrics[0]!.evidence,value:0,observationState:"OBSERVED" as const,coverageState:"COMPLETE" as const}}));
 const page=await analysisResultPanel(issue,{run,result:{...result,metrics}},locale);
 const current=await analysisResultPanel(issue,{run:{...run,target_channel_ids:["777777777777777777"],calculated_at:new Date("2026-10-08T00:00:00Z")},result:{...result,metrics,baseline:{runId:run.id,changes:[{key:"first_reply_seconds",before:240,after:120,unit:"SECONDS"}]}}},locale);
 expect(JSON.stringify(current)).toContain("1791417600:f");
 expect(JSON.stringify(current)).toContain(locale==="ja"?"240秒 → 120秒":"240 seconds → 120 seconds");
 expect(JSON.stringify(page)).toContain(locale==="ja"?"0件":"0 items");expect(JSON.stringify(page)).not.toContain("internal_unknown");expect(intents.some(i=>i.action==="analysisEvidence")).toBe(true);
 const detail=await analysisResultPanel(issue,{run,result:{...result,metrics}},locale,undefined,true,2);validatePanel(detail);
 const basic=await basicAnalysisPanel(issue,{basicAnalysis:{result:{...result,metrics},from:run.period_start,to:run.period_end,channelCount:2}},locale,"posts");
 expect(JSON.stringify(basic)).toContain(locale==="ja"?"0件":"0 items");expect(intents.some(i=>i.action==="analysisStart")).toBe(false);
});
it("confirms and reports duplicates before creating an analysis review",async()=>{
 const {issue,intents}=capture(),evidence=result.metrics[0]!.evidence;
 const panel=await analysisAttentionConfirmationPanel(issue,{run,result:{...result,concerns:[{key:"waiting_response",metricKey:"waiting_response",reason:"WAITING_RESPONSE",value:3,evidence}]}},"waiting_response",true,"en");
 expect(JSON.stringify(panel)).toContain("will not be duplicated");
 expect(intents.find(i=>i.action==="analysisAttentionConfirm")).toMatchObject({runId:run.id,concernKey:"waiting_response"});
 const rows=(panel.components![0] as unknown as {components:Record<string,unknown>[]}).components.filter(c=>c.type===ComponentType.ActionRow);
 expect((rows[0]!.components as Record<string,unknown>[])[0]).toMatchObject({disabled:true,style:ButtonStyle.Primary});
});

it("keeps a correction free at zero remaining uses and preserves the original fixed conditions",async()=>{
 const {issue,intents}=capture(),correctionOf=run.id;
 const preview=await analysisPreviewPanel(issue,{request:{type:"OVERALL",days:30,periodStart:run.period_start.toISOString(),periodEnd:run.period_end.toISOString(),correctionOf},scope:{mode:"include",channelIds:["777777777777777777"]},availability:"AVAILABLE",quality:"COMPLETE",metrics:result.metrics,periodStart:run.period_start,periodEnd:run.period_end,usage:{remaining:0,reserved:0,consumed:0},duplicate:null,configRevision:1,inputFingerprint:"a".repeat(64),estimate:null,targetChannelCount:1,consumeCount:0,correctionOf},"en");
 validatePanel(preview);
 expect(JSON.stringify(preview)).toContain("without using an analysis allowance");
 expect(JSON.stringify(preview)).not.toContain("No analysis uses remain");
 expect(intents.find(i=>i.action==="analysisStart")).toMatchObject({correctionOf,periodStart:run.period_start.toISOString(),periodEnd:run.period_end.toISOString()});
 const content=(preview.components![0] as unknown as {components:Record<string,unknown>[]}).components;
 const start=(content.filter(c=>c.type===ComponentType.ActionRow)[0]!.components as Record<string,unknown>[])[0]!;
 expect(start.disabled).toBe(false);
 const old=await analysisResultPanel(issue,{run:{...run,scope_bug_impact:"POSSIBLE_CATEGORY_PARENT"},result},"en");
 expect(JSON.stringify(old)).toContain("Review corrected calculation");
 expect(intents.find(i=>i.action==="analysisPreview")).toMatchObject({correctionOf,periodStart:run.period_start.toISOString(),periodEnd:run.period_end.toISOString()});
});
