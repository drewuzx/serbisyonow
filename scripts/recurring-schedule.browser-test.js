'use strict';
const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {startQrFixture}=require('./provider-qr-test-fixture');

async function main() {
 const f=await startQrFixture();
 let browser;
 try {
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===f.base?route.continue():route.fulfill({body:'',contentType:'text/plain'}));
  const provider=(await f.request('/api/auth/provider/session','GET',undefined,f.providerToken)).data.user;
  provider.auth_token=f.providerToken;
  await context.addInitScript(user=>localStorage.setItem('sn_provider_user',JSON.stringify(user)),provider);
  const page=await context.newPage(),errors=[];
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${f.base}/pages/provider/schedule/schedule.html`);
  await page.locator('#sn-availability-repeat').waitFor();
  assert.equal(await page.locator('#sn-availability-repeat').isChecked(),false);
  await page.locator('#sn-availability-date').fill('2099-10-05');
  await page.locator('#sn-availability-date').dispatchEvent('change');
  await page.locator('.sn-week-day[aria-label="2099-10-05"]').waitFor();
  await page.locator('#sn-schedule-days input[value="2099-10-07"]').check();
  await page.getByLabel('Start hour',{exact:true}).selectOption('9');
  await page.getByLabel('End hour',{exact:true}).selectOption('12');
  await page.getByLabel('End AM/PM',{exact:true}).selectOption('PM');
  await page.locator('#sn-availability-repeat').check();
  await page.getByRole('button',{name:'Save Availability',exact:true}).click();
  await page.getByText('Weekly repeat saved and will continue until stopped.',{exact:true}).waitFor();
  assert.equal(await page.locator('.sn-repeat-row').count(),1);
  assert.equal(await page.locator('.sn-repeat-label').count(),2);
  assert.match(await page.locator('.sn-repeat-row').textContent(),/Mon, Wed/);
  await page.getByRole('button',{name:'Next week',exact:true}).click();
  await page.locator('.sn-week-day[aria-label="2099-10-12"]').waitFor();
  assert.equal(await page.locator('.sn-week-slot').count(),2);
  await page.reload();
  await page.locator('.sn-repeat-row').waitFor();
  for(const width of [1440,1024,390,320]) {
   await page.setViewportSize({width,height:1000});
   await page.locator('.sn-week-repeats').scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`page overflow ${width}`);
   assert.equal(await page.locator('.sn-repeat-row').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`repeat overflow ${width}`);
   await page.screenshot({path:path.join(os.tmpdir(),`provider-repeat-${width}.png`),fullPage:true});
   await page.locator('#sn-availability-repeat').scrollIntoViewIfNeeded();
   assert.equal(await page.locator('.sn-schedule-form').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`form overflow ${width}`);
  }
  await page.getByRole('button',{name:'Stop repeating',exact:true}).click();
  const modal=page.locator('.sn-modal-backdrop');
  await modal.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM provider_schedule_repeats WHERE is_active')).rows[0].n,1);
  await page.getByRole('button',{name:'Stop repeating',exact:true}).click();
  await modal.getByRole('button',{name:'Stop repeating',exact:true}).click();
  await page.getByText('No active weekly repeats.',{exact:true}).waitFor();
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM provider_availability')).rows[0].n,0);
  assert.deepEqual(errors,[]);
  console.log('Recurring schedule browser checks passed: opt-in, weekday selection, save, following week, reload, cancellation, stop, desktop/mobile layouts.');
 } finally { if(browser) await browser.close(); await f.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
