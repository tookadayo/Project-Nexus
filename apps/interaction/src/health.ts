export type InteractionHealthSnapshot={
 handlerRegistered:boolean;
 transport:'gateway'|'webhook';
 lastReceivedAt:string|null;
 lastAcknowledgedAt:string|null;
 lastCompletedAt:string|null;
 lastResult:'success'|'ack_failed'|'queue_failed'|'reply_failed'|null;
};

export class InteractionHealth {
 private receivedAt:string|null=null;
 private acknowledgedAt:string|null=null;
 private completedAt:string|null=null;
 private result:InteractionHealthSnapshot['lastResult']=null;
 constructor(readonly transport:'gateway'|'webhook'){}
 received(at=new Date()){this.receivedAt=at.toISOString();}
 acknowledged(at=new Date()){this.acknowledgedAt=at.toISOString();}
 completed(at=new Date()){this.completedAt=at.toISOString();this.result='success';}
 failed(kind:'ack_failed'|'queue_failed'|'reply_failed'){this.result=kind;}
 snapshot():InteractionHealthSnapshot{return {handlerRegistered:true,transport:this.transport,lastReceivedAt:this.receivedAt,lastAcknowledgedAt:this.acknowledgedAt,lastCompletedAt:this.completedAt,lastResult:this.result};}
}
