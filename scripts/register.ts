import {loadEnvFile} from 'node:process';
import {connect,migrate,ensureGuild} from '../packages/db/src/index.js';
import {scopeForGuild} from '../packages/security/src/index.js';
import {enqueue} from '../packages/discord/src/outbox.js';
import {randomUUID} from 'node:crypto';
import {buildNexusCommand} from './commands.js';
try{loadEnvFile();}catch{/* Validate required variables below. */}
const guildId=process.env.DISCORD_GUILD_ID,databaseUrl=process.env.DATABASE_URL;
if(!guildId||!databaseUrl)throw new Error('DISCORD_GUILD_ID and DATABASE_URL required');
const command=buildNexusCommand();
const db=connect(databaseUrl);try{await migrate(db);const s=scopeForGuild(guildId);await db.transaction().execute(async tx=>{await ensureGuild(tx,s);await enqueue(tx,s,`commands:${randomUUID()}`,'COMMANDS_REGISTER',{commands:[command.toJSON()]});});}finally{await db.destroy();}
process.stdout.write('NEXUS guild commands queued in the action outbox. Run pnpm dev to deliver.\n');
