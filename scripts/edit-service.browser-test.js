'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const f = await startQrFixture();
 let browser;
 try {
  const created = await f.request('/api/provider/81/services', 'POST', {
   title: 'Appliance repair', description: 'Original description', category: 'Repair Services',
   starting_price: 500, max_price: 2000, accepts_cash: true, accepts_gcash: true,
  }, f.providerToken);
  assert.equal(created.status, 201);
  const service = created.data.service;
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === f.base ? route.continue() : route.fulfill({ body: '', contentType: route.request().url().includes('fonts.googleapis.com') ? 'text/css' : 'application/javascript' }));
  const provider = (await f.request('/api/auth/provider/session', 'GET', undefined, f.providerToken)).data.user;
  await context.addInitScript(provider => localStorage.setItem('sn_provider_user', JSON.stringify(provider)), provider);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${f.base}/pages/provider/services/services.html`);
  const card = page.locator(`[data-service-id="${service.id}"]`);
  await card.waitFor();
  const originalCount = Number((await f.db.query('SELECT count(*) FROM provider_services WHERE provider_id=81')).rows[0].count);
  const edit = () => card.getByRole('button', { name: 'Edit Service', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const next = () => dialog.getByRole('button', { name: 'Next', exact: true }).click();
  const noOverflow = async width => {
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow at ${width}`);
   for (const button of await page.locator('#sn-price-editor button:visible, .sn-service-edit-dialog button:visible').all()) {
    assert.ok(await button.evaluate(node => node.scrollWidth <= node.clientWidth + 2), `clipped button at ${width}`);
   }
  };
  // Dismissing the name step must not send a write.
  let writes = 0;
  page.on('request', request => { if (request.method() === 'PATCH' && request.url().includes(`/services/${service.id}`)) writes++; });
  await edit();
  await dialog.getByLabel('Service name', { exact: true }).fill('Discard this name');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await edit();
  assert.equal(await dialog.getByLabel('Service name', { exact: true }).inputValue(), 'Appliance repair');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(writes, 0);
  await edit();
  await dialog.getByLabel('Service name', { exact: true }).fill('   ');
  await next();
  await dialog.getByRole('alert').filter({ hasText: 'Enter a service name' }).waitFor();
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: 1000 });
   await dialog.getByLabel('Service name', { exact: true }).fill('Appliance repair and maintenance');
   assert.equal(await dialog.getByRole('alert').isVisible(), false);
   await noOverflow(width);
   await page.screenshot({ path: path.join(os.tmpdir(), `edit-service-modal-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await next();
  assert.equal(await page.locator('.sn-price-heading p').innerText(), 'Appliance repair and maintenance');
  assert.equal(await page.getByLabel('Minimum price', { exact: true }).inputValue(), '500');
  await page.getByLabel('Minimum price', { exact: true }).fill('700');
  await page.getByLabel('Maximum price', { exact: true }).fill('600');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Maximum price must be at least' }).waitFor();
  assert.equal(writes, 0);
  await page.getByLabel('Maximum price', { exact: true }).fill('2400');
  await page.getByRole('button', { name: 'Add Another Add-on' }).click();
  await page.getByLabel('Add-on 1 name', { exact: true }).fill('Parts inspection');
  await page.getByLabel('Add-on 1 description', { exact: true }).fill('Includes a written diagnosis.');
  await page.getByLabel('Add-on 1 minimum', { exact: true }).fill('150');
  await page.getByLabel('Add-on 1 maximum', { exact: true }).fill('150');
  await page.getByRole('button', { name: 'Add Another Add-on' }).click();
  await page.getByRole('button', { name: 'Remove add-on 2', exact: true }).click();
  assert.equal(await page.locator('[data-addon]').count(), 1);
  await page.getByLabel('Service area', { exact: true }).fill('Angeles City');
  await page.getByLabel('Typical duration', { exact: true }).selectOption('Half day');
  await page.getByLabel('Special instructions', { exact: true }).fill('Please unplug the appliance.');
  await page.getByRole('button', { name: 'Back to service name', exact: true }).click();
  assert.equal(await dialog.getByLabel('Service name', { exact: true }).inputValue(), 'Appliance repair and maintenance');
  await dialog.getByLabel('Service name', { exact: true }).fill('Appliance inspection and repair');
  await next();
  assert.equal(await page.getByLabel('Minimum price', { exact: true }).inputValue(), '700');
  assert.equal(await page.getByLabel('Add-on 1 description', { exact: true }).inputValue(), 'Includes a written diagnosis.');
  assert.equal(await page.getByLabel('Special instructions', { exact: true }).inputValue(), 'Please unplug the appliance.');
  await page.getByRole('button', { name: 'Provider rates', exact: true }).click();
  await dialog.getByText(/Saved base price/).waitFor();
  assert.match(await dialog.innerText(), /500.*2,000/);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await page.evaluate(() => loadProviderDatabase({ background: true }));
  assert.equal(await page.getByLabel('Minimum price', { exact: true }).inputValue(), '700');
  for (const width of [1440, 1024, 768, 390, 320]) {
   await page.setViewportSize({ width, height: 1000 });
   await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
   await noOverflow(width);
   assert.ok(await page.evaluate(() => document.querySelector('.sn-price-heading').getBoundingClientRect().top >= document.querySelector('.sn-topbar').getBoundingClientRect().bottom), `heading under topbar at ${width}`);
   await page.screenshot({ path: path.join(os.tmpdir(), `edit-service-pricing-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Next', exact: false }).click();
  assert.equal(await page.getByLabel('Add-on 1 description', { exact: true }).inputValue(), 'Includes a written diagnosis.');
  await page.getByRole('button', { name: 'Next', exact: false }).click();
  assert.equal(await page.getByLabel('Typical duration', { exact: true }).inputValue(), 'Half day');
  await page.screenshot({ path: path.join(os.tmpdir(), 'edit-service-settings-mobile.png'), fullPage: true });
  let fail = true;
  await page.route(`**/api/provider/81/services/${service.id}`, route => fail ? route.fulfill({ status: 503, json: { message: 'Test: unable to save.' } }) : route.continue());
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Test: unable to save.' }).waitFor();
  assert.equal(await page.getByLabel('Service area', { exact: true }).inputValue(), 'Angeles City');
  fail = false;
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.getByText('Service changes saved.', { exact: true }).waitFor();
  const rows = (await f.db.query('SELECT * FROM provider_services WHERE provider_id=81')).rows;
  assert.equal(rows.length, originalCount);
  const saved = rows.find(row => row.id === service.id);
  assert.equal(saved.title, 'Appliance inspection and repair');
  assert.equal(saved.description, 'Original description');
  assert.equal(saved.accepts_cash, true);
  assert.equal(saved.accepts_gcash, true);
  assert.equal(saved.pricing_config.addons[0].description, 'Includes a written diagnosis.');
  assert.equal(saved.pricing_config.duration, 'Half day');
  await page.reload();
  await edit();
  assert.equal(await dialog.getByLabel('Service name', { exact: true }).inputValue(), saved.title);
  await next();
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.getByLabel('Minimum price', { exact: true }).inputValue(), '700');
  assert.equal(await page.getByLabel('Add-on 1 description', { exact: true }).inputValue(), 'Includes a written diagnosis.');
  await page.getByLabel('Minimum price', { exact: true }).fill('999');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
  assert.equal(Number((await f.db.query('SELECT starting_price FROM provider_services WHERE id=$1', [service.id])).rows[0].starting_price), 700);
  assert.deepEqual(errors, []);
  console.log('Edit service checks passed: name validation, cancel/close, desktop/mobile, back retention, saved-rate info, add/remove/description, half day, invalid range, retry, reload, no duplicates, unchanged payment options.');
 } finally {
  if (browser) await browser.close();
  await f.close();
 }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
