'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const f = await startQrFixture(); let browser;
 try {
  await f.db.query("UPDATE providers SET full_name='Drew Wu',service='Plumbing services',category='Repair Services' WHERE id=81");
  await f.db.query("UPDATE providers SET full_name='Pending Cleaner',is_verified=FALSE,verification_status='pending' WHERE id=82");
  await f.db.query('DELETE FROM provider_services');
  await f.db.query(`INSERT INTO provider_services(provider_id,title,category,starting_price,max_price,is_active) VALUES
   (81,'Appliance repair','Repair Services',500,2000,TRUE),(81,'Gardening','Outdoor and Property Maintenance',200,400,FALSE),
   (82,'House Cleaning','Cleaning Services',400,800,TRUE)`);
  for (const q of ['Drew', 'repair', 'Appliance', 'REPAIR SERVICES']) {
   const result = await f.request(`/api/providers/search?q=${encodeURIComponent(q)}`);
   assert.equal(result.status, 200); assert.deepEqual(result.data.providers.map(p => p.id), [81]);
   assert.deepEqual(result.data.providers[0].matched_services, ['Appliance repair']);
  }
  for (const q of ['Gardening', 'Cleaning', 'NoSuchService987']) assert.equal((await f.request(`/api/providers/search?q=${q}`)).data.providers.length, 0);
  const customer = (await f.request('/api/auth/customer/session')).data.user;
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(user => localStorage.setItem('sn_customer_user', JSON.stringify(user)), customer);
  await context.route('**/*', route => new URL(route.request().url()).origin === f.base ? route.continue() : route.fulfill({ body: '', contentType: 'text/css' }));
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  const home = () => page.goto(f.base + '/pages/customer/dashboard/dashboard.html');
  await home();
  const input = page.locator('#sn-home-search-input'), panel = page.locator('#sn-home-search-results');
  await input.waitFor();
  for (const q of ['Drew', 'Repair Services', 'Appliance']) {
   await input.fill(q); await panel.getByText('Drew Wu', { exact: true }).waitFor();
   assert.match(await panel.textContent(), /Appliance repair/); assert.match(await panel.textContent(), /PHP 500/);
  }
  for (const width of [320, 390, 768, 1440]) {
   await page.setViewportSize({ width, height: 900 });
   await input.focus(); await input.fill('Appliance'); await panel.getByText('Drew Wu', { exact: true }).waitFor();
   const box = await panel.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
   await page.screenshot({ path: path.join(os.tmpdir(), `dashboard-search-${width}.png`) });
  }
  await input.fill('NoSuchService987'); await panel.getByText('No available services or providers match your search.', { exact: true }).waitFor();
  assert.equal(await panel.locator('li').count(), 0);
  await input.fill(''); await panel.waitFor({ state: 'hidden' });
  await input.fill('Drew'); await panel.getByText('Drew Wu', { exact: true }).waitFor();
  await input.press('Escape'); await panel.waitFor({ state: 'hidden' });
  await input.fill('Appliance'); await panel.getByText('Drew Wu', { exact: true }).waitFor();
  await page.locator('.sn-hero-eyebrow').click(); await panel.waitFor({ state: 'hidden' });
  await input.focus(); await panel.getByText('Drew Wu', { exact: true }).waitFor();
  await input.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForURL('**/provider-profile/provider-profile.html?id=81');
  await home(); await input.fill('Repair Services'); await input.press('Enter');
  await page.waitForURL('**/search/search.html?q=Repair+Services');
  await page.locator('.sn-result-name').filter({ hasText: 'Drew Wu' }).waitFor();
  await home();
  let fail = true;
  await page.route('**/api/providers/search?**', async route => {
   if (fail) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
   return route.continue();
  });
  await input.fill('Appliance'); await panel.getByText('Search is unavailable right now. Please try again.', { exact: true }).waitFor();
  fail = false; await panel.getByRole('button', { name: 'Retry' }).click();
  await panel.getByText('Drew Wu', { exact: true }).waitFor();
  await page.unroute('**/api/providers/search?**');
  await page.route('**/api/providers/search?**', async route => {
   if (new URL(route.request().url()).searchParams.get('q') === 'slow') {
    await new Promise(resolve => setTimeout(resolve, 600));
    return route.fulfill({ json: { providers: [{ id: 82, full_name: 'Stale result' }] } }).catch(() => {});
   }
   return route.continue();
  });
  await input.fill('slow'); await page.waitForRequest(request => new URL(request.url()).searchParams.get('q') === 'slow');
  await input.fill('Drew'); await panel.getByText('Drew Wu', { exact: true }).waitFor();
  await page.waitForTimeout(700); assert.doesNotMatch(await panel.textContent(), /Stale result/);
  await input.fill(''); await panel.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('PASS: provider/category/service searches, active verified offerings only, no matches, keyboard/Enter navigation, error retry, stale-response protection, clear/dismiss, and four responsive widths.');
 } finally { await browser?.close(); await f.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
