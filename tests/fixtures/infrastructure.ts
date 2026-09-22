import EmbeddedPostgres from 'embedded-postgres';
import {GenericContainer,Wait} from 'testcontainers';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Redis} from 'ioredis';
export async function infrastructure(){
 if(process.env.NEXUS_TEST_INFRA==='docker'){
  const pg=await new GenericContainer('postgres:18').withEnvironment({POSTGRES_USER:'nexus',POSTGRES_PASSWORD:'nexus',POSTGRES_DB:'nexus'}).withExposedPorts(5432).withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections',2)).start();
  const redis=await new GenericContainer('redis:8').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage('Ready to accept connections')).start();
  return {databaseUrl:`postgresql://nexus:nexus@${pg.getHost()}:${pg.getMappedPort(5432)}/nexus`,redisUrl:`redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,stop:async()=>{await redis.stop();await pg.stop();}};
 }
 await mkdir('.local',{recursive:true});const dir=await mkdtemp(resolve('.local/pg-integration-'));
 const pg=new EmbeddedPostgres({databaseDir:dir,user:'nexus',password:'nexus',port:55434,persistent:true,onLog:()=>{},onError:()=>{}});
 await pg.initialise();await pg.start();
 const executable=process.env.REDIS_BINARY??resolve('.local/redis/Redis-8.10.2-Windows-x64-cygwin/redis-server.exe');
 const server=spawn(executable,['--bind','127.0.0.1','--port','56380','--save','','--appendonly','no'],{cwd:dir,windowsHide:true,stdio:'ignore'});
 let failure:Error|undefined;server.on('error',error=>{failure=error;});
 const redisUrl='redis://127.0.0.1:56380';const client=new Redis(redisUrl,{maxRetriesPerRequest:0,retryStrategy:()=>null,lazyConnect:true});client.on('error',()=>{});
 let ready=false;
 for(let attempt=0;attempt<50;attempt++){if(failure)throw failure;try{if(client.status==='end'||client.status==='wait')await client.connect();await client.ping();ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 client.disconnect();if(!ready){await pg.stop();server.kill();throw new Error('Redis did not start');}
 return {databaseUrl:'postgresql://nexus:nexus@127.0.0.1:55434/postgres',redisUrl,stop:async()=>{
  const client=new Redis(redisUrl,{maxRetriesPerRequest:0,retryStrategy:()=>null});client.on('error',()=>{});try{await client.shutdown('NOSAVE');}catch{/* shutdown closes connection */}finally{client.disconnect();}
  server.kill();await pg.stop();
 }};
}
