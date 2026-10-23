'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');
const { issueSession } = require('./account-sessions');

async function main() {
 let session, browser;
 const gateway = { ready:true,livemode:true,
  async checkout({promotionOrderId,reference,amountCentavos}) {
   session = { id:'cs_browser',attributes:{livemode:true,status:'active',reference_number:reference,
    metadata:{purpose:'promotion_purchase',promotion_order_id:String(promotionOrderId)},payments:[]} };
   assert.equal(amountCentavos,19900);
   return {id:session.id,url:'https://checkout.paymongo.com/cs_browser',livemode:true};
  },
  async retrieve() {return session;}, async expire() {session.attributes.status='expired';}
 };
 const f = await startQrFixture({gateway,promotionChannel:'paymongo'});
 try {
  const admin = (await f.db.query("INSERT INTO admins(username,password_hash) VALUES('browser-gateway-admin','fixture') RETURNING id,username")).rows[0];
  admin.auth_token = await issueSession(f.db,'admin',admin.id);
  const provider = (await f.request('/api/auth/provider/session','GET',undefined,f.providerToken)).data.user;
  await f.request('/api/admin/promotions/plans','POST',{name:'QR Ph Boost',description:'Profile boost',kind:'promotion',duration_days:14,price:199,enabled:true},admin.auth_token);
  browser = await chromium.launch({headless:true,channel:'msedge'});
  const context = await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===f.base ? route.continue() : route.fulfill({body:'',contentType:'text/html'}));
  await context.addInitScript(({admin,provider})=>{
   localStorage.setItem('sn_admin_user',JSON.stringify(admin));localStorage.setItem('sn_provider_user',JSON.stringify(provider));
  },{admin,provider});
  const page = await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const url = f.base+'/pages/provider/promotions/promotions.html';
  await page.goto(url);
  await page.getByRole('button',{name:'Choose Plan',exact:true}).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Continue to QR Ph',exact:true}).click();
  await page.getByRole('button',{name:'Pay with QR Ph',exact:true}).waitFor();
  assert.equal(await page.locator('[data-receipt-form]').count(),0);
  for (const width of [1440,390,320]) {
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.screenshot({path:path.join(os.tmpdir(),`promotion-qrph-${width}.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'Pay with QR Ph',exact:true}).click();
  await page.waitForURL('https://checkout.paymongo.com/cs_browser');
  const id = session.attributes.metadata.promotion_order_id;
  await page.goto(url+`?payment_return=success&order_id=${id}`);
  await page.getByRole('button',{name:'Check Payment Status',exact:true}).waitFor();
  assert.equal((await f.db.query('SELECT status FROM promotion_orders WHERE id=$1',[id])).rows[0].status,'awaiting_payment','return URL cannot activate a boost');
  await page.route('**/payment-status',route=>route.fulfill({status:503,json:{message:'Connection interrupted. Please retry.'}}));
  await page.getByRole('button',{name:'Check Payment Status',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Connection interrupted'}).waitFor();
  await page.unroute('**/payment-status');
  session.attributes.payments=[{id:'pay_browser',attributes:{status:'paid',amount:19900,currency:'PHP',livemode:true}}];
  await page.getByRole('button',{name:'Check Payment Status',exact:true}).click();
  await page.getByText('Payment confirmed. Your promotion is active.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(f.base+'/pages/admin/revenue/revenue.html');
  await page.getByRole('heading',{name:'PayMongo QR Ph',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Edit Receiving QR',exact:true}).count(),0);
  await page.locator('.promotion-metric').filter({hasText:'Verified platform revenue'}).getByText(/199/).waitFor();
  await page.getByRole('button',{name:'Payment Details',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Verify & Activate',exact:true}).count(),0);
  await page.screenshot({path:path.join(os.tmpdir(),'promotion-qrph-admin.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: QR Ph purchase, hosted checkout redirect, untrusted return, status recovery, automatic activation, Admin revenue, and desktop/mobile views.');
 } finally {if(browser) await browser.close();await f.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
