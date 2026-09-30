import {test,expect} from '@playwright/test';
for(const locale of ['ja','en'] as const){
 test(`quality: public and all dashboard surfaces (${locale})`,async({page,context})=>{
  test.setTimeout(120000);
  await context.addCookies([{name:'nexus_locale',value:locale,url:`http://127.0.0.1:${process.env.NEXUS_E2E_WEB_PORT??3100}`}]);
  for(const path of ['/product','/support','/privacy','/terms']){
   await page.setViewportSize({width:1440,height:1000});await page.goto(path);
   await expect(page.locator('h1')).toBeVisible();await page.screenshot({caret:'initial',path:`test-results/quality-${locale}-${path.slice(1)}.png`,fullPage:true});
   await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await page.setViewportSize({width:1440,height:1000});await page.goto('/dashboard');
  const views=[['home','0'],['new-members','1'],['attention','8'],['insights','5'],['improvements','2'],['results','3'],['rules','9'],['settings','4']];
  for(const [name,value] of views){
   await page.setViewportSize({width:375,height:812});await page.locator('.mobile-head select').selectOption(value!);
   await expect(page.locator('main')).not.toContainText(/普段から参加|最近の活動なし|最初の成功|\b(?:Eligibility|Maturity|Cohort)\b/);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await page.screenshot({caret:'initial',path:`test-results/quality-${locale}-${name}-mobile.png`,fullPage:true});
   await page.setViewportSize({width:1440,height:1000});await page.screenshot({caret:'initial',path:`test-results/quality-${locale}-${name}-desktop.png`,fullPage:true});
  }
  await page.route('**/control',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({failure:{category:'DATABASE_FAILURE',effect:'UNKNOWN',reference:'NXS-123456ABCDEF'}})}));
  await page.getByRole('button',{name:locale==='ja'?'変更を保存':'Save changes',exact:true}).first().click();
  const alert=page.locator('section[role="alert"]');await expect(alert).toContainText('NXS-123456ABCDEF');
  await expect(alert).toContainText(locale==='ja'?'変更が行われたか確認できません':'Whether a change was applied could not be confirmed');
  await expect(alert.getByRole('button',{name:locale==='ja'?'再試行':'Retry',exact:true})).toHaveCount(0);
  await page.screenshot({caret:'initial',path:`test-results/quality-${locale}-error-desktop.png`,fullPage:true});
  await page.setViewportSize({width:375,height:812});await page.screenshot({caret:'initial',path:`test-results/quality-${locale}-error-mobile.png`,fullPage:true});
  await alert.getByRole('button',{name:locale==='ja'?'最新状態を確認':'Check current state',exact:true}).click();
  await expect(page).toHaveURL(/view=4/);await expect(page.getByRole('heading',{name:locale==='ja'?'設定':'Settings',exact:true})).toBeVisible();
 });
}
