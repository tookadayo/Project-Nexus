import {test,expect,type BrowserContext} from '@playwright/test';
import {createHash,createCipheriv,randomBytes} from 'node:crypto';
const base=`http://127.0.0.1:${process.env.NEXUS_VERIFICATION_WEB_PORT??3150}`,fixture=`http://127.0.0.1:${process.env.NEXUS_VERIFICATION_API_PORT??3151}`;
const ids=['931111111111111111','931111111111111112','931111111111111113','931111111111111114'],user='911111111111111111',other='911111111111111112';
async function signIn(context:BrowserContext,userId=user,locale='en'){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update('s'.repeat(64)).digest(),iv),bytes=Buffer.concat([cipher.update(JSON.stringify({userId,accessToken:`verification-oauth-${userId}`,expiresAt:Date.now()+600000})),cipher.final()]);
 await context.addCookies([{name:'nexus_session',value:Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url'),url:base,httpOnly:true,sameSite:'Lax'},{name:'nexus_locale',value:locale,url:base}]);
}
for(const locale of ['en','ja'])test(`verification pages show four real states and fit mobile (${locale})`,async({page,context})=>{
 await signIn(context,user,locale);await page.setViewportSize({width:375,height:812});await page.goto('/servers');
 for(const state of ['VERIFIED','INSTALLED_NOT_VERIFIED','VERIFICATION_PENDING','NOT_INSTALLED'])await expect(page.locator(`[data-state="${state}"]`)).toHaveCount(1);
 await expect(page.getByText('Unauthorized community',{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({caret:'initial',path:`test-results/verification-${locale}-servers-mobile.png`,fullPage:true});
 await page.goto('/link');await expect(page.getByLabel(locale==='ja'?'接続コード':'Verification code',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({caret:'initial',path:`test-results/verification-${locale}-link-mobile.png`,fullPage:true});
});
test('logged-out /link returns through OAuth and GET cannot redeem',async({request})=>{
 const response=await request.get('/link',{maxRedirects:0});expect(response.status()).toBe(307);expect(response.headers().location).toContain('/auth/login?next=%2Flink');
 const login=await request.get('/auth/login?next=/link',{maxRedirects:0});expect(login.headers().location).toContain('discord.com/oauth2/authorize');expect(login.headers()['set-cookie']).toContain('nexus_oauth_next');
 const sessionResponse=await request.post('/link/redeem',{headers:{origin:base,'sec-fetch-site':'same-origin'},data:{code:'invalid'}});expect(sessionResponse.status()).toBe(401);
});
test('unverified and arbitrary URLs cannot expose dashboard data',async({page,context})=>{
 await signIn(context);for(const guildId of [ids[1],ids[2],'999111111111111112']){await page.goto(`/dashboard/${guildId}`);await expect(page).toHaveURL(/\/servers$/);}
 const get=await page.request.get('/link/redeem?code=ignored');expect(get.status()).toBe(405);
 const cross=await page.request.post('/link/redeem',{headers:{origin:'https://attacker.example','sec-fetch-site':'cross-site'},data:{code:'invalid'}});expect(cross.status()).toBe(403);
});
test('issuer-only redemption, confirmed disconnect and relinking preserve settings',async({page,context,request,browser})=>{
 await signIn(context);const issue=await request.post(`${fixture}/fixture/code`,{data:{guildId:ids[1]}}),{code}=await issue.json() as {code:string};
 const second=await browser.newContext();await signIn(second,other);const otherPage=await second.newPage();await otherPage.goto(`${base}/link`);await otherPage.getByLabel('Verification code',{exact:true}).fill(code);await otherPage.getByRole('button',{name:'Connect server',exact:true}).click();await expect(otherPage.locator('p[role="alert"]')).toContainText('This code cannot be used');await second.close();
 const capturedUrls:string[]=[];page.on('request',req=>capturedUrls.push(req.url()));await page.goto('/link');await page.getByLabel('Verification code',{exact:true}).fill(code);await page.getByRole('button',{name:'Connect server',exact:true}).click();await expect(page.getByRole('heading',{name:'Connected'})).toBeVisible();expect(capturedUrls.every(url=>!url.includes(code))).toBe(true);
 await page.getByRole('link',{name:'Open Dashboard',exact:true}).click();await expect(page).toHaveURL(new RegExp(`/dashboard/${ids[1]}$`));
 const before=await (await request.get(`${fixture}/fixture/data/${ids[1]}`)).json();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Disconnect',exact:true}).click();await expect(page.getByRole('dialog',{name:'Confirm disconnect'})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.screenshot({caret:'initial',path:'test-results/verification-settings-connection.png',fullPage:true});await page.getByRole('button',{name:'Disconnect',exact:true}).click();await page.getByRole('button',{name:'Confirm disconnect',exact:true}).click();await expect(page).toHaveURL(/\/servers$/);
 const after=await (await request.get(`${fixture}/fixture/data/${ids[1]}`)).json();expect(after.settings).toEqual(before.settings);expect(after.connection.state).toBe('INSTALLED_NOT_VERIFIED');
 const fresh=await (await request.post(`${fixture}/fixture/code`,{data:{guildId:ids[1]}})).json();await page.goto('/link');await page.getByLabel('Verification code',{exact:true}).fill(fresh.code);await page.getByRole('button',{name:'Connect server',exact:true}).click();await page.getByRole('link',{name:'Open Dashboard',exact:true}).click();await expect(page).toHaveURL(new RegExp(`/dashboard/${ids[1]}$`));
});
test('permission loss blocks a verified dashboard on revalidation',async({page,context,request})=>{
 await signIn(context);await page.goto(`/dashboard/${ids[0]}`);await expect(page).toHaveURL(new RegExp(`/dashboard/${ids[0]}$`));
 await request.post(`${fixture}/fixture/permission`,{data:{guildId:ids[0],allowed:false}});try{await page.reload();await expect(page).toHaveURL(/\/servers$/);}finally{await request.post(`${fixture}/fixture/permission`,{data:{guildId:ids[0],allowed:true}});}
});
