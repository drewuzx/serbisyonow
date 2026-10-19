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
  await f.db.query('UPDATE provider_services SET is_active=FALSE WHERE provider_id=81');
  const { rows: [service] } = await f.db.query("INSERT INTO provider_services(provider_id,title,category,description,starting_price,max_price,accepts_cash,accepts_gcash) VALUES(81,'Nail Care','Personal Care','Manicure and pedicure',450,1500,TRUE,FALSE) RETURNING *");
  const provider = (await f.request('/api/auth/provider/session', 'GET', undefined, f.providerToken)).data.user;
  const customer = (await f.request('/api/auth/customer/session', 'GET', undefined, f.customerToken)).data.user;
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === f.base ? route.continue() : route.fulfill({ body: '', contentType: route.request().url().includes('fonts.googleapis.com') ? 'text/css' : 'application/javascript' }));
  await context.addInitScript(({ provider, customer }) => {
   localStorage.setItem('sn_provider_user', JSON.stringify(provider));
   localStorage.setItem('sn_customer_user', JSON.stringify(customer));
  }, { provider, customer });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `${f.base}/pages/provider/services/services.html`;
  await page.goto(url);
  const card = page.locator(`[data-service-id="${service.id}"]`);
  const toggle = card.getByRole('switch');
  await toggle.waitFor();
  assert.equal(await card.getByLabel('Other', { exact: true }).count(), 0);
  assert.equal(await card.getByLabel('QR', { exact: true }).isChecked(), false);
  await toggle.click();
  await card.getByRole('status').filter({ hasText: 'Service is off.' }).waitFor();
  assert.equal(await toggle.isChecked(), false);
  await page.reload();
  await toggle.waitFor();
  assert.equal(await toggle.isChecked(), false);
  await page.goto(`${f.base}/pages/customer/bookings/bookings.html?provider_id=81`);
  await page.getByText('No services available', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('#sn-create-booking-form [type=submit]').isDisabled(), true);
  await page.goto(url);
  await toggle.focus();
  await toggle.press('Space');
  await card.getByRole('status').filter({ hasText: 'Service is on.' }).waitFor();
  await card.getByLabel('QR', { exact: true }).check();
  await card.getByRole('status').filter({ hasText: 'Payment options saved.' }).waitFor();
  await card.getByLabel('Cash', { exact: true }).uncheck();
  await card.getByRole('status').filter({ hasText: 'Payment options saved.' }).waitFor();
  await page.reload();
  await toggle.waitFor();
  assert.equal(await card.getByLabel('QR', { exact: true }).isChecked(), true);
  assert.equal(await card.getByLabel('Cash', { exact: true }).isChecked(), false);
  // Failed saves roll the switch back without claiming the new state was saved.
  await page.route(`**/api/provider/81/services/${service.id}`, route => route.fulfill({ status: 503, json: { message: 'Test connection interrupted.' } }));
  await toggle.click();
  await page.getByText('Test connection interrupted.', { exact: true }).waitFor();
  assert.equal(await toggle.isChecked(), true);
  await page.locator('[data-modal-confirm]').click();
  await page.unroute(`**/api/provider/81/services/${service.id}`);
  // Keep the in-flight setting intact while background data arrives.
  let finish;
  await page.route(`**/api/provider/81/services/${service.id}`, async route => {
   await new Promise(resolve => { finish = resolve; });
   await route.continue();
  });
  await card.getByLabel('Cash', { exact: true }).check();
  await page.waitForFunction(() => document.querySelector('[aria-busy="true"]'));
  await page.evaluate(() => loadProviderDatabase({ background: true }));
  assert.equal(await card.getByLabel('Cash', { exact: true }).isChecked(), true);
  assert.equal(await toggle.isDisabled(), true);
  finish();
  await card.getByRole('status').filter({ hasText: 'Payment options saved.' }).waitFor();
  await page.unroute(`**/api/provider/81/services/${service.id}`);
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: 1000 });
   if (width < 768 && await page.locator('.sn-shell').evaluate(node => node.classList.contains('sidebar-open'))) await page.locator('#sn-hamburger').click();
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow at ${width}`);
   await card.scrollIntoViewIfNeeded();
   await page.screenshot({ path: path.join(os.tmpdir(), `service-options-${width}.png`), fullPage: true });
  }
  await page.goto(`${f.base}/pages/customer/bookings/bookings.html?provider_id=81`);
  await page.locator('#sn-booking-service').selectOption('Nail Care');
  assert.deepEqual(await page.locator('#sn-booking-payment option').allTextContents(), ['Cash', 'QR']);
  await page.locator('#sn-booking-payment').selectOption('gcash');
  assert.match(await page.locator('#sn-booking-payment-note').textContent(), /provider's QR/);
  await f.request(`/api/provider/81/services/${service.id}`, 'PATCH', { accepts_cash: false }, f.providerToken);
  await page.reload();
  await page.locator('#sn-booking-service').selectOption('Nail Care');
  assert.deepEqual(await page.locator('#sn-booking-payment option').allTextContents(), ['QR']);
  await f.request(`/api/provider/81/services/${service.id}`, 'PATCH', { accepts_cash: true, accepts_gcash: false }, f.providerToken);
  await page.reload();
  await page.locator('#sn-booking-service').selectOption('Nail Care');
  assert.deepEqual(await page.locator('#sn-booking-payment option').allTextContents(), ['Cash']);
  // A verified QR deposit keeps the recipient QR accessible for the remaining balance.
  const booking = await f.createBooking({ payment_method: 'gcash' });
  assert.equal((await f.request('/api/provider/81/payment-qr', 'PUT', f.qrForm(), f.providerToken)).status, 200);
  assert.equal((await f.request(`/api/provider/81/bookings/${booking.id}/price`, 'PATCH', { price: 1000, price_version: 0 }, f.providerToken)).status, 200);
  assert.equal((await f.request(`/api/customer/61/bookings/${booking.id}/direct-payment`, 'POST', { accept_price: true, price_version: 1 })).status, 200);
  const proof = await f.request(`/api/customer/61/bookings/${booking.id}/direct-payment/receipt`, 'POST', f.receiptForm(1));
  assert.equal(proof.status, 201);
  assert.equal((await f.request(`/api/provider/81/bookings/${booking.id}/direct-payment`, 'PATCH', { decision: 'verify', receipt_id: proof.data.receipt.id, price_version: 1, payment_received: true }, f.providerToken)).status, 200);
  const paymentUrl = `${f.base}/pages/customer/bookings/bookings.html?pay_booking_id=${booking.id}`;
  await page.goto(paymentUrl);
  await page.getByRole('heading', { name: 'Remaining Balance - QR' }).waitFor();
  assert.match(await page.locator('.sn-direct-balance').textContent(), /700/);
  assert.equal(await page.locator('.sn-direct-receipt-form').count(), 0, 'Balance QR must not reuse the deposit receipt submission');
  await page.waitForFunction(() => document.querySelector('.sn-direct-balance img')?.naturalWidth > 0);
  await f.db.query("UPDATE customer_bookings SET payment_method='cash' WHERE id=$1", [booking.id]);
  await page.goto(paymentUrl);
  await page.locator('.sn-direct-recipient').waitFor();
  assert.equal(await page.locator('.sn-direct-balance').count(), 0);
  await f.db.query("UPDATE customer_bookings SET payment_method='gcash',status='cancelled' WHERE id=$1", [booking.id]);
  await page.goto(paymentUrl);
  await page.locator('.sn-direct-recipient').waitFor();
  assert.equal(await page.locator('.sn-direct-balance').count(), 0, 'Cancelled bookings must not solicit another payment');
  assert.deepEqual(errors, []);
  console.log('Service options browser checks passed: switch click/keyboard, reload, Cash/QR choices, no-service state, failure rollback, idle save protection, desktop/mobile layouts.');
 } finally { if (browser) await browser.close(); await f.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
