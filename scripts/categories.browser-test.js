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
  const admin = (await f.db.query("INSERT INTO admins(username,password_hash) VALUES('category-admin','fixture') RETURNING id,username")).rows[0];
  admin.auth_token = await issueSession(f.db,'admin',admin.id);
  const read = async () => (await f.request('/api/admin/categories','GET',undefined,admin.auth_token)).data.categories;
  assert.equal((await f.request('/api/admin/categories','POST',{name:'Unauthorized'},null)).status,401);
  assert.equal((await f.request('/api/admin/categories','POST',{name:'Unauthorized'},f.providerToken)).status,403);
  assert.equal((await f.request('/api/admin/categories','POST',{name:'   '},admin.auth_token)).status,400);
  assert.equal((await f.request('/api/admin/categories','POST',{name:'Valid',services:{}},admin.auth_token)).status,400);
  const provider = (await f.request('/api/auth/provider/session','GET',undefined,f.providerToken)).data.user;
  browser = await chromium.launch({headless:true,channel:'msedge'});
  const context = await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===f.base ? route.continue() : route.fulfill({body:'',contentType:'text/css'}));
  await context.addInitScript(({admin,provider})=>{
   localStorage.setItem('sn_admin_user',JSON.stringify(admin));
   localStorage.setItem('sn_provider_user',JSON.stringify(provider));
  },{admin,provider});
  const page = await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(f.base+'/pages/admin/categories/categories.html');
  await page.getByRole('button',{name:'Add Category',exact:true}).click();
  await page.getByLabel('Category name',{exact:true}).fill('Home Technology');
  await page.getByLabel('Description',{exact:true}).fill('Home device setup services.');
  await page.getByLabel('Services (comma separated)',{exact:true}).fill('Smart sensors, Network setup');
  await page.getByRole('button',{name:'Save Category',exact:true}).click();
  await page.getByText('Category saved.',{exact:true}).waitFor();
  const card = page.locator('#category-list .admin-card').filter({has:page.getByRole('heading',{name:'Home Technology',exact:true})});
  await card.getByText('Inactive',{exact:true}).waitFor();
  await card.getByText('0 provider(s)',{exact:true}).waitFor();
  await page.getByLabel('Category name',{exact:true}).fill('home technology');
  await page.getByRole('button',{name:'Save Category',exact:true}).click();
  await page.getByText('This category already exists. Choose a different name.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Category name',{exact:true}).inputValue(),'home technology');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.locator('#category-form-panel').isVisible(),false);
  assert.equal((await read()).filter(c=>c.name.toLowerCase()==='home technology').length,1);

  const providerPage=await context.newPage();
  providerPage.on('pageerror',e=>errors.push(e.message));
  await providerPage.goto(f.base+'/pages/provider/services/services.html');
  await providerPage.locator('[data-action="add-service"]').click();
  for (const [label,value] of [['Service name','Smart sensor setup'],['Category','Others'],['New category name','Home Technology'],['Description','Install smart home sensors.'],['Starting price','500'],['Maximum price','800']]) {
   await providerPage.locator('.sn-modal-field > span').filter({hasText:new RegExp(`^${label}$`)}).waitFor();
   const field=providerPage.locator('.sn-modal-input');
   if(label==='Category') await field.selectOption(value); else await field.fill(value);
   await providerPage.locator('[data-modal-confirm]').click();
  }
  await providerPage.getByText('Smart sensor setup',{exact:false}).first().waitFor();
  await page.bringToFront();
  await card.getByText('1 provider(s)',{exact:true}).waitFor({timeout:20000});
  await card.getByText('Active',{exact:true}).waitFor();
  assert.match(await card.textContent(),/Smart sensor setup/);
  const cleaning=(await read()).filter(c=>/cleaning/i.test(c.name));
  assert.equal(cleaning.length,1);
  assert.equal(cleaning[0].provider_count,2);

  const serviceBody={title:'Network configuration',category:'home technology',starting_price:100,max_price:200,accepts_cash:true,is_active:true};
  const second=await f.request('/api/provider/81/services','POST',serviceBody,f.providerToken);
  assert.equal(second.status,201);
  assert.equal((await read()).find(c=>c.name==='Home Technology').provider_count,1);
  const third=await f.request('/api/provider/82/services','POST',{...serviceBody,title:'Device pairing'},f.otherProviderToken);
  assert.equal(third.status,201);
  assert.equal((await read()).find(c=>c.name==='Home Technology').provider_count,2);
  assert.equal((await f.request(`/api/provider/82/services/${third.data.service.id}`,'PATCH',{title:'Updated device pairing'},f.otherProviderToken)).status,200);
  assert.ok((await read()).find(c=>c.name==='Home Technology').services.includes('Updated device pairing'));
  await page.evaluate(()=>loadCategories());
  for(const width of [1440,390,320]) {
   await page.setViewportSize({width,height:1000});
   await page.getByRole('button',{name:'Add Category',exact:true}).click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Category overflow ${width}`);
   await page.screenshot({path:path.join(os.tmpdir(),`categories-${width}.png`),fullPage:true});
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
  }
  const customServices=(await f.db.query("SELECT id,provider_id FROM provider_services WHERE lower(category)='home technology'")).rows;
  for(const service of customServices) assert.equal((await f.request(`/api/provider/${service.provider_id}/services/${service.id}`,'DELETE',undefined,service.provider_id===81?f.providerToken:f.otherProviderToken)).status,200);
  const empty=(await read()).find(c=>c.name==='Home Technology');
  assert.equal(empty.provider_count,0); assert.equal(empty.is_active,false);
  await providerPage.goto(f.base+'/pages/auth/providerRegister.html');
  await providerPage.evaluate(()=>{ document.getElementById('category').value='Others'; updateServiceOptions(); });
  assert.equal(await providerPage.locator('#custom-service').isDisabled(),false);
  assert.equal(await providerPage.locator('#custom-service').getAttribute('required'),'');
  await providerPage.evaluate(()=>{ document.getElementById('category').value='Cleaning'; updateServiceOptions(); });
  assert.equal(await providerPage.locator('#custom-service').isDisabled(),true);
  assert.equal(await providerPage.locator('#custom-service-group').getAttribute('hidden'),'');
  assert.deepEqual(errors,[]);
  console.log('Categories passed: admin creation/validation/auth, duplicate prevention, provider Others wizard, automatic admin refresh, distinct provider counts, updated services, empty Inactive status, registration custom service field, desktop/mobile layouts.');
 } finally { if(browser) await browser.close(); await f.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
