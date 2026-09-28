export function zonedDateKey(date:Date,timeZone:string){
 let formatter:Intl.DateTimeFormat;
 try{formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});}
 catch{formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'});}
 const parts=Object.fromEntries(formatter.formatToParts(date).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
export function zonedDayStart(date:Date,timeZone:string){
 const target=zonedDateKey(date,timeZone);let low=date.getTime()-48*3600000,high=date.getTime();
 while(high-low>1){const mid=Math.floor((low+high)/2);if(zonedDateKey(new Date(mid),timeZone)<target)low=mid;else high=mid;}
 return new Date(high);
}
export function nextZonedDayStart(date:Date,timeZone:string){
 const target=zonedDateKey(date,timeZone);let low=date.getTime(),high=low+48*3600000;
 while(high-low>1){const mid=Math.floor((low+high)/2);if(zonedDateKey(new Date(mid),timeZone)<=target)low=mid;else high=mid;}
 return new Date(high);
}
