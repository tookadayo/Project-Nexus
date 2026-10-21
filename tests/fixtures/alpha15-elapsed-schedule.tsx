import {useState} from '../../apps/web/node_modules/react';
import {createRoot} from '../../apps/web/node_modules/react-dom/client';
import {TriggerEditor} from '../../apps/web/app/automation/trigger-editor';
import type {TriggerDefinition} from '../../packages/automation/src/types';
import '../../apps/web/app/automation/workspace.css';
function Fixture(){
  const [trigger,setTrigger]=useState<TriggerDefinition>({kind:'manual',inputs:[]});
  return <main className="automation-workspace"><TriggerEditor trigger={trigger} onChange={setTrigger} locale={new URLSearchParams(location.search).get('locale')==='ja'?'ja':'en'}/><output data-testid="trigger-state">{JSON.stringify(trigger)}</output></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
