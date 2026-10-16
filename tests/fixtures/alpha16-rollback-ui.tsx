import {useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RollbackPanel,ManagedRolePanel} from '../../apps/web/app/automation/rollback-panel';
import {automationClient} from '../../apps/web/app/automation/client';
function App(){
 const query=new URLSearchParams(location.search),locale=query.get('locale')==='ja'?'ja':'en';
 const client=useMemo(()=>automationClient('/api/automation','884111111111111111'),[]),[revision,setRevision]=useState(2),[uncertain,setUncertain]=useState(false);
 return <main><output aria-label="Revision">{revision}</output><output aria-label="Uncertain">{String(uncertain)}</output><RollbackPanel client={client} flowId="restore" revision={revision} locale={locale} disabled={query.has('readonly')||uncertain} reviewed={query.has('reviewed')} onAdopt={detail=>{setRevision(detail.draftRevision);setUncertain(false);}} onUncertain={()=>setUncertain(true)}/><ManagedRolePanel client={client} locale={locale}/></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
