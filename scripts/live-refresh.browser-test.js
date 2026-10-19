'use strict';

// All APIs are intercepted fixtures. No account changes or payments are made.
const { chromium } = require('playwright');
const express = require('express');
const assert = require('node:assert/strict');
const path = require('node:path');

const customer = { id: 61, full_name: 'Customer Test', email: 'customer@example.test', address: 'Angeles City', verification_status: 'verified', is_verified: true, auth_token: 'b'.repeat(64) };
const provider = { id: 81, full_name: 'Provider Test', email: 'provider@example.test', address: 'Angeles City', category: 'Cleaning', service: 'General House Cleaning', verification_status: 'verified', is_verified: true, auth_token: 'a'.repeat(64) };
const booking = { id: 1, customer_id: 61, provider_id: 81, customer_name: customer.full_name, provider_name: provider.full_name, provider_category: 'Cleaning', service: 'General House Cleaning', scheduled_date: '2027-01-15', scheduled_time: '09:00', address: 'Angeles City', amount: 1000, status: 'pending', deposit_channel: 'provider_qr', deposit_status: 'awaiting_payment', deposit_required: true, confirmed_price: 1000, deposit_amount: 300, balance_due: 700, price_version: 1, customer_agreed_at: '2026-10-01', service_details: {} };
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=', 'base64');
function fixture() {
  return {
    customer: { ...customer }, provider: { ...provider }, providers: [{ ...provider, starting_price: 500 }],
    bookings: [{ ...booking }, { ...booking, id: 2, status: 'completed', deposit_status: 'paid' }, { ...booking, id: 3, status: 'cancelled', deposit_status: 'cancelled' }],
    favorites: [{ ...provider }], reviews: [], messages: [], conversations: [], categories: [],
    availability: [{ id: 1, available_date: '2027-01-15', start_time: '09:00', end_time: '10:00', is_available: true }],
    services: [{ id: 1, title: 'General House Cleaning', category: 'Cleaning', starting_price: 500, is_active: true, accepts_cash:true, accepts_gcash:true }],
    metrics: { users: 2, providers: 1, pending: 1, open_feedback: 0 }, categoryTrends: [], recentActivity: [],
    feedback: [],
    report: { days:30,sort:'bookings',period:{start:'2026-10-01T00:00:00+08:00',finish:'2026-10-31T00:00:00+08:00'},
      bookings:{total:0,previous_total:0,completed:0,cancelled:0,active:0},revenue:{total_centavos:0,previous_centavos:0,payments:0},
      reviews:{count:0,average:null},trend:[{date:'2026-10-01',bookings:0,completed:0,revenue_centavos:0}],categories:[],providers:[],plans:[] },
    users: [{ ...provider, role: 'provider' }], assessment: { score: 60, badge: 'Basic Verified' },
    payment_qr: { wallet: 'GCash', account_name: provider.full_name, account_number: '09123456789', qr_url: '/uploads/provider-payment-qrs/test.png' },
  };
}

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..')));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [];
  let passed = 0;
  async function scenario(routePath, ready, check) {
    const data = fixture();
    const requests = [];
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    await context.addInitScript(({ customer, provider }) => {
      localStorage.setItem('sn_customer_user', JSON.stringify(customer));
      localStorage.setItem('sn_provider_user', JSON.stringify(provider));
      window.__liveDocumentId = Math.random();
    }, { customer, provider });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.fulfill({ body: '', contentType: url.hostname.includes('fonts') ? 'text/css' : 'application/javascript' });
      if (url.pathname === '/uploads/provider-payment-qrs/test.png') return route.fulfill({ body: image, contentType: 'image/png' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      requests.push(url.pathname);
      if (route.request().method() !== 'GET') return route.fulfill({ status: 405, json: { message: 'Read-only refresh test.' } });
      let response = { ...data, history_bookings: data.bookings, recommendations: data.providers };
      if (url.pathname.startsWith('/api/auth/')) response = { user: url.pathname.includes('/provider/') ? data.provider : data.customer };
      if (url.pathname.endsWith('/payment')) response = { booking: data.bookings[0], recipient: data.payment_qr, checkout_configured: true };
      if (url.pathname.endsWith('/location-map')) response = { providers: [], customer_location: null };
      if (url.pathname === '/api/admin/reports') response = data.report;
      await route.fulfill({ json: response });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${routePath}: ${error.message}`));
    await page.clock.install();
    try {
      await page.goto(`${base}/pages/${routePath}`);
      await page.locator(ready).first().waitFor({ state: 'attached' });
      await page.waitForFunction(() => Boolean(window.snLiveRefresh));
      await page.waitForTimeout(150);
      const documentId = await page.evaluate(() => window.__liveDocumentId);
      const tick = async () => { await page.clock.runFor(3100); await page.waitForTimeout(200); };
      await check(page, data, tick, requests);
      assert.equal(await page.evaluate(() => window.__liveDocumentId), documentId, 'Must not reload the document');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sn_customer_user')).auth_token), customer.auth_token);
      console.log(`PASS ${routePath}`);
      passed++;
    } finally { await context.close(); }
  }

  try {
    await scenario('customer/bookings/bookings.html', '.sn-customer-booking-card', async (page, data, tick, requests) => {
      data.bookings[0].status = 'upcoming';
      await page.mouse.move(200, 200);
      const before = requests.filter(url => url === '/api/customer/61/dashboard').length;
      for (let i = 0; i < 4; i++) {
        await page.clock.runFor(2000);
        await page.mouse.move(200 + i * 10, 220 + i * 10);
      }
      assert.equal(requests.filter(url => url === '/api/customer/61/dashboard').length, before, 'Active user must pause automatic data requests');
      assert.equal(await page.evaluate(() => window.snCustomerBookings[0].status), 'pending');
      await tick();
      assert.equal(await page.evaluate(() => window.snCustomerBookings[0].status), 'upcoming', 'Refresh resumes after three idle seconds');
    });
    await scenario('customer/bookings/bookings.html', '.sn-customer-booking-card', async (page, data, tick, requests) => {
      await page.locator('.sn-filter-tab[data-filter="upcoming"]').click();
      data.bookings[0].status = 'upcoming'; data.bookings[0].deposit_status = 'paid';
      const before = requests.filter(url => url === '/api/customer/61/dashboard').length;
      await tick();
      assert.equal(await page.evaluate(() => window.snCustomerBookings[0].status), 'upcoming');
      assert.equal(await page.locator('.sn-filter-tab.active').getAttribute('data-filter'), 'upcoming');
      assert.equal(requests.filter(url => url === '/api/customer/61/dashboard').length - before, 1);
    });
    await scenario('customer/bookings/bookings.html', '.sn-customer-booking-card', async (page, data, tick) => {
      await page.evaluate(() => showBookingPayment(1));
      const reference = page.locator('[name="reference_number"]');
      await reference.fill('DRAFT-REFERENCE');
      await page.locator('[name="receipt"]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: image });
      await tick();
      assert.equal(await reference.inputValue(), 'DRAFT-REFERENCE');
      assert.equal(await page.locator('[name="receipt"]').evaluate(input => input.files[0].name), 'receipt.png');
      data.bookings[0].deposit_status = 'paid'; data.bookings[0].status = 'upcoming';
      await tick();
      assert.match(await page.locator('.sn-downpayment-message').textContent(), /schedule is confirmed/i);
      await page.locator('.sn-downpayment-modal .sn-modal-close').click();
    });
    await scenario('customer/bookings/bookings.html?provider_id=81', '#sn-create-booking-form', async (page, data, tick) => {
      await page.locator('#sn-booking-date').fill('2027-01-15');
      await page.locator('#sn-booking-date').dispatchEvent('change');
      await page.waitForTimeout(100);
      await page.locator('#sn-create-booking-form [name="address"]').fill('Unsaved booking address');
      data.availability.push({ id: 2, available_date: '2027-01-15', start_time: '11:00', end_time: '12:00', is_available: true });
      await page.locator('#sn-booking-date').focus(); await tick();
      assert.equal(await page.locator('#sn-booking-time option').count(), 2);
      assert.equal(await page.locator('#sn-booking-time').inputValue(), '09:00');
      assert.equal(await page.locator('#sn-create-booking-form [name="address"]').inputValue(), 'Unsaved booking address');
    });
    await scenario('customer/dashboard/dashboard.html', '.sn-provider-card', async (page, data, tick) => {
      await page.locator('.sn-cat[data-category="Cleaning"]').click();
      data.providers[0].full_name = 'Updated Cleaning Provider';
      await tick();
      assert.match(await page.locator('.sn-providers-grid').textContent(), /Updated Cleaning Provider/);
      assert.equal(await page.locator('.sn-cat.active').getAttribute('data-category'), 'Cleaning');
    });
    await scenario('customer/favorites/favorites.html', '.sn-fav-card', async (page, data, tick) => {
      data.favorites.push({ ...provider, id: 82, full_name: 'New Favorite' });
      await tick(); assert.equal(await page.locator('.sn-fav-card').count(), 2);
    });
    await scenario('customer/reviews/reviews.html', '[data-review-booking]', async (page, data, tick) => {
      await page.locator('[data-review-booking]').first().click();
      await page.locator('#sn-review-comment').fill('Unsaved review');
      data.bookings.push({ ...booking, id: 4, status: 'completed' });
      await tick(); assert.equal(await page.locator('#sn-review-comment').inputValue(), 'Unsaved review');
      await page.locator('[data-review-cancel]').click(); await tick();
      assert.equal(await page.locator('[data-review-booking]').count(), 2);
    });
    await scenario('customer/history/history.html', '.sn-history-item', async (page, data, tick) => {
      data.bookings.push({ ...booking, id: 4, status: 'completed' });
      await tick(); assert.equal(await page.locator('.sn-history-item').count(), 3);
    });
    await scenario('customer/profile/profile.html', '#sn-edit-toggle', async (page, data, tick) => {
      await page.locator('#sn-edit-toggle').click(); await page.locator('#edit-fullname').fill('Unsaved customer');
      data.customer.full_name = 'Server customer'; data.customer.verification_status = 'rejected';
      await tick();
      assert.equal(await page.locator('#edit-fullname').inputValue(), 'Unsaved customer');
      assert.match(await page.locator('#sn-profile-name').textContent(), /Server customer/);
      assert.match(await page.locator('#sn-user-status').textContent(), /declined/i);
    });
    await scenario('customer/search/search.html', '.sn-result-card', async (page, data, tick) => {
      data.providers[0].full_name = 'New Search Result'; await tick();
      assert.match(await page.locator('.sn-result-name').textContent(), /New Search Result/);
    });
    await scenario('customer/provider-profile/provider-profile.html?id=81', '.sn-profile-summary', async (page, data, tick) => {
      data.provider.full_name = 'New Public Profile'; await tick();
      assert.match(await page.locator('.sn-profile-summary').textContent(), /New Public Profile/);
    });
    await scenario('provider/requests/requests.html', '.sn-booking-request-card', async (page, data, tick) => {
      await page.locator('[data-request-filter="cancelled"]').click();
      data.bookings.push({ ...booking, id: 4, status: 'cancelled' }); await tick();
      assert.equal(await page.locator('[data-request-filter].active').getAttribute('data-request-filter'), 'cancelled');
      assert.equal(await page.locator('.sn-booking-request-card').count(), 2);
    });
    await scenario('provider/schedule/schedule.html', '#sn-provider-availability-form', async (page, data, tick) => {
      await page.locator('#sn-availability-start').fill('13:30');
      data.availability.push({ ...data.availability[0], id: 2, start_time: '11:00' }); await tick();
      assert.equal(await page.locator('#sn-availability-start').inputValue(), '13:30');
      assert.equal(await page.locator('.sn-schedule-slot').count(), 2);
    });
    await scenario('provider/profile/profile.html', '#sn-provider-payment-name', async (page, data, tick) => {
      await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
      await page.locator('#sn-provider-full-name').fill('Unsaved provider');
      await page.locator('#sn-provider-payment-name').fill('Unsaved recipient');
      await page.locator('#sn-provider-payment-qr').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: image });
      data.provider.full_name = 'Server provider'; data.provider.verification_status = 'rejected';
      data.payment_qr.account_name = 'Server QR account'; await tick();
      assert.equal(await page.locator('#sn-provider-full-name').inputValue(), 'Unsaved provider');
      assert.equal(await page.locator('#sn-provider-payment-name').inputValue(), 'Unsaved recipient');
      assert.equal(await page.locator('#sn-provider-payment-qr').evaluate(input => input.files[0].name), 'qr.png');
      assert.match(await page.locator('#sn-user-status').textContent(), /declined/i);
    });
    await scenario('provider/services/services.html', '.sn-provider-service-card', async (page, data, tick) => {
      data.services[0].title = 'Updated Service'; await tick();
      assert.match(await page.locator('.sn-provider-service-card').textContent(), /Updated Service/);
    });
    await scenario('provider/reviews/reviews.html', '.sn-page-grid', async (page, data, tick) => {
      data.reviews.push({ id: 1, rating: 5, customer_name: customer.full_name, comment: 'Fresh feedback' }); await tick();
      assert.match(await page.locator('.sn-page-grid').textContent(), /Fresh feedback/);
    });
    await scenario('provider/history/history.html', '.sn-history-item', async (page, data, tick) => {
      await page.locator('#sn-provider-history-search').fill('House');
      await page.locator('[data-history-id="2"]').click();
      data.bookings.push({ ...booking, id: 4 }); await tick();
      assert.equal(await page.locator('#sn-provider-history-search').inputValue(), 'House');
      assert.equal(await page.locator('.sn-history-item.active').getAttribute('data-history-id'), '2');
      assert.equal(await page.locator('.sn-history-item').count(), 4);
    });
    await scenario('provider/dashboard/dashboard.html', '.stats-grid', async (page, data, tick, requests) => {
      const before = requests.filter(url => url === '/api/provider/81/dashboard').length;
      data.bookings.push({ ...booking, id: 4, status: 'completed' }); await tick();
      assert.equal(requests.filter(url => url === '/api/provider/81/dashboard').length - before, 1, 'Single provider data poll');
      assert.match(await page.locator('.stats-grid').textContent(), /Completed Jobs/);
    });
    await scenario('provider/dashboard/dashboard.html', '.sn-float-root', async (page, data, tick) => {
      await page.evaluate(() => window.snFloatingChat.open(61));
      await page.locator('#sn-float-input').fill('Unsaved chat draft');
      data.messages.push({ id: 1, customer_id: 61, customer_name: customer.full_name, sender_role: 'customer', message: 'New customer message', created_at: '2026-10-12T09:00:00Z', is_read: false });
      await tick();
      assert.equal(await page.locator('#sn-float-input').inputValue(), 'Unsaved chat draft');
      assert.match(await page.locator('.sn-float-chat-body').textContent(), /New customer message/);
    });
    await scenario('admin/dashboard/dashboard.html', '#metric-users', async (page, data, tick) => {
      data.metrics.users = 42; await tick(); assert.equal(await page.locator('#metric-users').textContent(), '42');
    });
    await scenario('admin/categories/categories.html', '#category-list', async (page, data, tick) => {
      await page.locator('#add-category-toggle').click(); await page.locator('#category-name').fill('Unsaved category');
      data.categories.push({ id: 1, name: 'New category', services: [], is_active: true, provider_count: 1 }); await tick();
      assert.match(await page.locator('#category-list').textContent(), /New category/);
      assert.equal(await page.locator('#category-name').inputValue(), 'Unsaved category');
    });
    await scenario('admin/provider-verification/provider-verification.html', '#provider-list', async (page, data, tick) => {
      data.providers.push({ ...provider, id: 82, full_name: 'New Registration' }); await tick();
      assert.match(await page.locator('#provider-list').textContent(), /New Registration/);
    });
    await scenario('admin/feedback/feedback.html', '#feedback-list', async (page, data, tick) => {
      data.feedback.push({ id: 1, source:'system',rating:4,user_role:'customer',subject: 'New support request', submitted_by: customer.full_name, message: 'Example', status: 'open' }); await tick();
      assert.match(await page.locator('#feedback-list').textContent(), /New support request/);
    });
    await scenario('admin/reports/reports.html', '#top-providers', async (page, data, tick) => {
      data.report.providers.push({ id:81,full_name: 'Fresh report provider',bookings:1,completed:0,rating:4,reviews:1 }); await tick();
      assert.match(await page.locator('#top-providers').textContent(), /Fresh report provider/);
      await page.locator('#booking-chart button').first().focus();
      data.report.providers[0].full_name='Updated report provider'; await tick();
      assert.match(await page.locator('#top-providers').textContent(), /Fresh report provider/);
      await page.evaluate(()=>document.activeElement.blur()); await tick();
      assert.match(await page.locator('#top-providers').textContent(), /Updated report provider/);
    });
    await scenario('admin/user-management/user-management.html', '#pending-table-body', async (page, data, tick) => {
      data.users.push({ ...customer, role: 'customer', verification_status: 'pending' }); await tick();
      assert.match(await page.locator('#pending-table-body').textContent(), /Customer Test/);
    });
    assert.deepEqual(errors, []);
    console.log(`${passed} live-refresh browser scenarios passed; no page reloads, lost sessions, or JavaScript errors.`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
