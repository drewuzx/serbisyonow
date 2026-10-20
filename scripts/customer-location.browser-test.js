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
  const gps = { latitude:15.15, longitude:120.59, accuracy:12 };
  const route = '/api/customer/61/location';
  assert.equal((await f.request(route,'PATCH',gps,null)).status,401);
  assert.equal((await f.request(route,'PATCH',gps,f.otherCustomerToken)).status,403);
  assert.equal((await f.request(route,'PATCH',gps,f.providerToken)).status,403);
  for (const invalid of [{latitude:null},{latitude:'15'},{latitude:91},{longitude:-181},{accuracy:-1},{accuracy:'12'}]) {
   assert.equal((await f.request(route,'PATCH',{...gps,...invalid})).status,400);
  }
  assert.equal((await f.request(route,'PATCH',{latitude:0,longitude:0})).status,200);
  const booking = await f.createBooking();
  const profile = {id:61,full_name:'QR Test Customer',contact:'09123456789',address:'Test address',gender:'Female',dob:'2000-01-01'};
  assert.equal((await f.request('/api/auth/customer/update','PATCH',profile,null)).status,401);
  assert.equal((await f.request('/api/auth/customer/update','PATCH',profile,f.otherCustomerToken)).status,403);
  assert.equal((await f.request('/api/auth/customer/update','PATCH',{...profile,address:'  '})).status,400);
  await f.request(route,'PATCH',gps);
  const unchanged = await f.request('/api/auth/customer/update','PATCH',profile);
  assert.equal(unchanged.status,200);
  assert.equal(Number(unchanged.data.user.latitude),gps.latitude);
  const changed = await f.request('/api/auth/customer/update','PATCH',{...profile,address:'Angeles City'});
  assert.equal(changed.status,200);
  for (const field of ['latitude','longitude','location_accuracy_m','location_updated_at']) assert.equal(changed.data.user[field],null);
  assert.deepEqual((await f.db.query('SELECT * FROM customer_bookings WHERE id=$1',[booking.id])).rows[0],booking);
  await f.db.query(`INSERT INTO provider_availability(provider_id,available_date,start_time,end_time,is_available)
   VALUES (81,'2099-10-10','09:00','10:00',TRUE),(82,'2099-10-10','09:00','10:00',FALSE),(82,'2000-01-01','09:00','10:00',TRUE)`);
  assert.deepEqual((await f.request('/api/customer/61/location-map?available=true')).data.providers.map(p=>p.id),[81]);
  assert.equal((await f.request('/api/customer/61/location-map?available=false')).data.providers.length,2);

  browser = await chromium.launch({headless:true,channel:'msedge'});
  const context = await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',geolocation:gps,permissions:['geolocation']});
  await context.route('**/*',r=>new URL(r.request().url()).origin===f.base ? r.continue() : r.fulfill({body:'',contentType:r.request().url().includes('fonts.googleapis.com')?'text/css':'application/javascript'}));
  const customer = (await f.request('/api/auth/customer/session')).data.user;
  await context.addInitScript(user=>{if(!localStorage.getItem('sn_customer_user')) localStorage.setItem('sn_customer_user',JSON.stringify(user));},customer);
  const page = await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${f.base}/pages/customer/profile/profile.html`);
  const button = page.locator('#sn-customer-update-location');
  await button.waitFor();
  await page.locator('#sn-edit-toggle').click();
  await page.locator('#edit-address').fill('Unsaved address draft');
  await button.click();
  await page.getByText('Your location has been updated.',{exact:true}).waitFor();
  assert.equal(await page.locator('#edit-address').inputValue(),'Unsaved address draft');
  assert.equal(await page.locator('#view-address').textContent(),'Angeles City');
  assert.equal(Number((await f.db.query('SELECT latitude FROM customers WHERE id=61')).rows[0].latitude),gps.latitude);
  await page.reload();
  await page.getByText('15.150000, 120.590000',{exact:true}).waitFor();
  for (const width of [1440,390,320]) {
   await page.setViewportSize({width,height:1000});
   await page.reload();
   await page.getByText('15.150000, 120.590000',{exact:true}).waitFor();
   await button.scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow at ${width}`);
   assert.ok(await button.evaluate(el=>el.getBoundingClientRect().width<=el.parentElement.getBoundingClientRect().width));
   await page.screenshot({path:path.join(os.tmpdir(),`customer-location-${width}.png`),fullPage:true});
  }
  await context.setGeolocation({...gps,latitude:16});
  await page.route('**/api/customer/61/location',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Location save unavailable.'})}));
  await button.click();
  await page.getByText('Location save unavailable.',{exact:true}).waitFor();
  assert.equal(await page.locator('#sn-customer-gps-value').textContent(),'15.150000, 120.590000');
  assert.equal(Number(await page.evaluate(()=>JSON.parse(localStorage.getItem('sn_customer_user')).latitude)),gps.latitude);
  await page.unroute('**/api/customer/61/location');
  await context.clearPermissions();
  await button.click();
  await page.getByText('Location permission denied. Allow location in your browser, then try again.',{exact:true}).waitFor();
  await context.grantPermissions(['geolocation']);
  await button.click();
  await page.getByText('16.000000, 120.590000',{exact:true}).waitFor();
  await page.locator('#sn-edit-toggle').click();
  await page.locator('#edit-address').fill('Mabalacat City');
  await page.route('**/api/auth/customer/update',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Profile save unavailable.'})}));
  await page.locator('#sn-save-btn').click();
  await page.getByText('Profile save unavailable.',{exact:true}).waitFor();
  assert.equal(await page.locator('#edit-address').inputValue(),'Mabalacat City');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sn_customer_user')).address),'Angeles City');
  await page.unroute('**/api/auth/customer/update');
  await page.locator('#sn-save-btn').click();
  await page.getByText('GPS location not saved yet',{exact:true}).waitFor();
  await page.reload();
  await page.locator('#view-address').filter({hasText:'Mabalacat City'}).waitFor();
  assert.equal((await f.request('/api/customer/61/location-map')).data.customer_location.source,'estimated');
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${f.base}/pages/customer/search/search.html`);
  await page.locator('#sn-available-only').waitFor();
  const mapResponse = page.waitForResponse(r=>r.url().includes('/location-map?')&&r.url().includes('available=true'));
  await page.locator('#sn-available-only').check();
  assert.deepEqual((await (await mapResponse).json()).providers.map(p=>p.id),[81]);
  const allResponse = page.waitForResponse(r=>r.url().includes('/location-map?')&&r.url().includes('available=false'));
  await page.locator('#sn-available-only').uncheck();
  assert.equal((await (await allResponse).json()).providers.length,2);
  const gpsResponse = page.waitForResponse(r=>r.url().endsWith('/api/customer/61/location')&&r.request().method()==='PATCH');
  await page.locator('#sn-use-gps').click();
  assert.equal((await gpsResponse).status(),200);
  await page.reload();
  assert.equal((await f.request('/api/customer/61/location-map')).data.customer_location.source,'saved-gps');
  assert.deepEqual((await f.db.query('SELECT * FROM customer_bookings WHERE id=$1',[booking.id])).rows[0],booking);
  assert.deepEqual(errors,[]);
  console.log('Customer location checks passed: authenticated ownership, coordinate validation, persisted GPS, unchanged booking snapshot, address edits, draft retention, failed saves, permission denial and retry, three responsive widths, and Available only map filtering.');
 } finally {if(browser) await browser.close(); await f.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
