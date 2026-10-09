'use strict';
// All finance APIs and checkout pages are fixtures; no real payments or records are touched.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const base = process.env.TEST_BASE_URL || 'http://localhost:3003';

(async () => {
 const browser = await chromium.launch({ headless: true, channel: 'msedge' });
 try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await context.route('https://unpkg.com/**', route => route.fulfill({ body: '', contentType: route.request().url().endsWith('.css') ? 'text/css' : 'application/javascript' }));
  await context.route('https://checkout.paymongo.com/**', route => route.fulfill({ body: '<h1>Fixture e-wallet checkout</h1>', contentType: 'text/html' }));
  const customer = { id: 61, full_name: 'Test Customer', is_verified: true, verification_status: 'verified', auth_token: 'b'.repeat(64) };
  const provider = { id: 81, full_name: 'Test Provider', is_verified: true, verification_status: 'verified', auth_token: 'a'.repeat(64) };
  const booking = { id: 1, customer_id: 61, provider_id: 81, customer_name: customer.full_name, provider_name: provider.full_name, service: 'Plumbing Services', address: 'Test Street, Angeles City', scheduled_date: '2026-10-10', scheduled_time: '10:00 AM', status: 'pending', amount: 500,
   deposit_required: true, deposit_status: 'awaiting_price', confirmed_price: null, price_version: 0, customer_agreed_at: null, service_details: {} };
  const errors = [];
  const requests = [];
  let checkoutConfigured = false;
  let checkoutFail = true;
  let priceFail = true;
  await context.addInitScript(({ customer, provider }) => {
   localStorage.setItem('sn_customer_user', JSON.stringify(customer));
   localStorage.setItem('sn_provider_user', JSON.stringify(provider));
  }, { customer, provider });
  await context.route('**/api/**', async route => {
   const req = route.request(); const url = new URL(req.url());
   let data = { messages: [], conversations: [], notifications: [], categories: [], providers: [] };
   if (url.pathname.endsWith('/price')) {
    assert.equal(req.headers().authorization, `Bearer ${provider.auth_token}`);
    if (priceFail) { priceFail = false; return route.fulfill({ status: 409, json: { message: 'Test price conflict. Please review and retry.' } }); }
    const body = req.postDataJSON(); requests.push({ type: 'price', body });
    const total = Math.round(Number(body.price) * 100); const deposit = Math.round(total * 0.3);
    Object.assign(booking, { confirmed_price: total / 100, amount: total / 100, deposit_amount: deposit / 100, balance_due: (total - deposit) / 100, price_notes: body.notes, price_version: booking.price_version + 1, deposit_status: 'awaiting_payment' });
    data = { booking };
   } else if (url.pathname.endsWith('/payment')) {
    assert.equal(req.headers().authorization, `Bearer ${customer.auth_token}`);
    data = { booking, checkout_configured: checkoutConfigured, livemode: false };
   } else if (url.pathname.endsWith('/checkout')) {
    assert.equal(req.headers().authorization, `Bearer ${customer.auth_token}`);
    if (checkoutFail) { checkoutFail = false; return route.fulfill({ status: 503, json: { message: 'Test gateway unavailable. Try again.' } }); }
    requests.push({ type: 'checkout', body: req.postDataJSON() });
    booking.customer_agreed_at = 'now';
    data = { checkout_url: 'https://checkout.paymongo.com/cs_fixture', livemode: false };
   } else if (url.pathname.endsWith('/track')) data = { booking };
   else if (url.pathname.includes('/auth/customer/status/')) data = { user: customer };
   else if (url.pathname.includes('/auth/provider/status/')) data = { user: provider };
   else if (url.pathname.includes('/customer/') && url.pathname.endsWith('/dashboard')) data = { customer, bookings: [booking], favorites: [], reviews: [], messages: [] };
   else if (url.pathname.includes('/provider/') && url.pathname.endsWith('/dashboard')) data = { provider, bookings: [booking], history_bookings: [booking], services: [], reviews: [], messages: [], availability: [] };
   await route.fulfill({ json: data });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.stack));
  async function layout(label, modalSelector) {
   for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.waitForTimeout(300);
    const modal = page.locator(modalSelector);
    assert.equal(await modal.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `${label} modal does not overflow at ${width}`);
    assert.equal(await modal.locator('button, h2, h3, dt, dd').evaluateAll(elements => elements.some(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1)), false, `${label} controls and text fit at ${width}`);
    assert.equal(await modal.evaluate(element => {
     const rect = element.getBoundingClientRect();
     return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, `${label} stays above the mobile sidebar`);
    await page.screenshot({ path: path.join(os.tmpdir(), `downpayment-${label}-${width}.png`), fullPage: true, animations: 'disabled' });
   }
  }
  await page.goto(`${base}/pages/provider/requests/requests.html`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-booking-card="1"]');
  await card.waitFor();
  assert.equal(await card.locator('[data-status="upcoming"]').count(), 0, 'no unpaid Accept shortcut');
  await card.locator('[data-confirm-price]').click();
  await page.locator('.sn-price-dialog [name="price"]').fill('333.35');
  await page.locator('.sn-price-dialog [name="notes"]').fill('Repair labor and listed materials included');
  assert.match(await page.locator('.sn-price-preview').textContent(), /100\.01.*233\.34/);
  await layout('provider-price', '.sn-price-dialog .sn-modal');
  await page.locator('.sn-price-dialog [type="submit"]').click();
  await page.getByRole('alert').filter({ hasText: 'Test price conflict' }).waitFor();
  assert.equal(await page.locator('.sn-price-dialog').count(), 1, 'failed price save stays open');
  await page.locator('.sn-price-dialog [type="submit"]').click();
  await page.locator('.sn-price-dialog').waitFor({ state: 'detached' });
  await card.getByText('Waiting for 30% downpayment', { exact: true }).waitFor();
  assert.equal(booking.status, 'pending');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/pages/customer/bookings/bookings.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-booking-action="pay"]').click();
  const pay = page.locator('[data-payment-pay]');
  await page.getByRole('status').filter({ hasText: 'not configured' }).waitFor();
  await page.locator('[data-payment-consent]').check();
  assert.equal(await pay.isDisabled(), true, 'missing keys cannot open checkout');
  checkoutConfigured = true;
  await page.locator('[data-payment-refresh]').click();
  await page.getByRole('status').filter({ hasText: 'test checkout' }).waitFor();
  assert.equal(await pay.isDisabled(), true, 'explicit consent required after refreshed price');
  await layout('customer-payment', '.sn-downpayment-modal .sn-modal-card');
  await page.locator('[data-payment-consent]').check();
  await pay.click();
  await page.getByRole('status').filter({ hasText: 'Test gateway unavailable' }).waitFor();
  assert.equal(booking.status, 'pending');
  await pay.click();
  await page.waitForURL('https://checkout.paymongo.com/cs_fixture');
  assert.equal(booking.status, 'pending', 'opening checkout is not payment');
  assert.deepEqual(requests.find(item => item.type === 'checkout').body, { accept_price: true, price_version: 1 });
  await page.goto(`${base}/pages/customer/bookings/bookings.html?payment_return=success&booking_id=1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('status').filter({ hasText: 'Waiting for PayMongo payment verification' }).waitFor();
  assert.equal(booking.status, 'pending', 'success return cannot settle payment');
  Object.assign(booking, { status: 'upcoming', deposit_status: 'paid', deposit_paid_at: 'now', deposit_livemode: false });
  await page.locator('[data-payment-refresh]').click();
  await page.getByRole('status').filter({ hasText: 'Test downpayment verified' }).waitFor();
  assert.equal(await pay.isVisible(), false, 'paid booking cannot pay again');
  await page.locator('.sn-downpayment-modal .sn-modal-close').click();
  await page.locator('.sn-booking-group[data-status="upcoming"]').waitFor();
  assert.equal(await page.locator('[data-booking-action="pay"]').count(), 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/pages/provider/requests/requests.html`, { waitUntil: 'domcontentloaded' });
  await card.locator('[data-status="ongoing"]').waitFor();
  assert.equal(await card.locator('[data-confirm-price]').count(), 0);
  await page.screenshot({ path: path.join(os.tmpdir(), 'downpayment-provider-paid-1440.png'), fullPage: true });
  Object.assign(booking, { status: 'cancelled', deposit_status: 'refund_review' });
  await page.goto(`${base}/pages/customer/bookings/bookings.html?pay_booking_id=1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('status').filter({ hasText: 'refund review' }).waitFor();
  assert.equal(await pay.isVisible(), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sn-downpayment-modal').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Downpayment browser flow passed: provider price, customer consent, missing keys, retry, verified-only confirmation, refund review, and desktop/390/320px screenshots. All payments mocked.');
  await context.close();
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
