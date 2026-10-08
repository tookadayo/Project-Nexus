import {hostedBetaEnabled} from './hosted-beta';
import { z } from 'zod';
import {webAuthMode} from './web-auth';
const key=z.string().regex(/^[a-f0-9]{64}$/i);
export const configSchema=z.object({
  DATABASE_URL:z.url(), REDIS_URL:z.url(), IDENTITY_KEY:key,LOOKUP_KEY:key,COMPONENT_KEY:key,
  DISCORD_PUBLIC_KEY:z.preprocess(value=>value===''?undefined:value,key.optional().default('0'.repeat(64))),DISCORD_TOKEN:z.string().min(1),DISCORD_APPLICATION_ID:z.string().regex(/^\d{17,20}$/),
  NEXUS_INTERACTION_TRANSPORT:z.enum(['gateway','webhook']).default('gateway'),
  NEXUS_COMMAND_SCOPE:z.enum(['guild','global']).default('guild'),
  API_KEY:z.string().min(32),API_PORT:z.coerce.number().int().default(3001),INTERACTION_PORT:z.coerce.number().int().default(3002)
});
export function readConfig(env:NodeJS.ProcessEnv=process.env){webAuthMode(env);hostedBetaEnabled(env);const config=configSchema.parse(env);if(config.NEXUS_COMMAND_SCOPE==='global')throw new Error('Global command registration is not available in this Alpha release. Use NEXUS_COMMAND_SCOPE=guild.');return config;}
