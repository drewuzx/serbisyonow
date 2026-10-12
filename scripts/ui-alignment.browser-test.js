'use strict';

// API responses are fixtures; layout checks never change accounts or payments.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const base = process.env.TEST_BASE_URL || 'http://localhost:3003';
const baseline = process.env.UI_BASELINE === '1';

const customer = { id: 61, full_name: 'Patricia Anne Dela Cruz', email: 'customer@example.test', address: '109 Purok 1, Barangay Anunas, Angeles City', contact_number: '09123456789', is_verified: true, verification_status: 'verified', auth_token: 'b'.repeat(64) };
const provider = { id: 81, full_name: 'Alexandra Mae Santos', email: 'provider@example.test', category: 'Cleaning', service: 'General House Cleaning', address: 'Barangay Anunas, Angeles City', contact_number: '09123456789', is_verified: true, verification_status: 'verified', auth_token: 'a'.repeat(64) };
const providers = [
 { ...provider, starting_price: 500, rating: 4.9, completed_jobs: 32, available_slots: 3 },
 { ...provider, id: 82, full_name: 'Maria Cristina Villanueva-Santiago', service: 'Deep Cleaning', address: 'Building 12, Saint Joseph Village, Barangay Anunas, Angeles City', starting_price: 1250, rating: 4.8, recommendation_reason: 'Recommended for your selected service and location.', completed_jobs: 18, available_slots: 2 },
 { ...provider, id: 83, full_name: 'Ben Cruz', starting_price: 750, rating: 4.7, completed_jobs: 10, available_slots: 1 },
];
const bookings = ['pending', 'pending', 'upcoming', 'in-progress', 'completed', 'cancelled'].map((status, index) => ({
 id: index + 1, customer_id: customer.id, provider_id: provider.id, customer_name: customer.full_name,
 provider_name: providers[index % providers.length].full_name, provider_category: 'Cleaning', service: index % 2 ? 'Sofa and Upholstery Cleaning' : 'General House Cleaning',
 address: '109 Purok 1, Saint Joseph Village, Barangay Anunas, Angeles City', scheduled_date: '2027-01-15', scheduled_time: '10:30 AM', status, amount: 1500, payment_method: 'cash',
 deposit_required: true, deposit_status: status === 'pending' ? 'awaiting_payment' : status === 'cancelled' ? 'cancelled' : 'paid', confirmed_price: 1500, deposit_amount: 450, balance_due: 1050, price_version: 1,
 service_details: {}, customer_latitude: null, customer_longitude: null,
}));
const services = [
 { id: 1, title: 'General House Cleaning', category: 'Cleaning', starting_price: 500, max_price: 1500, description: 'Regular cleaning for bedrooms, bathrooms, and living areas.', is_active: true },
 { id: 2, title: 'Sofa and Upholstery Cleaning', category: 'Cleaning', starting_price: 1200, max_price: 2500, description: 'Fabric and upholstery cleaning for sofas and recliners.', is_active: true },
];
const reviews = [{ id: 1, booking_id: 5, provider_id: 81, provider_name: provider.full_name, customer_name: customer.full_name, service: 'General House Cleaning', rating: 5, comment: 'Arrived on time and completed the cleaning carefully.', created_at: '2026-10-01' }];
const availability = [{ id: 1, available_date: '2027-01-15', start_time: '09:00', end_time: '17:00', is_available: true }];
const data = { customer, provider, providers, bookings, history_bookings: bookings, recommendations: providers, favorites: providers, reviews, services, availability, metrics: {}, messages: [], conversations: [], notifications: [], categories: [], assessment: { score: 65, passed: false, badge: 'Basic Verified', answers: [] } };

