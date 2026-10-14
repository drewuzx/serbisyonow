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
    await f.db.query("UPDATE providers SET documents_files = ARRAY['test-certificate.pdf'] WHERE id = 81");
    await f.db.query('UPDATE provider_skill_assessments SET score = 100 WHERE provider_id = 81');
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === f.base || url.protocol === 'blob:') return route.continue();
      return route.fulfill({ body: '', contentType: url.pathname.endsWith('.css') || url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'application/javascript' });
    });
    const user = (await f.request('/api/auth/provider/session', 'GET', undefined, f.providerToken)).data.user;
    const customer = (await f.request('/api/auth/customer/session', 'GET', undefined, f.customerToken)).data.user;
    await context.addInitScript(({ user, customer }) => {
      localStorage.setItem('sn_provider_user', JSON.stringify(user));
      localStorage.setItem('sn_customer_user', JSON.stringify(customer));
    }, { user, customer });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = `${f.base}/pages/provider/assessment/assessment.html`;
    await page.goto(url);
    const badge = page.locator('.sn-badge-result strong');
    await badge.getByText('Skilled Verified', { exact: true }).waitFor();
    assert.ok((await page.locator('.sn-badge-total').textContent()).includes('90 / 100 points'));
    assert.equal(await page.locator('.sn-badge-component').count(), 3);
    assert.equal(await page.locator('.sn-badge-requirements [data-met="false"]').count(), 3);
    assert.equal(await page.locator('.sn-badge-result img').evaluate(img => img.complete && img.naturalWidth > 0), true);

    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1050 });
      await page.evaluate(() => scrollTo(0, 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow at ${width}`);
      for (const button of await page.locator('.sn-assessment-page .btn').all()) {
        assert.ok(await button.evaluate(node => node.scrollWidth <= node.clientWidth + 2), `clipped action at ${width}`);
      }
      const summary = page.locator('.sn-assessment-summary');
      assert.ok(await summary.evaluate(node => [...node.children].every(child => child.getBoundingClientRect().right <= node.getBoundingClientRect().right + 1)), `summary overflow ${width}`);
      await page.screenshot({ path: path.join(os.tmpdir(), `provider-badges-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1050 });
    for (const rating of [5, 5, 5, 4, 4]) {
      const booking = await f.createBooking({ status: 'completed' });
      await f.db.query('INSERT INTO customer_reviews (customer_id, provider_id, booking_id, rating) VALUES (61, 81, $1, $2)', [booking.id, rating]);
    }
    await badge.getByText('Top-Rated', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await page.locator('.sn-badge-requirements [data-met="false"]').count(), 0);
    assert.ok((await page.locator('.sn-badge-total').textContent()).includes('99.2 / 100 points'));
    await page.screenshot({ path: path.join(os.tmpdir(), 'provider-badges-top-rated.png'), fullPage: true });

    await page.getByRole('link', { name: 'Manage Credentials' }).click();
    await page.locator('#sn-provider-docs').waitFor();
    await page.locator('#sn-provider-docs').setInputFiles({ name: 'updated-proof.png', mimeType: 'image/png', buffer: f.image });
    await page.getByRole('button', { name: 'Upload Credentials', exact: true }).click();
    await page.locator('#sn-provider-credential-status').getByText('Credentials uploaded successfully. Pending admin review.', { exact: true }).waitFor();
    await page.goto(url);
    await badge.getByText('Pending Verification', { exact: true }).waitFor();
    assert.equal(await page.locator('.sn-badge-component progress').nth(1).getAttribute('value'), '0');
    await page.getByRole('link', { name: 'Retake Assessment', exact: true }).click();
    await page.getByRole('button', { name: 'Retake Assessment', exact: true }).click();
    assert.equal(await page.locator('.sn-reassessment-question').count(), 10);
    await page.getByRole('button', { name: 'Submit Reassessment', exact: true }).click();
    await page.locator('#sn-provider-profile-status').getByText('Please answer all reassessment questions before submitting.', { exact: true }).waitFor();
    await page.evaluate(() => {
      const bank = window.SN_PROVIDER_ASSESSMENT_BANKS.Cleaning;
      for (const fieldset of document.querySelectorAll('.sn-reassessment-question')) {
        const question = bank.find(item => item.q === fieldset.querySelector('legend strong').textContent);
        for (const label of fieldset.querySelectorAll('label')) if (label.querySelector('span').textContent === question.a) label.querySelector('input').click();
      }
    });
    await page.getByRole('button', { name: 'Submit Reassessment', exact: true }).click();
    await page.locator('#sn-provider-profile-status').filter({ hasText: 'New score: 100%' }).waitFor();
    await f.db.query("UPDATE providers SET is_verified = TRUE, verification_status = 'verified' WHERE id = 81");
    await page.goto(url);
    await badge.getByText('Top-Rated', { exact: true }).waitFor();
    await page.reload();
    await badge.getByText('Top-Rated', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('sn_provider_user')).auth_token));
    await page.goto(`${f.base}/pages/customer/provider-profile/provider-profile.html?id=81`);
    await page.locator('.sn-provider-badge').getByText('Top-Rated', { exact: true }).waitFor();
    assert.ok((await page.locator('.sn-rating-line').textContent()).includes('5 completed-service reviews'));
    assert.deepEqual(errors, []);
    console.log('Skill assessment browser checks passed: weighted breakdown, 5 responsive widths, real-time Top-Rated promotion, pending-credential gating, working retake link and grading, customer badge consistency, login and reload persistence.');
  } finally { if (browser) await browser.close(); await f.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
