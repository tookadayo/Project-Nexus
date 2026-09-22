import Console,{type Dashboard} from './console';
type Metric={value:number|null,sampleSize:number,coverage:string,coverageRatio:number};
type Data={metrics:Record<string,Metric>,generatedAt:string};
export const dynamic='force-dynamic';
const labels:Record<string,string>={newMembers:'New Members',onboardingStartRate:'Onboarding Start Rate',onboardingCompletionRate:'Onboarding Completion Rate',activationRate:'Activation Rate',silentJoinerRate:'Silent Joiner Rate',medianTtfvSeconds:'Median TTFV',p75TtfvSeconds:'P75 TTFV',firstResponseRate:'First Response Rate',medianFirstResponseSeconds:'Median First Response Time',d1ActiveRetention:'D1 Active Retention',d7ActiveRetention:'D7 Active Retention',d30ActiveRetention:'D30 Active Retention',unansweredAfter1h:'Unanswered after 1h',unansweredAfter6h:'Unanswered after 6h',unansweredAfter24h:'Unanswered after 24h'};
function value(key:string,m:Metric){if(m.value===null)return '—';if(key.includes('Rate')||key.includes('Retention'))return `${(m.value*100).toFixed(1)}%`;if(key.includes('Seconds'))return `${Math.round(m.value/60)} min`;return m.value.toLocaleString();}
export default async function Page(){
 let data:Data|null=null;
 const {NEXUS_API_URL,NEXUS_ORGANIZATION_ID,NEXUS_GUILD_ID,NEXUS_API_TOKEN}=process.env;
 let dashboard:Dashboard|null=null;
 if(NEXUS_API_URL&&NEXUS_ORGANIZATION_ID&&NEXUS_GUILD_ID&&NEXUS_API_TOKEN){try{const response=await fetch(`${NEXUS_API_URL}/v2/organizations/${NEXUS_ORGANIZATION_ID}/guilds/${NEXUS_GUILD_ID}/dashboard`,{headers:{Authorization:`Bearer ${NEXUS_API_TOKEN}`},cache:'no-store',signal:AbortSignal.timeout(10000)});if(response.ok)dashboard=await response.json() as Dashboard;}catch{/* Explicit unavailable state below. */}}
 if(dashboard)return <main><header><a className="brand" href="/">N<span>✦</span>XUS</a><div className="badge">COMMUNITY ACTIVATION · v0.2</div></header><Console data={dashboard}/><footer className="bottom">Metadata, never message contents. Observable Active Retention · Guild-scoped identity</footer></main>;
 if(NEXUS_API_URL&&NEXUS_ORGANIZATION_ID&&NEXUS_GUILD_ID&&NEXUS_API_TOKEN){try{
  const res=await fetch(`${NEXUS_API_URL}/v1/organizations/${NEXUS_ORGANIZATION_ID}/guilds/${NEXUS_GUILD_ID}/overview`,{headers:{Authorization:`Bearer ${NEXUS_API_TOKEN}`},cache:'no-store',signal:AbortSignal.timeout(5000)});
  if(res.ok)data=await res.json() as Data;
 }catch{/* Present unavailable state rather than invented values. */}}
 const partial=data&&Object.values(data.metrics).some(m=>m.coverage!=='COMPLETE');
 return <main><header><a className="brand" href="/">N<span>✦</span>XUS</a><div className="badge">COMMUNITY ACTIVATION · v0.1</div></header>
 <section className="intro"><div><p className="eyebrow">YOUR COMMUNITY, IN CONTEXT</p><h1>From joining<br/>to belonging.</h1><p className="subtitle">An overview of the first steps, the first replies,<br/>and the reasons to come back.</p></div><aside><span className="dot"/> DISCORD-FIRST<p>Manage your community from<br/><code>/nexus panel</code> in Discord.</p><small>Last 30 days · membership episodes</small></aside></section>
 {!data?<section className="notice" role="status"><h2>Overview unavailable</h2><p>Connect the scoped NEXUS API to show verified community metrics. No sample data is displayed.</p></section>:<>
 {partial&&<section className="notice" role="status"><strong>Coverage needs attention</strong><p>Some activity was not observed. Read the coverage and sample size alongside each metric. No automated recommendation is generated.</p></section>}
 <section className="metrics" aria-label="Community metrics">{Object.entries(data.metrics).map(([key,m])=><article key={key}><h2>{labels[key]??key}</h2><div className="value">{value(key,m)}</div><footer><span>n = {m.sampleSize}</span><span className={m.coverage==='COMPLETE'?'complete':'partial'}>{m.coverage} · {Math.round(m.coverageRatio*100)}%</span></footer></article>)}</section>
 <p className="method">Activation: first message in the configured start channel within seven days. Active Retention: a message in the corresponding 24-hour window after joining. Immature cohorts are excluded. First Response Rate uses first messages observed for at least 24 hours.</p>
 </>}
 <footer className="bottom"><span>Metadata, never message contents.</span><span>TEST / PREVIEW activity excluded · No individual scores</span></footer></main>;
}
