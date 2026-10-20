'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const f = await startQrFixture(); let browser;
 try {
  const customer = (await f.request('/api/auth/customer/session')).data.user;
  const provider = (await f.request('/api/auth/provider/session', 'GET', null, f.providerToken)).data.user;
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ serviceWorkers: 'block', hasTouch: true });
  await context.addInitScript(({ customer, provider }) => {
   localStorage.setItem('sn_customer_user', JSON.stringify(customer));
   localStorage.setItem('sn_provider_user', JSON.stringify(provider));
  }, { customer, provider });
  await context.route('**/*', route => new URL(route.request().url()).origin === f.base ? route.continue() : route.fulfill({ body: '', contentType: 'text/css' }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const role of ['customer', 'provider']) {
   for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${f.base}/pages/${role}/dashboard/dashboard.html`);
    const link = page.getByRole('link', { name: 'My profile', exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), `/pages/${role}/profile/profile.html`);
    assert.equal(await link.getAttribute('aria-hidden'), null);
    const box = await link.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
    if (width === 390) await link.tap(); else { await link.focus(); await page.keyboard.press('Enter'); }
    await page.waitForURL(`**/pages/${role}/profile/profile.html`);
    await page.locator('#sn-photo-open').waitFor();
    assert.equal(await page.getByRole('link', { name: 'My profile', exact: true }).count(), 1);
   }
  }
  // A provider's public profile must still link the customer back to their own account.
  await page.goto(`${f.base}/pages/customer/provider-profile/provider-profile.html?id=81`);
  await page.getByRole('link', { name: 'My profile', exact: true }).click();
  await page.waitForURL('**/pages/customer/profile/profile.html');
  assert.deepEqual(errors, []);
  console.log('PASS: customer/provider profile links, touch, keyboard, desktop/mobile hit targets, and correct role with both accounts stored.');
 } finally { await browser?.close(); await f.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