async function inspectLayout(page) {
 return page.evaluate(() => {
  const issues = [];
  const visible = element => {
   const rect = element.getBoundingClientRect();
   const style = getComputedStyle(element);
   return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && rect.right > 0 && rect.left < innerWidth && !element.closest('[hidden]');
  };
  const label = element => `${element.tagName.toLowerCase()}.${String(element.className).trim().replace(/\s+/g, '.')} ${(element.textContent || '').trim().slice(0, 65)}`;
  const actions = [...document.querySelectorAll('.btn, .sn-btn, .sn-provider-action, .sn-filter-action, .sn-filter-tab, .sn-chip, .sn-edit-toggle-btn, .sn-request-filters button')].filter(visible);
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push(`Page overflow: ${document.documentElement.scrollWidth} > ${innerWidth}`);
  for (const element of actions) {
   const rect = element.getBoundingClientRect();
   if (rect.left < -1 || rect.right > innerWidth + 1) issues.push(`Offscreen control: ${label(element)}`);
   if (element.scrollWidth > element.clientWidth + 1) issues.push(`Clipped control text: ${label(element)}`);
   const style = getComputedStyle(element);
   if (style.display !== 'inline-flex' && style.display !== 'flex' && style.display !== 'grid') issues.push(`Uncentered control: ${label(element)} (${style.display})`);
   if (rect.height < 35) issues.push(`Short control: ${label(element)} (${rect.height.toFixed(1)}px)`);
   const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
   while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(walker.currentNode);
    for (const textRect of range.getClientRects()) {
     if (textRect.width && (textRect.left < rect.left - 1 || textRect.right > rect.right + 1 || textRect.top < rect.top - 1 || textRect.bottom > rect.bottom + 1)) issues.push(`Text outside control: ${label(element)}`);
    }
   }
  }
  for (const group of document.querySelectorAll('.sn-provider-actions, .sn-result-actions, .sn-fav-actions, .sn-form-actions, .sn-modal-actions, .sn-actions-row, .sn-booking-nav-actions')) {
   const controls = [...group.children].filter(element => element.matches('.btn, .sn-btn, .sn-provider-action') && visible(element));
   for (let i = 1; i < controls.length; i++) {
    const a = controls[i - 1].getBoundingClientRect();
    const b = controls[i].getBoundingClientRect();
    if (Math.abs(a.top - b.top) < 10 && Math.abs(a.height - b.height) > 1) issues.push(`Unequal button heights: ${label(group)}`);
   }
  }
  for (const group of document.querySelectorAll('.sn-customer-booking-amount')) {
   const controls = [...group.querySelectorAll('.sn-btn')].filter(visible);
   if (controls.length > 1) {
    const first = controls[0].getBoundingClientRect();
    if (controls.slice(1).some(element => {
     const rect = element.getBoundingClientRect();
     return Math.abs(rect.width - first.width) > 1;
    })) issues.push(`Uneven booking action widths: ${label(group)}`);
   }
  }
  const cards = [...document.querySelectorAll('.sn-providers-grid > .sn-provider-card')].filter(visible);
  for (let i = 1; i < cards.length; i++) {
   const previous = cards[i - 1];
   const current = cards[i];
   if (Math.abs(previous.getBoundingClientRect().top - current.getBoundingClientRect().top) > 1) continue;
   const a = previous.querySelector('.sn-provider-actions')?.getBoundingClientRect();
   const b = current.querySelector('.sn-provider-actions')?.getBoundingClientRect();
   if (a && b && Math.abs(a.bottom - b.bottom) > 1) issues.push('Provider card buttons do not align along the bottom of their row');
  }
  const headers = [...document.querySelectorAll('.sn-page-header, .sn-section-head, .sn-search-header, .sn-profile-name-row, .sn-result-top, .sn-modal-head')].filter(visible);
  for (const header of headers) {
   const children = [...header.children].filter(visible);
   for (let i = 0; i < children.length; i++) {
    const a = children[i].getBoundingClientRect();
    for (let j = i + 1; j < children.length; j++) {
     const b = children[j].getBoundingClientRect();
     if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) issues.push(`Overlapping heading: ${label(header)}`);
    }
   }
  }
  return { issues: [...new Set(issues)], actions: actions.length };
 });
}

