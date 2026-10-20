'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require('playwright');
const {startQrFixture} = require('./provider-qr-test-fixture');
const {issueSession} = require('./account-sessions');
const {inspectLayout} = require('./ui-alignment.browser-test');

async function main() {
 const f=await startQrFixture(); let browser;
 const baseline=process.env.UI_BASELINE==='1';
 const widths=(process.env.UI_WIDTHS||'320,390,768,1024,1440').split(',').map(Number);
 const results=[],errors=[];
 try {
  const admin=(await f.db.query("INSERT INTO admins(username,password_hash) VALUES('layout-admin','fixture') RETURNING id,username")).rows[0];
  admin.auth_token=await issueSession(f.db,'admin',admin.id);
  await f.db.query("UPDATE providers SET full_name='Alexandra Mae Villanueva-Santiago',address='Building 12, Saint Joseph Village, Barangay Anunas, Angeles City'");
  for(const status of ['pending','completed','cancelled']) await f.createBooking({status,address:'Building 12, Saint Joseph Village, Barangay Anunas, Angeles City'});
  await f.db.query("INSERT INTO customer_reviews(customer_id,provider_id,rating,comment) VALUES(61,81,5,'Arrived on time and completed the cleaning carefully.')");
  await f.db.query("INSERT INTO provider_availability(provider_id,available_date,start_time,end_time) VALUES(81,'2099-10-10','09:00','17:00')");
  const customer=(await f.request('/api/auth/customer/session')).data.user;
  const provider=(await f.request('/api/auth/provider/session','GET',undefined,f.providerToken)).data.user;
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.addInitScript(({customer,provider,admin})=>{
   localStorage.setItem('sn_customer_user',JSON.stringify(customer));
   localStorage.setItem('sn_provider_user',JSON.stringify(provider));
   localStorage.setItem('sn_admin_user',JSON.stringify(admin));
  },{customer,provider,admin});
  await context.route('**/*',r=>new URL(r.request().url()).origin===f.base?r.continue():r.fulfill({body:'',contentType:r.request().url().includes('fonts.googleapis.com')?'text/css':'application/javascript'}));
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(`${page.url()}: ${e.message}`));
  const root=path.join(__dirname,'../pages');
  const routes=fs.readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.html')&&!p.includes('googleAuthBridge')).map(p=>p.replaceAll('\\','/'));
  async function check(route,width) {
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForTimeout(100);
   const result=await inspectLayout(page);
   const structural=await page.evaluate(()=>{
    const issues=[];
    const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden';};
    for(const el of document.querySelectorAll('[hidden]:not([hidden="until-found"])')) {
     if(visible(el)) issues.push(`Hidden content displayed: ${el.tagName}#${el.id}.${String(el.className).replace(/\s+/g,'.')}`);
    }
   for(const el of document.querySelectorAll('input:not([type="hidden"]),select,textarea')) {
     if(!visible(el)||el.closest('.sn-sidebar')) continue;
     const r=el.getBoundingClientRect();
     if(r.left<0||r.right>innerWidth+1) issues.push(`Offscreen field: #${el.id}.${el.className}`);
     if(innerWidth<=940&&!el.matches('[type="checkbox"],[type="radio"],[type="range"],[type="color"],[type="submit"],[type="button"]')&&parseFloat(getComputedStyle(el).fontSize)<16) issues.push(`Small mobile field text: #${el.id}`);
    }
    return issues;
   });
   result.issues.push(...structural);
   results.push({route,width,...result});
   if(result.issues.length) console.log(JSON.stringify(results.at(-1)));
   if(width===390||result.issues.length) await page.screenshot({path:path.join(os.tmpdir(),`system-${baseline?'before':'after'}-${route.replace(/[^a-z0-9-]/gi,'-')}-${width}.png`),fullPage:true,animations:'disabled'});
  }
  for(const width of widths) {
   await page.setViewportSize({width,height:900});
   for(const route of routes) {
    await page.goto(`${f.base}/pages/${route}${route.includes('provider-profile')?'?id=81':''}`);
    await page.waitForLoadState('networkidle');
    await check(route,width);
   }
   for(const [route,control,ready] of [
    ['customer/profile/profile.html','#sn-edit-toggle','#sn-profile-form'],
    ['provider/services/services.html','[data-action="edit-service"]','#sn-service-editor'],
    ['provider/services/services.html','[data-action="set-price"]','#sn-price-editor'],
    ['admin/revenue/revenue.html','button:has-text("Edit Receiving QR")','dialog'],
   ]) {
    await page.goto(`${f.base}/pages/${route}`);
    await page.locator(control).first().click();
    await page.locator(ready).waitFor();
    await check(`${route}-editing-${ready}`,width);
   }
   console.log(`Completed system layout checks at ${width}px`);
  }
  for(const route of ['customer/profile/profile.html','customer/search/search.html','provider/dashboard/dashboard.html']) {
   await page.setViewportSize({width:1440,height:900});
   await page.goto(`${f.base}/pages/${route}`);
   await page.waitForLoadState('networkidle');
   await page.setViewportSize({width:390,height:800});
   await page.waitForTimeout(250);
   assert.equal(await page.locator('.sn-shell').evaluate(el=>el.classList.contains('sidebar-open')),false,'resize must not leave the desktop sidebar over mobile content');
   await page.locator('#sn-hamburger-top').click();
   assert.equal(await page.locator('.sn-shell').evaluate(el=>el.classList.contains('sidebar-open')),true,'mobile navigation remains usable');
   await page.locator('#sn-hamburger').click();
   await page.locator('.sn-float-launch').waitFor();
   const dock=await page.locator('.sn-float-root').boundingBox();
   assert.ok(dock.height<=90&&dock.y>=700,'mobile controls use a compact bottom area');
   await page.locator('.sn-float-launch').click();
   await page.locator('.sn-float-list.is-open').waitFor();
   await page.setViewportSize({width:640,height:360});
   const chat=await page.locator('.sn-float-list').boundingBox();
   assert.ok(chat.x>=0&&chat.y>=0&&chat.x+chat.width<=640&&chat.y+chat.height<=360,'chat fits short landscape screens');
   await check(`${route}-landscape-chat`,640);
  }
  console.log(JSON.stringify({views:results.length,issues:results.filter(r=>r.issues.length).length,errors}));
  if(!baseline) {
   assert.deepEqual(errors,[]);
   assert.deepEqual(results.filter(r=>r.issues.length),[]);
  }
 } finally {if(browser) await browser.close();await f.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
