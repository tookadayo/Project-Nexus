export class CommandRetry {
 private readonly pending=new Map<string,{attempt:number,next:number}>();
 constructor(private readonly baseMs=10000,private readonly maxMs=1800000){}
 due(guildId:string,now=Date.now()){return (this.pending.get(guildId)?.next??0)<=now;}
 success(guildId:string){this.pending.delete(guildId);}
 fail(guildId:string,now=Date.now()){
  const attempt=(this.pending.get(guildId)?.attempt??0)+1;
  const next=now+Math.min(this.maxMs,this.baseMs*2**Math.min(attempt-1,16));
  this.pending.set(guildId,{attempt,next});return next;
 }
}
