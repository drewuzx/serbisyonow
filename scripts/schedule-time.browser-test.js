'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const f = await startQrFixture();
 let browser;
 try {
  await f.createBooking({ scheduled_time:'05:40' });
  await f.db.query(`INSERT INTO provider_availability(provider_id,available_date,start_time,end_time,is_available)
   VALUES (81,'2099-10-10','05:40','10:40',FALSE),(81,'2099-10-10','17:40','19:00',TRUE),(81,'2099-10-10','09:00 AM','12:00 PM',TRUE)`);
  browser = await chromium.launch({ headless:true,channel:'msedge' });
  // A 24-hour browser locale must not change the application's AM/PM presentation.
  const context = await browser.newContext({ viewport:{width:1440,height:1000},locale:'en-GB',serviceWorkers:'block' });
  await context.route('**/*',route=>new URL(route.request().url()).origin===f.base ? route.continue() : route.fulfill({body:'',contentType:route.request().url().includes('fonts.googleapis.com')?'text/css':'application/javascript'}));
  const provider=(await f.request('/api/auth/provider/session','GET',undefined,f.providerToken)).data.user;
  const customer=(await f.request('/api/auth/customer/session','GET',undefined,f.customerToken)).data.user;
  provider.auth_token = f.providerToken;
  customer.auth_token = f.customerToken;
  await context.addInitScript(({provider,customer})=>{
   localStorage.setItem('sn_provider_user',JSON.stringify(provider));
   localStorage.setItem('sn_customer_user',JSON.stringify(customer));
  },{provider,customer});
  const page=await context.newPage(), errors=[];
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${f.base}/pages/provider/schedule/schedule.html`);
  await page.locator('#sn-availability-date').fill('2099-10-10');
  await page.locator('#sn-availability-date').dispatchEvent('change');
  await page.locator('.sn-week-slot').first().waitFor();
  await page.locator('.sn-schedule-appointments-panel').getByText('5:40 AM',{exact:true}).waitFor();
  assert.deepEqual(await page.locator('.sn-schedule-slot > div:first-child > span').allTextContents(),['5:40 AM - 10:40 AM','9:00 AM - 12:00 PM','5:40 PM - 7:00 PM']);
  await page.locator('#sn-availability-date').fill('2099-10-11');
  async function choose(label,hour,minute,period) {
   await page.getByLabel(`${label} hour`,{exact:true}).selectOption(hour);
   await page.getByLabel(`${label} minute`,{exact:true}).selectOption(minute);
   await page.getByLabel(`${label} AM/PM`,{exact:true}).selectOption(period);
  }
  await choose('Start','12','00','PM');
  await choose('End','11','59','AM');
  await page.getByRole('button',{name:'Save Availability',exact:true}).click();
  await page.getByText('End time must be later than start time.',{exact:true}).waitFor();
  await choose('End','1','30','PM');
  await page.getByRole('heading',{name:'Add Availability',exact:true}).click();
  await page.evaluate(()=>loadProviderDatabase({background:true}));
  assert.equal(await page.locator('#sn-availability-start').inputValue(),'12:00');
  assert.equal(await page.locator('#sn-availability-end').inputValue(),'13:30');
  for (const width of [1440,1024,390,320]) {
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow at ${width}`);
   for (const field of await page.locator('.sn-time-controls select').all()) {
    assert.ok(await field.evaluate(node=>node.getBoundingClientRect().width>=45),`time control too narrow at ${width}`);
   }
   await page.screenshot({path:path.join(os.tmpdir(),`schedule-am-pm-${width}.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'Save Availability',exact:true}).click();
  await page.getByText('12:00 PM - 1:30 PM',{exact:true}).waitFor();
  const saved=(await f.db.query("SELECT * FROM provider_availability WHERE provider_id=81 AND available_date='2099-10-11'")).rows[0];
  assert.equal(saved.start_time,'12:00');
  assert.equal(saved.end_time,'13:30');
  await page.locator('#sn-availability-date').fill('2099-10-12');
  await choose('Start','12','00','AM');
  await choose('End','1','05','AM');
  await page.getByRole('button',{name:'Save Availability',exact:true}).click();
  await page.getByText('12:00 AM - 1:05 AM',{exact:true}).waitFor();
  assert.equal((await f.db.query("SELECT start_time FROM provider_availability WHERE available_date='2099-10-12'")).rows[0].start_time,'00:00');
  await page.goto(`${f.base}/pages/customer/bookings/bookings.html?provider_id=81`);
  await page.locator('#sn-booking-date').fill('2099-10-10');
  await page.locator('#sn-booking-time option[value="17:40"]').waitFor({state:'attached'});
  assert.equal(await page.locator('#sn-booking-time option[value="17:40"]').textContent(),'5:40 PM - 7:00 PM');
  assert.equal(await page.locator('#sn-booking-time option[value="09:00 AM"]').textContent(),'9:00 AM - 12:00 PM');
  await page.locator('#sn-booking-time').selectOption('17:40');
  assert.equal(await page.locator('#sn-booking-time').inputValue(),'17:40');
  assert.equal(await page.evaluate(()=>bookingSlotLabel({available_date:'2099-10-10',start_time:'17:40'})),'Oct 10 - 5:40 PM');
  await page.goto(`${f.base}/pages/customer/history/history.html`);
  assert.match(await page.evaluate(()=>historyDateTime({scheduled_date:'2099-10-10',scheduled_time:'17:40'})),/5:40 PM/);
  assert.deepEqual(errors,[]);
  console.log('AM/PM checks passed: 24-hour browser locale, legacy and 24-hour records, chronological slots, AM/PM input, noon/midnight, validation, unchanged API values, draft retention, four widths and customer booking labels.');
 } finally { if(browser) await browser.close(); await f.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
