/** Runs before application clients hydrate. Cookie contents are read at request
 * time in the browser, never serialized into a shared page or external request. */
const source = String.raw`(()=>{
const token=()=>document.cookie.split(';').map(p=>p.trim()).find(p=>p.startsWith('nexus_csrf='))?.slice(11);
const local=value=>{try{return new URL(value,document.baseURI).origin===location.origin}catch{return false}};
const original=window.fetch;
window.fetch=function(input,init){const request=input instanceof Request?input:null;const method=(init?.method||request?.method||'GET').toUpperCase();const url=request?.url||String(input);if(!['GET','HEAD','OPTIONS'].includes(method)&&local(url)){const value=token();if(value){const headers=new Headers(init?.headers||request?.headers);headers.set('X-Nexus-CSRF',decodeURIComponent(value));init={...init,headers}}}return original.call(this,input,init)};
const patch=form=>{if(!(form instanceof HTMLFormElement)||['get','dialog'].includes(form.method.toLowerCase())||!local(form.action))return;const value=token();if(!value)return;let field=form.querySelector('input[name="_nexus_csrf"]');if(!field){field=document.createElement('input');field.type='hidden';field.name='_nexus_csrf';form.append(field)}field.value=decodeURIComponent(value)};
document.addEventListener('submit',event=>patch(event.target),true);
document.addEventListener('DOMContentLoaded',()=>document.querySelectorAll('form').forEach(patch),{once:true});
})();`;
export function CsrfBridge() { return <script dangerouslySetInnerHTML={{ __html: source }} />; }
