export const setupOrder=['scope','team','notifications','goals'] as const;
export type SetupStep=typeof setupOrder[number];
export type SetupSteps=Record<SetupStep,boolean>;
export function advanceSetup(state:{setupSteps:SetupSteps;setupVersion:number},step:SetupStep){
 const index=setupOrder.indexOf(step);
 if(!setupOrder.slice(0,index).every(previous=>state.setupSteps[previous]))throw new Error('SETUP_STEP_OUT_OF_ORDER');
 const setupSteps={...state.setupSteps,[step]:true};
 return {setupSteps,setupVersion:step==='goals'?2:state.setupVersion,next:setupOrder[index+1]??null};
}
