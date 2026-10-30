'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium, expect } = require('playwright/test');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const f = await startQrFixture();
 let browser;
 try {
  await f.db.query("UPDATE providers SET full_name='Drew Wu',category='Repair Services' WHERE id=81");
  await f.db.query("UPDATE providers SET is_verified=FALSE,verification_status='pending' WHERE id=82");
  await f.db.query('DELETE FROM provider_services');
  await f.db.query("INSERT INTO provider_services(provider_id,title,category,starting_price,max_price,is_active) VALUES (81,'Appliance repair','Repair Services',500,2000,TRUE)");
  const customer = (await f.request('/api/auth/customer/session','GET',undefined,f.customerToken)).data.user;
  customer.auth_token=f.customerToken;
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===f.base?route.continue():route.fulfill({body:'',contentType:'text/css'}));
  await context.addInitScript(user=>localStorage.setItem('sn_customer_user',JSON.stringify(user)),customer);
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(f.base+'/pages/customer/search/search.html');
  const input=page.locator('#sn-page-search');
  const results=page.locator('#sn-results-list');
  await expect(results).toContainText('Drew Wu');
  await input.pressSequentially('Drew Wu',{delay:40});
  await expect(input).toHaveValue('Drew Wu');
  await expect(results).toContainText('Drew Wu');
  for (const query of ['Appliance repair','Repair Services','  drew   wu  ']) {
   await input.fill('');
   await input.pressSequentially(query,{delay:25});
   await input.press('Enter');
   await expect(results).toContainText('Drew Wu');
   await expect(page.locator('#sn-results-count')).toHaveText('1 provider found');
  }
  await input.fill('Nobody offers this');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await expect(results).toContainText('No available services or providers match');
  await expect(page.locator('#sn-results-count')).toHaveText('0 providers found');
  await input.fill('');
  await expect(results).toContainText('Drew Wu');
  assert.equal(new URL(page.url()).searchParams.has('q'),false);
  await input.fill('Drew Wu');
  await input.press('Enter');
  await expect(results).toContainText('Drew Wu');
  await page.reload();
  await expect(input).toHaveValue('Drew Wu');
  await expect(results).toContainText('Drew Wu');
  await input.focus();
  await input.press('Home');
  await input.press('ArrowRight');
  await input.press('ArrowRight');
  await input.press('ArrowRight');
  await input.press('ArrowRight');
  await input.press('Delete');
  await input.pressSequentially(' ');
  await expect(input).toHaveValue('Drew Wu');
  assert.equal(await input.evaluate(node=>node.selectionStart),5,'Editing keeps the caret in place');
  let fail=true;
  await page.route('**/api/customer/search/providers?**',route=>fail?route.fulfill({status:503,json:{message:'Unavailable'}}):route.continue());
  await input.fill('Appliance');
  await expect(results).toContainText('Search is unavailable right now');
  await expect(page.locator('#sn-results-count')).toHaveText('Unable to load results');
  fail=false;
  await results.getByRole('button',{name:'Retry'}).click();
  await expect(results).toContainText('Drew Wu');
  await page.unroute('**/api/customer/search/providers?**');
  await page.route('**/api/customer/search/providers?**',async route=>{
   if(new URL(route.request().url()).searchParams.get('q')==='slow') {
    await new Promise(resolve=>setTimeout(resolve,800));
    return route.fulfill({json:{providers:[{id:82,full_name:'Stale Provider'}]}}).catch(()=>{});
   }
   return route.continue();
  });
  await input.fill('slow');
  await page.waitForRequest(request=>new URL(request.url()).searchParams.get('q')==='slow');
  await input.fill('Drew Wu');
  await expect(results).toContainText('Drew Wu');
  await page.waitForTimeout(900);
  await expect(results).not.toContainText('Stale Provider');
  for(const width of [1440,390,320]) {
   await page.setViewportSize({width,height:1000});
   await input.scrollIntoViewIfNeeded();
   await input.fill('Drew Wu');
   await expect(results).toContainText('Drew Wu');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Overflow at ${width}`);
   const form=page.getByRole('search',{name:'Find providers and services'});
   await form.evaluate(node=>node.scrollIntoView({block:'center'}));
   const fieldBox=await input.boundingBox();
   const buttonBox=await form.getByRole('button',{name:'Search',exact:true}).boundingBox();
   assert(fieldBox.width>80 && fieldBox.x+fieldBox.width<=buttonBox.x,'Search field and button do not overlap');
   const headerBox=await page.locator('.sn-topbar').boundingBox();
   assert(fieldBox.y>=headerBox.y+headerBox.height,'Search field stays below the sticky header');
   await page.screenshot({path:path.join(os.tmpdir(),`provider-search-fix-${width}.png`)});
  }
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('PASS: typed multiword providers/services/categories, caret editing, Enter and button submit, no matches, clear/reload, retry, stale responses, and responsive layouts.');
 } finally { await browser?.close(); await f.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
