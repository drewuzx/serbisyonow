'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');
const { issueSession } = require('./account-sessions');

async function main() {
 const f = await startQrFixture(); let browser;
 try {
  const admin = (await f.db.query("INSERT INTO admins(username,password_hash) VALUES('color-test-admin','fixture') RETURNING id,username")).rows[0];
  admin.auth_token = await issueSession(f.db,'admin',admin.id);
  assert.equal((await f.request('/api/admin/providers/81','DELETE',undefined,null)).status,401);
  assert.equal((await f.request('/api/admin/providers/81','DELETE',undefined,f.customerToken)).status,403);
  assert.equal((await f.request('/api/admin/providers/81','DELETE',undefined,f.providerToken)).status,403);
  assert.equal((await f.request('/api/admin/providers/81','DELETE',undefined,admin.auth_token)).status,400);
  await f.db.query("UPDATE providers SET is_verified=FALSE,verification_status=CASE WHEN id=81 THEN 'rejected' ELSE 'pending' END");
  await f.db.query("INSERT INTO provider_skill_assessments(provider_id,category,score,badge) VALUES(82,'Cleaning Services',90,'Skilled Verified')");
  const provider = (await f.request('/api/auth/provider/session','GET',undefined,f.otherProviderToken)).data.user;
  const customer = (await f.request('/api/auth/customer/session','GET',undefined,f.customerToken)).data.user;
  browser = await chromium.launch({headless:true,channel:'msedge'});
  const context = await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===f.base ? route.continue() : route.fulfill({body:'',contentType:'text/css'}));
  await context.addInitScript(({admin,provider,customer})=>{
   localStorage.setItem('sn_admin_user',JSON.stringify(admin));
   localStorage.setItem('sn_provider_user',JSON.stringify(provider));
   localStorage.setItem('sn_customer_user',JSON.stringify(customer));
  },{admin,provider,customer});
  const page = await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const color = locator => locator.evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.goto(f.base+'/pages/admin/provider-verification/provider-verification.html');
  await page.locator('[data-delete-provider="81"]').waitFor();
  assert.equal(await color(page.locator('[data-verify-provider="81"]')),'rgb(21, 128, 61)');
  assert.equal(await color(page.locator('[data-delete-provider="81"]')),'rgb(185, 28, 28)');
  assert.equal(await color(page.locator('[data-reject-provider="82"]')),'rgb(229, 231, 235)');
  assert.equal(await page.locator('.status-badge.rejected').textContent(),'Declined');
  assert.equal(await color(page.locator('.status-badge.rejected')),'rgb(229, 231, 235)');
  for (const width of [1440,390,320]) {
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Verification overflow ${width}`);
   await page.screenshot({path:path.join(os.tmpdir(),`verification-colors-${width}.png`),fullPage:true});
  }
  await page.locator('[data-reject-provider="82"]').click();
  await page.locator('[data-delete-provider="82"]').waitFor();
  await page.locator('[data-verify-provider="82"]').click();
  await page.locator('.status-badge.verified').waitFor();
  assert.equal((await f.db.query('SELECT verification_status FROM providers WHERE id=82')).rows[0].verification_status,'verified');
  await page.locator('[data-delete-provider="81"]').click();
  await page.locator('#delete-provider-cancel').click();
  assert.equal((await f.db.query('SELECT id FROM providers WHERE id=81')).rowCount,1);
  await page.locator('[data-delete-provider="81"]').click();
  await page.locator('#delete-provider-confirm').click();
  await page.getByText('Declined provider submission deleted.',{exact:true}).waitFor();
  assert.equal((await f.db.query('SELECT id FROM providers WHERE id=81')).rowCount,0);

  // Test the same button contracts with each role's real stylesheets and overrides.
  const pages = [
   '/pages/admin/user-management/user-management.html',
   '/pages/provider/services/services.html',
   '/pages/customer/bookings/bookings.html',
   '/pages/auth/providerLogin.html',
   '/pages/provider/promotions/promotions.html',
  ];
  for (const route of pages) {
   await page.goto(f.base+route);
   await page.addStyleTag({url:f.base+'/pages/provider/services/pricing-editor.css'});
   await page.addStyleTag({url:f.base+'/shared/css/promotions.css'});
   await page.evaluate(()=>{
    const matrix = document.createElement('div'); matrix.id='color-test-matrix';
    matrix.innerHTML='<button class="btn btn-primary">Save</button><button class="sn-btn sn-btn-primary">Book</button><button class="btn btn-orange">Continue</button><button class="btn btn-success">Verify</button><button class="btn btn-danger">Delete</button><button class="btn btn-neutral">Decline</button><button class="btn btn-outline">Details</button><button class="promotion-button primary">Pay</button><button class="promotion-button danger">Cancel Order</button><button class="btn btn-primary" disabled>Unavailable</button><button class="promotion-button primary" aria-disabled="true">Unavailable</button><div id="sn-price-editor"><button class="btn btn-primary">Save Prices</button></div><form data-review-form><button class="promotion-button primary" type="submit">Verify Payment</button></form>';
    document.body.append(matrix);
   });
   const expected = ['rgb(43, 85, 204)','rgb(43, 85, 204)','rgb(43, 85, 204)','rgb(21, 128, 61)','rgb(185, 28, 28)','rgb(229, 231, 235)','rgb(255, 255, 255)','rgb(43, 85, 204)','rgb(185, 28, 28)','rgb(229, 231, 235)','rgb(229, 231, 235)','rgb(43, 85, 204)','rgb(21, 128, 61)'];
   assert.deepEqual(await page.locator('#color-test-matrix button').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).backgroundColor)),expected,route);
   const primary = page.locator('#color-test-matrix button').first();
   await primary.hover();
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('#color-test-matrix button')).backgroundColor==='rgb(26, 58, 143)');
   assert.equal(await color(primary),'rgb(26, 58, 143)');
   const disabled = page.locator('#color-test-matrix button:disabled');
   await disabled.hover({force:true});
   assert.equal(await color(disabled),'rgb(229, 231, 235)');
  }
  await f.db.query(`INSERT INTO promotion_orders(provider_id,plan_id,request_id,plan_name,description,duration_days,amount_centavos,status,wallet,account_name,account_number,qr_content,qr_mime)
   SELECT 82,id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name,description,14,10000,'paid','GCash','Test Platform','09123456789',$1,'image/png' FROM promotion_plans LIMIT 1`,[f.image]);
  await f.db.query("UPDATE providers SET verification_status='rejected',is_verified=FALSE WHERE id=82");
  const retained = await f.request('/api/admin/providers/82','DELETE',undefined,admin.auth_token);
  assert.equal(retained.status,409);
  assert.match(retained.data.message,/payment records/);
  assert.equal((await f.db.query('SELECT id FROM providers WHERE id=82')).rowCount,1);
  assert.deepEqual(errors,[]);
  console.log('Button colors passed across admin/provider/customer/auth/promotions, including hover/disabled states. Verified decline, verify, cancel deletion, admin-only deletion, and desktop/mobile layouts.');
 } finally { if(browser) await browser.close(); await f.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
