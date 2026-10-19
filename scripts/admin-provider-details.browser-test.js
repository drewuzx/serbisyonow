'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const {startQrFixture}=require('./provider-qr-test-fixture');
const {issueSession}=require('./account-sessions');
const {saveProviderCredentials}=require('./provider-profile');

async function main() {
 const f=await startQrFixture(); let browser;
 try {
  const admin=(await f.db.query("INSERT INTO admins(username,password_hash) VALUES('detail-admin','fixture') RETURNING id,username")).rows[0];
  admin.auth_token=await issueSession(f.db,'admin',admin.id);
  await f.db.query("UPDATE providers SET full_name='Detail Test Provider',description=$1 WHERE id=81",['Experienced appliance technician. <img src=x onerror="window.unsafeProfile=true">']);
  await saveProviderCredentials(f.db,81,[{fieldname:'docs',originalname:'work-sample.png',buffer:f.image},{fieldname:'idFront',originalname:'front.png',buffer:f.image}]);
  for(let i=0;i<12;i++) await f.db.query('INSERT INTO customer_reviews(customer_id,provider_id,rating,comment) VALUES($1,81,$2,$3)',[i%2?61:62,i%2?4:5,`Customer feedback ${i+1}`]);
  await f.db.query("INSERT INTO customer_reviews(customer_id,provider_id,rating,comment) VALUES(61,82,1,'Other provider feedback')");
  const details='/api/admin/providers/81/details';
  assert.equal((await f.request(details,'GET',undefined,null)).status,401);
  assert.equal((await f.request(details,'GET',undefined,f.customerToken)).status,403);
  assert.equal((await f.request(details,'GET',undefined,f.providerToken)).status,403);
  const read=await f.request(details,'GET',undefined,admin.auth_token);
  assert.equal(read.status,200);
  assert.equal(read.data.provider.full_name,'Detail Test Provider');
  assert.equal(read.data.provider.password_hash,undefined);
  assert.equal(read.data.review_summary.total,12);
  assert.equal(read.data.review_summary.average,4.5);
  assert.equal(read.data.reviews.length,10);
  assert.equal((await f.request(details+'?page=2','GET',undefined,admin.auth_token)).data.reviews.length,2);
  assert.equal((await f.request(details+'?page=-1','GET',undefined,admin.auth_token)).status,400);
  assert.equal((await f.request('/api/admin/providers/99999/details','GET',undefined,admin.auth_token)).status,404);
  const document='/api/admin/providers/81/documents/credential/0';
  assert.equal((await f.request(document,'GET',undefined,null)).status,401);
  assert.equal((await f.request(document,'GET',undefined,f.providerToken)).status,403);
  const file=await f.request(document,'GET',undefined,admin.auth_token);
  assert.equal(file.status,200); assert.deepEqual(file.data,f.image);
  assert.match(file.headers.get('content-disposition'),/^attachment/);
  assert.match(file.headers.get('cache-control'),/no-store/);
  assert.equal((await f.request('/api/admin/providers/82/documents/credential/0','GET',undefined,admin.auth_token)).status,404);

  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===f.base?route.continue():route.fulfill({body:'',contentType:'text/css'}));
  await context.addInitScript(admin=>localStorage.setItem('sn_admin_user',JSON.stringify(admin)),admin);
  const page=await context.newPage(),errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(f.base+'/pages/admin/user-management/user-management.html');
  assert.deepEqual(await page.locator('#role-filter option').allTextContents(),['All','Customers','Providers']);
  assert.ok((await page.locator('#status-filter option').allTextContents()).every(text=>!text.toLowerCase().includes('only')));
  await page.goto(f.base+'/pages/admin/provider-verification/provider-verification.html');
  const opener=page.getByRole('button',{name:'View profile of Detail Test Provider',exact:true});
  await opener.click();
  await page.getByRole('heading',{name:'Customer Feedback',exact:true}).waitFor();
  await page.getByText('4.5 / 5 / 12 reviews',{exact:true}).waitFor();
  assert.equal(await page.locator('.admin-provider-review').count(),10);
  assert.equal(await page.evaluate(()=>window.unsafeProfile),undefined);
  assert.equal(await page.locator('.admin-provider-description img').count(),0);
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download Credential / proof of work 1',exact:true}).click();
  const download=await downloadEvent;
  assert.deepEqual(await fs.readFile(await download.path()),f.image);
  for(const width of [1440,390,320]) {
   await page.setViewportSize({width,height:1000});
   await page.waitForFunction(()=>[...document.querySelectorAll('.admin-provider-detail img')].every(img=>img.complete&&img.naturalWidth>0));
   assert.equal(await page.evaluate(()=>{const d=document.querySelector('.admin-provider-detail');return d.scrollWidth>d.clientWidth+1;}),false,`Detail overflow at ${width}`);
   await page.screenshot({path:path.join(os.tmpdir(),`admin-provider-details-${width}.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'Next reviews',exact:true}).click();
  await page.getByText('Page 2 of 2',{exact:true}).waitFor();
  assert.equal(await page.locator('.admin-provider-review').count(),2);
  assert.equal(await page.getByRole('button',{name:'Next reviews',exact:true}).isDisabled(),true);
  await page.keyboard.press('Escape');
  await page.locator('.admin-provider-detail').waitFor({state:'detached'});
  assert.equal(await opener.evaluate(el=>document.activeElement===el),true);
  await page.route('**/api/admin/providers/82/details*',route=>route.fulfill({status:503,json:{message:'Temporarily unavailable.'}}));
  await page.locator('[data-provider-details="82"]').click();
  await page.getByText('Temporarily unavailable.',{exact:true}).waitFor();
  await page.unroute('**/api/admin/providers/82/details*');
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByText('No documents submitted.',{exact:true}).waitFor();
  await page.getByText('Other provider feedback',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('Admin provider details passed: filter labels, clickable profile, private documents/downloads, real customer feedback/summary/pagination, escaping, keyboard close/focus, retry/empty states, and desktop/mobile layouts.');
 } finally {if(browser) await browser.close(); await f.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
