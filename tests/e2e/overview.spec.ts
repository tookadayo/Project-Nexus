import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

test('public product and pricing are readable without dashboard credentials',async({page,request})=>{
 for(const route of ['/','/product','/pricing','/support','/privacy','/terms'])expect((await request.get(route)).ok()).toBe(true);
 for(const route of ['/','/product','/pricing','/support','/privacy','/terms'])expect((await fetch(`http://127.0.0.1:${process.env.NEXUS_E2E_WEB_PORT??3100}${route}`)).status).toBe(200);
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toContainText('Help every newcomer');
 await page.keyboard.press('Tab');await expect(page.locator(':focus-visible')).toHaveCount(1);
 await page.evaluate(()=>(document.activeElement as HTMLElement|null)?.blur());
 await page.screenshot({path:'test-results/alpha3-landing-desktop.png',fullPage:true});
 await page.setViewportSize({width:375,height:812});await page.screenshot({path:'test-results/alpha3-landing-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:768,height:900});await page.screenshot({path:'test-results/alpha3-landing-tablet.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:'test-results/alpha3-landing-large.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1280,height:900});await page.goto('/product');await page.screenshot({path:'test-results/alpha3-product-desktop.png',fullPage:true});
 await page.goto('/pricing');await expect(page.getByRole('table')).toContainText('Planned');
 await expect(page.locator('.price-card')).toHaveCount(5);
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'test-results/alpha3-pricing-desktop.png',fullPage:true});
 await page.setViewportSize({width:375,height:812});await page.screenshot({path:'test-results/alpha3-pricing-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('server selection cards fit desktop and mobile layouts',async({page})=>{
 const cards=execFileSync(process.execPath,['--import','tsx','tests/e2e/render-server-cards.ts'],{cwd:resolve('.'),encoding:'utf8'});
 const css=readFileSync(resolve('apps/web/app/style.css'),'utf8');
 await page.setContent(`<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="site servers-page"><header class="site-header"><div class="site-header-inner"><a class="site-logo" href="/"><span class="site-logo-mark">✦</span>NEXUS</a><nav><a href="/product">Product</a><a href="/pricing">Pricing</a></nav></div></header><main class="servers-content"><p class="site-eyebrow">YOUR DISCORD SERVERS</p><h1>Choose a server to manage</h1><p>Signing in and installing the bot are separate steps.</p>${cards}</main></div></body></html>`);
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'test-results/alpha3-servers-desktop.png',fullPage:true});
 await page.setViewportSize({width:375,height:812});await page.screenshot({path:'test-results/alpha3-servers-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('dashboard operational views remain readable at desktop and mobile widths',async({page})=>{
 await page.setViewportSize({width:1280,height:900});await page.goto('/dashboard');
 for(const [name,file] of [['New Members','new-members'],['Attention','attention'],['Insights','insights'],['Goals & Rules','goals-rules'],['Settings','settings']] as const){
  await page.getByRole('button',{name,exact:true}).click();
  await page.screenshot({path:`test-results/alpha3-${file}-desktop.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:375,height:812});
 await page.locator('.mobile-head select').selectOption('0');
 await page.screenshot({path:'test-results/alpha3-dashboard-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.mobile-head select').selectOption('9');
 await page.screenshot({path:'test-results/alpha3-rules-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('shows independent newcomer data before optional onboarding is configured',async({page})=>{
 await page.goto('/dashboard');
 await expect(page.getByRole('heading',{name:'Start measuring community growth'})).toBeVisible();
 await expect(page.getByRole('radio',{name:'Sign up for an event',exact:true})).toBeVisible();
 await expect(page.getByText('Discord onboarding is not currently in use. You can add a welcome flow later.')).toBeVisible();
 await expect(page.locator('article').filter({has:page.getByRole('heading',{name:'New Members',exact:true})}).locator('.value')).toHaveText('26');
 await expect(page.locator('.kpi-grid .value')).not.toContainText(['0.0%']);
 await expect(page.locator('article').filter({has:page.getByRole('heading',{name:'New Members',exact:true})}).locator('.comparison')).toContainText('Previous period: —');
 await expect(page.getByRole('button',{name:'New Members',exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/v04-home-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'test-results/v04-home-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('rejects unauthenticated dashboard requests',async()=>{const response=await fetch(`http://127.0.0.1:${process.env.NEXUS_E2E_WEB_PORT??3100}/dashboard`);expect(response.status).toBe(401);});

test('uses independent newcomer milestones and labels for Discord choices',async({page})=>{
 await page.goto('/dashboard');
 await page.getByRole('button',{name:'New Members',exact:true}).click();
 await expect(page.getByText('Overview / New Members')).toBeVisible();
 const response=page.waitForResponse(value=>value.url().includes('/data/journey?range=7'));
 await page.getByRole('button',{name:'7D'}).click();expect((await response).ok()).toBe(true);
 await expect(page.locator('body')).not.toContainText(/step conversion/i);
 await page.getByRole('button',{name:'Insights',exact:true}).click();
 await page.getByRole('button',{name:'Alert staff when a direct reply is not confirmed',exact:true}).click();
 const channel=page.getByLabel('Destination channel');await channel.selectOption({label:'#helpers'});
 await expect(channel.locator('option:checked')).toHaveText('#helpers');
 await expect(page.locator('body')).not.toContainText('621111111111111111');
});

test('persists Japanese web language across reload and shows the improvement flow',async({page})=>{
 await page.goto('/dashboard');await page.getByRole('button',{name:'日本語',exact:true}).click();
 await page.getByRole('button',{name:'分析',exact:true}).click();
 await expect(page.getByRole('heading',{name:'改善メニュー'})).toBeVisible();
 await page.getByRole('button',{name:'直接の返信が確認できない投稿をスタッフに知らせる',exact:true}).click();
 await expect(page.getByLabel('改善策の流れ')).toContainText('1時間');
 await page.screenshot({path:'test-results/v04-improve-japanese.png',fullPage:true});
 await page.reload();await expect(page.getByRole('button',{name:'分析',exact:true})).toBeVisible();
});

test('explains an unusable notification channel with a direct fix',async({page})=>{
 await page.goto('/dashboard');await page.getByRole('button',{name:'Insights',exact:true}).click();
 await page.getByRole('button',{name:'Alert staff when a direct reply is not confirmed',exact:true}).click();
 await page.getByLabel('Destination channel').selectOption({label:'#welcome'});
 await page.getByRole('button',{name:'Check setup',exact:true}).click();
 await expect(page.locator('.builder-v3 [role="status"]')).toContainText('Permission needed. Give NEXUS View Channel and Send Messages in the selected channels.');
});

test('chooses a goal, tests an improvement and sees a useful small-community comparison',async({page})=>{
 await page.goto('/dashboard');
 await page.getByRole('radio',{name:'First reply to a post'}).check();
 await page.getByRole('button',{name:'Save success goal'}).click();
 await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Enable'}).first().click()]);
 await page.getByRole('button',{name:'Insights',exact:true}).click();
 await page.getByRole('button',{name:'Alert staff when a direct reply is not confirmed',exact:true}).click();
 await expect(page.getByLabel('Improvement preview')).toContainText('1 hour');
 await page.getByRole('button',{name:'Check setup',exact:true}).click();
 await expect(page.locator('.builder-v3 [role="status"]')).toContainText('Ready');
 await page.getByRole('button',{name:'Send test notification',exact:true}).click();
 await expect(page.locator('main > .status')).toContainText('Test notification sent');
 await page.getByRole('button',{name:'Enable',exact:true}).click();
 await expect(page.getByRole('heading',{name:/Alert staff when a direct reply is not confirmed/})).toBeVisible();
 await page.getByRole('button',{name:'Check the result',exact:true}).click();
 await expect(page.getByText('Before and after this improvement')).toBeVisible();
 await expect(page.getByText('Other factors may have affected this difference.')).toBeVisible();
 await expect(page.getByText('A more rigorous check can become available as activity grows.')).toBeVisible();
 await expect(page.locator('body')).not.toContainText(/\bActivation\b|\bCohort\b|\bIntervention\b|\bExperiment\b|\bITT\b|\bDSL\b|\bRandomization\b|\bGuardrail\b|\bRevision\b|\bMaturity\b|\bEligibility\b/i);
 await page.screenshot({path:'test-results/v05-results-desktop.png',fullPage:true});
});

test('keeps forbidden technical terms out of normal English and Japanese pages',async({page})=>{
 await page.goto('/dashboard');
 const forbidden=/\b(?:Activation|Retention|Cohorts?|Baseline|Journey|Lifecycle|Funnel|Signals?|Interventions?|Experiments?|Friction|Evidence|Maturity|Native|Fallback|Hybrid|ITT|DSL|Randomization|Guardrails?|Revisions?|Membership Episodes?|Eligibility|Posterior|Credible Interval|Deterministic threshold)\b|アクティベーション|コホート|ランダム化|ガードレール|割付|施策|実験|成熟|シグナル/i;
 for(const name of ['Home','New Members','Attention','Insights','Results','Settings']){await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('main')).not.toContainText(forbidden);}
 await page.getByRole('button',{name:'Insights',exact:true}).click();
 for(const name of ['Overall','Channels','Behavior']){await page.getByRole('tab',{name,exact:true}).click();await expect(page.locator('main')).not.toContainText(forbidden);}
 await page.locator('.sidebar-bottom').getByRole('button',{name:'日本語',exact:true}).click();
 for(const name of ['ホーム','新しいメンバー','対応','分析','結果','設定']){await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('main')).not.toContainText(forbidden);}
});
test('saves a multi-channel analysis scope and shows the community comparison pages',async({page})=>{
 await page.goto('/dashboard');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('combobox',{name:'Channels to analyze'}).selectOption('include');
 await page.locator('.scope-list').first().getByLabel('#helpers').check();
 await page.locator('.scope-list').first().getByLabel('#welcome').check();
 await page.getByRole('button',{name:'Save changes'}).click();
 await expect(page.locator('main > .status')).toContainText('Analysis scope saved');
 await page.reload();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Channels to analyze'})).toHaveValue('include');
 await page.getByRole('button',{name:'Insights',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Community activity'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Compare participation'})).toBeVisible();
});

test('acknowledges, snoozes, and resolves observed attention posts',async({page})=>{
 await page.goto('/dashboard');await page.getByRole('button',{name:'Attention',exact:true}).click();
 await expect(page.locator('.attention-card')).toHaveCount(2);
 await page.locator('.attention-card').first().getByRole('button',{name:'Acknowledge'}).click();
 await expect(page.locator('.attention-card').first()).toContainText('Staff acknowledged · not yet resolved');
 await page.locator('.attention-card').first().getByRole('button',{name:'Resolve'}).click();
 await expect(page.locator('.attention-card')).toHaveCount(1);
 await page.locator('.attention-card').first().getByRole('combobox',{name:'Snooze'}).selectOption('60');
 await page.locator('.attention-card').first().getByRole('button',{name:'Snooze'}).click();
 await expect(page.locator('.attention-card')).toHaveCount(0);
 await expect(page.locator('.empty-state')).toContainText('No posts need a reply right now');
});
