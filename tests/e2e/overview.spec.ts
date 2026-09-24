import {test,expect} from '@playwright/test';

test('shows independent newcomer data before optional onboarding is configured',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Start measuring community growth'})).toBeVisible();
 await expect(page.getByText('Discord onboarding is not currently in use. You can add a welcome flow later.')).toBeVisible();
 await expect(page.locator('article').filter({has:page.getByRole('heading',{name:'New Members',exact:true})}).locator('.value')).toHaveText('24');
 await expect(page.locator('article').filter({has:page.getByRole('heading',{name:'New Members',exact:true})}).locator('.comparison')).toContainText('Previous period: —');
 await expect(page.getByRole('button',{name:'Newcomers',exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/v04-home-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'test-results/v04-home-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('rejects unauthenticated dashboard requests',async()=>{const response=await fetch('http://127.0.0.1:3100');expect(response.status).toBe(401);});

test('uses independent newcomer milestones and labels for Discord choices',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Newcomers',exact:true}).click();
 await expect(page.getByText('Home / Newcomers')).toBeVisible();
 const response=page.waitForResponse(value=>value.url().includes('/data/journey?range=7'));
 await page.getByRole('button',{name:'7D'}).click();expect((await response).ok()).toBe(true);
 await expect(page.locator('body')).not.toContainText(/step conversion/i);
 await page.getByRole('button',{name:'Improve',exact:true}).click();
 await page.getByRole('button',{name:'Reply Rescue',exact:true}).click();
 const channel=page.getByLabel('Destination channel');await channel.selectOption({label:'#helpers'});
 await expect(channel.locator('option:checked')).toHaveText('#helpers');
 await expect(page.locator('body')).not.toContainText('621111111111111111');
});

test('persists Japanese web language across reload and shows the improvement flow',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'日本語',exact:true}).click();
 await page.getByRole('button',{name:'改善',exact:true}).click();
 await expect(page.getByRole('heading',{name:'改善メニュー'})).toBeVisible();
 await page.getByRole('button',{name:'返信レスキュー',exact:true}).click();
 await expect(page.getByText(/新規メンバーが1時間返信を待ったら/)).toBeVisible();
 await page.screenshot({path:'test-results/v04-improve-japanese.png',fullPage:true});
 await page.reload();await expect(page.getByRole('button',{name:'改善',exact:true})).toBeVisible();
});

test('explains an unusable notification channel with a direct fix',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Improve',exact:true}).click();
 await page.getByRole('button',{name:'Reply Rescue',exact:true}).click();
 await page.getByLabel('Destination channel').selectOption({label:'#welcome'});
 await page.getByRole('button',{name:'Enable',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('NEXUS cannot send messages in #welcome. Choose another channel or check View and Send permissions.');
});

test('chooses a goal, enables Reply Rescue and checks the result without jargon',async({page})=>{
 await page.goto('/');
 await page.getByRole('radio',{name:'Receive a reply'}).check();
 await page.getByRole('button',{name:'Start measuring'}).click();
 await page.getByRole('button',{name:'Enable'}).first().click();
 await page.getByRole('button',{name:'Improve',exact:true}).click();
 await page.getByRole('button',{name:'Reply Rescue',exact:true}).click();
 await expect(page.getByText('If a newcomer waits 1 hour without a reply, notify your team. Confirm before running.')).toBeVisible();
 await page.getByRole('button',{name:'Enable',exact:true}).click();
 await expect(page.getByRole('heading',{name:/Reply Rescue · v1/})).toBeVisible();
 await page.getByRole('button',{name:'Check the result',exact:true}).click();
 await expect(page.getByText('Home / Results / Reply Rescue')).toBeVisible();
 await page.getByRole('button',{name:'Check the result',exact:true}).last().click();
 await expect(page.getByRole('heading',{name:'Reply Rescue Test'})).toBeVisible();
 await expect(page.getByRole('application').getByText('Usual experience')).toBeVisible();
 await expect(page.getByRole('application').getByText('Improvement enabled')).toBeVisible();
 await expect(page.locator('body')).not.toContainText(/\bDSL\b|\bCohort\b|\bITT\b/);
 await page.screenshot({path:'test-results/v04-results-desktop.png',fullPage:true});
});
