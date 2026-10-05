import {loadEnvFile} from 'node:process';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {scopeForGuild,apiToken} from '../packages/security/src/index.js';
import {webAuthMode} from '../packages/config/src/web-auth.js';
import {webOrigin} from '../packages/config/src/web-origin.js';
try{loadEnvFile();}catch{/* Optional .env; direct environment variables are also supported. */}
const guildId=process.env.NEXUS_GUILD_ID||process.env.DISCORD_GUILD_ID;
if(guildId&&process.env.API_KEY){const s=scopeForGuild(guildId);process.env.NEXUS_GUILD_ID=s.guildId;process.env.NEXUS_ORGANIZATION_ID=s.organizationId;process.env.NEXUS_API_TOKEN=apiToken(process.env.API_KEY,s);}
process.env.NEXUS_API_URL??='http://127.0.0.1:3001';process.env.NEXT_TELEMETRY_DISABLED??='1';
const development=process.argv.includes('--dev')||process.env.NODE_ENV!=='production'&&process.env.NEXUS_WEB_AUTH_MODE==='development';
Object.assign(process.env,{NODE_ENV:process.env.NODE_ENV??(development?'development':'production')});
webAuthMode();
webOrigin();
const webPort=Number(process.env.NEXUS_WEB_PORT??3100);if(!Number.isInteger(webPort)||webPort<1||webPort>65535)throw new Error('NEXUS_WEB_PORT must be a valid port');
const child=spawn(process.execPath,[resolve('apps/web/node_modules/next/dist/bin/next'),development?'dev':'start','--hostname','127.0.0.1','--port',String(webPort)],{cwd:resolve('apps/web'),env:process.env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>{process.exitCode=code??1;});process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());
