import {expect,test,type Page} from './alpha16-browser-fixture';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
let html='';
test.beforeAll(async()=>{
 const local=createRequire(import.meta.url),web=createRequire(resolve('apps/web/package.json'));
 const esbuild=createRequire(local.resolve('tsx'))('esbuild') as {build(input:Record<string,unknown>):Promise<{outputFiles:{path:string;text:string}[]}>};
 const result=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MaintenanceWorkspace} from ${JSON.stringify(resolve('apps/web/app/operations/maintenance/view.tsx'))};import ${JSON.stringify(resolve('apps/web/app/operations/maintenance/maintenance.css'))};createRoot(document.getElementById('root')).render(<MaintenanceWorkspace guildId="123456789012345678" locale={new URLSearchParams(location.search).get('locale')==='ja'?'ja':'en'}/>);`,resolveDir:resolve('.'),sourcefile:'alpha16-maintenance-fixture.tsx',loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,outfile:'maintenance.js',jsx:'automatic',alias:{react:dirname(web.resolve('react/package.json')),'react-dom':dirname(web.resolve('react-dom/package.json'))}});
 const js=result.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=result.outputFiles.find(f=>f.path.endsWith('.css'))!.text;
 html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:0}${css}</style></head><body><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`;
});
test.beforeEach(async({page})=>{await page.route('**/alpha16-maintenance-fixture*',route=>route.fulfill({contentType:'text/html',body:html}));await page.addInitScript(()=>{document.cookie='nexus_csrf=synthetic-only; path=/';});});
async function mock(page:Page,options:{empty?:boolean;forbidden?:boolean;failed?:boolean;conflict?:boolean;unknown?:boolean}={}){
 const writes:{body:unknown;headers:Record<string,string>}[]=[];let exists=true;
 await page.route('**/api/operations-maintenance/**',async route=>{
  const request=route.request(),reply=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({ok:status<400,...(status<400?{data}:{error:{code:data}})})});
  if(options.forbidden)return reply('NEXUS_ROLE_REQUIRED',403);if(options.failed)return reply('SERVICE_UNAVAILABLE',503);
  if(request.method()==='POST'){writes.push({body:request.postDataJSON(),headers:request.headers()});if(options.unknown)return route.abort('failed');if(options.conflict)return reply('REVISION_CONFLICT',412);exists=false;return reply({deleted:true});}
  return reply({value:!options.empty&&exists?[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'Synthetic event',revision:3,state:'ENABLED'}]:[],permissions:['READ','CONFIGURE']});
 });return writes;
}
for(const locale of ['ja','en'] as const){
 test(`empty and narrow screen ${locale}`,async({page})=>{await mock(page,{empty:true});await page.setViewportSize({width:320,height:900});await page.goto('/alpha16-maintenance-fixture?locale='+locale);await expect(page.getByText(locale==='ja'?'保存された項目はありません。':'No saved items.',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);});
 test(`cancel is inert and duplicate confirmation sends once ${locale}`,async({page})=>{const writes=await mock(page);await page.goto('/alpha16-maintenance-fixture?locale='+locale);const remove=page.getByRole('button',{name:locale==='ja'?'保存イベントを削除':'Delete saved event',exact:true});await remove.click();await page.getByRole('button',{name:locale==='ja'?'取消':'Cancel',exact:true}).click();expect(writes).toEqual([]);await expect(remove).toBeFocused();await remove.click();await page.getByRole('button',{name:locale==='ja'?'確定':'Confirm',exact:true}).dblclick();await expect(page.getByText(locale==='ja'?'操作が完了しました。':'Operation completed.',{exact:true})).toBeVisible();expect(writes).toHaveLength(1);expect(writes[0]!.body).toEqual({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision:3});expect(writes[0]!.headers['x-nexus-guild']).toBe('123456789012345678');expect(writes[0]!.headers['x-nexus-csrf']).toBe('synthetic-only');});
}
for(const failure of ['forbidden','failed','conflict','unknown'] as const)test(`does not hide or retry ${failure}`,async({page})=>{
 const writes=await mock(page,{[failure]:true});await page.goto('/alpha16-maintenance-fixture');
 if(failure==='conflict'||failure==='unknown'){await page.getByRole('button',{name:'Delete saved event',exact:true}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();}
 await expect(page.getByRole('alert')).toBeVisible();expect(writes).toHaveLength(failure==='conflict'||failure==='unknown'?1:0);
});
