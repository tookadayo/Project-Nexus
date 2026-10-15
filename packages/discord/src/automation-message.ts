import {z} from 'zod';
import {validateMessageSpec,type EmbedSpec} from '../../automation/src/message';
import {DEFAULT_AUTOMATION_LIMITS} from '../../automation/src/types';
import {assert} from '../../shared/src/index';

/** The only compiled Legacy fields accepted by the narrow automation sender. */
export interface CompiledLegacyMessage {
  content?:string;embeds?:EmbedSpec[];
  allowed_mentions:{parse:[];users:[];roles:[];replied_user:false};
}
export function validateCompiledLegacyMessage(input:unknown):CompiledLegacyMessage {
  assert(Buffer.byteLength(JSON.stringify(input)??'')<=DEFAULT_AUTOMATION_LIMITS.maxValueBytes,'AUTOMATION_MESSAGE_SIZE');
  const parsed=z.object({content:z.string().max(2000).optional(),embeds:z.array(z.unknown()).max(10).optional(),allowed_mentions:z.object({parse:z.array(z.never()).max(0),users:z.array(z.never()).max(0),roles:z.array(z.never()).max(0),replied_user:z.literal(false)}).strict()}).strict().parse(input);
  const validated=validateMessageSpec({kind:'legacy',...(parsed.content!==undefined?{content:parsed.content}:{}),...(parsed.embeds!==undefined?{embeds:parsed.embeds}:{})});
  if(validated.kind!=='legacy')throw new Error('AUTOMATION_MESSAGE_INVALID');
  return {...(validated.content!==undefined?{content:validated.content}:{}),...(validated.embeds!==undefined?{embeds:validated.embeds}:{}),allowed_mentions:{parse:[],users:[],roles:[],replied_user:false}};
}
