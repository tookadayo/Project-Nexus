import {afterEach,expect,it,vi} from 'vitest';
import {buildDiscordMessage} from '../../packages/automation/src/message';
import {graphemeLength} from '../../packages/automation/src/scratch-unicode';
import {DiscordRest} from '../../packages/discord/src/rest';
import type {CompiledLegacyMessage} from '../../packages/discord/src/automation-message';

const guildId='891111111111111111',channelId='892222222222222222',botId='894444444444444444';
const noMentions:CompiledLegacyMessage['allowed_mentions']={parse:[],users:[],roles:[],replied_user:false};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('T066 rejects a one-grapheme emoji payload before pre-dispatch or network calls',async()=>{
  const content='\u{1f469}'+'\u200d\u{1f469}'.repeat(700);
  expect(graphemeLength(content)).toBe(1);
  expect(content.length).toBe(2102);
  expect(()=>buildDiscordMessage({kind:'legacy',content})).toThrow();
  expect(()=>buildDiscordMessage({kind:'legacy',richText:[{kind:'text',text:content}]})).toThrow();
  const fetcher=vi.fn(),beforeDispatch=vi.fn(async()=>{});vi.stubGlobal('fetch',fetcher);
  await expect(new DiscordRest('synthetic-not-a-credential',botId).automationWrite({kind:'message',guildId,channelId,nonce:'synthetic-payload',messageSpec:{content,allowed_mentions:noMentions}},beforeDispatch)).rejects.toThrow();
  expect(beforeDispatch).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it('T066 independently validates the final expanded payload while permitting a valid boundary',async()=>{
  const content='e'+'\u0301'.repeat(1999);
  expect(graphemeLength(content)).toBe(1);
  expect(content.length).toBe(2000);
  expect(buildDiscordMessage({kind:'legacy',content})).toMatchObject({content});
  expect(()=>buildDiscordMessage({kind:'legacy',richText:[{kind:'bold',children:[{kind:'text',text:content}]}]})).toThrowError(expect.objectContaining({code:'MESSAGE_LENGTH'}));
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({id:'893333333333333333'}),{status:200})),beforeDispatch=vi.fn(async()=>{});vi.stubGlobal('fetch',fetcher);
  await expect(new DiscordRest('synthetic-not-a-credential',botId).automationWrite({kind:'message',guildId,channelId,nonce:'synthetic-boundary',messageSpec:{content,allowed_mentions:noMentions}},beforeDispatch)).resolves.toBe('893333333333333333');
  expect(beforeDispatch).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
