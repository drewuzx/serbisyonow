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
  const page = await context.newPage(), errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
   if (request.method() === 'PATCH' && request.url().includes(`/services/${service.id}`)) writes.push(request.postDataJSON());
  });
  await page.goto(`${f.base}/pages/provider/services/services.html`);
  const card = page.locator(`[data-service-id="${service.id}"]`);
  await card.waitFor();
  const originalCount = Number((await f.db.query('SELECT count(*) FROM provider_services WHERE provider_id=81')).rows[0].count);
  const edit = () => card.getByRole('button', { name: 'Edit Service', exact: true }).click();
  const form = page.locator('#sn-service-editor');
  const save = () => form.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await edit();
  await form.getByRole('heading', { name: 'Edit Service', exact: true }).waitFor();
  assert.equal(await page.locator('#sn-price-editor').count(), 0);
  assert.equal(await form.getByRole('button', { name: 'Next', exact: true }).count(), 0);
  assert.equal(await form.getByLabel('Service name', { exact: true }).inputValue(), service.title);
  assert.equal(await form.getByLabel('Description', { exact: true }).inputValue(), service.description);
  await form.getByLabel('Service name', { exact: true }).fill('   ');
  await save();
  await form.getByRole('alert').filter({ hasText: 'Enter a service name' }).waitFor();
  assert.equal(writes.length, 0);
  await form.getByLabel('Service name', { exact: true }).fill('Appliance inspection and repair');
  await form.getByLabel('Description', { exact: true }).fill('Includes appliance inspection and maintenance.');
  await form.getByLabel('Category', { exact: true }).selectOption('Others');
  await save();
  await form.getByRole('alert').filter({ hasText: 'Enter a service category' }).waitFor();
  await form.getByLabel('New category name', { exact: true }).fill('Appliance Maintenance');
  // Refreshes cannot replace the editor or its draft.
  await page.evaluate(() => loadProviderDatabase({ background: true }));
  await page.evaluate(() => loadProviderDatabase());
  assert.equal(await form.getByLabel('Service name', { exact: true }).inputValue(), 'Appliance inspection and repair');
  assert.equal(await form.getByLabel('New category name', { exact: true }).inputValue(), 'Appliance Maintenance');
  for (const width of [1440, 1024, 768, 390, 320]) {
   await page.setViewportSize({ width, height: 900 });
   await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow at ${width}`);
   for (const button of await form.locator('button:visible').all()) assert.ok(await button.evaluate(node => node.scrollWidth <= node.clientWidth + 2), `clipped button at ${width}`);
   assert.ok(await page.evaluate(() => document.querySelector('.sn-price-heading').getBoundingClientRect().top >= document.querySelector('.sn-topbar').getBoundingClientRect().bottom), `heading overlaps at ${width}`);
   await page.screenshot({ path: path.join(os.tmpdir(), `service-details-editor-${width}.png`), fullPage: true });
  }
  await form.getByRole('button', { name: 'Back to services', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await form.getByLabel('New category name', { exact: true }).inputValue(), 'Appliance Maintenance');
  let fail = true;
  await page.route(`**/api/provider/81/services/${service.id}`, route => fail ? route.fulfill({ status: 503, json: { message: 'Test: unable to save.' } }) : route.continue());
  await save();
  await form.getByRole('alert').filter({ hasText: 'Test: unable to save.' }).waitFor();
  assert.equal(await form.getByLabel('Description', { exact: true }).inputValue(), 'Includes appliance inspection and maintenance.');
  fail = false;
  await save();
  await page.getByText('Service details saved.', { exact: true }).waitFor();
  assert.equal(await page.locator('#sn-price-editor').count(), 0);
  for (const body of writes) assert.deepEqual(Object.keys(body).sort(), ['category', 'description', 'title']);
  const rows = (await f.db.query('SELECT * FROM provider_services WHERE provider_id=81')).rows;
  assert.equal(rows.length, originalCount);
  const saved = rows.find(row => row.id === service.id);
  assert.equal(saved.title, 'Appliance inspection and repair');
  assert.equal(saved.category, 'Appliance Maintenance');
  assert.equal(saved.accepts_cash, true);
  assert.equal(saved.accepts_gcash, true);
  assert.deepEqual(saved.pricing_config, service.pricing_config);
  assert.equal(Number(saved.starting_price), service.starting_price);
  assert.equal(Number(saved.max_price), service.max_price);
  await page.reload();
  await edit();
  assert.equal(await form.getByLabel('Service name', { exact: true }).inputValue(), saved.title);
  assert.equal(await form.getByLabel('Category', { exact: true }).inputValue(), saved.category);
  await form.getByLabel('Service name', { exact: true }).fill('Discard this change');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click();
  await edit();
  assert.equal(await form.getByLabel('Service name', { exact: true }).inputValue(), saved.title);
  await form.getByRole('button', { name: 'Back to services', exact: true }).click();
  await card.getByRole('button', { name: 'Set Price', exact: true }).click();
  await page.getByRole('heading', { name: 'Set Price', exact: true }).waitFor();
  assert.equal(await page.locator('#sn-service-editor').count(), 0);
  assert.equal(await page.getByLabel('Minimum price', { exact: true }).inputValue(), '500');
  assert.equal(await page.getByLabel('Maximum price', { exact: true }).inputValue(), '2000');
  assert.deepEqual(errors, []);
  console.log('Separate Edit Service passed: direct editor, no Next or pricing redirect, details-only save, validation, custom category, draft retention, retry, reload, discard, five widths, unchanged pricing/payment options and separate Set Price.');
 } finally {
  if (browser) await browser.close();
  await f.close();
 }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
