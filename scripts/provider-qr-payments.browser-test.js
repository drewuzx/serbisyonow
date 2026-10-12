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
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const booking = await f.createBooking();
  const errors = [];
  async function accountPage(role, token) {
   const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
   await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === f.base || url.protocol === 'blob:') return route.continue();
    return route.fulfill({ body: '', contentType: url.pathname.endsWith('.css') || url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'application/javascript' });
   });
   const user = (await f.request(`/api/auth/${role}/session`, 'GET', undefined, token)).data.user;
   await context.addInitScript(({ role, user }) => localStorage.setItem(`sn_${role}_user`, JSON.stringify(user)), { role, user });
   const page = await context.newPage();
   page.on('pageerror', error => errors.push(`${role}: ${error.message}`));
   return page;
  }
  const provider = await accountPage('provider', f.providerToken);
  const customer = await accountPage('customer', f.customerToken);
  const imageFile = { name: 'fixture-payment.png', mimeType: 'image/png', buffer: f.image };
  async function imageLoaded(locator) {
   await locator.waitFor({ state: 'visible' });
   await locator.evaluate(img => img.complete && img.naturalWidth > 0 || new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; }));
   assert.ok(await locator.evaluate(img => img.naturalWidth > 0));
  }
  async function screenshots(page, label, dialog) {
   for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} overflow at ${width}`);
    if (dialog) {
     assert.ok(await dialog.evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= -1 && box.right <= innerWidth + 1; }), `${label} dialog width`);
     for (const button of await dialog.locator('button:visible').all()) {
      assert.ok(await button.evaluate(node => node.scrollWidth <= node.clientWidth + 2), `${label} button text clipping`);
     }
    }
    await page.screenshot({ path: path.join(os.tmpdir(), `provider-qr-${label}-${width}.png`), fullPage: true });
   }
   await page.setViewportSize({ width: 1440, height: 1000 });
  }

  await provider.goto(`${f.base}/pages/provider/profile/profile.html`);
  const profileForm = provider.locator('#sn-provider-payment-form');
  await profileForm.getByRole('button', { name: 'Save Payment QR' }).waitFor();
  await provider.getByLabel('Account name', { exact: true }).fill('QR Test Provider');
  await provider.getByLabel('Account / mobile number').fill('09123456789');
  await provider.getByLabel('Receiving QR image').setInputFiles(imageFile);
  await profileForm.getByRole('checkbox').check();
  await profileForm.getByRole('button', { name: 'Save Payment QR' }).click();
  await provider.getByRole('status').filter({ hasText: 'Payments already started' }).waitFor();
  await imageLoaded(profileForm.locator('img'));
  await screenshots(provider, 'profile');

  await provider.goto(`${f.base}/pages/provider/requests/requests.html`);
  const card = provider.locator(`[data-booking-card="${booking.id}"]`);
  await card.getByRole('button', { name: 'Confirm Price' }).click();
  const priceDialog = provider.locator('.sn-price-dialog');
  await priceDialog.locator('[name="price"]').fill('1000');
  await priceDialog.getByRole('button', { name: 'Request Downpayment' }).click();
  await priceDialog.waitFor({ state: 'detached' });

  await customer.goto(`${f.base}/pages/customer/bookings/bookings.html`);
  await customer.getByRole('link', { name: 'Review & Pay 30%' }).click();
  const payment = customer.locator('.sn-downpayment-modal');
  await payment.getByRole('checkbox').check();
  await payment.getByRole('button', { name: 'Show Provider QR' }).click();
  await imageLoaded(payment.locator('.sn-payment-qr-image'));
  await screenshots(customer, 'customer-qr', payment);
  await customer.setViewportSize({ width: 390, height: 850 });
  async function submitProof() {
   await payment.locator('[name="reference_number"]').fill('BROWSER-TEST-REF');
   await payment.locator('[name="receipt"]').setInputFiles(imageFile);
   await payment.getByRole('button', { name: 'Submit Payment Receipt' }).click();
   await payment.getByRole('status').filter({ hasText: 'Receipt submitted' }).waitFor();
   await imageLoaded(payment.locator('[data-payment-receipt-image]'));
  }
  await submitProof();
  assert.equal((await f.db.query('SELECT status FROM customer_bookings WHERE id = $1', [booking.id])).rows[0].status, 'pending');
  await screenshots(customer, 'customer-pending', payment);

  await provider.reload();
  await card.getByRole('button', { name: 'Review Payment' }).click();
  const review = provider.locator('.sn-direct-review-dialog');
  await imageLoaded(review.locator('[data-payment-receipt-image]'));
  assert.equal(await review.getByRole('button', { name: 'Confirm Payment' }).isDisabled(), true);
  await review.getByRole('button', { name: 'Reject Receipt' }).click();
  await review.getByRole('status').filter({ hasText: 'Add a reason' }).waitFor();
  await review.locator('[name="notes"]').fill('Reference is not visible. Resubmit proof; do not pay again.');
  await review.getByRole('button', { name: 'Reject Receipt' }).click();
  await review.waitFor({ state: 'detached' });
  await payment.getByRole('button', { name: 'Refresh Status' }).click();
  await payment.getByRole('status').filter({ hasText: 'Payment was not verified' }).waitFor();
  await screenshots(customer, 'customer-rejected', payment);
  await submitProof();

  await provider.reload();
  await card.getByRole('button', { name: 'Review Payment' }).click();
  await imageLoaded(review.locator('[data-payment-receipt-image]'));
  await screenshots(provider, 'provider-review', review);
  await provider.setViewportSize({ width: 320, height: 850 });
  await review.getByRole('checkbox').check();
  await review.getByRole('button', { name: 'Confirm Payment' }).click();
  await review.waitFor({ state: 'detached' });
  await card.getByRole('button', { name: 'Start Service' }).waitFor();
  await payment.getByRole('button', { name: 'Refresh Status' }).click();
  await payment.getByRole('status').filter({ hasText: 'schedule is confirmed' }).waitFor();
  await screenshots(customer, 'customer-verified', payment);
  assert.equal((await f.db.query('SELECT status FROM customer_bookings WHERE id = $1', [booking.id])).rows[0].status, 'upcoming');
  assert.deepEqual(errors, []);
  console.log('Direct provider QR browser flow passed: saved QR, customer consent, private receipt, rejection/resubmission, verified-only Upcoming, and 1440/390/320px screenshots. No real payments or real accounts used.');
 } finally { if (browser) await browser.close(); await f.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
