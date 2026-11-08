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
  const customer=(await f.request('/api/auth/customer/session')).data.user;
  const data={customer_location:{lat:15.145,lng:120.59,source:'saved-gps',address:'Angeles City'},providers:Array.from({length:4},(_,i)=>({id:81+i,full_name:`Map Test Provider ${i+1}`,service:'Cleaning',map_lat:15.15+i*0.002,map_lng:120.6+i*0.002,distance_km:i+1,location_accuracy:'accurate',location_match:'nearby'}))};
  for(const width of [390,320,1440]) {
   const mobile=width<940;
   const context=await browser.newContext({viewport:{width,height:900},hasTouch:mobile,isMobile:mobile,serviceWorkers:'block'});
   let releaseRoute;
   const routeGate=new Promise(resolve=>{releaseRoute=resolve;});
   let mapRequests=0;
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/location-map')) {mapRequests++;return route.fulfill({json:data});}
    if(url.hostname==='router.project-osrm.org') {
     await routeGate;
     return route.fulfill({json:{routes:[{distance:1800,duration:400,geometry:{coordinates:[[120.59,15.145],[120.592,15.148],[120.6,15.15]]}}]}});
    }
    if(url.hostname.endsWith('tile.openstreetmap.org')) return route.continue();
    if(url.origin===f.base) return route.continue();
    return route.fulfill({body:'',contentType:'text/plain'});
   });
   await context.addInitScript(user=>{
    localStorage.setItem('sn_customer_user',JSON.stringify(user));
    Object.defineProperty(window,'L',{configurable:true,set(value){
     Object.defineProperty(window,'L',{value,writable:true,configurable:true});
     value.Map.addInitHook(function(){window.testMap=this;});
    }});
   },customer);
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.setDefaultTimeout(15000);
   await page.goto(`${f.base}/pages/customer/search/search.html`);
   const map=page.locator('#sn-real-map');
   await map.waitFor();
   await page.waitForTimeout(1500);
   await map.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
   await page.waitForTimeout(350);
   const box=await map.boundingBox();
   if(mobile) {
    const list=await page.locator('.sn-map-nearby-list--leaflet').boundingBox();
    await page.screenshot({path:path.join(os.tmpdir(),`customer-map-debug-${width}.png`)});
    assert.ok(list.y>=box.y+box.height-1,`Provider list must not cover the mobile map: ${JSON.stringify({width,list,box})}`);
    assert.equal(await map.evaluate(el=>getComputedStyle(el).touchAction),'none');
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow ${width}`);
   const state=()=>page.evaluate(()=>({center:window.testMap.getCenter(),zoom:window.testMap.getZoom(),scroll:scrollY}));
   const before=await state();
   const x=box.x+box.width*0.4,y=box.y+box.height*0.6;
   const cdp=await context.newCDPSession(page);
   const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y],i)=>({x,y,id:i+1,radiusX:4,radiusY:4}))});
   if(mobile) {
    await touch('touchStart',[[x,y]]);
    for(let i=1;i<=10;i++){await touch('touchMove',[[x+i*6,y-i*4]]);await page.waitForTimeout(25);}
    await touch('touchEnd',[]);
   } else {
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+70,y-40,{steps:10});await page.mouse.up();
   }
   await page.waitForTimeout(600);
   const dragged=await state();
   assert.ok(Math.abs(dragged.center.lng-before.center.lng)>0.0001,`drag changes center at ${width}`);
   assert.ok(Math.abs(dragged.scroll-before.scroll)<2,`Map drag must not scroll the page: ${JSON.stringify({width,box,before,dragged})}`);
   releaseRoute();
   await page.waitForFunction(()=>document.getElementById('sn-route-summary').textContent.includes('min'));
   const afterRoute=await state();
   assert.deepEqual(afterRoute.center,dragged.center,'Late route response must not undo a drag');
   if(mobile) {
    const cx=box.x+box.width/2,cy=box.y+box.height/2;
    await touch('touchStart',[[cx-25,cy],[cx+25,cy]]);
    for(let i=1;i<=10;i++){await touch('touchMove',[[cx-25-i*6,cy],[cx+25+i*6,cy]]);await page.waitForTimeout(25);}
    await touch('touchEnd',[]);
    await page.waitForTimeout(500);
    assert.ok((await state()).zoom>afterRoute.zoom,`pinch zoom in at ${width}`);
    const zoomed=(await state()).zoom;
    await touch('touchStart',[[cx-85,cy],[cx+85,cy]]);
    for(let i=1;i<=10;i++){await touch('touchMove',[[cx-85+i*6,cy],[cx+85-i*6,cy]]);await page.waitForTimeout(25);}
    await touch('touchEnd',[]);
    await page.waitForTimeout(500);
    assert.ok((await state()).zoom<zoomed,`pinch zoom out at ${width}`);
   }
   const zoomBefore=(await state()).zoom;
   await page.locator('.leaflet-control-zoom-in').click();
   await page.waitForFunction(z=>window.testMap.getZoom()>z,zoomBefore);
   await page.waitForTimeout(400);
   const positioned=await state();
   // Trigger a genuine background data change after the user has positioned the map.
   data.providers[0].distance_km+=0.1;
   const lastRequests=mapRequests;
   await page.waitForFunction(()=>window.snLiveRefresh?.isIdle());
   await page.waitForTimeout(4000);
   assert.ok(mapRequests>lastRequests,'Background refresh ran');
   const refreshed=await state();
   assert.deepEqual(refreshed.center,positioned.center,'Refresh preserves center');
   assert.equal(refreshed.zoom,positioned.zoom,'Refresh preserves zoom');
   await map.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
   await page.screenshot({path:path.join(os.tmpdir(),`customer-map-touch-${width}.png`)});
   assert.deepEqual(errors,[]);
   await context.close();
  }
  console.log('PASS: real Leaflet one-finger drag, pinch in/out, zoom buttons, uncovered mobile map, desktop drag, delayed route and background view preservation.');
 } finally {if(browser)await browser.close();await f.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
