// Only the isolated test process redirects the official Stripe SDK transport.
// Production configuration has no alternate provider host or test bypass.
import './verification-fetch.cjs';
import https from 'node:https';
import http from 'node:http';
const original=https.request;
https.request=function(options,...args){
 if(options && (options.hostname==='api.stripe.com'||options.host==='api.stripe.com')) return http.request({...options,hostname:'127.0.0.1',host:'127.0.0.1',port:Number(globalThis.process.env.NEXUS_VERIFICATION_API_PORT||3161),protocol:'http:',agent:undefined,path:'/fixture/stripe'+options.path},...args);
 return original.call(this,options,...args);
};
