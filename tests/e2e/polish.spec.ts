import {test,expect} from '@playwright/test';

for(const locale of ['en','ja'] as const){
 test(`polish: public mobile navigation, pricing and landing (${locale})`,async({page,context})=>{
  await context.addCookies([{name:'nexus_locale',value:locale,url:process.env.NEXUS_E2E_WEB_PORT?`http://127.0.0.1:${process.env.NEXUS_E2E_WEB_PORT}`:'http://127.0.0.1:3100'}]);
  await page.setViewportSize({width:375,height:812});await page.goto('/');
  await expect(page.locator('.pricing-teaser-grid article')).toHaveCount(3);
  await expect(page.locator('.faq details')).toHaveCount(4);
  const menu=page.locator('.mobile-site-menu');await menu.locator('summary').click();
  await expect(menu.getByRole('link',{name:locale==='ja'?'ログイン':'Log in',exact:true})).toBeVisible();
  await expect(menu.getByRole('link',{name:locale==='ja'?'Discordに追加':'Add NEXUS to Discord',exact:true})).toHaveAttribute('href',/client_id=321111111111111119/);
  await expect(menu.getByRole('button',{name:'English',exact:true})).toBeVisible();
  await page.screenshot({caret:'initial',path:`test-results/polish-${locale}-mobile-menu.png`,fullPage:false});
  await menu.getByRole('link',{name:locale==='ja'?'料金':'Pricing',exact:true}).click();
  await expect(page).toHaveURL(/\/pricing$/);
  for(const plan of ['Scale','Enterprise']){
   const card=page.locator('.price-card').filter({has:page.getByRole('heading',{name:plan,exact:true})});
   await expect(card.locator('li')).not.toHaveCount(0);
   await expect(card).toContainText(locale==='ja'?'現在利用可能':'Available now');
   await expect(card).toContainText(locale==='ja'?'準備中':'Planned');
   await expect(card.locator('.planned-features')).toContainText('API');
   await expect(card).toContainText(locale==='ja'?'登録枠':'allowance');
   await expect(card).toContainText(locale==='ja'?'一括管理は準備中':'management is planned');
   await expect(card).not.toContainText('$149');
  }
  const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(element=>element.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(element).display!=='none'&&!element.closest('.comparison-scroll')).map(element=>({tag:element.tagName,className:element.className,right:element.getBoundingClientRect().right})).slice(0,10));
  expect(overflow).toEqual([]);
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('body')).toHaveCSS('margin','0px');
  const width=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth,overflow:Array.from(document.querySelectorAll('body *')).filter(e=>e.scrollWidth>e.clientWidth+1&&!e.closest('.comparison-scroll')).map(e=>({tag:e.tagName,className:e.className,width:e.clientWidth,scroll:e.scrollWidth})).slice(0,20)}));
  expect(width.document,JSON.stringify(width)).toBeLessThanOrEqual(width.viewport+1);
  await page.screenshot({caret:'initial',path:`test-results/polish-${locale}-pricing-mobile.png`,fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({caret:'initial',path:`test-results/polish-${locale}-pricing-desktop.png`,fullPage:true});
  await page.goto('/');await page.screenshot({caret:'initial',path:`test-results/polish-${locale}-landing-desktop.png`,fullPage:true});
  await page.setViewportSize({width:375,height:812});await page.screenshot({caret:'initial',path:`test-results/polish-${locale}-landing-mobile.png`,fullPage:true});
  await page.locator('.mobile-site-menu summary').click();await page.locator('.mobile-site-menu').getByRole('link',{name:locale==='ja'?'ログイン':'Log in',exact:true}).click();
  await expect(page).toHaveURL(/\/(dashboard|servers)/);
 });
 test(`polish: rules explain observed activity and dashboard adapts to mobile (${locale})`,async({page,context})=>{
  await context.addCookies([{name:'nexus_locale',value:locale,url:process.env.NEXUS_E2E_WEB_PORT?`http://127.0.0.1:${process.env.NEXUS_E2E_WEB_PORT}`:'http://127.0.0.1:3100'}]);
  await page.setViewportSize({width:1280,height:900});await page.goto('/dashboard');
  await page.screenshot({caret:'initial',path:`test-results/polish-${locale}-dashboard-desktop.png`,fullPage:true});
  await page.getByRole('button',{name:locale==='ja'?'目標と判定ルール':'Goals & Rules',exact:true}).click();
  const intro=page.getByTestId('adaptive-community');
  await expect(intro).toContainText(locale==='ja'?'観測人数・件数':'Observed sample');
  await expect(intro).not.toContainText(locale==='ja'?'観測中です':'Still collecting');
  await expect(intro).toContainText(locale==='ja'?'他の人からの明示的な返信':'Explicit replies from another human');
  await expect(intro).not.toContainText(locale==='ja'?'観測できた出席':'Observed attendance');
  await page.setViewportSize({width:375,height:812});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({caret:'initial',path:`test-results/polish-${locale}-rules-mobile.png`,fullPage:true});
  await page.locator('.mobile-head select').selectOption('0');
  await page.screenshot({caret:'initial',path:`test-results/polish-${locale}-dashboard-mobile.png`,fullPage:true});
 });
}
