'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const f = await startQrFixture(); let browser;
 try {
  const { rows:[service] }=await f.db.query("INSERT INTO provider_services(provider_id,title,category,starting_price,max_price,accepts_cash) VALUES(81,'General House Cleaning','Cleaning Services',500,1000,TRUE) RETURNING *");
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===f.base ? route.continue() : route.fulfill({body:'',contentType:route.request().url().includes('fonts.googleapis.com')?'text/css':'application/javascript'}));
  const provider=(await f.request('/api/auth/provider/session','GET',undefined,f.providerToken)).data.user;
  const customer=(await f.request('/api/auth/customer/session','GET',undefined,f.customerToken)).data.user;
  await context.addInitScript(({provider,customer})=>{
   localStorage.setItem('sn_provider_user',JSON.stringify(provider));
   localStorage.setItem('sn_customer_user',JSON.stringify(customer));
  },{provider,customer});
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${f.base}/pages/provider/services/services.html`);
  await page.locator(`[data-service-id="${service.id}"]`).getByRole('button',{name:'Set Price'}).click();
  await page.getByLabel('Pricing method').selectOption('house_matrix');
  await page.getByRole('spinbutton',{name:'Studio, 2 hours',exact:true}).fill('475');
  await page.getByRole('button',{name:'Add Another Add-on'}).click();
  await page.getByLabel('Add-on 1 name',{exact:true}).fill('Inside Fridge Cleaning');
  await page.getByLabel('Add-on 1 minimum',{exact:true}).fill('200');
  await page.getByLabel('Add-on 1 maximum',{exact:true}).fill('400');
  await page.getByLabel('Service area',{exact:true}).fill('Within Angeles City');
  await page.getByLabel('Special instructions',{exact:true}).fill('Please make water available.');
  await page.getByRole('heading',{name:'Set Price',exact:true}).click();
  // A background update cannot discard a pricing draft.
  await f.db.query("UPDATE provider_services SET description='Updated by background request' WHERE id=$1",[service.id]);
  await page.evaluate(()=>loadProviderDatabase({background:true}));
  assert.equal(await page.getByRole('spinbutton',{name:'Studio, 2 hours',exact:true}).inputValue(),'475');
  for (const width of [1440,1024,768,390,320]) {
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow at ${width}`);
   for(const button of await page.locator('#sn-price-editor button:visible').all()) assert.ok(await button.evaluate(n=>n.scrollWidth<=n.clientWidth+2),`clipped button at ${width}`);
   await page.screenshot({path:path.join(os.tmpdir(),`provider-pricing-${width}.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'Next',exact:false}).click();
  assert.equal(await page.getByLabel('Add-on 1 name',{exact:true}).inputValue(),'Inside Fridge Cleaning');
  await page.getByRole('button',{name:'Next',exact:false}).click();
  assert.equal(await page.getByLabel('Service area',{exact:true}).inputValue(),'Within Angeles City');
  await page.screenshot({path:path.join(os.tmpdir(),'provider-pricing-mobile-settings.png'),fullPage:true});
  let fail=true;
  await page.route(`**/api/provider/81/services/${service.id}`,route=>fail?route.fulfill({status:503,json:{message:'Test save failed. Try again.'}}):route.continue());
  await page.getByRole('button',{name:'Save Changes'}).click();
  await page.getByRole('alert').filter({hasText:'Test save failed'}).waitFor();
  assert.equal(await page.getByLabel('Service area',{exact:true}).inputValue(),'Within Angeles City');
  fail=false;
  await page.getByRole('button',{name:'Save Changes'}).click();
  await page.getByText('Service pricing saved.',{exact:true}).waitFor();
  assert.equal((await f.db.query('SELECT pricing_config FROM provider_services WHERE id=$1',[service.id])).rows[0].pricing_config.matrix[0][0],475);
  await page.reload();
  await page.locator(`[data-service-id="${service.id}"]`).getByRole('button',{name:'Set Price'}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'Studio, 2 hours',exact:true}).inputValue(),'475');
  await page.getByRole('spinbutton',{name:'Studio, 2 hours',exact:true}).fill('999');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('[data-modal-confirm]').click();
  await page.locator(`[data-service-id="${service.id}"]`).getByRole('button',{name:'Set Price'}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'Studio, 2 hours',exact:true}).inputValue(),'475');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();

  const nail=await f.request('/api/provider/81/services','POST',{title:'Nail Care',category:'Personal Care',starting_price:450,max_price:1500},f.providerToken);
  assert.equal(nail.status,201);
  await page.reload();
  await page.locator(`[data-service-id="${nail.data.service.id}"]`).getByRole('button',{name:'Set Price'}).click();
  assert.equal(await page.getByLabel('Pricing method').locator('option').count(),1);
  await page.getByLabel('Minimum price',{exact:true}).fill('600');
  await page.getByRole('button',{name:'Next',exact:false}).click();
  await page.getByRole('button',{name:'Next',exact:false}).click();
  await page.getByLabel('Typical duration',{exact:true}).selectOption('1 hour');
  await page.getByRole('button',{name:'Save Changes'}).click();
  await page.getByText('Service pricing saved.',{exact:true}).waitFor();
  assert.equal((await f.db.query('SELECT pricing_config FROM provider_services WHERE id=$1',[nail.data.service.id])).rows[0].pricing_config.min,600);

  const today=new Date().toISOString().slice(0,10);
  await f.db.query("INSERT INTO provider_availability(provider_id,available_date,start_time,end_time) VALUES(81,$1,'09:00 AM','05:00 PM')",[today]);
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${f.base}/pages/customer/bookings/bookings.html?provider_id=81`);
  await page.locator('#sn-booking-service').selectOption('Nail Care');
  assert.match(await page.locator('.sn-personal-care-total').innerText(),/600.*1,500/);
  await page.locator('#sn-booking-service').selectOption('General House Cleaning');
  await page.locator('#sn-cleaning-assessment').waitFor();
  assert.match(await page.locator('.sn-cleaning-total').innerText(),/475/);
  assert.match(await page.locator('.sn-cleaning-price-summary').innerText(),/Provider rates/);
  await page.locator('[data-provider-addon]').check();
  assert.match(await page.locator('.sn-cleaning-total').innerText(),/675.*875/);
  await page.locator('#sn-booking-time').selectOption('09:00 AM');
  await page.screenshot({path:path.join(os.tmpdir(),'provider-pricing-customer-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:1000});
  if(await page.locator('.sn-shell').evaluate(n=>n.classList.contains('sidebar-open'))) await page.locator('#sn-hamburger').click();
  await page.waitForFunction(()=>document.getElementById('sn-sidebar').getBoundingClientRect().right<=0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:path.join(os.tmpdir(),'provider-pricing-customer-mobile.png'),fullPage:true});
  await page.locator('#sn-create-booking-form [type=submit]').click();
  await page.getByRole('button',{name:'Booking Submitted',exact:true}).waitFor();
  const booking=(await f.db.query('SELECT * FROM customer_bookings WHERE provider_id=81 ORDER BY id DESC LIMIT 1')).rows[0];
  assert.equal(Number(booking.estimated_min),675);
  assert.equal(Number(booking.estimated_max),875);
  assert.equal(booking.service_details.provider_pricing.config.matrix[0][0],475);
  assert.deepEqual(errors,[]);
  console.log('Provider pricing browser checks passed: editor, matrix, add-ons, idle draft retention, five widths, mobile steps, save/retry, persistence, discard, customer estimates and real booking totals.');
 } finally { if(browser) await browser.close(); await f.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
