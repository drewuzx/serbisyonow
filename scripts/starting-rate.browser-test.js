'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');
const pricing = require('../shared/js/providerPricing');

async function main() {
 const f = await startQrFixture(); let browser;
 try {
  await f.db.query('DELETE FROM provider_services WHERE provider_id=81');
  await f.db.query('INSERT INTO customer_favorites(customer_id,provider_id) VALUES(61,81)');
  const config = { mode: 'range', min: 500, max: 2000, duration: 'Flexible', service_area: '', notes: '', addons: [] };
  const created = await f.request('/api/provider/81/services', 'POST', { title: 'Appliance repair', category: 'Repair Services', pricing_config: config }, f.providerToken);
  assert.equal(created.status, 201);
  const serviceId = created.data.service.id;
  await f.db.query(`INSERT INTO provider_services(provider_id,title,category,starting_price,max_price,is_active)
   VALUES(81,'Inactive service','Repair Services',100,200,FALSE),(81,'Unpriced service','Repair Services',0,0,TRUE)`);
  async function checkRates(expected) {
   const profile = await f.request('/api/auth/provider/status/81');
   assert.equal(profile.status, 200); assert.equal(profile.data.user.starting_price, expected, 'profile');
   for (const [route, key] of [
    ['/api/customer/61/favorites', 'favorites'], ['/api/customer/61/dashboard', 'providers'],
    ['/api/providers/search', 'providers'], ['/api/customer/61/recommendations', 'providers'], ['/api/customer/61/location-map', 'providers'],
   ]) {
    const result = await f.request(route); assert.equal(result.status, 200, route);
    assert.equal(result.data[key].find(provider => provider.id === 81)?.starting_price, expected, route);
    if (route.endsWith('/dashboard')) {
     assert.equal(result.data.favorites.find(provider => provider.id === 81).starting_price, expected);
     assert.equal(result.data.recommendations.find(provider => provider.id === 81).starting_price, expected);
    }
   }
  }
  await checkRates(500);
  async function update(pricingConfig) {
   const result = await f.request(`/api/provider/81/services/${serviceId}`, 'PATCH', { pricing_config: pricingConfig }, f.providerToken);
   assert.equal(result.status, 200); return result;
  }
  await update({ ...config, min: 725.5 }); await checkRates(725.5);
  const second = await f.request('/api/provider/81/services', 'POST', { title: 'Electrical repair', category: 'Repair Services', pricing_config: { ...config, min: 300 } }, f.providerToken);
  assert.equal(second.status, 201); await checkRates(300);
  await f.request(`/api/provider/81/services/${second.data.service.id}`, 'PATCH', { is_active: false }, f.providerToken);
  await checkRates(725.5);
  const matrix = { ...pricing.defaults({ title: 'General House Cleaning' }), mode: 'house_matrix', duration: '3 hours' };
  const matrixResult = await f.request(`/api/provider/81/services/${serviceId}`, 'PATCH', { title: 'General House Cleaning', category: 'Cleaning Services', pricing_config: matrix }, f.providerToken);
  assert.equal(matrixResult.status, 200); await checkRates(550);
  await f.request(`/api/provider/81/services/${serviceId}`, 'PATCH', { title: 'Appliance repair', category: 'Repair Services', pricing_config: config }, f.providerToken);
  await checkRates(500);

  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const customer = (await f.request('/api/auth/customer/session')).data.user;
  await context.addInitScript(user => localStorage.setItem('sn_customer_user', JSON.stringify(user)), customer);
  await context.route('**/*', route => new URL(route.request().url()).origin === f.base ? route.continue() : route.fulfill({ body: '', contentType: 'text/css' }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [390, 1440]) {
   await page.setViewportSize({ width, height: 900 });
   await page.goto(f.base + '/pages/customer/provider-profile/provider-profile.html?id=81');
   await page.locator('.sn-rate-card strong').filter({ hasText: 'PHP 500' }).waitFor();
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
   await page.screenshot({ path: path.join(os.tmpdir(), `starting-rate-${width}.png`) });
  }
  for (const [route, selector] of [
   ['favorites/favorites.html', '.sn-fav-price'], ['search/search.html', '.sn-result-price'], ['dashboard/dashboard.html', '.sn-provider-price'],
  ]) {
   await page.goto(`${f.base}/pages/customer/${route}`);
   await page.locator(selector).filter({ hasText: 'PHP 500' }).first().waitFor();
  }
  await update({ ...config, min: 725.5 });
  await page.goto(f.base + '/pages/customer/provider-profile/provider-profile.html?id=81');
  await page.locator('.sn-rate-card strong').filter({ hasText: 'PHP 725.5' }).waitFor();
  await f.request(`/api/provider/81/services/${serviceId}`, 'PATCH', { is_active: false }, f.providerToken);
  await checkRates(null);
  await page.reload(); await page.locator('.sn-rate-card strong').filter({ hasText: 'Price not set' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: saved minimum, updates, inactive/unpriced services, multiple services, matrix pricing, all customer API displays, mobile/desktop profile, and no-price state.');
 } finally { await browser?.close(); await f.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
