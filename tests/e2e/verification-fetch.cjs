// Test process only: the production app has no alternative Discord endpoint.
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 const value=input instanceof globalThis.Request?input.url:String(input),url=new globalThis.URL(value);
 if(url.hostname==='discord.com'&&url.pathname.startsWith('/api/v10/'))return originalFetch(`http://127.0.0.1:${globalThis.process.env.NEXUS_VERIFICATION_API_PORT||3151}/fixture/discord${url.pathname.slice('/api/v10'.length)}${url.search}`,init);
 return originalFetch(input,init);
};
