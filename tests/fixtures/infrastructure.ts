import {isolatedPostgres} from './postgres';
import {GenericContainer,Wait} from 'testcontainers';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {Redis} from 'ioredis';
import {createServer} from 'node:net';
async function freePort(){const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('PORT_UNAVAILABLE');await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return address.port;}
export async function infrastructure(){
 if(process.env.NEXUS_TEST_INFRA==='docker'){
  const pg=await new GenericContainer('postgres:18').withEnvironment({POSTGRES_USER:'nexus',POSTGRES_PASSWORD:'nexus',POSTGRES_DB:'nexus'}).withExposedPorts(5432).withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections',2)).start();
  const redis=await new GenericContainer('redis:8').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage('Ready to accept connections')).start();
  return {databaseUrl:`postgresql://nexus:nexus@${pg.getHost()}:${pg.getMappedPort(5432)}/nexus`,redisUrl:`redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,stop:async()=>{await redis.stop();await pg.stop();}};
 }
 const pg=await isolatedPostgres(),dir=pg.directory,redisPort=await freePort();
 const executable=process.env.REDIS_BINARY??resolve('.local/redis/Redis-8.10.2-Windows-x64-cygwin/redis-server.exe');
 const server=spawn(executable,['--bind','127.0.0.1','--port',String(redisPort),'--save','','--appendonly','no'],{cwd:dir,windowsHide:true,stdio:'ignore'});
 let failure:Error|undefined;server.on('error',error=>{failure=error;});
 const redisUrl=`redis://127.0.0.1:${redisPort}`;const client=new Redis(redisUrl,{maxRetriesPerRequest:0,retryStrategy:()=>null,lazyConnect:true});client.on('error',()=>{});
 let ready=false;
 try{
  for(let attempt=0;attempt<50;attempt++){if(failure)throw failure;try{if(client.status==='end'||client.status==='wait')await client.connect();await client.ping();ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  if(!ready)throw new Error('Redis did not start');
 }catch(error){client.disconnect();server.kill();await pg.stop();throw error;}
 client.disconnect();
 return {databaseUrl:pg.databaseUrl,redisUrl,stop:async()=>{
  const client=new Redis(redisUrl,{maxRetriesPerRequest:0,retryStrategy:()=>null});client.on('error',()=>{});try{await client.shutdown('NOSAVE');}catch{/* shutdown closes connection */}finally{client.disconnect();}
  server.kill();await pg.stop();
 }};
}
