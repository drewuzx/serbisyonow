'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
  const f = await startQrFixture();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === f.base || url.protocol === 'blob:') return route.continue();
      return route.fulfill({ body: '', contentType: url.pathname.endsWith('.css') || url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'application/javascript' });
    });
    const user = (await f.request('/api/auth/provider/session', 'GET', undefined, f.providerToken)).data.user;
    await context.addInitScript(user => localStorage.setItem('sn_provider_user', JSON.stringify(user)), user);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${f.base}/pages/provider/profile/profile.html`);
    const description = page.getByLabel('Description', { exact: true });
    await description.waitFor();
    const descriptionText = 'Reliable cleaning services.\n' + 'A detailed provider description. '.repeat(20) + '<img src=x onerror=alert(1)>';
    await description.fill(descriptionText);
    await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
    await page.locator('#sn-provider-profile-status').filter({ hasText: 'Profile saved successfully' }).waitFor();
    await page.reload();
    await description.waitFor();
    assert.equal(await description.inputValue(), descriptionText);

    const draft = 'Unsaved description stays while uploading.';
    await description.fill(draft);
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload Credentials', exact: true }).click();
    await (await picker).setFiles({ name: 'work-sample.png', mimeType: 'image/png', buffer: f.image });
    const docs = page.locator('#sn-provider-docs');
    await page.getByLabel('Front of ID', { exact: true }).setInputFiles({ name: 'id-front.png', mimeType: 'image/png', buffer: f.image });
    await page.getByLabel('Account name', { exact: true }).fill('Unsaved payment draft');
    await page.locator('h2').first().click();
    await f.db.query("UPDATE providers SET full_name = 'Updated by test' WHERE id = 81");
    await page.waitForFunction(() => document.getElementById('sn-user-name').textContent === 'Updated by test', null, { timeout: 12000 });
    assert.equal(await description.inputValue(), draft);
    assert.equal(await docs.evaluate(input => input.files[0]?.name), 'work-sample.png');
    assert.equal(await page.getByLabel('Account name', { exact: true }).inputValue(), 'Unsaved payment draft');

    let failUpload = true;
    await page.route('**/api/provider/81/credentials', async route => {
      if (failUpload) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Test connection failure. Try again.' }) });
      await new Promise(resolve => setTimeout(resolve, 3500));
      return route.continue();
    });
    await page.getByRole('button', { name: 'Upload Credentials', exact: true }).click();
    await page.locator('#sn-provider-credential-status').filter({ hasText: 'Test connection failure' }).waitFor();
    assert.equal(await docs.evaluate(input => input.files.length), 1);
    assert.equal(await description.inputValue(), draft);
    failUpload = false;
    await page.getByRole('button', { name: 'Upload Credentials', exact: true }).click();
    await page.getByRole('button', { name: 'Uploading...', exact: true }).waitFor();
    assert.equal(await docs.isDisabled(), true);
    await page.locator('#sn-provider-credential-status').filter({ hasText: 'uploaded successfully' }).waitFor();
    assert.equal(await description.inputValue(), draft);
    assert.equal(await docs.evaluate(input => input.files.length), 0);
    assert.equal(await page.getByLabel('Account name', { exact: true }).inputValue(), 'Unsaved payment draft');
    const workLink = page.locator('.sn-provider-documents a').filter({ hasText: 'work-sample.png' });
    await workLink.waitFor();
    const response = await context.request.get(await workLink.getAttribute('href'));
    assert.equal(response.status(), 200);
    assert.deepEqual(await response.body(), f.image);
    assert.ok(await page.locator('.sn-provider-documents').getByText('Front ID', { exact: true }).isVisible());
    assert.equal((await f.db.query('SELECT verification_status FROM providers WHERE id = 81')).rows[0].verification_status, 'pending');

    await docs.setInputFiles({ name: 'unsupported.html', mimeType: 'text/html', buffer: Buffer.from('<h1>invalid</h1>') });
    await page.getByRole('button', { name: 'Upload Credentials', exact: true }).click();
    await page.locator('#sn-provider-credential-status').filter({ hasText: 'supported, non-empty file' }).waitFor();
    await docs.setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await page.getByRole('button', { name: 'Upload Credentials', exact: true }).click();
    await page.locator('#sn-provider-credential-status').filter({ hasText: 'does not match its file type' }).waitFor();
    assert.equal(await docs.evaluate(input => input.files.length), 1);
    await docs.setInputFiles([]);

    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow at ${width}`);
      for (const button of await page.locator('.sn-panel button:visible').all()) {
        assert.ok(await button.evaluate(node => node.scrollWidth <= node.clientWidth + 2), `button clipping at ${width}: ${await button.textContent()}`);
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(os.tmpdir(), `provider-profile-${width}.png`), fullPage: true });
    }
    await page.reload();
    await description.waitFor();
    assert.equal(await description.inputValue(), descriptionText);
    await workLink.waitFor();
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('sn_provider_user')).auth_token));
    const customer = (await f.request('/api/auth/customer/session', 'GET', undefined, f.customerToken)).data.user;
    await page.evaluate(customer => localStorage.setItem('sn_customer_user', JSON.stringify(customer)), customer);
    await page.goto(`${f.base}/pages/customer/provider-profile/provider-profile.html?id=81`);
    const about = page.locator('.sn-profile-section').first();
    await about.waitFor();
    assert.equal(await about.locator('p').textContent(), descriptionText);
    assert.equal(await about.locator('img').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Provider profile browser checks passed: saved description, file picker/upload/retry, database-backed files, retained drafts during idle refresh, persistent login, escaped customer description, and 1440/1024/768/390/320px layouts.');
  } finally { if (browser) await browser.close(); await f.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
