'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium, expect } = require('playwright/test');
const { startQrFixture } = require('./provider-qr-test-fixture');
const { issueSession } = require('./account-sessions');

async function main() {
 const f = await startQrFixture();
 let browser;
 try {
  const admin = (await f.db.query("INSERT INTO admins(username,password_hash) VALUES('motion-test','fixture') RETURNING id,username")).rows[0];
  admin.auth_token = await issueSession(f.db,'admin',admin.id);
  const provider = (await f.request('/api/auth/provider/session','GET',undefined,f.providerToken)).data.user;
  const customer = (await f.request('/api/auth/customer/session','GET',undefined,f.customerToken)).data.user;
  provider.auth_token = f.providerToken;
  customer.auth_token = f.customerToken;
  browser = await chromium.launch({headless:true,channel:'msedge'});
  for (const mobile of [false,true]) {
   const context = await browser.newContext({viewport:{width:mobile?390:1440,height:950},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
   await context.route('**/*',route=>new URL(route.request().url()).origin===f.base?route.continue():route.fulfill({body:'',contentType:'text/css'}));
   await context.addInitScript(users=>{
    for (const [role,user] of Object.entries(users)) localStorage.setItem(`sn_${role}_user`,JSON.stringify(user));
   },{admin,provider,customer});
   const page = await context.newPage();
   const style = (node,property)=>node.evaluate((el,key)=>getComputedStyle(el)[key],property);
   const routes = [
    ['/pages/auth/loginChoice.html','.provider-login-choice'],
    ['/pages/landing/index.html','.cta-section .provider-entry-button'],
    ['/pages/provider/schedule/schedule.html','button[aria-label="Next week"]'],
    ['/pages/customer/dashboard/dashboard.html','button:visible'],
    ['/pages/admin/feedback/feedback.html','.admin-header-actions button'],
   ];
   for (const [route,selector] of routes) {
    await page.goto(f.base+route);
    const control = page.locator(selector).first();
    await control.waitFor();
    await control.scrollIntoViewIfNeeded();
    await expect.poll(()=>style(control,'transitionProperty')).toContain('scale');
    if (!mobile) {
     await control.hover();
     await expect.poll(()=>style(control,'translate')).toBe('0px -2px');
     assert.notEqual(await style(control,'boxShadow'),'none',route);
     await page.mouse.down();
     await expect.poll(()=>style(control,'scale')).toBe('0.98');
     await page.mouse.move(0,0);
     await page.mouse.up();
    }
   }
   // A dynamically inserted control exercises the same CSS as async modals.
   await page.goto(f.base+'/pages/auth/loginChoice.html');
   await page.evaluate(()=>{
    const panel=document.createElement('div');
    panel.id='motion-test';
    panel.style.cssText='position:fixed;bottom:16px;left:16px;z-index:99999;display:flex;gap:8px;background:white;padding:8px';
    panel.innerHTML='<button class="btn btn-primary" id="motion-action">Action</button><button class="btn" disabled>Disabled</button><button class="btn" aria-disabled="true">Inactive</button>';
    panel.querySelector('#motion-action').addEventListener('click',()=>panel.dataset.clicks=String(Number(panel.dataset.clicks||0)+1));
    document.body.append(panel);
   });
   const action=page.locator('#motion-action');
   await page.keyboard.press('Tab');
   await action.focus();
   assert.equal(await style(action,'outlineStyle'),'solid');
   assert.equal(await style(action,'outlineWidth'),'3px');
   await page.keyboard.down('Space');
   await expect.poll(()=>style(action,'scale')).toBe('0.98');
   await page.keyboard.up('Space');
   await expect(page.locator('#motion-test')).toHaveAttribute('data-clicks','1');
   if (mobile) {
    await expect.poll(()=>style(action,'scale')).toBe('none');
    const box=await action.boundingBox();
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
    await expect.poll(()=>style(action,'scale')).toBe('0.98');
    await page.screenshot({path:path.join(os.tmpdir(),'interaction-mobile-press.png')});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>style(action,'translate')).toBe('none');
    await expect(page.locator('#motion-test')).toHaveAttribute('data-clicks','2');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
    await expect(action).toHaveClass(/sn-is-pressed/);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await expect(action).not.toHaveClass(/sn-is-pressed/);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
    await expect(action).toHaveClass(/sn-is-pressed/);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2-30}]});
    await expect(action).not.toHaveClass(/sn-is-pressed/);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    for (const disabled of await page.locator('#motion-test button:not(#motion-action)').all()) {
     await disabled.tap({force:true});
     await expect(disabled).not.toHaveClass(/sn-is-pressed/);
    }
    await cdp.detach();
   } else {
    for (const control of await page.locator('#motion-test button:not(#motion-action)').all()) {
     await control.hover({force:true});
     assert.equal(await style(control,'translate'),'none');
     assert.equal(await style(control,'scale'),'none');
     assert.equal(await style(control,'boxShadow'),'none');
    }
    await page.locator('.provider-login-choice').hover();
    await expect.poll(()=>style(page.locator('.provider-login-choice'),'translate')).toBe('0px -2px');
    await page.screenshot({path:path.join(os.tmpdir(),'interaction-desktop-hover.png')});
   }
   await page.emulateMedia({reducedMotion:'reduce'});
   await action.hover({force:true});
   assert.equal(await style(action,'transitionDuration'),'0s');
   assert.equal(await style(action,'translate'),'none');
   await page.mouse.down();
   assert.equal(await style(action,'scale'),'none');
   await page.mouse.move(0,0); await page.mouse.up();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await context.close();
  }
  console.log('PASS: shared hover, mouse/keyboard/touch press, focus, disabled states, dynamic controls and reduced motion across auth, landing, provider, customer and admin pages.');
 } finally { if(browser) await browser.close(); await f.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
