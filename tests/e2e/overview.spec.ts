import {test,expect} from '@playwright/test';

test('shows independent newcomer data before optional onboarding is configured',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Start measuring community growth'})).toBeVisible();
 await expect(page.getByText('Discord onboarding is not currently in use. You can add a welcome flow later.')).toBeVisible();
 await expect(page.locator('article').filter({has:page.getByRole('heading',{name:'New Members',exact:true})}).locator('.value')).toHaveText('24');
 await expect(page.locator('article').filter({has:page.getByRole('heading',{name:'New Members',exact:true})}).locator('.comparison')).toContainText('Previous period: —');
 await expect(page.getByRole('button',{name:'New Members',exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/v04-home-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'test-results/v04-home-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('rejects unauthenticated dashboard requests',async()=>{const response=await fetch('http://127.0.0.1:3100');expect(response.status).toBe(401);});

test('uses independent newcomer milestones and labels for Discord choices',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'New Members',exact:true}).click();
 await expect(page.getByText('Overview / New Members')).toBeVisible();
 const response=page.waitForResponse(value=>value.url().includes('/data/journey?range=7'));
 await page.getByRole('button',{name:'7D'}).click();expect((await response).ok()).toBe(true);
 await expect(page.locator('body')).not.toContainText(/step conversion/i);
 await page.getByRole('button',{name:'Improve',exact:true}).click();
 await page.getByRole('button',{name:'Notify staff when someone has no reply',exact:true}).click();
 const channel=page.getByLabel('Destination channel');await channel.selectOption({label:'#helpers'});
 await expect(channel.locator('option:checked')).toHaveText('#helpers');
 await expect(page.locator('body')).not.toContainText('621111111111111111');
});

test('persists Japanese web language across reload and shows the improvement flow',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'日本語',exact:true}).click();
 await page.getByRole('button',{name:'改善',exact:true}).click();
 await expect(page.getByRole('heading',{name:'改善メニュー'})).toBeVisible();
 await page.getByRole('button',{name:'返信がない人をスタッフに知らせる',exact:true}).click();
 await expect(page.getByLabel('改善策の流れ')).toContainText('1時間');
 await page.screenshot({path:'test-results/v04-improve-japanese.png',fullPage:true});
 await page.reload();await expect(page.getByRole('button',{name:'改善',exact:true})).toBeVisible();
});

test('explains an unusable notification channel with a direct fix',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Improve',exact:true}).click();
 await page.getByRole('button',{name:'Notify staff when someone has no reply',exact:true}).click();
 await page.getByLabel('Destination channel').selectOption({label:'#welcome'});
 await page.getByRole('button',{name:'Check setup',exact:true}).click();
 await expect(page.locator('.builder-v3 [role="status"]')).toContainText('Permission needed. Give NEXUS View Channel and Send Messages in the selected channels.');
});

test('chooses a goal, tests an improvement and sees a useful small-community comparison',async({page})=>{
 await page.goto('/');
 await page.getByRole('radio',{name:'Receive a reply'}).check();
 await page.getByRole('button',{name:'Save success goal'}).click();
 await page.getByRole('button',{name:'Enable'}).first().click();
 await page.getByRole('button',{name:'Improve',exact:true}).click();
 await page.getByRole('button',{name:'Notify staff when someone has no reply',exact:true}).click();
 await expect(page.getByLabel('Improvement preview')).toContainText('1 hour');
 await page.getByRole('button',{name:'Check setup',exact:true}).click();
 await expect(page.locator('.builder-v3 [role="status"]')).toContainText('Ready');
 await page.getByRole('button',{name:'Send test notification',exact:true}).click();
 await expect(page.locator('main > .status')).toContainText('Test notification sent');
 await page.getByRole('button',{name:'Enable',exact:true}).click();
 await expect(page.getByRole('heading',{name:/Notify staff when someone has no reply/})).toBeVisible();
 await page.getByRole('button',{name:'Check the result',exact:true}).click();
 await expect(page.getByText('Before and after this improvement')).toBeVisible();
 await expect(page.getByText('Other factors may have affected this difference.')).toBeVisible();
 await expect(page.getByText('A more rigorous check can become available as activity grows.')).toBeVisible();
 await expect(page.locator('body')).not.toContainText(/\bActivation\b|\bCohort\b|\bIntervention\b|\bExperiment\b|\bITT\b|\bDSL\b|\bRandomization\b|\bGuardrail\b|\bRevision\b|\bMaturity\b|\bEligibility\b/i);
 await page.screenshot({path:'test-results/v05-results-desktop.png',fullPage:true});
});

test('keeps forbidden technical terms out of normal English and Japanese pages',async({page})=>{
 await page.goto('/');
 const forbidden=/\b(?:Activation|Retention|Cohorts?|Baseline|Journey|Lifecycle|Funnel|Signals?|Interventions?|Experiments?|Friction|Evidence|Maturity|Native|Fallback|Hybrid|ITT|DSL|Randomization|Guardrails?|Revisions?|Membership Episodes?|Eligibility|Posterior|Credible Interval|Deterministic threshold)\b|アクティベーション|コホート|ランダム化|ガードレール|割付|施策|実験|成熟|シグナル/i;
 for(const name of ['Overview','New Members','Improve','Results','Settings','Community','Compare','Channels']){await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('main')).not.toContainText(forbidden);}
 await page.locator('.sidebar-bottom').getByRole('button',{name:'日本語',exact:true}).click();
 for(const name of ['概要','新しいメンバー','改善','結果','設定','コミュニティ','比較','チャンネル']){await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('main')).not.toContainText(forbidden);}
});
test('saves a multi-channel analysis scope and shows the community comparison pages',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('combobox',{name:'Channels to analyze'}).selectOption('include');
 await page.locator('.scope-list').first().getByLabel('#helpers').check();
 await page.locator('.scope-list').first().getByLabel('#welcome').check();
 await page.getByRole('button',{name:'Save changes'}).click();
 await expect(page.locator('main > .status')).toContainText('Analysis scope saved');
 await page.reload();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Channels to analyze'})).toHaveValue('include');
 await page.getByRole('button',{name:'Community',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Community activity'})).toBeVisible();
 await page.getByRole('button',{name:'Compare',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Compare participation'})).toBeVisible();
});
