import { z } from 'zod';
const key=z.string().regex(/^[a-f0-9]{64}$/i);
export const configSchema=z.object({
  DATABASE_URL:z.url(), REDIS_URL:z.url(), IDENTITY_KEY:key,LOOKUP_KEY:key,COMPONENT_KEY:key,
  DISCORD_PUBLIC_KEY:key,DISCORD_TOKEN:z.string().min(1),DISCORD_APPLICATION_ID:z.string().regex(/^\d{17,20}$/),
  API_KEY:z.string().min(32),API_PORT:z.coerce.number().int().default(3001),INTERACTION_PORT:z.coerce.number().int().default(3002)
});
export function readConfig(env:NodeJS.ProcessEnv=process.env){return configSchema.parse(env);}
