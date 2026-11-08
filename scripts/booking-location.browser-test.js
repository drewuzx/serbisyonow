'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');

(async () => {
 const f = await startQrFixture();
 let browser;
 try {
  await f.db.query('UPDATE customers SET latitude=15.145,longitude=120.59 WHERE id=61');
  await f.db.query("INSERT INTO provider_services(provider_id,title,category,starting_price,max_price) VALUES(81,'Fixture work','Fixture',500,1000)");
  const customer = { ...(await f.request('/api/auth/customer/session')).data.user, auth_token:f.customerToken };
  browser = await chromium.launch({ headless:true, channel:'msedge' });
  for (const width of [390,320,1440]) {
   const date = `2099-10-${width === 390 ? '10' : width === 320 ? '11' : '12'}`;
   await f.db.query('INSERT INTO provider_availability(provider_id,available_date,start_time,end_time,is_available) VALUES(81,$1,\'10:00\',\'11:00\',TRUE)',[date]);
   const context = await browser.newContext({ viewport:{ width,height:900 }, hasTouch:width<600, isMobile:width<600, serviceWorkers:'block' });
   await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === f.base || url.hostname.endsWith('tile.openstreetmap.org') ? route.continue() : route.fulfill({ body:'' });
   });
   await context.addInitScript(user => {
    localStorage.setItem('sn_customer_user',JSON.stringify(user));
    Object.defineProperty(window,'L',{ configurable:true, set(value) {
     Object.defineProperty(window,'L',{value,writable:true,configurable:true});
     value.Map.addInitHook(function() { window.testBookingMap=this; });
    }});
    navigator.geolocation.getCurrentPosition = (success, failure) => { window.testGps = {success,failure}; };
   },customer);
   const page = await context.newPage(), errors = [], writes = [];
   page.on('pageerror', error => errors.push(error.message));
   page.on('request', r => { if (r.method() === 'PATCH' && r.url().includes('/location')) writes.push(r.url()); });
   await page.goto(`${f.base}/pages/customer/bookings/bookings.html?provider_id=81`);
   const map = page.locator('#sn-booking-location-map');
   await map.waitFor();
   assert.equal(await page.evaluate(() => bookingLocationPicker.value()),null,'Saved pin is not auto-confirmed');
   await page.locator('#sn-booking-date').fill(date);
   await page.locator('#sn-booking-date').dispatchEvent('change');
   await page.waitForFunction(() => document.querySelector('#sn-booking-time').value === '10:00');
   await page.locator('#sn-create-booking-form [type=submit]').click();
   assert.match(await page.locator('#sn-booking-location-status').innerText(),/Confirm the service location/);
   await page.locator('#sn-use-booking-gps').click();
   await page.evaluate(() => testGps.failure({code:1}));
   assert.match(await page.locator('#sn-booking-location-status').innerText(),/unavailable/);
   await page.locator('#sn-use-booking-gps').click();
   await page.evaluate(() => testGps.success({coords:{latitude:15.15,longitude:120.6,accuracy:9}}));
   await page.locator('#sn-confirm-booking-location').click();
   assert.equal((await page.evaluate(() => bookingLocationPicker.value())).latitude,15.15);
   await page.locator('[name=address]').fill('Booking-only address, Angeles City');
   assert.equal(await page.evaluate(() => bookingLocationPicker.value()),null);
   await page.locator('#sn-booking-landmark').fill('Unit 4, blue gate');
   await map.evaluate(el => el.scrollIntoView({block:'center',behavior:'instant'}));
   await page.waitForTimeout(400);
   const box = await map.boundingBox();
   await page.mouse.click(box.x+box.width*0.65,box.y+box.height*0.65);
   await page.locator('#sn-confirm-booking-location').click();
   const pinned = await page.evaluate(() => bookingLocationPicker.value());
   assert.ok(Math.abs(pinned.longitude-120.6)>0.00001);
   const marker = page.locator('.sn-booking-pin');
   await map.evaluate(el => el.scrollIntoView({block:'center',behavior:'instant'}));
   await page.waitForTimeout(400);
   const m = await marker.boundingBox();
   const x=m.x+m.width/2,y=m.y+m.height/2;
   if (width<600) {
    const cdp = await context.newCDPSession(page);
    const touch = (type,points) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y],i)=>({x,y,id:i+1}))});
    await touch('touchStart',[[x,y]]);
    for(let i=1;i<=8;i++) await touch('touchMove',[[x-i*4,y-i*3]]);
    await touch('touchEnd',[]);
    const b=await map.boundingBox(),cx=b.x+b.width/2,cy=b.y+b.height/2,z=await page.evaluate(()=>testBookingMap.getZoom());
    await touch('touchStart',[[cx-20,cy],[cx+20,cy]]);
    for(let i=1;i<=8;i++) {await touch('touchMove',[[cx-20-i*6,cy],[cx+20+i*6,cy]]);await page.waitForTimeout(25);}
    await touch('touchEnd',[]);
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(z=>testBookingMap.getZoom()>z,z),'Pinch zoom works');
   } else {
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-32,y-24,{steps:8});await page.mouse.up();
   }
   assert.equal(await page.evaluate(() => bookingLocationPicker.value()),null,'Dragging invalidates confirmation');
   await page.locator('#sn-confirm-booking-location').click();
   const dragged=await page.evaluate(() => bookingLocationPicker.value());
   assert.notEqual(dragged.longitude,pinned.longitude);
   assert.equal(dragged.accuracy,null,'Manual pin is not described as device GPS accuracy');
   // A stale GPS reply must not replace a subsequent manual selection.
   await page.locator('#sn-use-booking-gps').click();
   await page.locator('#sn-booking-pin-center').click();
   await page.locator('#sn-confirm-booking-location').click();
   const chosen = await page.evaluate(() => bookingLocationPicker.value());
   await page.evaluate(() => testGps.success({coords:{latitude:14,longitude:121,accuracy:5}}));
   assert.deepEqual(await page.evaluate(() => bookingLocationPicker.value()),chosen);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`No overflow at ${width}`);
   await page.locator('.sn-booking-location').screenshot({path:path.join(os.tmpdir(),`booking-pin-${width}.png`)});
   const saved = page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/bookings'));
   await page.locator('#sn-create-booking-form [type=submit]').click();
   const response = await saved;
   const data = await response.json();
   assert.equal(response.status(),201,JSON.stringify(data));
   assert.ok(Math.abs(data.booking.latitude-chosen.latitude)<0.0000001);
   assert.ok(Math.abs(data.booking.longitude-chosen.longitude)<0.0000001);
   assert.equal(data.booking.service_details.booking_location.landmark,'Unit 4, blue gate');
   assert.deepEqual(writes,[],'Booking does not update customer profile location');
   assert.deepEqual(errors,[]);
   await context.close();
  }
  const original=(await f.db.query('SELECT address,latitude,longitude FROM customers WHERE id=61')).rows[0];
  assert.equal(original.address,'Test address');
  assert.equal(Number(original.latitude),15.145);
  await f.db.query('UPDATE customers SET latitude=NULL,longitude=NULL WHERE id=61');
  const fallbackContext=await browser.newContext({serviceWorkers:'block'});
  await fallbackContext.addInitScript(user=>localStorage.setItem('sn_customer_user',JSON.stringify(user)),customer);
  const fallback=await fallbackContext.newPage();
  await fallback.goto(`${f.base}/pages/customer/bookings/bookings.html?provider_id=81`);
  await fallback.locator('#sn-booking-location-map').waitFor();
  assert.equal(await fallback.locator('.sn-booking-pin').count(),0,'Default city center is not a selected service location');
  assert.equal(await fallback.locator('#sn-confirm-booking-location').isDisabled(),true);
  await fallback.locator('#sn-booking-pin-center').click();
  await fallback.locator('#sn-confirm-booking-location').click();
  assert.ok(await fallback.evaluate(()=>bookingLocationPicker.value()));
  await fallbackContext.route('**/vendor/leaflet/leaflet.js',route=>route.abort());
  await fallback.reload();
  await fallback.getByText('Map unavailable. Refresh the page to retry.',{exact:true}).waitFor();
  assert.equal(await fallback.evaluate(()=>bookingLocationPicker.value()),null);
  assert.equal(await fallback.locator('#sn-confirm-booking-location').isDisabled(),true);
  await fallbackContext.close();
  console.log('PASS: desktop/mobile map selection, touch marker drag, pinch zoom, confirmation invalidation, GPS denial/race, actual booking persistence and unchanged profile.');
 } finally {await browser?.close();await f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
