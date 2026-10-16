import {describe,expect,it,vi,afterEach} from 'vitest';
import {assertRollbackBase,rollbackAuditExpiry} from '../../packages/automation/src/rollback';
import {automationClient,AutomationRequestError} from '../../apps/web/app/automation/client';

afterEach(()=>vi.unstubAllGlobals());
describe('alpha16 revision restore protocol',()=>{
 it('requires current draft, active pointer and generation together',()=>{
  const current={draft_revision:3,active_revision:2,generation:4};
  expect(()=>assertRollbackBase(current,{expectedRevision:3,expectedActiveRevision:2,expectedGeneration:4})).not.toThrow();
  for(const expected of [{expectedRevision:2,expectedActiveRevision:2,expectedGeneration:4},{expectedRevision:3,expectedActiveRevision:1,expectedGeneration:4},{expectedRevision:3,expectedActiveRevision:2,expectedGeneration:3}])expect(()=>assertRollbackBase(current,expected)).toThrow('AUTOMATION_ROLLBACK_CONFLICT');
 });
 it('bounds independent minimal rollback audit without carrying Run state',()=>{
  expect(rollbackAuditExpiry(new Date('2026-10-16T12:00:00Z')).toISOString()).toBe('2026-10-30T12:00:00.000Z');
 });
 it('uses existing authenticated same-origin routes and binds restoration CAS fields',async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({id:'flow',draftRevision:4}),{status:200}));vi.stubGlobal('fetch',fetch);
  const client=automationClient('/api/automation','884111111111111111');
  const request={sourceRevision:1,expectedRevision:3,expectedActiveRevision:2,expectedGeneration:4,requestId:'00000000-0000-4000-8000-000000000001'};
  await client.prepareRollback('flow',request);
  const [url,options]=fetch.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe('/api/automation/flows/flow/rollback-draft');expect(options.credentials).toBe('same-origin');expect(options.method).toBe('POST');expect(JSON.parse(options.body as string)).toEqual(request);
 });
 it('keeps an uncertain mutation distinct and never retries it automatically',async()=>{
  const fetch=vi.fn(async()=>{throw new Error('lost response');});vi.stubGlobal('fetch',fetch);
  const client=automationClient('/api/automation','884111111111111111');
  let caught:unknown;try{await client.commitRollback('flow',{rollbackId:'00000000-0000-4000-8000-000000000001',revision:3,semanticHash:'a'.repeat(64),expectedActiveRevision:2,expectedGeneration:4,requestId:'00000000-0000-4000-8000-000000000002'});}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(AutomationRequestError);expect((caught as AutomationRequestError).uncertain).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
 });
});
