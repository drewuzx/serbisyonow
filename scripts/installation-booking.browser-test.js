'use strict';

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const Busboy = require('busboy');
const path = require('node:path');
const os = require('node:os');
const pricing = require('../shared/js/installationPricing');
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
  const customer = { id: 987001, full_name: 'Installation Test Customer', address: 'Test address, Angeles City', verification_status: 'verified', is_verified: true };
  const provider = { id: 987002, full_name: 'Installation Test Provider', service: 'Installation Services', category: 'Installation Services', verification_status: 'verified', is_verified: true };
  const services = [
   { id: 75, title: 'Installation Services' }, { id: 76, title: 'Furniture assembly' },
   { id: 77, title: 'Cabinet installation' }, { id: 78, title: 'Curtain or blinds installation' },
   { id: 79, title: 'Lighting installation' }, { id: 80, title: 'CCTV installation' },
   { id: 81, title: 'Internet or router setup' }, { id: 82, title: 'Appliance Installation' },
   { id: 83, title: 'Home Installation' },
   { id: 71, title: 'Cleaning', category: 'Cleaning' }, { id: 72, title: 'Personal Care', category: 'Personal Care' },
   { id: 73, title: 'Appliance Maintenance', category: 'Appliance Maintenance' },
   { id: 74, title: 'Plumbing services', category: 'Repair Services' },
  ].map(service => ({ category: 'Installation Services', ...service, is_active: true, starting_price: 500, max_price: 1500 }));
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
  let page;
  async function openForm() {
   if (page) await page.close();
   page = await context.newPage();
   page.on('pageerror', error => errors.push(error.stack));
   await page.goto(`${base}/pages/customer/bookings/bookings.html?provider_id=${provider.id}`);
   await page.locator('#sn-installation-specific-service').waitFor();
   await page.locator('#sn-booking-time').selectOption('09:00 AM');
  }
  const input = key => page.locator(`[name="installation_${key}"]`);
  const selectService = key => page.locator('#sn-installation-specific-service').selectOption(key);
  async function fillRequired(key) {
   for (const field of pricing.fields(key)) {
    if (field.type !== 'text' || field.required === false || field.when) continue;
    await input(field.key).fill(field.key === 'dimensions' ? '80 x 60 x 40 cm' : 'Test brand');
   }
  }
  async function checkLayout() {
   const hiddenSidebar = page.locator('.sn-shell');
   if (await page.evaluate(() => innerWidth < 940) && await hiddenSidebar.evaluate(shell => shell.classList.contains('sidebar-open'))) await page.locator('#sn-hamburger').click();
   if (await page.evaluate(() => innerWidth < 940)) await page.waitForFunction(() => document.getElementById('sn-sidebar').getBoundingClientRect().right <= 0);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
   assert.equal(await page.locator('#sn-installation-assessment label > span').evaluateAll(labels => labels.some(label => label.scrollWidth > label.clientWidth + 1)), false, 'no clipped question labels');
   assert.equal(await page.locator('#sn-installation-assessment input, #sn-installation-assessment select').evaluateAll(controls => controls.some(control => {
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
    await page.screenshot({ path: path.join(os.tmpdir(), `installation-${label}-${width}.png`), fullPage: true, animations: 'disabled' });
   }
  }
  await openForm();
  assert.equal(await page.locator('#sn-booking-custom-amount').isDisabled(), true);
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: 950 });
   for (const key of Object.keys(pricing.configs)) {
    await selectService(key);
    await fillRequired(key);
    assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), true, key);
    assert.match(await page.locator('.sn-installation-price-summary').innerText(), /Sample estimated (price|range)/);
    await checkLayout();
   }
  }
  await selectService('lighting installation');
  assert.equal(await input('new_wiring').inputValue(), 'No');
  assert.equal(await input('other_fixture').isDisabled(), true);
  await selectService('internet / router setup');
  assert.equal(await input('new_wiring').inputValue(), 'No');
  await input('package').selectOption('Mesh setup');
  await input('devices').fill('8');
  await input('access_points').fill('3');
  assert.match(await page.locator('.sn-installation-total').innerText(), /PHP 1,245/);
  await input('new_wiring').selectOption('Yes');
  assert.match(await page.locator('.sn-installation-total').innerText(), /PHP 1,695 - PHP 2,595/);
  assert.equal(await page.locator('.sn-calculated-head > span').innerText(), 'Assessment / Quote');

  await selectService('curtain / blinds installation');
  assert.equal(await input('width_m').isDisabled(), true);
  await input('covering_type').selectOption('Roller blinds');
  await input('windows').fill('3');
  await input('window_size').selectOption('Medium');
  await input('installation_type').selectOption('New brackets / track');
  assert.match(await page.locator('.sn-installation-total').innerText(), /PHP 1,425/);
  await input('window_size').selectOption('Custom width');
  assert.equal(await input('width_m').isDisabled(), false);
  await input('width_m').fill('2.5');
  assert.match(await page.locator('.sn-installation-total').innerText(), /PHP 2,175/);
  await input('windows').fill('');
  assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), false);
  assert.doesNotMatch(await page.locator('.sn-installation-price-summary').innerText(), /NaN/);

  await selectService('cctv installation');
  await input('cameras').fill('4');
  await input('environment').selectOption('Outdoor');
  await input('existing_wiring').selectOption('No');
  await input('storage').selectOption('New DVR / NVR setup');
  await input('floors').fill('2');
  assert.match(await page.locator('.sn-installation-total').innerText(), /PHP 4,750/);
  await screenshots('cctv');
  await page.locator('#sn-create-booking-form [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#sn-create-booking-form [type="submit"]')?.textContent === 'Booking Submitted');
  assert.equal(submitted.service, 'CCTV Installation');
  assert.equal(submitted.provider_service_id, 75);
  assert.equal(submitted.amount, 4750);
  assert.equal(submitted.service_details.answers['Number of cameras'], '4');

  await openForm();
  await page.locator('#sn-booking-service').selectOption('Home Installation');
  assert.equal(await page.locator('#sn-installation-specific-service option').count(), 7);
  for (const [service, key] of [['Furniture assembly', 'furniture installation'], ['Cabinet installation', 'cabinet installation'], ['Curtain or blinds installation', 'curtain / blinds installation'], ['Internet or router setup', 'internet / router setup'], ['Appliance Installation', 'appliance installation']]) {
   await page.locator('#sn-booking-service').selectOption(service);
   assert.equal(await page.locator('#sn-installation-specific-service').count(), 0);
   assert.equal(await page.locator('#sn-installation-assessment').getAttribute('data-service-key'), key);
  }
  await fillRequired('appliance installation');
  assert.equal(await input('additional_materials').inputValue(), 'No');
  await input('appliance_type').selectOption('Other');
  assert.equal(await input('other_appliance').isDisabled(), false);
  assert.equal(await page.locator('#sn-create-booking-form').evaluate(form => form.checkValidity()), false);
  await input('other_appliance').fill('Water dispenser');
  await input('location').selectOption('Other');
  await input('other_location').fill('Dining area');
  await screenshots('appliance');
  for (const [service, panel] of [['Cleaning', '#sn-cleaning-assessment'], ['Personal Care', '#sn-personal-care-assessment'], ['Appliance Maintenance', '#sn-appliance-assessment'], ['Plumbing services', '#sn-repair-assessment']]) {
   await page.locator('#sn-booking-service').selectOption(service);
   assert.equal(await page.locator(panel).isVisible(), true);
   assert.equal(await page.locator('#sn-installation-assessment').isVisible(), false);
  }

  await page.locator('#sn-booking-service').selectOption('Furniture assembly');
  await input('units').fill('2');
  await input('product_url').fill('javascript:alert(1)');
  assert.match(await page.locator('.sn-installation-price-summary').innerText(), /http:\/\/ or https:\/\//);
  await input('product_url').fill('https://example.com/furniture/chair');
  await input('ready_to_assemble').selectOption('No');
  assert.match(await page.locator('.sn-installation-total').innerText(), /PHP 1,000 - PHP 1,900/);
  const media = page.locator('#sn-installation-media');
  const photo = { name: 'furniture.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1hYAAAAASUVORK5CYII=', 'base64') };
  await media.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
  assert.equal(await media.evaluate(control => control.validity.valid), false);
  await media.setInputFiles(Array.from({ length: 4 }, (_, i) => ({ ...photo, name: `photo-${i}.png` })));
  assert.equal(await media.evaluate(control => control.validity.valid), false);
  await media.setInputFiles(photo);
  assert.equal(await media.evaluate(control => control.validity.valid), true);
  await screenshots('furniture');
  await page.locator('#sn-create-booking-form [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#sn-create-booking-form [type="submit"]')?.textContent === 'Booking Submitted');
  assert.equal(submitted.service, 'Furniture Installation');
  assert.equal(submitted.provider_service_id, '76');
  assert.equal(submitted.pricing_type, 'provider_quote');
  assert.equal(submitted.service_details.answers['Ready-to-assemble?'], 'No');
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].filename, 'furniture.png');
  const customerDetails = await page.evaluate(details => bookingServiceDetailRows(details), bookings[1].service_details);
  assert.match(customerDetails, /Open product link/);
  assert.match(customerDetails, /https:\/\/example.com\/furniture\/chair/);
  assert.match(customerDetails, /furniture.png/);
  const unsafeDetails = await page.evaluate(() => bookingServiceDetailRows({ product_url: 'javascript:alert(1)', answers: { 'Product link': 'javascript:alert(1)' } }));
  assert.doesNotMatch(unsafeDetails, /href="javascript:/);
  await page.close();

  const providerPage = await context.newPage();
  providerPage.on('pageerror', error => errors.push(error.stack));
  await providerPage.goto(`${base}/pages/provider/requests/requests.html`);
  const card = providerPage.locator('[data-booking-card="102"]');
  await card.waitFor();
  assert.match(await card.innerText(), /Furniture Installation/);
  assert.match(await card.innerText(), /Ready-to-assemble\?/);
  assert.match(await card.innerText(), /final quotation for your approval/);
  assert.equal(await card.getByRole('link', { name: 'Open product link' }).getAttribute('href'), 'https://example.com/furniture/chair');
  assert.equal(await card.getByRole('link', { name: 'furniture.png' }).getAttribute('href'), '/uploads/booking-media/furniture.png');
  assert.deepEqual(errors, []);
  console.log('PASS: all seven installation forms, calculated prices and quote ranges, aliases, conditional fields, uploads, product links, saved customer/provider details and desktop/mobile layouts.');
  console.log('Screenshots saved in', os.tmpdir());
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
