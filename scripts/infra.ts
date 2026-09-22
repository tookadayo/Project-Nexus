import EmbeddedPostgres from 'embedded-postgres';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
await mkdir('.local/pg',{recursive:true});await mkdir('.local/redis-data',{recursive:true});
const pg=new EmbeddedPostgres({databaseDir:resolve('.local/pg'),user:'nexus',password:'nexus',port:55432,persistent:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
if(!existsSync('.local/pg/PG_VERSION'))await pg.initialise();await pg.start();
const client=pg.getPgClient();await client.connect();const exists=await client.query("SELECT 1 FROM pg_database WHERE datname='nexus'");await client.end();if(!exists.rowCount)await pg.createDatabase('nexus');
const binary=process.env.REDIS_BINARY??resolve('.local/redis/Redis-8.10.2-Windows-x64-cygwin/redis-server.exe');
const redis=spawn(binary,['--bind','127.0.0.1','--port','56379','--appendonly','yes'],{cwd:resolve('.local/redis-data'),windowsHide:true,stdio:'ignore'});
redis.on('error',()=>{process.stderr.write('Redis binary unavailable. Set REDIS_BINARY or use Docker Compose.\n');void pg.stop();});
process.stdout.write('Local PostgreSQL :55432; Redis :56379. Ctrl+C to stop.\n');
let stopped=false;async function stop(){if(stopped)return;stopped=true;redis.kill();await pg.stop();}
process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});
