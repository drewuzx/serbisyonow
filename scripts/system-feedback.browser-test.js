'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const f = await startQrFixture();
 let browser;
 const errors = [];
 try {
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  async function accountPage(role, token) {
   const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
   await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === f.base) return route.continue();
    return route.fulfill({ body: '', contentType: url.hostname.includes('fonts') ? 'text/css' : 'application/javascript' });
   });
   const user = role === 'admin' ? token : (await f.request(`/api/auth/${role}/session`, 'GET', undefined, token)).data.user;
   await context.addInitScript(({ role, user }) => localStorage.setItem(`sn_${role}_user`, JSON.stringify(user)), { role, user });
   const page = await context.newPage();
   page.on('pageerror', error => errors.push(`${role}: ${error.message}`));
   await page.clock.install();
   return page;
  }
  async function loaded(page, role, id) {
   await page.locator('.sn-feedback-launch').waitFor();
   await page.waitForFunction(({role,id}) => Object.hasOwn(JSON.parse(localStorage.getItem(`sn_system_feedback_${role}_${id}`) || '{}'), 'submitted_until'), {role,id});
  }
  async function checkLayout(page, label) {
   for (const [width, height] of [[1440,1000],[390,850],[320,700],[640,360]]) {
    await page.setViewportSize({ width, height });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page overflow at ${width}`);
    const result = await page.locator('.sn-feedback-panel').evaluate(panel => {
     const box = panel.getBoundingClientRect();
     const launch = document.querySelector('.sn-feedback-launch').getBoundingClientRect();
     const chat = document.querySelector('.sn-float-launch')?.getBoundingClientRect();
     const issues = [];
     if (box.left < 0 || box.right > innerWidth || box.top < 0 || box.bottom > innerHeight) issues.push('Panel outside viewport');
     if (box.bottom > launch.top) issues.push('Panel overlaps its launcher');
     if (chat && launch.bottom > chat.top) issues.push('Rating launcher overlaps chat');
     if (panel.scrollWidth > panel.clientWidth + 1) issues.push('Panel content overflows');
     for (const button of panel.querySelectorAll('button')) if (button.getClientRects().length && button.scrollWidth > button.clientWidth + 1) issues.push('Button text clips');
     return issues;
    });
    assert.deepEqual(result, [], `${label}: layout at ${width}x${height}`);
    if (width === 1440 || width === 390) await page.screenshot({ path: path.join(os.tmpdir(), `system-feedback-${label}-${width}.png`) });
   }
   await page.setViewportSize({ width: 1440, height: 1000 });
  }

  const provider = await accountPage('provider', f.providerToken);
  await provider.goto(`${f.base}/pages/provider/dashboard/dashboard.html`);
  await loaded(provider, 'provider', 81);
  await provider.getByRole('button', { name: 'Rate SerbisyoNow', exact: true }).click();
  const panel = provider.locator('.sn-feedback-panel');
  assert.equal(await panel.getByRole('button', { name: 'Submit Feedback' }).isDisabled(), true);
  await panel.getByRole('radio', { name: '1 star', exact: true }).focus();
  await provider.keyboard.press('ArrowRight');
  assert(await panel.getByRole('radio', { name: '2 stars', exact: true }).isChecked());
  await panel.getByRole('radio', { name: '4 stars', exact: true }).check();
  const comment = 'Helpful system. <img src=x onerror="window.feedbackXss=true">';
  await panel.getByLabel('Comment (optional)').fill(comment);
  await checkLayout(provider, 'provider');
  await provider.clock.runFor(3500);
  assert.equal(await panel.locator('textarea').inputValue(), comment, 'Idle refresh preserves draft');
  await provider.evaluate(() => {
   const modal = document.createElement('div'); modal.id = 'fixture-payment-modal'; modal.setAttribute('aria-modal','true'); modal.textContent = 'Payment test'; document.body.appendChild(modal);
  });
  await provider.locator('.sn-feedback-root').waitFor({ state: 'hidden' });
  await provider.evaluate(() => document.getElementById('fixture-payment-modal').remove());
  await panel.waitFor({ state: 'visible' });
  assert.equal(await panel.locator('textarea').inputValue(), comment);
  let failed = false;
  await provider.route('**/api/system-feedback', route => {
   if (route.request().method() === 'POST' && !failed) { failed = true; return route.abort('failed'); }
   return route.continue();
  });
  await panel.getByRole('button', { name: 'Submit Feedback' }).click();
  await panel.getByRole('alert').waitFor();
  assert.equal(await panel.locator('textarea').inputValue(), comment, 'Failed submission preserves comment');
  assert(await panel.getByRole('radio', { name: '4 stars', exact: true }).isChecked());
  await panel.getByRole('button', { name: 'Submit Feedback' }).click();
  await panel.locator('.sn-feedback-thanks').waitFor();
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM admin_feedback')).rows[0].count, 1);
  await provider.getByRole('button', { name: 'Close feedback', exact: true }).click();
  await provider.reload();
  await loaded(provider, 'provider', 81);
  await provider.clock.runFor(95000);
  assert(await panel.isHidden(), 'Submitted ratings are not automatically prompted again');
  await provider.getByRole('button', { name: 'Rate SerbisyoNow', exact: true }).click();
  await panel.locator('.sn-feedback-thanks').waitFor();
  assert.equal(await panel.locator('form').isHidden(), true);

  await f.db.query('INSERT INTO admins (username,password_hash) VALUES ($1,$2)', ['feedback-browser-admin', await bcrypt.hash('fixture-password',4)]);
  const adminUser = (await f.request('/api/auth/admin/login','POST',{username:'feedback-browser-admin',password:'fixture-password'},'')).data.user;
  const admin = await accountPage('admin', adminUser);
  await admin.goto(`${f.base}/pages/admin/feedback/feedback.html`);
  await admin.waitForFunction(() => document.querySelector('#feedback-count').textContent === '1 of 1 records');
  assert.equal(await admin.locator('.sn-feedback-root').count(), 0);
  assert.equal(await admin.locator('#feedback-list img').count(), 0, 'Comments are escaped');
  assert.equal(await admin.evaluate(() => window.feedbackXss), undefined);
  assert((await admin.locator('#feedback-list').innerText()).includes(comment));

  const customer = await accountPage('customer', f.customerToken);
  await customer.goto(`${f.base}/pages/customer/dashboard/dashboard.html`);
  await loaded(customer, 'customer', 61);
  await customer.getByRole('button', { name: 'Rate SerbisyoNow', exact: true }).click();
  await customer.getByRole('radio', { name: '5 stars', exact: true }).check();
  await checkLayout(customer, 'customer');
  await customer.getByRole('button', { name: 'Submit Feedback', exact: true }).click();
  await customer.locator('.sn-feedback-thanks').waitFor();
  await admin.bringToFront();
  await admin.clock.runFor(3500);
  await admin.waitForFunction(() => document.querySelector('#feedback-count').textContent === '2 of 2 records');
  await admin.getByLabel('Account type', {exact:true}).selectOption('provider');
  await admin.getByLabel('Rating', {exact:true}).selectOption('1');
  assert((await admin.locator('#feedback-list').innerText()).includes('No feedback matches'));
  await admin.getByLabel('Rating', {exact:true}).selectOption('4');
  await admin.locator('[data-feedback-status]').selectOption('review');
  await admin.getByText('Feedback status updated.', {exact:true}).waitFor();
  assert.equal(await admin.getByLabel('Account type', {exact:true}).inputValue(), 'provider');
  assert.equal(await admin.getByLabel('Rating', {exact:true}).inputValue(), '4');
  await admin.getByLabel('Account type', {exact:true}).selectOption('all');
  await admin.getByLabel('Rating', {exact:true}).selectOption('all');
  for (const width of [1440,390,320]) {
   await admin.setViewportSize({width,height:1000});
   assert(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Admin overflow at ${width}`);
   if (width !== 320) await admin.screenshot({path:path.join(os.tmpdir(),`system-feedback-admin-${width}.png`),fullPage:true});
  }

  const idle = await accountPage('customer', f.otherCustomerToken);
  await idle.goto(`${f.base}/pages/customer/dashboard/dashboard.html`);
  await loaded(idle, 'customer', 62);
  const delay = await idle.evaluate(() => JSON.parse(localStorage.getItem('sn_system_feedback_customer_62')).auto_after - Date.now());
  assert(delay >= 44000 && delay <= 90000, 'Automatic delay is randomized between 45 and 90 seconds');
  await idle.evaluate(() => { const input=document.createElement('textarea'); input.id='fixture-draft'; document.body.prepend(input); input.focus(); });
  await idle.clock.runFor(95000);
  assert(await idle.locator('.sn-feedback-panel').isHidden(), 'Automatic prompts do not interrupt a focused input');
  await idle.evaluate(() => document.getElementById('fixture-draft').remove());
  await idle.mouse.move(10,10);
  await idle.clock.runFor(3200);
  await idle.locator('.sn-feedback-panel').waitFor();
  assert.equal(await idle.evaluate(() => document.activeElement === document.body),true,'Automatic prompts never steal focus');
  await idle.getByRole('button',{name:'Not now',exact:true}).click();
  await idle.reload();
  await loaded(idle,'customer',62);
  await idle.clock.runFor(95000);
  assert(await idle.locator('.sn-feedback-panel').isHidden(),'Dismissal persists across reloads');
  await idle.getByRole('button',{name:'Open chats',exact:true}).click();
  await idle.locator('.sn-feedback-root').waitFor({state:'hidden'});
  await idle.locator('[data-float-list-close]').click();
  await idle.locator('.sn-feedback-root').waitFor({state:'visible'});
  await idle.getByRole('button',{name:'Rate SerbisyoNow',exact:true}).click();
  await idle.keyboard.press('Escape');
  assert(await idle.locator('.sn-feedback-panel').isHidden());
  assert.equal(await idle.evaluate(() => document.activeElement.classList.contains('sn-feedback-launch')),true);

  const anonymous = await browser.newPage();
  await anonymous.goto(`${f.base}/pages/admin/feedback/feedback.html`);
  await anonymous.locator('#feedback-login').waitFor();
  assert.equal(await anonymous.locator('.admin-feedback-rating').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: customer/provider submission, keyboard stars, empty comments, retry/draft preservation, random idle prompt, dismissal/submission cooldowns, chat/modal coexistence, admin privacy/filters/live refresh, and responsive screenshots.');
 } finally { if (browser) await browser.close(); await f.close(); }
}
main().catch(error => {console.error(error);process.exitCode=1;});
