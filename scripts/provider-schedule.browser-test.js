'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const f = await startQrFixture();
 let browser;
 try {
  await f.createBooking({ scheduled_date:'2099-10-07', scheduled_time:'15:00' });
  browser = await chromium.launch({headless:true,channel:'msedge'});
  const context = await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',route => new URL(route.request().url()).origin === f.base ? route.continue() : route.fulfill({body:'',contentType:'text/plain'}));
  const provider = (await f.request('/api/auth/provider/session','GET',undefined,f.providerToken)).data.user;
  provider.auth_token = f.providerToken;
  await context.addInitScript(user=>localStorage.setItem('sn_provider_user',JSON.stringify(user)),provider);
  const page = await context.newPage(), errors=[];
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${f.base}/pages/provider/schedule/schedule.html`);
  await page.locator('.sn-week-day').first().waitFor();
  assert.equal(await page.locator('.sn-week-day').count(),7);
  await page.locator('#sn-availability-date').fill('2099-10-05');
  await page.locator('#sn-availability-date').dispatchEvent('change');
  await page.locator('.sn-week-appointment').waitFor();
  for (const checkbox of await page.locator('#sn-schedule-days input').all()) await checkbox.check();
  await page.getByLabel('Start hour',{exact:true}).selectOption('9');
  await page.getByLabel('End hour',{exact:true}).selectOption('12');
  await page.getByLabel('End AM/PM',{exact:true}).selectOption('PM');
  await page.getByRole('button',{name:'Save Availability',exact:true}).click();
  await page.getByText('Availability saved for 7 days.',{exact:true}).waitFor();
  assert.equal(await page.locator('.sn-week-slot').count(),7);
  assert.equal(await page.locator('#sn-schedule-days input:checked').count(),7);
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM provider_availability')).rows[0].count,7);
  await page.getByRole('button',{name:'Next week',exact:true}).click();
  await page.locator('.sn-week-day[aria-label="2099-10-12"]').waitFor();
  assert.equal(await page.locator('.sn-week-slot').count(),0);
  assert.equal(await page.locator('#sn-availability-start').inputValue(),'09:00');
  await page.getByRole('button',{name:'Previous week',exact:true}).click();
  await page.locator('.sn-week-slot').first().waitFor();
  const monday = page.locator('.sn-week-day[aria-label="2099-10-05"]');
  await monday.getByRole('button',{name:'Close',exact:true}).click();
  await monday.getByRole('button',{name:'Reopen',exact:true}).waitFor();
  assert.equal((await f.request('/api/providers/81/availability?date=2099-10-05')).data.availability.length,0);
  await monday.getByRole('button',{name:'Reopen',exact:true}).click();
  await monday.getByRole('button',{name:'Close',exact:true}).waitFor();
  for (const width of [1440,1024,390,320]) {
   await page.setViewportSize({width,height:1000});
   await page.locator('.sn-schedule-week').scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow at ${width}`);
   assert.equal(await page.locator('.sn-week-day').count(),7);
   const boxes = await page.locator('.sn-week-day').evaluateAll(days=>days.map(day=>({width:day.clientWidth,scroll:day.scrollWidth})));
   assert.ok(boxes.every(box=>box.scroll<=box.width+1),`day overflow at ${width}`);
   await page.screenshot({path:path.join(os.tmpdir(),`provider-week-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await monday.getByRole('button',{name:'Delete',exact:true}).click();
  await page.locator('.sn-modal-backdrop').getByRole('button',{name:'Delete',exact:true}).click();
  await monday.getByText('No schedule',{exact:true}).waitFor();
  await page.locator('.sn-week-day[aria-label="2099-10-09"]').getByRole('button',{name:'Add hours'}).click();
  assert.equal(await page.locator('#sn-availability-date').inputValue(),'2099-10-09');
  assert.deepEqual(await page.locator('#sn-schedule-days input:checked').evaluateAll(inputs=>inputs.map(input=>input.value)),['2099-10-09']);
  await page.getByRole('button',{name:'This week',exact:true}).click();
  await page.locator('.sn-week-day.is-today').waitFor();
  assert.deepEqual(errors,[]);
  console.log('Weekly schedule browser checks passed: seven-day batch, persistence, appointments, navigation, drafts, close/reopen/delete, day shortcuts, customer availability, desktop/mobile layout.');
 } finally { if(browser) await browser.close(); await f.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
