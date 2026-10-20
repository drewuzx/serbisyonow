'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const f = await startQrFixture(); let browser;
 try {
  await f.db.query("UPDATE providers SET full_name=CASE WHEN id=81 THEN 'Drew Wu' ELSE 'Alexandra Mae Villanueva-Santiago' END,address='9th St. Plaridel 2, Amsic, Angeles City, Pampanga, 2009',service='Appliance repair'");
  await f.db.query('UPDATE provider_services SET starting_price=500,max_price=2000');
  await f.db.query('INSERT INTO profile_photos(provider_id,content) VALUES(81,$1)', [await sharp(f.image).jpeg().toBuffer()]);
  const customer = (await f.request('/api/auth/customer/session')).data.user;
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(user => localStorage.setItem('sn_customer_user', JSON.stringify(user)), customer);
  await context.route('**/*', route => new URL(route.request().url()).origin === f.base ? route.continue() : route.fulfill({ body: '', contentType: 'text/css' }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 390, 700, 768, 1024, 1440, 1920]) {
   await page.setViewportSize({ width, height: 1000 });
   await page.goto(f.base + '/pages/customer/search/search.html');
   const card = page.locator('.sn-result-card').filter({ hasText: 'Drew Wu' });
   await card.waitFor();
   await card.scrollIntoViewIfNeeded();
   await page.waitForFunction(() => document.querySelector('[data-photo-target="provider/81"] img')?.naturalWidth > 0);
   const issues = await page.locator('.sn-result-card').evaluateAll(cards => cards.flatMap(card => {
    const bounds = card.getBoundingClientRect(), failures = [];
    for (const node of card.querySelectorAll('a, button, .sn-result-img, .sn-result-body, .sn-result-actions, .sn-result-price-wrap')) {
     const rect = node.getBoundingClientRect();
     if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1) failures.push(`${node.className}: outside card`);
    }
    const image = card.querySelector('.sn-result-img').getBoundingClientRect();
    const body = card.querySelector('.sn-result-body').getBoundingClientRect();
    if (Math.abs(image.top - body.top) > 1) failures.push('Photo and details not top-aligned');
    const links = [...card.querySelectorAll('.sn-result-actions > a')].map(node => node.getBoundingClientRect());
    if (Math.abs(links[0].width - links[1].width) > 1) failures.push('Unequal action widths');
    return failures;
   }));
   assert.deepEqual(issues, [], `${width}px`);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}px page overflow`);
   assert.match(await card.locator('.sn-result-price').textContent(), /PHP 500/);
   assert.match(await card.getByRole('link', { name: 'View Profile' }).getAttribute('href'), /id=81$/);
   assert.match(await card.getByRole('link', { name: 'Book Now' }).getAttribute('href'), /provider_id=81$/);
   await card.screenshot({ path: path.join(os.tmpdir(), `search-result-aligned-${width}.png`) });
  }
  const favorite = page.locator('.sn-result-card').filter({ hasText: 'Drew Wu' }).getByRole('button', { name: /Favorite provider/ });
  await favorite.click();
  await page.waitForFunction(() => document.querySelector('.sn-fav-btn[data-provider-id="81"]')?.classList.contains('sn-fav-btn--active'));
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM customer_favorites WHERE customer_id=61 AND provider_id=81')).rows[0].count, 1);
  assert.deepEqual(errors, []);
  console.log('PASS: seven viewport widths, aligned photos/details, contained actions, matching button widths, saved rates, navigation links, and favorite interaction.');
 } finally { await browser?.close(); await f.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
