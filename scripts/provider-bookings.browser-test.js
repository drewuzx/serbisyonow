'use strict';

// All API requests use fixtures; no real booking or location is changed.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const pricing = require('../shared/js/cleaningPricing');
const base = process.env.TEST_BASE_URL || 'http://localhost:3003';

(async () => {
 const browser = await chromium.launch({ headless: true, channel: 'msedge' });
 try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const provider = { id: 987002, full_name: 'Booking Test Provider', verification_status: 'verified', is_verified: true, latitude: 15.147, longitude: 120.58 };
  const estimate = pricing.assessment('general house cleaning', { ...pricing.defaults('general house cleaning'), areas: ['Living room'] });
  const bookings = [
   { id: 101, status: 'pending', customer_latitude: 15.1443, customer_longitude: 120.5894 },
   { id: 102, status: 'pending', customer_latitude: null, customer_longitude: null },
   { id: 103, status: 'cancelled', customer_latitude: 15.147, customer_longitude: 120.58 },
  ].map(booking => ({ ...booking, customer_id: 987001, customer_name: 'Test Customer', service: 'General House Cleaning', address: '109 Test Street, Angeles City', scheduled_date: '2026-10-01', scheduled_time: '10:30 AM', amount: estimate.amount, service_details: estimate.details, pricing_type: 'calculated' }));
  const actions = [];
  let failNext = false;
  let conflictNext = false;
  let failDashboard = false;
  let delayDirections;
  const errors = [];
  await context.addInitScript(provider => {
   localStorage.setItem('sn_provider_user', JSON.stringify(provider));
   window.testGpsAllowed = false;
   Object.defineProperty(navigator, 'geolocation', { value: {
    getCurrentPosition(success, failure) {
     if (window.testGpsAllowed) success({ coords: { latitude: 15.148, longitude: 120.581, accuracy: 12 } });
     else failure({ code: 1 });
    },
   } });
  }, provider);
  await context.route('**/api/**', async route => {
   const request = route.request();
   const url = new URL(request.url());
   let data = { messages: [], conversations: [], notifications: [], categories: [] };
   if (url.pathname.endsWith('/dashboard')) {
    if (failDashboard) return route.fulfill({ status: 503, json: { message: 'Test unavailable' } });
    data = { provider, user: provider, bookings: bookings.filter(row => !row.provider_closed), history_bookings: bookings, services: [], messages: [], reviews: [], availability: [] };
   } else if (url.pathname.includes('/auth/provider/status/')) data = { user: provider };
   else if (url.pathname.endsWith('/location')) {
    Object.assign(provider, request.postDataJSON());
    data = { user: provider };
   } else if (url.pathname.includes('/bookings/') && request.method() === 'PATCH') {
    actions.push({ url: url.pathname, body: request.postDataJSON() });
    const booking = bookings.find(row => String(row.id) === url.pathname.split('/').at(-2));
    if (failNext) {
     failNext = false;
     return route.fulfill({ status: 500, json: { message: 'Test save failed. Please retry.' } });
    }
    if (conflictNext) {
     conflictNext = false;
     booking.status = 'cancelled';
     return route.fulfill({ status: 409, json: { message: 'This booking is now cancelled. Refresh the bookings before trying again.' } });
    }
    if (url.pathname.endsWith('/close')) booking.provider_closed = true;
    else booking.status = request.postDataJSON().status;
    data = { booking, archived: Boolean(booking.provider_closed) };
   } else if (url.pathname === '/api/directions') {
    const wait = delayDirections;
    delayDirections = null;
    if (wait) await wait;
    data = { directions: { distance_m: 1900, duration_s: 360, steps: [{ instruction: 'Turn right on Test Street', distance_m: 600 }], geometry: { type: 'LineString', coordinates: [[120.58, 15.147], [120.582, 15.144], [120.5894, 15.1443]] } } };
   }
   await route.fulfill({ json: data });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.stack));
  const card = id => page.locator(`[data-booking-card="${id}"]`);
  const filter = name => page.locator(`[data-request-filter="${name}"]`);
  const settled = () => page.waitForFunction(() => providerBookingActions.size === 0);
  const notice = text => page.getByRole('status').filter({ hasText: text }).waitFor();
  await page.goto(`${base}/pages/provider/requests/requests.html`);
  await card(101).waitFor();
  await notice('Location permission denied');
  assert.equal(await card(103).count(), 0, 'cancelled is separate from active bookings');
  await page.locator('#sn-booking-nav-eta').filter({ hasText: '6 min driving' }).waitFor();
  assert.match(await page.locator('#sn-booking-open-gmaps').getAttribute('href'), /destination=15.1443%2C120.5894/);
  assert.match(await page.locator('#sn-booking-open-waze').getAttribute('href'), /ll=15.1443,120.5894/);
  const leafletLoaded = await page.evaluate(() => Boolean(window.L));
  assert.equal(leafletLoaded, true, 'actual Leaflet library loads');
  assert.equal(await page.locator('.leaflet-marker-icon').count(), 2);
  assert.ok(await page.locator('.leaflet-overlay-pane path').count() > 0, 'route is rendered');

  await page.locator('#sn-booking-map-expand').click();
  assert.equal(await page.locator('.sn-booking-customer-map-panel.is-fullscreen').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sn-booking-customer-map-panel.is-fullscreen').count(), 0);
  await card(102).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#sn-booking-map-status').innerText(), 'Address only');
  assert.equal(await page.locator('#sn-booking-add-direction').isDisabled(), true);
  assert.equal(await page.locator('#sn-booking-open-waze').getAttribute('href'), null);
  assert.match(await page.locator('#sn-booking-open-gmaps').getAttribute('href'), /destination=109\+Test\+Street/);

  // A late route response must not overwrite a newly selected booking without GPS.
  let releaseDirections;
  delayDirections = new Promise(resolve => { releaseDirections = resolve; });
  const directionRequest = page.waitForRequest(request => request.url().includes('/api/directions'));
  await card(101).click();
  await directionRequest;
  await card(102).click();
  releaseDirections();
  await page.waitForResponse(response => response.url().includes('/api/directions'));
  assert.equal(await page.locator('#sn-booking-nav-steps li').count(), 0);

  failNext = true;
  await card(101).getByRole('button', { name: 'Accept', exact: true }).click();
  await settled();
  await notice('Test save failed');
  assert.equal(await card(101).getByRole('button', { name: 'Accept', exact: true }).isEnabled(), true);
  const beforeAccept = actions.length;
  await card(101).getByRole('button', { name: 'Accept', exact: true }).evaluate(button => { button.click(); button.click(); });
  await settled();
  assert.equal(actions.length, beforeAccept + 1, 'double click submits only once');
  assert.equal(actions.at(-1).body.expected_status, 'pending');
  await card(101).getByRole('button', { name: 'Start Service' }).click();
  await settled();
  await card(101).getByRole('button', { name: 'Mark Completed' }).click();
  await page.locator('[data-modal-cancel]').click();
  await settled();
  assert.equal(bookings[0].status, 'ongoing');
  await card(101).getByRole('button', { name: 'Mark Completed' }).click();
  await page.locator('[data-modal-confirm]').click();
  await settled();
  assert.equal(bookings[0].status, 'completed');
  assert.equal(await card(101).count(), 0);
  await filter('completed').click();
  await card(101).getByRole('button', { name: 'Move to History' }).click();
  await page.locator('[data-modal-confirm]').click();
  await settled();
  assert.equal(await card(101).count(), 0);
  assert.equal(bookings[0].provider_closed, true);

  await filter('pending').click();
  await card(102).getByRole('button', { name: 'Decline', exact: true }).click();
  await page.locator('[data-modal-cancel]').click();
  await settled();
  assert.equal(bookings[1].status, 'pending');
  await card(102).getByRole('button', { name: 'Decline', exact: true }).click();
  await page.locator('[data-modal-confirm]').click();
  await settled();
  assert.equal(bookings[1].status, 'cancelled');
  await filter('cancelled').click();
  await card(103).click();
  assert.equal(await page.locator('#sn-booking-map-status').innerText(), 'Pins overlap');
  assert.equal(await page.locator('#sn-booking-add-direction').isDisabled(), true);
  await card(102).getByRole('button', { name: 'Move to History' }).click();
  await page.locator('[data-modal-confirm]').click();
  await settled();
  assert.equal(bookings[1].provider_closed, true);

  await page.evaluate(() => { window.testGpsAllowed = true; });
  await page.locator('#sn-booking-refresh-gps').click();
  await notice('Your location has been updated');
  assert.equal(provider.latitude, 15.148);
  failDashboard = true;
  await page.locator('#sn-refresh-requests').click();
  await notice('Unable to refresh bookings');
  failDashboard = false;
  await page.locator('#sn-refresh-requests').click();
  await notice('Bookings refreshed');

  bookings.push({ ...bookings[2], id: 104, status: 'pending', provider_closed: false });
  await filter('pending').click();
  await card(104).waitFor({ timeout: 10000 });
  conflictNext = true;
  await card(104).getByRole('button', { name: 'Accept', exact: true }).click();
  await settled();
  await notice('This booking is now cancelled');
  assert.equal(await card(104).count(), 0);

  // Restore representative fixture cards for visual checks after exercising the full flow.
  bookings[0].status = 'pending';
  bookings[0].provider_closed = false;
  await filter('active').click();
  await page.locator('#sn-refresh-requests').click();
  await card(101).waitFor();
  await page.waitForFunction(() => {
   const tiles = [...document.querySelectorAll('.leaflet-tile')];
   return tiles.length && tiles.every(tile => tile.complete && tile.naturalWidth > 0);
  });
  await page.locator('.sn-panel').screenshot({ path: path.join(os.tmpdir(), 'provider-bookings-desktop.png'), animations: 'disabled' });
  for (const width of [390, 320]) {
   await page.setViewportSize({ width, height: 844 });
   if (await page.locator('.sn-shell').evaluate(shell => shell.classList.contains('sidebar-open'))) await page.locator('#sn-hamburger').click();
   await page.waitForFunction(() => document.getElementById('sn-sidebar').getBoundingClientRect().right <= 0);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no overflow at ${width}px`);
   assert.equal(await card(101).locator('button').evaluateAll(buttons => buttons.some(button => button.scrollWidth > button.clientWidth + 1)), false, `no clipped actions at ${width}px`);
   await page.locator('.sn-panel').screenshot({ path: path.join(os.tmpdir(), `provider-bookings-mobile-${width}.png`), animations: 'disabled' });
   await page.evaluate(() => scrollTo(0, 0));
   await page.screenshot({ path: path.join(os.tmpdir(), `provider-bookings-viewport-${width}.png`), animations: 'disabled' });
  }
  await page.locator('#sn-booking-map-expand').click();
  const bounds = await page.locator('.sn-booking-customer-map-panel').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 320 && bounds.y + bounds.height <= 844, 'mobile fullscreen fits');
  await page.keyboard.press('Escape');
  await page.goto(`${base}/pages/provider/history/history.html`);
  await page.locator('[data-history-id="102"]').waitFor();
  assert.deepEqual(errors, []);
  console.log('Provider bookings browser checks passed: workflow, errors, history, live refresh, GPS, routes, desktop and mobile.');
  console.log(`Screenshots: ${path.join(os.tmpdir(), 'provider-bookings-*.png')}`);
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
