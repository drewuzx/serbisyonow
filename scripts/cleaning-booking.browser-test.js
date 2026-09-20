'use strict';

// Run against the local app with Playwright available in NODE_PATH.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const pricing = require('../shared/js/cleaningPricing');
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';

(async () => {
 const browser = await chromium.launch({ headless: true, channel: 'msedge' });
 try {
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, serviceWorkers: 'block' });
  const customer = { id: 987001, full_name: 'Cleaning Test Customer', address: 'Test address, Angeles City', verification_status: 'verified', is_verified: true };
  const provider = { id: 987002, full_name: 'Cleaning Test Provider', service: 'Cleaning', category: 'Cleaning', verification_status: 'verified', is_verified: true };
  const services = [
   { id: 987010, title: 'Cleaning', category: 'Cleaning', laundry_pickup_delivery: true },
   { id: 987011, title: 'Bathroom cleaning', category: 'Cleaning' },
   { id: 987012, title: 'Sofa and upholstery cleaning', category: 'Cleaning' },
   { id: 987013, title: 'Plumbing Services', category: 'Repair Services' },
   { id: 987014, title: 'Massage therapy', category: 'Personal Care' },
  ].map(service => ({ ...service, starting_price: 500, max_price: 800, is_active: true, accepts_cash: true, accepts_gcash: true }));
  let submitted;
  let providerUpdate;
  await context.addInitScript(({ customer, provider }) => {
   localStorage.setItem('sn_customer_user', JSON.stringify(customer));
   localStorage.setItem('sn_provider_user', JSON.stringify(provider));
  }, { customer, provider });
  await context.route('**/api/**', async route => {
   const request = route.request();
   const url = new URL(request.url());
   let data = {};
   if (request.method() === 'POST' && url.pathname.endsWith('/bookings')) {
    submitted = request.postDataJSON();
    data = { booking: { id: 987020, ...submitted } };
   } else if (request.method() === 'PATCH' && url.pathname.includes('/services/')) {
    providerUpdate = request.postDataJSON();
    data = { service: { ...services[0], ...providerUpdate } };
   } else if (url.pathname.includes('/auth/provider/status/')) data = { user: provider };
   else if (url.pathname.includes('/auth/customer/status/')) data = { user: customer };
   else if (url.pathname.includes('/provider/') && url.pathname.endsWith('/dashboard')) data = { provider, user: provider, services, bookings: [], messages: [], reviews: [], availability: [], assessment: { score: 100 } };
   else if (url.pathname.endsWith('/availability')) data = { availability: [{ id: 987030, available_date: new Date().toISOString().slice(0, 10), start_time: '09:00 AM', end_time: '05:00 PM', is_available: true }] };
   else if (url.pathname.includes('/customer/') && url.pathname.endsWith('/dashboard')) data = { customer, user: customer, bookings: [], favorites: [], reviews: [], messages: [] };
   else data = { messages: [], conversations: [], notifications: [], categories: [], providers: [] };
   await route.fulfill({ json: data });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack));
  await page.goto(`${base}/pages/customer/bookings/bookings.html?provider_id=${provider.id}`);
  await page.locator('#sn-cleaning-specific-service').waitFor();
  await page.locator('#sn-booking-time').selectOption('09:00 AM');

  for (const key of Object.keys(pricing.configs)) {
   await page.locator('#sn-cleaning-specific-service').selectOption(key);
   assert.match(await page.locator('.sn-cleaning-price-summary').innerText(), /Sample estimated/);
   assert.equal(await page.locator('#sn-repair-assessment').isVisible(), false);
   assert.equal(await page.locator('#sn-booking-custom-amount').isDisabled(), true);
   assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), true, key);
  }
  await page.locator('#sn-cleaning-specific-service').selectOption('carpet cleaning');
  await page.locator('[name="cleaning_size"]').selectOption('Custom sq m');
  await page.locator('[name="cleaning_sqm"]').fill('');
  assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), false);
  assert.doesNotMatch(await page.locator('.sn-cleaning-price-summary').innerText(), /NaN/);
  await page.locator('[name="cleaning_sqm"]').fill('6.5');
  await page.locator('[name="cleaning_quantity"]').fill('2');
  assert.match(await page.locator('.sn-cleaning-price-summary').innerText(), /PHP 780/);
  await page.locator('[name="cleaning_size"]').selectOption('Small');
  assert.equal(await page.locator('[name="cleaning_sqm"]').isDisabled(), true);

  await page.locator('#sn-cleaning-specific-service').selectOption('general house cleaning');
  await page.locator('[name="cleaning_property_type"]').selectOption('1 Bedroom');
  await page.locator('[name="cleaning_duration"]').selectOption('3 hours');
  await page.locator('[name="cleaning_areas"][value="Kitchen"]').check();
  await page.locator('[name="cleaning_areas"][value="Balcony"]').check();
  assert.match(await page.locator('.sn-cleaning-total').innerText(), /PHP 950/);
  await page.locator('.sn-booking-create-panel').screenshot({ path: path.join(os.tmpdir(), 'cleaning-desktop.png') });
  for (const width of [390, 320]) {
   await page.setViewportSize({ width, height: 844 });
   if (await page.locator('.sn-shell').evaluate(shell => shell.classList.contains('sidebar-open'))) await page.locator('#sn-hamburger').click();
   await page.locator('#sn-cleaning-assessment').scrollIntoViewIfNeeded();
   const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
   assert.equal(overflow, false, `No page overflow at ${width}px`);
   const clipped = await page.locator('#sn-cleaning-assessment label > span').evaluateAll(labels => labels.filter(label => label.scrollWidth > label.clientWidth + 1).length);
   assert.equal(clipped, 0, `No clipped labels at ${width}px`);
   await page.locator('.sn-booking-create-panel').screenshot({ path: path.join(os.tmpdir(), `cleaning-mobile-${width}.png`) });
  }
  await page.locator('#sn-create-booking-form [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#sn-create-booking-form [type="submit"]')?.textContent === 'Booking Submitted');
  assert.equal(submitted.amount, 950);
  assert.equal(submitted.service, 'General House Cleaning');
  assert.equal(submitted.provider_service_id, services[0].id);
  assert.equal(submitted.service_details.answers['Additional areas'], 'Kitchen, Balcony');
  assert.equal(submitted.service_details.sample_rates, true);

  // Use a fresh page so the successful-submit redirect cannot interrupt checks.
  await page.close();
  const second = await context.newPage();
  second.on('pageerror', error => errors.push(error.stack));
  await second.goto(`${base}/pages/customer/bookings/bookings.html?provider_id=${provider.id}`);
  await second.locator('#sn-booking-service').selectOption('Sofa and upholstery cleaning');
  assert.equal(await second.locator('#sn-cleaning-specific-service').count(), 0);
  assert.equal(await second.locator('[name="cleaning_material"]').count(), 1);
  await second.locator('#sn-booking-service').selectOption('Plumbing Services');
  assert.equal(await second.locator('#sn-repair-assessment').isVisible(), true);
  assert.equal(await second.locator('#sn-cleaning-assessment').isVisible(), false);
  await second.locator('#sn-booking-service').selectOption('Massage therapy');
  assert.equal(await second.locator('#sn-cleaning-assessment').isVisible(), false);
  assert.equal(await second.locator('#sn-repair-assessment').isVisible(), false);
  assert.equal(await second.locator('#sn-booking-amount-choice').isEnabled(), true);
  services[0].laundry_pickup_delivery = false;
  await second.reload();
  await second.locator('#sn-cleaning-specific-service').selectOption('laundry services');
  assert.equal(await second.locator('[name="cleaning_fulfillment"]').isVisible(), false);
  assert.equal(await second.locator('[name="cleaning_fulfillment"]').isDisabled(), true);

  await second.goto(`${base}/pages/provider/services/services.html`);
  const toggle = second.locator('[data-service-field="laundry_pickup_delivery"]');
  await toggle.waitFor();
  await toggle.check();
  await second.waitForFunction(() => !document.querySelector('[data-service-field="laundry_pickup_delivery"]')?.disabled);
  assert.equal(providerUpdate.laundry_pickup_delivery, true);
  const quote = pricing.assessment('general house cleaning', pricing.defaults('general house cleaning'));
  const rendered = await second.evaluate(quote => renderProviderBookingAssessment({ service_details: quote.details, amount: quote.amount, estimated_min: quote.estimatedMin, estimated_max: quote.estimatedMax, pricing_type: quote.pricingType }), quote);
  assert.match(rendered, /Sample-rate price breakdown/);
  assert.match(rendered, /Studio/);
  assert.deepEqual(errors, []);
  console.log('PASS: all 7 forms, calculations, validation, booking payload, aliases, category switching, provider pickup toggle and breakdown; desktop/390px/320px screenshots saved in', os.tmpdir());
 } finally {
  await browser.close();
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
