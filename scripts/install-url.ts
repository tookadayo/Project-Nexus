import {loadEnvFile} from 'node:process';
import {discordInstallUrl} from '../packages/discord/src/install.js';
try{loadEnvFile();}catch{/* An environment variable may be supplied directly. */}
const applicationId=process.env.DISCORD_APPLICATION_ID;if(!applicationId)throw new Error('DISCORD_APPLICATION_ID required');
process.stdout.write(`${discordInstallUrl(applicationId,process.argv[2])}\n`);
