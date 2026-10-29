'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const fixture = await startQrFixture();
 let browser;
 try {
  browser = await chromium.launch({ headless:true, channel:'msedge' });
  for (const width of [1440,390,320]) {
   const context = await browser.newContext({viewport:{width,height:950},hasTouch:width<500,serviceWorkers:'block'});
   await context.route('**/*',route => new URL(route.request().url()).origin === fixture.base ? route.continue() : route.fulfill({body:'',contentType:'text/css'}));
   const page = await context.newPage();
   const errors = [];
   page.on('pageerror',error=>errors.push(error.message));
   page.setDefaultTimeout(10000);
   await page.clock.install();
   const url = `${fixture.base}/pages/auth/loginChoice.html?from=service&category=Cleaning`;
   await page.goto(url);
   await page.clock.pauseAt(await page.evaluate(()=>Date.now()));
   await page.clock.runFor(1000);
   const logo = page.getByRole('button',{name:'SerbisyoNow logo',exact:true});
   const admin = page.locator('#admin-login-choice');
   const activate = () => width<500 ? logo.tap() : logo.click();
   assert(await admin.isHidden());
   assert.equal(await page.getByRole('link',{name:'Admin Login',exact:true}).count(),0);
   assert.match(await page.getByRole('link',{name:'Customer Login',exact:true}).getAttribute('href'),/category=Cleaning/);
   assert.equal(await page.getByRole('link',{name:'Provider Login',exact:true}).getAttribute('href'),'providerLogin.html');
   const provider = page.getByRole('link',{name:'Provider Login',exact:true});
   assert.equal(await provider.evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(244, 130, 10)');
   assert.equal(await provider.evaluate(node=>getComputedStyle(node).color),'rgb(23, 43, 77)');
   assert.equal(await page.getByRole('link',{name:'Customer Login',exact:true}).evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(43, 85, 204)');
   await activate(); await activate();
   assert(await admin.isHidden(),'Two clicks do not reveal admin');
   await page.clock.runFor(3100);
   await activate();
   assert(await admin.isHidden(),'Slow clicks reset');
   await activate();
   const before = await logo.boundingBox();
   await activate();
   assert(await admin.isVisible(),JSON.stringify({width,errors,hidden:await admin.getAttribute('hidden'),expanded:await logo.getAttribute('aria-expanded')}));
   assert.deepEqual(await logo.boundingBox(),before,'Reveal does not move the logo');
   assert.equal(await logo.getAttribute('aria-expanded'),'true');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.screenshot({path:path.join(os.tmpdir(),`admin-login-revealed-${width}.png`),fullPage:true,animations:'disabled'});
   await admin.focus();
   await page.clock.runFor(4900);
   assert(await admin.isVisible());
   await page.clock.runFor(100);
   assert(await admin.isHidden(),'Hidden at five seconds');
   assert(await logo.evaluate(node=>node===document.activeElement),'Focus restored when link expires');
   await logo.press('Enter'); await logo.press('Space'); await logo.press('Enter');
   assert(await admin.isVisible(),'Keyboard activation works');
   await page.reload();
   assert(await admin.isHidden(),'Reload resets visibility');
   await activate(); await activate(); await activate();
   await admin.click();
   await page.waitForURL('**/adminLogin.html');
   await page.goBack();
   await page.clock.runFor(1000);
   assert(await admin.isHidden(),'Returning from admin login hides the link');
   await page.screenshot({path:path.join(os.tmpdir(),`admin-login-hidden-${width}.png`),fullPage:true,animations:'disabled'});
   assert.deepEqual(errors,[]);
   await context.close();
  }
  const noJs = await browser.newContext({javaScriptEnabled:false});
  await noJs.route('**/*',route=>new URL(route.request().url()).origin===fixture.base ? route.continue() : route.fulfill({body:'',contentType:'text/css'}));
  const page = await noJs.newPage();
  await page.goto(`${fixture.base}/pages/auth/loginChoice.html`);
  assert(await page.locator('#admin-login-choice').isHidden(),'No initial visible flash without JavaScript');
  await noJs.close();
  console.log('PASS: default hidden, triple click/tap, reset interval, exact five-second expiry, keyboard/focus, navigation, reload/back, and desktop/mobile layouts.');
 } finally { if(browser) await browser.close(); await fixture.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
