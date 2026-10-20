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
  browser = await chromium.launch({headless:true,channel:'msedge'});
  const context = await browser.newContext({viewport:{width:360,height:800},serviceWorkers:'block'});
  await context.route('**/*',r=>new URL(r.request().url()).origin===f.base ? r.continue() : r.fulfill({body:'',contentType:r.request().url().includes('fonts.googleapis.com')?'text/css':'application/javascript'}));
  const customer = (await f.request('/api/auth/customer/session')).data.user;
  await context.addInitScript(user=>localStorage.setItem('sn_customer_user',JSON.stringify(user)),customer);
  const page = await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const url = `${f.base}/pages/customer/history/history.html`;
  async function emptyIsSeparate() {
   assert.equal(await page.locator('#sn-detail-empty').isVisible(),true);
   for (const selector of ['.sn-detail-header','.sn-completion-banner','.sn-detail-body','.sn-cust-actions','.sn-provider-info-card']) {
    assert.equal(await page.locator(selector).isVisible(),false,`${selector} must be hidden without a selected booking`);
   }
  }
  async function noOverflow() {
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'page must fit viewport');
   assert.equal(await page.locator('#sn-detail-panel').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'details must fit panel');
   assert.ok(await page.locator('#sn-history-list').evaluate(el=>el.clientHeight>=Math.min(el.scrollHeight,100)),'history list must have usable height');
  }
  for (const width of [320,360,390,768,1440]) {
   await page.setViewportSize({width,height:900});
   await page.goto(url);
   await page.getByText('No completed or cancelled bookings yet.',{exact:true}).waitFor();
   await emptyIsSeparate();
   await noOverflow();
   await page.screenshot({path:path.join(os.tmpdir(),`history-empty-${width}.png`),fullPage:true});
  }
  await f.db.query("UPDATE providers SET full_name=$1 WHERE id=81",['Provider with an exceptionally long display name']);
  await f.createBooking({status:'completed',address:'A long customer address in Angeles City, Pampanga, with a building identifier '+ 'A'.repeat(90),service:'Appliance repair and preventive maintenance'});
  await f.createBooking({status:'cancelled'});
  for (const width of [320,360,390,768,1440]) {
   await page.setViewportSize({width,height:900});
   await page.goto(url);
   await page.locator('.sn-history-item').first().waitFor();
   await page.locator('[data-filter="completed"]').click();
   await page.locator('#detail-address').filter({hasText:'building identifier'}).waitFor();
   assert.equal(await page.locator('#sn-detail-empty').isVisible(),false);
   assert.equal(await page.locator('.sn-cust-actions').isVisible(),true);
   await noOverflow();
   const bounds = await page.locator('.sn-detail-body').evaluate(el=>{
    const [details,cards]=el.children;
    return {detailsBottom:details.getBoundingClientRect().bottom,cardsTop:cards.getBoundingClientRect().top,bodyBottom:el.getBoundingClientRect().bottom,cardsBottom:cards.getBoundingClientRect().bottom};
   });
   assert.ok(bounds.cardsTop>=bounds.detailsBottom,'actions must not overlap booking information');
   assert.ok(bounds.bodyBottom>=bounds.cardsBottom-1,'detail panel must contain its content');
   await page.screenshot({path:path.join(os.tmpdir(),`history-details-${width}.png`),fullPage:true});
   await page.locator('#history-search').fill('no matching service');
   await page.getByText('No bookings match your filter.',{exact:true}).waitFor();
   await emptyIsSeparate();
   await page.locator('#history-search').fill('');
   assert.equal(await page.locator('.sn-detail-body').isVisible(),true);
   await page.locator('[data-filter="cancelled"]').click();
   assert.equal(await page.locator('#detail-completed-row').isVisible(),false);
   assert.equal(await page.locator('#detail-reason-row').isVisible(),true);
  }
  await page.route('**/api/customer/61/dashboard',r=>r.fulfill({status:503,contentType:'application/json',body:'{"message":"History temporarily unavailable."}'}));
  await page.reload();
  await page.getByText('History temporarily unavailable.',{exact:true}).waitFor();
  await emptyIsSeparate();
  assert.deepEqual(errors,[]);
  console.log('History responsive checks passed: empty, populated, filtered, restored, cancelled and failed states across five viewport sizes; no overlapping details or horizontal overflow.');
 } finally {if(browser) await browser.close(); await f.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
