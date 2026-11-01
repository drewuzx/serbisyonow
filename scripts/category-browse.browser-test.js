'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium, expect } = require('playwright/test');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const f = await startQrFixture(); let browser;
 try {
  await f.db.query("UPDATE customers SET address='Balibago Angeles City' WHERE id=61");
  await f.db.query("UPDATE providers SET full_name='Rated Repair Provider',address='San Fernando',documents_files=ARRAY['certificate.pdf'] WHERE id=81");
  await f.db.query("UPDATE providers SET full_name='Nearby Cleaning Provider',address='Balibago Angeles City' WHERE id=82");
  await f.db.query('UPDATE provider_skill_assessments SET score=100 WHERE provider_id=81');
  for(let n=0;n<5;n++) {
   const booking=await f.createBooking({status:'completed'});
   await f.db.query("INSERT INTO customer_reviews(customer_id,provider_id,booking_id,rating,comment) VALUES(61,81,$1,5,'Completed service')",[booking.id]);
  }
  await f.db.query('DELETE FROM provider_availability');
  await f.db.query(`INSERT INTO provider_availability(provider_id,available_date,start_time,end_time,is_available) VALUES
   (81,CURRENT_DATE+1,'09:00','12:00',TRUE),(82,CURRENT_DATE+1,'09:00','12:00',FALSE),(82,CURRENT_DATE-1,'09:00','12:00',TRUE)`);
  const customer=(await f.request('/api/auth/customer/session','GET',undefined,f.customerToken)).data.user;
  customer.auth_token=f.customerToken;
  browser=await chromium.launch({headless:true,channel:'msedge'});
  for(const width of [1440,390,320]) {
   const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,serviceWorkers:'block'});
   await context.route('**/*',route=>new URL(route.request().url()).origin===f.base?route.continue():route.fulfill({body:'',contentType:'text/css'}));
   await context.addInitScript(user=>localStorage.setItem('sn_customer_user',JSON.stringify(user)),customer);
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   for(const [label,sort,available,count,first] of [
    ['Available now','available','true',1,'Rated Repair Provider'],
    ['Top-rated','top','false',2,'Rated Repair Provider'],
    ['Nearby','nearest','false',2,'Nearby Cleaning Provider'],
    ['All','recommended','false',2,null],
   ]) {
    await page.goto(f.base+'/pages/customer/categories/categories.html');
    await page.locator('.sn-category-card[href*="category="]').first().waitFor();
    const button=page.locator('.sn-filter-panel').getByRole('button',{name:label,exact:true});
    if(width<500) await button.tap(); else if(label==='All') await button.press('Enter'); else await button.click();
    await page.waitForURL('**/search/search.html?**',{timeout:5000});
    const params=new URL(page.url()).searchParams;
    assert.equal(params.get('sort'),sort);
    assert.equal(params.get('available'),available);
    assert.equal(params.get('location'),customer.address);
    await expect(page.locator('#sn-results-count')).toHaveText(`${count} provider${count===1?'':'s'} found`);
    if(first) await expect(page.locator('.sn-result-name').first()).toHaveText(first);
    assert.equal(await page.locator('#sn-available-only').isChecked(),available==='true');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   }
   await page.goto(f.base+'/pages/customer/categories/categories.html');
   await page.locator('#sn-home-search-input').fill('Nearby Cleaning Provider');
   await page.locator('.sn-filter-panel').getByRole('button',{name:'All',exact:true}).click();
   await page.waitForURL('**/search/search.html?**');
   assert.equal(new URL(page.url()).searchParams.get('q'),'Nearby Cleaning Provider');
   await expect(page.locator('#sn-results-count')).toHaveText('1 provider found');
   await page.goBack();
   await page.locator('.sn-filter-panel').scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(os.tmpdir(),`category-browse-${width}.png`)});
   await page.locator('.sn-category-card').filter({hasText:'Cleaning'}).click();
   await page.waitForURL('**/search/search.html?category=Cleaning');
   await expect(page.locator('#sn-results-count')).toHaveText('2 providers found');
   if(width===320) {
    await f.db.query('UPDATE provider_availability SET is_available=FALSE');
    await page.goto(f.base+'/pages/customer/categories/categories.html');
    await page.locator('.sn-filter-panel').getByRole('button',{name:'Available now',exact:true}).tap();
    await expect(page.locator('#sn-results-count')).toHaveText('0 providers found');
    await expect(page.locator('#sn-results-list')).toContainText('No available services or providers match');
   }
   assert.deepEqual(errors,[]);
   await context.close();
  }
  console.log('PASS: all Browse Filters navigate and apply to real provider results, open schedules exclude closed/past slots, ratings and saved-area ordering, typed query preserved, desktop/mobile taps.');
 } finally { await browser?.close(); await f.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
