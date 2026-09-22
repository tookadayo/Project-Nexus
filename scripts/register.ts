import {loadEnvFile} from 'node:process';
import {SlashCommandBuilder} from 'discord.js';
import {connect,migrate,ensureGuild} from '../packages/db/src/index.js';
import {scopeForGuild} from '../packages/security/src/index.js';
import {enqueue} from '../packages/discord/src/outbox.js';
import {randomUUID} from 'node:crypto';
try{loadEnvFile();}catch{/* Validate required variables below. */}
const guildId=process.env.DISCORD_GUILD_ID,databaseUrl=process.env.DATABASE_URL;
if(!guildId||!databaseUrl)throw new Error('DISCORD_GUILD_ID and DATABASE_URL required');
const command=new SlashCommandBuilder().setName('nexus').setDescription('Your community activation setup').setContexts(0).setIntegrationTypes(0);
for(const [name,description] of [['panel','Create or reopen the NEXUS control panel'],['personalize','Set your community preferences'],['privacy','View privacy settings and request deletion'],['overview','View community activation metrics']])command.addSubcommand(sub=>sub.setName(name!).setDescription(description!));
for(const name of ['setup','lifecycle','activation','cohorts','diagnose','interventions','experiments','reports','settings','billing'])command.addSubcommand(sub=>sub.setName(name).setDescription(`NEXUS ${name}`));
const db=connect(databaseUrl);try{await migrate(db);const s=scopeForGuild(guildId);await db.transaction().execute(async tx=>{await ensureGuild(tx,s);await enqueue(tx,s,`commands:${randomUUID()}`,'COMMANDS_REGISTER',{commands:[command.toJSON()]});});}finally{await db.destroy();}
process.stdout.write('NEXUS guild commands queued in the action outbox. Run pnpm dev to deliver.\n');
