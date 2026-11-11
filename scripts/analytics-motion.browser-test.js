'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '..')));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });

  try {
    const page = await browser.newPage();
    await page.route('**/shared/js/pwa-register.js', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
    await page.goto(`http://127.0.0.1:${server.address().port}/pages/landing/index.html`);
    await page.setContent(`
      <section class="stats-grid"><div class="stat-info"><div class="value">PHP 0</div></div></section>
      <article class="metric-card"><h2 id="metric-users">0</h2></article>
      <div class="report-metrics"><div class="report-metric"><strong id="report-total">0</strong></div></div>
      <div class="sn-provider-chart-bars"><div class="sn-bar" style="height:120px"></div></div>
      <div class="admin-chart-track"><div class="admin-chart-fill" style="width:75%"></div></div>
      <div class="sn-chart-track"><div class="sn-chart-fill" style="width:60%"></div></div>
      <div class="sn-badge-calculation"></div>
      <div id="report-chart" class="report-trend"></div>
      <script src="/shared/js/analytics-motion.js"></script>
    `);
    await page.waitForFunction(() => Boolean(window.snAnalyticsMotion));

    await page.evaluate(() => {
      document.querySelector('.stats-grid .value').textContent = 'PHP 1,250';
      document.querySelector('#metric-users').textContent = '42';
      document.querySelector('#report-total').textContent = '18';
      document.querySelector('.sn-badge-calculation').innerHTML = '<progress id="badge-progress" value="65" max="100"></progress>';
      document.querySelector('#report-chart').innerHTML = '<button class="report-bar-button"><span style="height:70%"></span></button>';
    });

    await page.waitForFunction(() => document.querySelector('#metric-users').textContent === '42'
      && document.querySelector('.stats-grid .value').textContent === 'PHP 1,250'
      && document.querySelector('#report-total').textContent === '18'
      && Math.round(document.querySelector('#badge-progress').value) === 65
      && document.querySelector('#badge-progress').classList.contains('sn-motion-ready'), null, { timeout: 5000 });
    const state = await page.evaluate(() => ({
      counters: [...document.querySelectorAll('.stats-grid .value, #metric-users, #report-total')].map(node => node.textContent),
      bars: [...document.querySelectorAll('.sn-bar, .admin-chart-fill, .sn-chart-fill, .report-bar-button > span')].map(node => node.className),
      progress: [document.querySelector('#badge-progress').value, document.querySelector('#badge-progress').dataset.snProgressValue, document.querySelector('#badge-progress').className],
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));
    assert.deepEqual(state.counters, ['PHP 1,250', '42', '18']);
    assert.equal(Math.round(state.progress[0]), 65);
    assert.equal(state.progress[1], '65/100');
    assert.ok(state.progress[2].includes('sn-motion-ready'));
    assert.ok(state.bars.every(classes => classes.includes('sn-motion-ready')));

    const animatedBars = await page.locator('.sn-motion-ready').count();
    assert.equal(animatedBars, 5, 'dashboard, review, report, and badge progress elements animate');
    console.log('PASS shared counters, charts, and badge progress animation');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
