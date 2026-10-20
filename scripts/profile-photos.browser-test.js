'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startQrFixture } = require('./provider-qr-test-fixture');
const { issueSession } = require('./account-sessions');

async function main() {
 const f = await startQrFixture(); let browser;
 try {
  const admin = (await f.db.query("INSERT INTO admins(username,password_hash) VALUES('photo-admin','fixture') RETURNING id")).rows[0];
  admin.auth_token = await issueSession(f.db, 'admin', admin.id);
  const customer = (await f.request('/api/auth/customer/session')).data.user;
  const provider = (await f.request('/api/auth/provider/session', 'GET', null, f.providerToken)).data.user;
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext({ serviceWorkers: 'block', permissions: ['camera'], viewport: { width: 390, height: 844 } });
  await context.addInitScript(({ customer, provider, admin }) => {
   for (const [role, value] of Object.entries({ customer, provider, admin })) localStorage.setItem(`sn_${role}_user`, JSON.stringify(value));
   const media = navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices);
   if (media) navigator.mediaDevices.getUserMedia = async options => {
    if (window.denyCamera) throw new DOMException('Denied', 'NotAllowedError');
    const stream = await media(options); window.testStream = stream; return stream;
   };
  }, { customer, provider, admin });
  await context.route('**/*', route => new URL(route.request().url()).origin === f.base ? route.continue() : route.fulfill({ body: '', contentType: 'text/css' }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const file = { name: 'photo.png', mimeType: 'image/png', buffer: f.image };
  async function screenshot(name) {
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name);
   const dialog = page.locator('dialog[open]');
   if (await dialog.count()) assert.ok(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight + 1; }));
   await page.screenshot({ path: path.join(os.tmpdir(), `profile-photo-${name}.png`) });
  }
  await page.goto(f.base + '/pages/customer/profile/profile.html');
  await page.locator('#sn-photo-open').click();
  await page.locator('dialog input[type=file]').setInputFiles(file);
  await page.locator('dialog [data-save]:not([disabled])').waitFor();
  await page.locator('[data-crop=zoom]').fill('1.5');
  for (const width of [320, 390, 1440]) {
   await page.setViewportSize({ width, height: 900 }); await screenshot(`customer-crop-${width}`);
  }
  await page.route('**/api/customer/profile-photo', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Photo save unavailable.' }) }));
  await page.locator('dialog [data-save]').click();
  await page.getByText('Photo save unavailable.', { exact: true }).waitFor();
  await page.unroute('**/api/customer/profile-photo');
  await page.locator('dialog [data-save]').click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#sn-profile-avatar img')?.naturalWidth > 0);
  await screenshot('customer-saved');

  await page.goto(f.base + '/pages/provider/profile/profile.html');
  await page.locator('#sn-photo-open').click();
  await page.locator('[data-front]').setInputFiles(file);
  await page.locator('[data-next]').click();
  await page.evaluate(() => { window.denyCamera = true; });
  await page.locator('[data-camera]').click();
  await page.getByText(/Camera permission was denied/).waitFor();
  await page.evaluate(() => { window.denyCamera = false; });
  await page.locator('[data-camera]').click();
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
  await page.locator('[data-capture]').click();
  assert.equal(await page.evaluate(() => window.testStream.getTracks().every(track => track.readyState === 'ended')), true);
  await page.locator('[data-submit]').click();
  await page.getByText('Please confirm your consent before submitting.', { exact: true }).waitFor();
  await page.locator('[data-consent]').check();
  for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: 900 }); await screenshot(`provider-selfie-${width}`); }
  await page.locator('[data-submit]').click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('#sn-photo-open')?.disabled);
  assert.equal((await f.request('/api/profile-photos/provider/81')).status, 404);

  await page.goto(f.base + '/pages/admin/provider-verification/provider-verification.html');
  await page.getByRole('button', { name: 'Review ID & Selfie' }).click();
  await page.locator('[data-decision=approved]:not([disabled])').waitFor();
  for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: 900 }); await screenshot(`admin-review-${width}`); }
  await page.locator('[data-decision=approved]').click();
  await page.getByText('Confirm that you reviewed the ID and selfie first.', { exact: true }).waitFor();
  await page.locator('[data-decision=declined]').click();
  await page.getByText('Enter a reason so the provider knows what to correct.', { exact: true }).waitFor();
  await page.locator('[data-confirm]').check();
  await page.locator('[data-decision=approved]').click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.equal((await f.request('/api/profile-photos/provider/81')).status, 200);
  await page.goto(f.base + '/pages/provider/profile/profile.html');
  await page.getByText('Profile photo approved.', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.sn-topbar .sn-photo-image')?.naturalWidth > 0);
  await page.locator('#sn-photo-open').click();
  await page.locator('[data-front]').setInputFiles(file); await page.locator('[data-next]').click(); await page.locator('[data-camera]').click();
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
  await page.locator('dialog .sn-photo-close').click();
  assert.equal(await page.evaluate(() => window.testStream.getTracks().every(track => track.readyState === 'ended')), true);
  await page.goto(f.base + '/pages/customer/provider-profile/provider-profile.html?id=81');
  await page.waitForFunction(() => document.querySelector('.sn-profile-photo img')?.naturalWidth > 0);
  assert.deepEqual(errors, []);
  console.log('PASS: customer crop/save/reload, failure recovery, provider camera/consent/private submission, admin review/approval, shared avatars, camera cleanup, and mobile/desktop layouts.');
 } finally { await browser?.close(); await f.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