(async () => {
 const browser = await chromium.launch({ headless: true, channel: 'msedge' });
 const results = [];
 const errors = [];
 try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.addInitScript(({ customer, provider }) => {
   localStorage.setItem('sn_customer_user', JSON.stringify(customer));
   localStorage.setItem('sn_provider_user', JSON.stringify(provider));
  }, { customer, provider });
  await context.route('**/*', async route => {
   const url = new URL(route.request().url());
   if (url.origin !== base) return route.fulfill({ body: '', contentType: url.hostname.includes('fonts') || url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
   if (!url.pathname.startsWith('/api/')) return route.continue();
   if (!['GET', 'HEAD'].includes(route.request().method())) return route.fulfill({ status: 405, json: { message: 'Layout fixtures do not allow writes.' } });
   let response = data;
   if (url.pathname.startsWith('/api/auth/')) response = { user: url.pathname.includes('/provider/') ? provider : customer };
   if (url.pathname.endsWith('/payment')) response = { booking: bookings[0], checkout_configured: true, livemode: false };
   if (url.pathname.endsWith('/payment-qr')) response = { payment_qr: { qr_url: null, wallet: '', account_name: '', account_number: '' } };
   if (url.pathname.endsWith('/track')) response = { booking: bookings[0] };
   await route.fulfill({ json: response });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${page.url()}: ${error.message}`));
  const routes = [
   ['customer/dashboard/dashboard.html', '.sn-provider-card'],
   ['customer/bookings/bookings.html', '.sn-customer-booking-card'],
   ['customer/bookings/bookings.html?provider_id=81', '#sn-booking-service'],
   ['customer/search/search.html', '.sn-result-card'],
   ['customer/favorites/favorites.html', '.sn-fav-card'],
   ['customer/reviews/reviews.html', '.sn-review-card'],
   ['customer/profile/profile.html', '.sn-profile-hero'],
   ['customer/inbox/inbox.html', '.sn-float-root'],
   ['customer/history/history.html', '.sn-history-item'],
   ['customer/categories/categories.html', '.sn-category-card'],
   ['customer/provider-profile/provider-profile.html?id=81', '.sn-profile-summary'],
   ['provider/dashboard/dashboard.html', '.stats-grid'],
   ['provider/requests/requests.html', '.sn-booking-request-card'],
   ['provider/services/services.html', '.sn-provider-service-card'],
   ['provider/schedule/schedule.html', '.sn-schedule-form'],
   ['provider/profile/profile.html', '#sn-provider-save-profile'],
   ['provider/inbox/inbox.html', '.sn-float-root'],
   ['provider/history/history.html', '.sn-history-item'],
   ['provider/reviews/reviews.html', '.sn-module-card'],
   ['provider/assessment/assessment.html', '.sn-panel'],
   ['auth/customerLogin.html', '.auth-card'],
   ['auth/providerLogin.html', '.auth-card'],
  ];
  for (const width of [1440, 1024, 768, 390, 320]) {
   await page.setViewportSize({ width, height: 1000 });
   for (const [route, selector] of routes) {
    await page.goto(`${base}/pages/${route}`);
    await page.waitForLoadState('load');
    await page.locator(selector).first().waitFor({ state: 'attached' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const result = await inspectLayout(page);
    const name = route.split('?')[0].replaceAll('/', '-').replace('.html', '');
    if (width === 1440 || width === 390 || result.issues.length) {
     const filename = `alignment-${baseline ? 'before' : 'after'}-${name}-${width}${route.includes('?provider_id') ? '-form' : ''}`;
     await page.screenshot({ path: path.join(os.tmpdir(), `${filename}.png`), fullPage: true, animations: 'disabled' });
     await page.screenshot({ path: path.join(os.tmpdir(), `${filename}-viewport.png`), animations: 'disabled' });
    }
    results.push({ route, width, ...result });
   }
   for (const [route, control, selector] of [
    ['customer/profile/profile.html', '#sn-edit-toggle', '#sn-profile-form'],
    ['provider/services/services.html', '[data-action="edit-service"]', '.sn-modal'],
   ]) {
    await page.goto(`${base}/pages/${route}`);
    await page.locator(control).first().click();
    await page.locator(selector).waitFor({ state: 'visible' });
    const result = await inspectLayout(page);
    results.push({ route: `${route} (editing)`, width, ...result });
    if (width === 1440 || width === 390) await page.screenshot({ path: path.join(os.tmpdir(), `alignment-editing-${route.replaceAll('/', '-').replace('.html', '')}-${width}.png`), animations: 'disabled' });
   }
  }
  for (const result of results.filter(result => result.issues.length)) console.log(JSON.stringify(result));
  if (!baseline) {
   assert.deepEqual(errors, [], 'pages have no JavaScript errors');
   assert.deepEqual(results.filter(result => result.issues.length), [], 'controls align and text stays within its layout at every tested width');
  }
  console.log(`${baseline ? 'Baseline' : 'Verified'} ${results.length} page/viewports, ${results.reduce((sum, result) => sum + result.actions, 0)} controls. Screenshots: ${os.tmpdir()}. JavaScript errors: ${JSON.stringify(errors)}`);
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
