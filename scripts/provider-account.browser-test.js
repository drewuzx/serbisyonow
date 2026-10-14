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
  try {
    await f.db.query('UPDATE providers SET password_hash = $1, description = $2 WHERE id = 81', [await bcrypt.hash('Original-Password', 4), 'Reliable cleaning services.']);
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === f.base || url.protocol === 'blob:') return route.continue();
      return route.fulfill({ body: '', contentType: url.pathname.endsWith('.css') || url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'application/javascript' });
    });
    const user = (await f.request('/api/auth/provider/session', 'GET', undefined, f.providerToken)).data.user;
    await context.addInitScript(user => { if (!localStorage.getItem('sn_provider_user')) localStorage.setItem('sn_provider_user', JSON.stringify(user)); }, user);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${f.base}/pages/provider/profile/profile.html`);
    const view = page.locator('#sn-provider-profile-view');
    await view.getByText('January 1, 2000', { exact: true }).waitFor();
    await page.locator('#sn-provider-account-status').getByText('Service Provider', { exact: true }).waitFor();
    assert.equal(await page.locator('#sn-provider-profile-form').isVisible(), false);
    await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
    assert.equal(await page.getByLabel('Email', { exact: true }).getAttribute('readonly'), '');
    assert.equal(await page.getByLabel('Date of Birth', { exact: true }).inputValue(), '2000-01-01');
    await page.getByLabel('Full Name', { exact: true }).fill('Cancelled draft');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await view.getByText('Cancelled draft').count(), 0);
    await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
    assert.equal(await page.getByLabel('Full Name', { exact: true }).inputValue(), user.full_name);
    await page.getByLabel('Full Name', { exact: true }).fill('Updated Profile Provider');
    await page.getByLabel('Gender', { exact: true }).selectOption('Prefer not to say');
    await page.getByLabel('Date of Birth', { exact: true }).fill('1995-06-15');
    await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
    await page.locator('#sn-provider-profile-status').filter({ hasText: 'Profile saved successfully.' }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await view.getByText('June 15, 1995', { exact: true }).waitFor();
    await view.getByText('Prefer not to say', { exact: true }).waitFor();

    const current = page.getByLabel('Current Password', { exact: true });
    const next = page.getByLabel('New Password', { exact: true });
    const confirm = page.getByLabel('Confirm New Password', { exact: true });
    const submit = page.getByRole('button', { name: 'Update Password', exact: true });
    const notice = page.locator('#sn-provider-password-status');
    await submit.click();
    await notice.filter({ hasText: 'fill in all password fields' }).waitFor();
    await current.fill('wrong-password');
    await next.fill('Updated-Password');
    await confirm.fill('Mismatch-Password');
    await submit.click();
    await notice.filter({ hasText: 'do not match' }).waitFor();
    await confirm.fill('Updated-Password');
    await submit.click();
    await notice.filter({ hasText: 'Current password is incorrect' }).waitFor();
    assert.equal(await next.inputValue(), 'Updated-Password');
    await current.fill('Original-Password');
    await page.getByLabel('Show passwords', { exact: true }).check();
    assert.equal(await current.getAttribute('type'), 'text');
    await page.getByRole('heading', { name: 'Account Status', exact: true }).click();
    await f.db.query("UPDATE providers SET verification_status = 'pending', is_verified = FALSE WHERE id = 81");
    await page.locator('#sn-provider-account-status').getByText('Pending', { exact: true }).waitFor({ timeout: 12000 });
    assert.equal(await current.inputValue(), 'Original-Password');
    assert.equal(await next.inputValue(), 'Updated-Password');
    let failRequest = true;
    await page.route('**/api/provider/81/change-password', async route => {
      if (failRequest) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Test connection failure. Try again.' }) });
      await new Promise(resolve => setTimeout(resolve, 1000));
      return route.continue();
    });
    await submit.click();
    await notice.filter({ hasText: 'Test connection failure' }).waitFor();
    assert.equal(await current.inputValue(), 'Original-Password');
    failRequest = false;
    await submit.click();
    await page.getByRole('button', { name: 'Updating...', exact: true }).waitFor();
    assert.equal(await current.isDisabled(), true);
    await notice.filter({ hasText: 'Password updated.' }).waitFor();
    assert.equal(await current.inputValue(), '');
    assert.equal(await current.getAttribute('type'), 'password');
    assert.equal(await page.getByLabel('Show passwords').isChecked(), false);
    assert.equal((await f.request('/api/auth/provider/session', 'GET', undefined, f.providerToken)).status, 200);
    assert.equal((await f.request('/api/auth/provider/login', 'POST', { email: user.email, password: 'Original-Password' }, null)).status, 401);
    assert.equal((await f.request('/api/auth/provider/login', 'POST', { email: user.email, password: 'Updated-Password' }, null)).status, 200);
    await page.reload();
    await view.getByText('June 15, 1995', { exact: true }).waitFor();
    assert.equal(await current.inputValue(), '');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sn_provider_user')).auth_token), f.providerToken);
    assert.ok(await page.getByRole('link', { name: 'Forgot Password?' }).getAttribute('href').then(href => href.endsWith('?role=provider')));
    await page.getByRole('heading', { name: 'Credentials & Proof of Work', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Downpayment Account', exact: true }).waitFor();
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow at ${width}`);
      for (const button of await page.locator('.sn-panel button:visible').all()) assert.ok(await button.evaluate(node => node.scrollWidth <= node.clientWidth + 2), `button clipping at ${width}`);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(os.tmpdir(), `provider-account-${width}.png`), fullPage: true });
    }
    await f.db.query("UPDATE providers SET auth_provider = 'google' WHERE id = 81");
    await current.fill('Updated-Password');
    await next.fill('Another-Password');
    await confirm.fill('Another-Password');
    await submit.click();
    await notice.filter({ hasText: 'Google sign-in' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Provider account browser checks passed: profile view/edit/cancel, saved personal details, date accuracy, account status, password errors/retry/change, retained drafts during idle refresh, persistent current session, Google recovery, and five responsive widths.');
  } finally { if (browser) await browser.close(); await f.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
