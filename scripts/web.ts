import {loadEnvFile} from 'node:process';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {scopeForGuild,apiToken} from '../packages/security/src/index.js';
try{loadEnvFile();}catch{/* Optional .env; direct environment variables are also supported. */}
const guildId=process.env.NEXUS_GUILD_ID??process.env.DISCORD_GUILD_ID;
if(guildId&&process.env.API_KEY){const s=scopeForGuild(guildId);process.env.NEXUS_GUILD_ID=s.guildId;process.env.NEXUS_ORGANIZATION_ID=s.organizationId;process.env.NEXUS_API_TOKEN=apiToken(process.env.API_KEY,s);}
process.env.NEXUS_API_URL??='http://127.0.0.1:3001';process.env.NEXT_TELEMETRY_DISABLED??='1';
if((process.env.NEXUS_WEB_PASSWORD?.length??0)<16)throw new Error('Set NEXUS_WEB_PASSWORD to at least 16 characters');
const child=spawn(process.execPath,[resolve('apps/web/node_modules/next/dist/bin/next'),process.argv.includes('--dev')?'dev':'start','--hostname','127.0.0.1','--port','3000'],{cwd:resolve('apps/web'),env:process.env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>{process.exitCode=code??1;});process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());
