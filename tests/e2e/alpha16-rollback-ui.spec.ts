import {test,expect} from './alpha16-browser-fixture';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
const web=createRequire(resolve('apps/web/package.json'));
const esbuild=createRequire(createRequire(import.meta.url).resolve('tsx'))('esbuild') as {build(input:Record<string,unknown>):Promise<{outputFiles:{text:string}[]}>};
let html='';
test.beforeAll(async()=>{const result=await esbuild.build({entryPoints:[resolve('tests/fixtures/alpha16-rollback-ui.tsx')],bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',alias:{react:dirname(web.resolve('react/package.json')),'react-dom':dirname(web.resolve('react-dom/package.json'))}});html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${result.outputFiles[0]!.text.replaceAll('</script','<\\/script')}</script>`;});
for(const locale of ['ja','en'] as const){
 test(`${locale}: restoration differences, cancel, fresh revision and unknown response fencing`,async({page})=>{
  let draft=2,posts=0,rollbackId='';const active=2;
  const definition=(name:string)=>({schemaVersion:1,id:'restore',guildId:'884111111111111111',name,trigger:{kind:'manual',inputs:[]},variables:[],body:[{kind:'end',id:'end'}]});
  const detail=()=>({id:'restore',name:draft===2?'Current':'Earlier',draftRevision:draft,activeRevision:active,generation:2,state:'ACTIVE',definition:definition(draft===2?'Current':'Earlier'),validation:{valid:true,complete:true,semanticHash:'a'.repeat(64),issues:[]},rollbackReadiness:{preparationAvailable:true,activationAvailable:true,reasonCode:null}});
  await page.route('**/*',route=>route.fulfill({status:404,body:'SYNTHETIC_ONLY'}));
  await page.route('**/alpha16-restore*',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.route('**/api/automation/**',async route=>{const url=new URL(route.request().url()),path=url.pathname;
   if(path.endsWith('/rollback-draft')){posts++;const body=route.request().postDataJSON();rollbackId=body.requestId;draft=3;return route.fulfill({json:{...detail(),rollbackId,restoredFromRevision:1,requiresFreshReview:true}});}
   if(path.endsWith('/rollback')){posts++;return route.abort('failed');}
   if(path.endsWith('/rollback-history'))return route.fulfill({json:{items:rollbackId?[{rollbackId,sourceRevision:1,preparedRevision:3,baseActiveRevision:2,baseGeneration:2,state:'PREPARED',createdAt:'2026-10-16T12:00:00Z',appliedAt:null,expiresAt:'2026-10-30T12:00:00Z'}]:[]}});
   if(path.endsWith('/revisions/1'))return route.fulfill({json:{id:'restore',revision:1,definition:definition('Earlier')}});
   if(path.endsWith('/flows/restore'))return route.fulfill({json:detail()});
   return route.fulfill({status:404,json:{error:'SYNTHETIC_ONLY'}});
  });
  await page.goto(`/alpha16-restore?locale=${locale}&reviewed`);
  await page.getByText(locale==='ja'?'過去の版へ戻す・復元履歴':'Restore an earlier revision and history',{exact:true}).click();
  await page.getByRole('button',{name:locale==='ja'?'差分を確認':'Review changes',exact:true}).click();
  const prepare=page.getByRole('button',{name:locale==='ja'?'この内容から新しい下書きを作る':'Create a new draft from these contents',exact:true});await expect(prepare).toBeEnabled();await prepare.click();
  await page.getByRole('dialog').getByRole('button',{name:locale==='ja'?'取消':'Cancel',exact:true}).click();expect(posts).toBe(0);
  await prepare.click();await page.getByRole('dialog').getByRole('button',{name:locale==='ja'?'下書きを作成':'Create draft',exact:true}).click();await expect(page.getByLabel('Revision',{exact:true})).toHaveText('3');expect(posts).toBe(1);
  await page.getByRole('button',{name:locale==='ja'?'履歴を更新':'Refresh history',exact:true}).click();
  await page.getByRole('button',{name:locale==='ja'?'確認した復元版を有効にする':'Enable the reviewed restored revision',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:locale==='ja'?'復元版を有効化':'Enable restored revision',exact:true}).click();
  await expect(page.getByLabel('Uncertain')).toHaveText('true');expect(posts).toBe(2);expect(active).toBe(2);
  await expect(page.getByRole('button',{name:locale==='ja'?'結果を照合':'Check recorded result',exact:true})).toBeVisible();
 });
 test(`${locale}: read-only, empty history, permission and communication failure stay distinct`,async({page})=>{
  await page.route('**/*',route=>route.fulfill({status:404,body:'SYNTHETIC_ONLY'}));await page.route('**/alpha16-restore*',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.route('**/api/automation/**',route=>route.fulfill({status:403,json:{error:'NEXUS_ROLE_REQUIRED'}}));
  await page.goto(`/alpha16-restore?locale=${locale}&readonly`);await page.getByText(locale==='ja'?'過去の版へ戻す・復元履歴':'Restore an earlier revision and history',{exact:true}).click();
  await expect(page.getByRole('alert')).toContainText(locale==='ja'?'権限':'permission');await expect(page.getByLabel(locale==='ja'?'復元元の保存済み版':'Earlier saved revision')).toBeDisabled();
  await page.unroute('**/api/automation/**');await page.route('**/api/automation/**',route=>route.abort('failed'));
  await page.getByRole('button',{name:locale==='ja'?'履歴を更新':'Refresh history',exact:true}).click();await expect(page.getByRole('alert')).toContainText(locale==='ja'?'確認できません':'could not be verified');
  await expect(page.getByText(locale==='ja'?'確認できる復元履歴はありません。':'No restore history is available.',{exact:true})).toHaveCount(0);
 });
}
