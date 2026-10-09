'use strict';

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const Busboy = require('busboy');
const path = require('node:path');
const os = require('node:os');
const pricing = require('../shared/js/appliancePricing');
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
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const customer = { id: 987001, full_name: 'Appliance Test Customer', address: 'Test address, Angeles City', verification_status: 'verified', is_verified: true };
  const provider = { id: 987002, full_name: 'Appliance Test Provider', service: 'Appliance Maintenance', category: 'Appliance Maintenance', verification_status: 'verified', is_verified: true };
  const services = [
   { id: 73, title: 'Appliance Maintenance' }, { id: 74, title: 'TV / Electronics' },
   { id: 75, title: 'Aircon' }, { id: 76, title: 'Refrigerator' },
   { id: 71, title: 'Cleaning', category: 'Cleaning' }, { id: 72, title: 'Personal Care', category: 'Personal Care' },
   { id: 77, title: 'Appliance repair', category: 'Repair Services' },
  ].map(service => ({ category: 'Appliance Maintenance', ...service, is_active: true, starting_price: 500, max_price: 1500 }));
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
   else if (url.pathname.includes('/customer/') && url.pathname.endsWith('/dashboard')) data = { customer, bookings: [], messages: [], favorites: [], reviews: [] };
   await route.fulfill({ json: data });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.stack));
  const selectService = key => page.locator('#sn-appliance-specific-service').selectOption(key);
  async function fillQuestions(key) {
   for (const field of pricing.fields(key)) {
    if (!['text', 'textarea'].includes(field.type)) continue;
    if (field.required === false) continue;
    await page.locator(`[name="appliance_${field.key}"]`).fill(field.key === 'problem' ? 'Unit is not working properly' : field.key === 'brand' ? 'Test brand' : 'Electric fan');
   }
  }
  async function screenshots(label) {
   for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    if (width < 940 && await page.locator('.sn-shell').evaluate(shell => shell.classList.contains('sidebar-open'))) await page.locator('#sn-hamburger').click();
    if (width < 940) await page.waitForFunction(() => document.getElementById('sn-sidebar').getBoundingClientRect().right <= 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label} fits at ${width}px`);
    assert.equal(await page.locator('#sn-appliance-assessment label > span').evaluateAll(labels => labels.some(label => label.scrollWidth > label.clientWidth + 1)), false, 'no clipped question labels');
    assert.equal(await page.locator('#sn-appliance-assessment input, #sn-appliance-assessment select, #sn-appliance-assessment textarea').evaluateAll(controls => controls.some(control => {
     const child = control.getBoundingClientRect();
     const parent = control.parentElement.getBoundingClientRect();
     return child.left < parent.left - 1 || child.right > parent.right + 1;
    })), false, 'controls remain inside their labels');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(os.tmpdir(), `appliance-${label}-${width}.png`), fullPage: true, animations: 'disabled' });
   }
  }
  await page.goto(`${base}/pages/customer/bookings/bookings.html?provider_id=${provider.id}`);
  await page.locator('#sn-appliance-specific-service').waitFor();
  await page.locator('#sn-booking-time').selectOption('09:00 AM');
  assert.equal(await page.locator('#sn-booking-custom-amount').isDisabled(), true);
  for (const key of Object.keys(pricing.configs)) {
   await selectService(key);
   await fillQuestions(key);
   assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), true, key);
   assert.match(await page.locator('.sn-appliance-price-summary').innerText(), key === 'aircon cleaning' ? /Sample estimated price/ : /Sample diagnostic estimate/);
   assert.equal(await page.locator('#sn-repair-assessment').isVisible(), false);
  }
  await selectService('aircon cleaning');
  await page.locator('[name="appliance_unit_type"]').selectOption('Split-type');
  await page.locator('[name="appliance_service"]').selectOption('Deep cleaning');
  await page.locator('[name="appliance_units"]').fill('');
  assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), false);
  assert.doesNotMatch(await page.locator('.sn-appliance-price-summary').innerText(), /NaN/);
  await page.locator('[name="appliance_units"]').fill('2');
  assert.match(await page.locator('.sn-appliance-total').innerText(), /PHP 2,000/);
  await screenshots('aircon');
  await page.locator('#sn-create-booking-form [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#sn-create-booking-form [type="submit"]')?.textContent === 'Booking Submitted');
  assert.equal(submitted.amount, 2000);
  assert.equal(submitted.service, 'Aircon Cleaning');
  assert.equal(submitted.provider_service_id, 73);
  assert.equal(submitted.service_details.answers['Number of units'], '2');
  await page.goto(`${base}/pages/customer/bookings/bookings.html?provider_id=${provider.id}`);
  await page.locator('#sn-appliance-specific-service').waitFor();
  await page.locator('#sn-booking-time').selectOption('09:00 AM');
  await page.locator('#sn-booking-service').selectOption('TV / Electronics');
  assert.deepEqual(await page.locator('#sn-appliance-specific-service option').evaluateAll(options => options.map(option => option.value)), ['tv', 'electronics']);
  await page.locator('#sn-booking-service').selectOption('Aircon');
  assert.equal(await page.locator('#sn-appliance-specific-service').count(), 0);
  assert.equal(await page.locator('[name="appliance_unit_type"]').count(), 1);
  for (const [service, panel] of [['Cleaning', '#sn-cleaning-assessment'], ['Personal Care', '#sn-personal-care-assessment'], ['Appliance repair', '#sn-repair-assessment']]) {
   await page.locator('#sn-booking-service').selectOption(service);
   assert.equal(await page.locator(panel).isVisible(), true);
   assert.equal(await page.locator('#sn-appliance-assessment').isVisible(), false);
  }
  await page.locator('#sn-booking-service').selectOption('Refrigerator');
  await fillQuestions('refrigerator');
  await page.locator('[name="appliance_refrigerator_type"]').selectOption('Double-door');
  await page.locator('[name="appliance_cooling_issue"]').selectOption('Yes');
  await page.locator('[name="appliance_leaking"]').selectOption('Yes');
  await page.locator('[name="appliance_turning_on"]').selectOption('No');
  const media = page.locator('#sn-appliance-media');
  await media.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
  assert.equal(await media.evaluate(input => input.validity.valid), false);
  const photo = { name: 'appliance.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1hYAAAAASUVORK5CYII=', 'base64') };
  await media.setInputFiles(Array.from({ length: 4 }, (_, i) => ({ ...photo, name: `photo-${i}.png` })));
  assert.equal(await media.evaluate(input => input.validity.valid), false);
  await media.setInputFiles([photo]);
  assert.equal(await media.evaluate(input => input.validity.valid), true);
  await screenshots('refrigerator');
  await page.locator('#sn-create-booking-form [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#sn-create-booking-form [type="submit"]')?.textContent === 'Booking Submitted');
  assert.equal(submitted.service, 'Refrigerator');
  assert.equal(submitted.pricing_type, 'provider_quote');
  assert.equal(submitted.service_details.answers['Is there a cooling issue?'], 'Yes');
  assert.equal(submitted.service_details.answers['Is it turning on?'], 'No');
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].filename, 'appliance.png');
  assert.equal(attachments[0].mimeType, 'image/png');
  const customerDetails = await page.evaluate(details => bookingServiceDetailRows(details), bookings[1].service_details);
  assert.match(customerDetails, /Sample diagnostic estimate/);
  assert.match(customerDetails, /Double-door/);
  assert.match(customerDetails, /appliance.png/);
  const providerPage = await context.newPage();
  providerPage.on('pageerror', error => errors.push(error.stack));
  await providerPage.goto(`${base}/pages/provider/requests/requests.html`);
  const providerCard = providerPage.locator('[data-booking-card="102"]');
  await providerCard.waitFor();
  assert.match(await providerCard.innerText(), /Double-door/);
  assert.match(await providerCard.innerText(), /not the final repair price/);
  assert.equal(await providerCard.getByRole('link', { name: 'appliance.png' }).getAttribute('href'), '/uploads/booking-media/appliance.png');
  assert.deepEqual(errors, []);
  console.log('PASS: appliance forms, pricing, assessment answers, optional uploads, offering limits, category switching, customer/provider details and desktop/mobile layouts.');
  console.log('Screenshots saved in', os.tmpdir());
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
