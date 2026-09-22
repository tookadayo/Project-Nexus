import {test,expect} from '@playwright/test';
test('renders real scoped API metrics and coverage without individual information',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
 await expect(page.getByText('Coverage needs attention')).toBeVisible();
 const members=page.locator('article').filter({has:page.getByRole('heading',{name:'New Members',exact:true})});await expect(members.locator('.value')).toHaveText('24');
 await expect(page.getByRole('heading',{name:'D7 Active Retention',exact:true})).toBeVisible();
 await expect(page.locator('body')).not.toContainText('421111111111111111');
 await page.screenshot({path:'test-results/overview-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/overview-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('rejects unauthenticated dashboard requests',async()=>{
 const response=await fetch('http://127.0.0.1:3100');expect(response.status).toBe(401);
});
test('validates, previews and publishes an activation definition through the scoped API',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Lifecycle',exact:true}).click();
 await page.getByRole('button',{name:'Validate and preview'}).click();await expect(page.getByRole('heading',{name:'Publish version 1'})).toBeVisible();
 await page.getByRole('button',{name:'Confirm publication'}).click();await expect(page.getByText('Published. Reload to see the latest state.')).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByText('activation v1')).toBeVisible();
 await page.getByRole('button',{name:'Preview rollback'}).click();await expect(page.getByRole('heading',{name:'Publish version 2'})).toBeVisible();
});
test('switches data health and native readiness without displaying invented observations',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Native Readiness',exact:true}).click();await expect(page.getByText('Run /nexus setup in Discord to read current capabilities.')).toBeVisible();
 await page.getByRole('button',{name:'Data Health',exact:true}).click();await expect(page.getByText('home_actions_completion: unavailable')).toBeVisible();
});
