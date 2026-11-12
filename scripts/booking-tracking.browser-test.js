'use strict';
const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {startQrFixture}=require('./provider-qr-test-fixture');
const scheduleWindow=require('../shared/js/schedule-window');
(async()=>{
 const f=await startQrFixture();let browser;
 try {
  const now=scheduleWindow.manilaNow();const currentTime=`${String(Math.floor(now.minutes/60)).padStart(2,'0')}:${String(now.minutes%60).padStart(2,'0')}`;
  const booking=await f.createBooking({status:'upcoming',deposit_required:false,latitude:15.145,longitude:120.59,scheduled_date:now.date,scheduled_time:currentTime});
  await f.db.query('UPDATE providers SET latitude=15.15,longitude=120.6 WHERE id=81');
  const customer={...(await f.request('/api/auth/customer/session')).data.user,auth_token:f.customerToken};
  const provider={...(await f.request('/api/auth/provider/session','GET',undefined,f.providerToken)).data.user,auth_token:f.providerToken};
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const pc=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const cc=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'block'});
  for(const context of [pc,cc]) await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/api/directions') return route.fulfill({json:{directions:{distance_m:1500,duration_s:360,geometry:{type:'LineString',coordinates:[[120.6,15.15],[120.59,15.145]]}}}});
   if(u.origin===f.base || u.hostname.endsWith('tile.openstreetmap.org')) return route.continue();
   return route.fulfill({body:''});
  });
  await pc.addInitScript(user=>{
   localStorage.setItem('sn_provider_user',JSON.stringify(user));
   window.gpsAllowed=false;window.gpsPoint={latitude:15.15,longitude:120.6,accuracy:10};window.gpsReads=0;
   navigator.geolocation.getCurrentPosition=(success,error)=>{window.gpsReads++;if(window.gpsPaused) return;if(gpsAllowed) success({coords:gpsPoint,timestamp:Date.now()});else error({code:1});};
   navigator.geolocation.watchPosition=(success,error)=>{window.gpsWatch=success;window.gpsError=error;return 42;};
   navigator.geolocation.clearWatch=()=>{window.gpsWatch=null;};
  },provider);
  await cc.addInitScript(user=>{
   localStorage.setItem('sn_customer_user',JSON.stringify(user));
   Object.defineProperty(window,'L',{configurable:true,set(value){Object.defineProperty(window,'L',{value,writable:true,configurable:true});value.Map.addInitHook(function(){window.liveTestMap=this;});}});
  },customer);
  const pp=await pc.newPage(),cp=await cc.newPage(),errors=[];
  pp.on('pageerror',e=>errors.push(e.message));cp.on('pageerror',e=>errors.push(e.message));
  await pp.goto(`${f.base}/pages/provider/requests/requests.html`);
  const action=pp.locator(`[data-live-tracking="${booking.id}"]`);
  await action.waitFor();await action.click();
  await pp.getByText('Location permission denied. Nothing was shared.',{exact:true}).waitFor();
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM booking_live_locations')).rows[0].count,0);
  await cp.goto(`${f.base}/pages/customer/bookings/bookings.html`);
  await cp.evaluate(async b=>showBookingDetails({...b,provider_name:'Test provider'}),booking);
  await cp.locator('[data-live-status]').filter({hasText:'not sharing'}).waitFor();
  await pp.evaluate(()=>{gpsAllowed=true;});await action.click();
  await pp.locator('#sn-live-tracking-notice').filter({hasText:'Sharing live location'}).waitFor();
  await cp.locator('[data-live-status]').filter({hasText:'location is live'}).waitFor({timeout:15000});
  await cp.locator('[data-live-eta]').filter({hasText:'6 min'}).waitFor();
  assert.equal(await cp.locator('.sn-tracking-marker').count(),2);
  await cp.evaluate(()=>liveTestMap.setView([15.14,120.58],15));
  const view=await cp.evaluate(()=>({center:liveTestMap.getCenter(),zoom:liveTestMap.getZoom()}));
  await pp.waitForTimeout(5200);
  await pp.evaluate(()=>{gpsPoint={latitude:15.147,longitude:120.595,accuracy:7};gpsWatch({coords:gpsPoint,timestamp:Date.now()});});
  await cp.waitForFunction(()=>Object.values(liveTestMap._layers).some(l=>l.options?.title==='Provider' && Math.abs(l.getLatLng().lat-15.147)<0.000001),{},{timeout:15000});
  assert.deepEqual(await cp.evaluate(()=>({center:liveTestMap.getCenter(),zoom:liveTestMap.getZoom()})),view,'Polling preserves customer pan and zoom');
  for(const width of [390,320,1440]) {
   await cp.setViewportSize({width,height:900});
   await cp.locator('[data-live-map]').scrollIntoViewIfNeeded();
   await cp.locator('[data-live-center]').click();
   await cp.waitForTimeout(300);
   assert.equal(await cp.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await cp.locator('.sn-booking-live-section').screenshot({path:path.join(os.tmpdir(),`live-tracking-${width}.png`)});
   await cp.screenshot({path:path.join(os.tmpdir(),`live-tracking-modal-${width}.png`)});
  }
  await action.click();
  await cp.locator('[data-live-status]').filter({hasText:'not sharing'}).waitFor({timeout:15000});
  assert.equal(await cp.locator('.sn-tracking-marker').count(),1);
  assert.equal(await cp.locator('[data-live-eta]').innerText(),'');
  await action.click();await pp.locator('#sn-live-tracking-notice').filter({hasText:'Sharing live location'}).waitFor();
  await cp.locator('[data-live-status]').filter({hasText:'location is live'}).waitFor({timeout:15000});
  // Simulate GPS failure without clearing the server's last reading.
  await pp.evaluate(()=>{gpsPaused=true;});
  await f.db.query("UPDATE booking_live_locations SET observed_at=NOW()-INTERVAL '40 seconds' WHERE booking_id=$1",[booking.id]);
  await cp.locator('[data-live-status]').filter({hasText:'delayed'}).waitFor({timeout:15000});
  assert.equal(await cp.locator('.sn-tracking-marker').count(),1);
  await pp.evaluate(()=>{gpsPaused=false;});
  await action.click();await action.click();
  await cp.locator('[data-live-status]').filter({hasText:'location is live'}).waitFor({timeout:15000});
  await f.request(`/api/provider/81/bookings/${booking.id}/status`,'PATCH',{status:'ongoing',expected_status:'upcoming'},f.providerToken);
  await f.request(`/api/provider/81/bookings/${booking.id}/status`,'PATCH',{status:'completed',expected_status:'ongoing'},f.providerToken);
  await cp.locator('[data-live-status]').filter({hasText:'not active'}).waitFor({timeout:15000});
  assert.equal(await cp.locator('[data-live-booking-status]').innerText(),'completed');
  assert.equal(await cp.locator('.sn-tracking-marker').count(),1);
  await cp.locator('.sn-modal-close').click();
  assert.equal(await cp.locator('[data-live-map]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: separate customer/provider sessions, permission denial, live GPS movement, ETA, preserved map view, mobile layouts, stop, stale GPS, resume and completion.');
 } finally {await browser?.close();await f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
