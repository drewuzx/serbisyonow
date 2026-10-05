'use strict';

// Fixture-only APIs keep test bookings and uploads out of the real database.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const Busboy = require('busboy');
const path = require('node:path');
const os = require('node:os');
const pricing = require('../shared/js/outdoorPricing');
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';

function multipart(request) {
 return new Promise((resolve, reject) => {
  const fields = {};
  const files = [];
  const parser = Busboy({ headers: request.headers() });
  parser.on('field', (key, value) => { fields[key] = value; });
  parser.on('file', (field, stream, info) => {
   const file = { field, ...info, size: 0 };
   files.push(file);
   stream.on('data', data => { file.size += data.length; });
  });
  parser.on('error', reject);
  parser.on('close', () => resolve({ fields, files }));
  parser.end(request.postDataBuffer());
 });
}

(async () => {
 const browser = await chromium.launch({ headless: true, channel: 'msedge' });
 try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  // Exercise the existing font fallback without depending on Google Fonts availability.
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const customer = { id: 987001, full_name: 'Outdoor Test Customer', address: 'Test address, Angeles City', verification_status: 'verified', is_verified: true };
  const provider = { id: 987002, full_name: 'Outdoor Test Provider', service: pricing.CATEGORY, category: pricing.CATEGORY, verification_status: 'verified', is_verified: true };
  const services = [
   { id: 77, title: pricing.CATEGORY }, { id: 78, title: 'Gardening services' },
   { id: 79, title: 'Lawn mowing' }, { id: 80, title: 'Landscape maintenance' },
   { id: 81, title: 'Tree trimming' }, { id: 82, title: 'Fence repair' },
   { id: 83, title: 'Outdoor & Property Maintenance' }, { id: 84, title: 'Lawn & Mowing' },
   { id: 71, title: 'Cleaning', category: 'Cleaning' }, { id: 72, title: 'Personal Care', category: 'Personal Care' },
   { id: 73, title: 'Appliance Maintenance', category: 'Appliance Maintenance' },
   { id: 74, title: 'Installation Services', category: 'Installation Services' },
   { id: 75, title: 'Plumbing services', category: 'Repair Services' },
  ].map(service => ({ category: pricing.CATEGORY, ...service, is_active: true, starting_price: 500, max_price: 1500 }));
  let submitted;
  let attachments = [];
  const bookings = [];
  const errors = [];
  await context.addInitScript(({ customer, provider }) => {
   localStorage.setItem('sn_customer_user', JSON.stringify(customer));
   localStorage.setItem('sn_provider_user', JSON.stringify(provider));
  }, { customer, provider });
  await context.route('**/api/**', async route => {
   const request = route.request();
   const url = new URL(request.url());
   let data = { messages: [], conversations: [], notifications: [], categories: [], providers: [] };
   if (request.method() === 'POST' && url.pathname.endsWith('/bookings')) {
    if ((request.headers()['content-type'] || '').startsWith('multipart/form-data')) {
     const parsed = await multipart(request);
     submitted = { ...parsed.fields, service_details: JSON.parse(parsed.fields.service_details) };
     attachments = parsed.files;
    } else { submitted = request.postDataJSON(); attachments = []; }
    const service = services.find(item => String(item.id) === String(submitted.provider_service_id));
    const estimate = pricing.forBooking(submitted.service, submitted.service_details, service);
    const booking = { ...submitted, id: 101 + bookings.length, customer_name: customer.full_name, customer_id: customer.id, status: 'pending', amount: estimate.amount,
     estimated_min: estimate.estimatedMin, estimated_max: estimate.estimatedMax, pricing_type: estimate.pricingType,
     service_details: { ...estimate.details, media_files: attachments.map(file => ({ name: file.filename, type: file.mimeType, url: `/uploads/booking-media/${file.filename}` })) } };
    bookings.push(booking);
    data = { booking };
   } else if (url.pathname.includes('/auth/provider/status/')) data = { user: provider };
   else if (url.pathname.includes('/auth/customer/status/')) data = { user: customer };
   else if (url.pathname.includes('/provider/') && url.pathname.endsWith('/dashboard')) data = { provider, services, bookings, history_bookings: bookings, messages: [], reviews: [], availability: [] };
   else if (url.pathname.endsWith('/availability')) data = { availability: [{ available_date: new Date().toISOString().slice(0, 10), start_time: '09:00 AM', end_time: '05:00 PM', is_available: true }] };
   else if (url.pathname.includes('/customer/') && url.pathname.endsWith('/dashboard')) data = { customer, bookings, messages: [], favorites: [], reviews: [] };
   await route.fulfill({ json: data });
  });
  let page;
  async function openForm() {
   if (page) await page.close();
   page = await context.newPage();
   page.on('pageerror', error => errors.push(error.stack));
   await page.goto(`${base}/pages/customer/bookings/bookings.html?provider_id=${provider.id}`, { waitUntil: 'domcontentloaded' });
   await page.locator('#sn-outdoor-specific-service').waitFor();
   await page.locator('#sn-booking-time').selectOption('09:00 AM');
  }
  const input = key => page.locator(`[name="outdoor_${key}"]`);
  const selectService = key => page.locator('#sn-outdoor-specific-service').selectOption(key);
  async function checkLayout() {
   if (await page.evaluate(() => innerWidth < 940)) {
    if (await page.locator('.sn-shell').evaluate(shell => shell.classList.contains('sidebar-open'))) await page.locator('#sn-hamburger').click();
    await page.waitForFunction(() => document.getElementById('sn-sidebar').getBoundingClientRect().right <= 0);
   }
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
   assert.equal(await page.locator('#sn-outdoor-assessment label > span, #sn-outdoor-assessment h4').evaluateAll(labels => labels.some(label => label.scrollWidth > label.clientWidth + 1)), false, 'no clipped question labels or heading');
   assert.equal(await page.locator('.sn-outdoor-price-summary dt, .sn-outdoor-price-summary dd').evaluateAll(labels => labels.some(label => label.scrollWidth > label.clientWidth + 1)), false, 'quote descriptions and prices remain readable');
   assert.equal(await page.locator('#sn-outdoor-assessment input, #sn-outdoor-assessment select').evaluateAll(controls => controls.some(control => {
    if (!control.getClientRects().length) return false;
    const child = control.getBoundingClientRect();
    const parent = control.parentElement.getBoundingClientRect();
    return child.left < parent.left - 1 || child.right > parent.right + 1;
   })), false, 'controls fit inside their labels');
  }
  async function screenshots(label) {
   for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await checkLayout();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(os.tmpdir(), `outdoor-${label}-${width}.png`), fullPage: true, animations: 'disabled' });
   }
  }
  await openForm();
  assert.equal(await page.locator('#sn-booking-custom-amount').isDisabled(), true);
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: 950 });
   for (const key of Object.keys(pricing.configs)) {
    await selectService(key);
    assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), true, key);
    assert.match(await page.locator('.sn-outdoor-price-summary').innerText(), /Sample estimated (price|range)/);
    assert.equal(await page.locator('#sn-repair-assessment').isVisible(), false);
    await checkLayout();
   }
  }
  await selectService('lawn mowing');
  assert.equal(await input('area_m2').isDisabled(), true);
  await input('lawn_size').selectOption('Custom m2');
  assert.equal(await input('area_m2').isDisabled(), false);
  await input('area_m2').fill('80');
  await input('grass_height').selectOption('Tall (over 30 cm)');
  await input('cleanup').selectOption('Bag grass clippings');
  assert.match(await page.locator('.sn-outdoor-total').innerText(), /PHP 1,304/);
  await input('frequency').selectOption('Weekly');
  assert.match(await page.locator('.sn-outdoor-total').innerText(), /PHP 1,173.6/);
  assert.match(await page.locator('.sn-outdoor-price-summary').innerText(), /does not include future visits/);
  await screenshots('lawn');
  await input('area_m2').fill('');
  assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), false);
  assert.doesNotMatch(await page.locator('.sn-outdoor-price-summary').innerText(), /NaN/);
  await input('lawn_size').selectOption('Small');
  assert.equal(await input('area_m2').isDisabled(), true);
  assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), true);

  await selectService('landscape maintenance');
  await input('area_m2').fill('40');
  await input('areas').fill('3');
  await input('maintenance_type').selectOption('Soil and garden bed care');
  await input('condition').selectOption('Overgrown');
  await input('frequency').selectOption('Weekly');
  assert.match(await page.locator('.sn-outdoor-total').innerText(), /PHP 2,106 - PHP 4,212/);
  assert.equal(await page.locator('.sn-calculated-head > span').innerText(), 'Assessment / Quote');
  await input('maintenance_type').selectOption('Other');
  assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), false);
  await input('other_maintenance').fill('Rock garden maintenance');
  await input('maintenance_type').selectOption('Routine maintenance');
  assert.equal(await input('other_maintenance').isDisabled(), true);
  assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), true);

  await selectService('fence repair');
  await input('material').selectOption('Metal');
  await input('length_m').fill('12');
  await input('sections').fill('3');
  await input('problem').selectOption('Broken panel');
  await input('height_m').fill('2.5');
  assert.match(await page.locator('.sn-outdoor-total').innerText(), /PHP 2,160 - PHP 4,470/);
  await input('material').selectOption('Other');
  await input('problem').selectOption('Other');
  assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), false);
  await input('other_material').fill('Bamboo');
  await input('other_problem').fill('Split rails');
  await screenshots('fence');
  await selectService('gardening');
  await input('area_m2').fill('50');
  await input('plants').fill('10');
  await input('frequency').selectOption('Weekly');
  assert.match(await page.locator('.sn-outdoor-total').innerText(), /PHP 720/);
  await page.locator('#sn-create-booking-form [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#sn-create-booking-form [type="submit"]')?.textContent === 'Booking Submitted');
  assert.equal(submitted.service, 'Gardening');
  assert.equal(submitted.amount, 720);
  assert.equal(submitted.provider_service_id, 77);
  assert.equal(submitted.service_details.answers.Frequency, 'Weekly');
  assert.equal(submitted.service_details.pricing_basis, 'per_visit');
  assert.equal(bookings.length, 1, 'frequency does not create automatic recurring bookings');

  await openForm();
  await page.locator('#sn-booking-service').selectOption('Outdoor & Property Maintenance');
  assert.equal(await page.locator('#sn-outdoor-specific-service option').count(), 5);
  for (const [service, key] of [['Gardening services', 'gardening'], ['Lawn mowing', 'lawn mowing'], ['Lawn & Mowing', 'lawn mowing'], ['Landscape maintenance', 'landscape maintenance'], ['Tree trimming', 'tree trimming'], ['Fence repair', 'fence repair']]) {
   await page.locator('#sn-booking-service').selectOption(service);
   assert.equal(await page.locator('#sn-outdoor-specific-service').count(), 0);
   assert.equal(await page.locator('#sn-outdoor-assessment').getAttribute('data-service-key'), key);
  }
  for (const [service, panel] of [['Cleaning', '#sn-cleaning-assessment'], ['Personal Care', '#sn-personal-care-assessment'], ['Appliance Maintenance', '#sn-appliance-assessment'], ['Installation Services', '#sn-installation-assessment'], ['Plumbing services', '#sn-repair-assessment']]) {
   await page.locator('#sn-booking-service').selectOption(service);
   assert.equal(await page.locator(panel).isVisible(), true);
   assert.equal(await page.locator('#sn-outdoor-assessment').isVisible(), false);
  }
  await page.locator('#sn-booking-service').selectOption('Tree trimming');
  assert.equal(await input('near_power_lines').inputValue(), 'No');
  assert.equal(await input('tree_type').getAttribute('required'), null);
  await input('trees').fill('2');
  await input('height_m').fill('8');
  await input('tree_type').fill('Mango');
  await input('branch_condition').selectOption('Damaged / dead');
  await input('access').selectOption('Limited access');
  await input('near_power_lines').selectOption('Yes');
  assert.match(await page.locator('.sn-outdoor-total').innerText(), /PHP 5,760 - PHP 11,520/);
  assert.match(await page.locator('.sn-outdoor-price-summary').innerText(), /safety assessment is required/);
  const media = page.locator('#sn-outdoor-media');
  const photo = { name: 'tree.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1hYAAAAASUVORK5CYII=', 'base64') };
  await media.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
  assert.equal(await media.evaluate(control => control.validity.valid), false);
  await media.setInputFiles(Array.from({ length: 4 }, (_, i) => ({ ...photo, name: `photo-${i}.png` })));
  assert.equal(await media.evaluate(control => control.validity.valid), false);
  await media.setInputFiles({ ...photo, buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  assert.equal(await media.evaluate(control => control.validity.valid), false);
  await media.setInputFiles(photo);
  assert.equal(await media.evaluate(control => control.validity.valid), true);
  await screenshots('tree');
  await page.locator('#sn-create-booking-form [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#sn-create-booking-form [type="submit"]')?.textContent === 'Booking Submitted');
  assert.equal(submitted.service, 'Tree Trimming');
  assert.equal(submitted.provider_service_id, '81');
  assert.equal(submitted.pricing_type, 'provider_quote');
  assert.equal(submitted.service_details.requires_safety_assessment, true);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].filename, 'tree.png');
  const customerDetails = await page.evaluate(details => bookingServiceDetailRows(details), bookings[1].service_details);
  assert.match(customerDetails, /Mango/);
  assert.match(customerDetails, /Near power lines\?/);
  assert.match(customerDetails, /safety assessment is required/);
  assert.match(customerDetails, /tree.png/);
  await page.close();
  const providerPage = await context.newPage();
  providerPage.on('pageerror', error => errors.push(error.stack));
  await providerPage.goto(`${base}/pages/provider/requests/requests.html`, { waitUntil: 'domcontentloaded' });
  const card = providerPage.locator('[data-booking-card="102"]');
  await card.waitFor();
  assert.match(await card.innerText(), /Tree Trimming/);
  assert.match(await card.innerText(), /Mango/);
  assert.match(await card.innerText(), /Near power lines\?/);
  assert.match(await card.innerText(), /provider safety assessment is required/);
  assert.equal(await card.getByRole('link', { name: 'tree.png' }).getAttribute('href'), '/uploads/booking-media/tree.png');
  const gardening = providerPage.locator('[data-booking-card="101"]');
  assert.match(await gardening.innerText(), /per visit/);
  assert.match(await gardening.innerText(), /Weekly/);
  assert.deepEqual(errors, []);
  console.log('PASS: all five outdoor forms, per-visit calculations, quote ranges, custom fields, aliases, uploads, safety flags, saved customer/provider answers and desktop/mobile layouts.');
  console.log('Screenshots saved in', os.tmpdir());
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
