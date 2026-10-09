'use strict';
// Fixture-only accounts and sessions; these tests never connect to the application database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const bcrypt = require('bcryptjs');
const { issueSession, authenticateAccount, hashToken, requestSessionToken, rememberSession, revokeSession } = require('./account-sessions');

const DAY = 86400000;
function fixtureDatabase() {
 const sessions = new Map();
 const accounts = {
  customer: { id: 61, full_name: 'Session Customer', email: 'customer@example.test', password_hash: bcrypt.hashSync('FixturePassword123', 4), is_verified: true, verification_status: 'verified' },
  provider: { id: 81, full_name: 'Session Provider', email: 'provider@example.test', password_hash: bcrypt.hashSync('FixturePassword123', 4), is_verified: true, verification_status: 'verified', category: 'Cleaning' },
 };
 let now = Date.now();
 let revokeDuringRenewal = false;
 const database = { sessions, accounts,
  advance: days => { now += days * DAY; },
  revokeDuringRenewal: () => { revokeDuringRenewal = true; },
  async query(sql, params = []) {
   const q = sql.trim().replace(/\s+/g, ' ');
   let rows = [];
   if (q.startsWith('INSERT INTO account_sessions')) {
    assert.ok(q.includes("INTERVAL '30 days'"));
    sessions.set(params[0], { account_role: params[1], account_id: params[2], expires_at: now + 30 * DAY });
   } else if (q.startsWith('SELECT account_role')) {
    const session = sessions.get(params[0]);
    if (session?.expires_at > now) rows = [session];
   } else if (q.startsWith('UPDATE account_sessions')) {
    assert.ok(q.includes('expires_at > NOW()'));
    if (revokeDuringRenewal) { sessions.delete(params[0]); revokeDuringRenewal = false; }
    const session = sessions.get(params[0]);
    if (session?.expires_at > now && session.account_role === params[1] && session.account_id === params[2]) {
     session.expires_at = now + 30 * DAY; rows = [session];
    }
   } else if (q.startsWith('DELETE FROM account_sessions WHERE token_hash')) {
    if (sessions.get(params[0])?.account_role === params[1]) sessions.delete(params[0]);
   } else if (q.startsWith('SELECT * FROM customers') || q.startsWith('SELECT * FROM providers')) {
    const account = accounts[q.includes('providers') ? 'provider' : 'customer'];
    if (q.includes('lower(email)') ? params[0] === account?.email : Number(params[0]) === account?.id) rows = [account];
   }
   return { rows: structuredClone(rows), rowCount: rows.length };
  },
 };
 return database;
}

async function startFixture(database, port = 0) {
 const filename = path.join(__dirname, 'auth-server.js');
 const localRequire = createRequire(filename);
 let resolveServer;
 const ready = new Promise(resolve => { resolveServer = resolve; });
 const expressFactory = Object.assign(() => {
  const app = express(); const listen = app.listen.bind(app);
  app.use((_req, res, next) => { res.set('Connection', 'close'); next(); });
  app.listen = () => {
   const server = listen(port, '127.0.0.1', () => resolveServer(server)); return server;
  };
  return app;
 }, express);
 vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  __dirname, __filename: filename, Buffer, URL, URLSearchParams, AbortSignal,
  setTimeout, clearTimeout, setInterval, clearInterval,
  process: { env: { PORT: '0' } }, console: { log() {}, error() {} },
  require(name) {
   if (name === './db') return database;
   if (name === 'express') return expressFactory;
   if (name === 'dotenv') return { config() {} };
   if (name === 'fs') return { ...fs, mkdirSync() {}, readdirSync: () => [], promises: { ...fs.promises, readdir: async () => [] } };
   return localRequire(name);
  },
 }, { filename });
 return ready;
}
const closeServer = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

test('remembered sessions are renewable, role-bound, hashed and revocable', async () => {
 const database = fixtureDatabase();
 const cookies = [];
 const req = { secure: true, headers: {} };
 const res = { cookie: (...args) => cookies.push(args), clearCookie: (...args) => cookies.push(args) };
 const token = await issueSession(database, 'customer', 61, { req, res });
 assert.match(token, /^[a-f0-9]{64}$/);
 assert.ok(database.sessions.has(hashToken(token)));
 assert.ok(!database.sessions.has(token));
 assert.deepEqual(cookies[0], ['sn_customer_session', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * DAY }]);
 const cookieRequest = { secure: true, headers: { cookie: `unrelated=1; sn_customer_session=${token}` } };
 assert.equal(requestSessionToken(cookieRequest, 'customer'), token);
 assert.equal(requestSessionToken(cookieRequest, 'provider'), '');
 assert.equal(requestSessionToken({ headers: { cookie: cookieRequest.headers.cookie, authorization: 'Bearer invalid' } }, 'customer'), '');
 for (let i = 0; i < 4; i++) {
  database.advance(20);
  assert.deepEqual(await authenticateAccount(database, cookieRequest, 'customer', 61), { role: 'customer', id: 61 });
 }
 await assert.rejects(authenticateAccount(database, { headers: { authorization: `Bearer ${token}` } }, 'provider', 61), { statusCode: 403 });
 await assert.rejects(authenticateAccount(database, cookieRequest, 'customer', 62), { statusCode: 403 });
 await revokeSession(database, cookieRequest, res, 'customer');
 assert.ok(!database.sessions.has(hashToken(token)));
 assert.equal(cookies.at(-1)[0], 'sn_customer_session');
 await assert.rejects(authenticateAccount(database, cookieRequest, 'customer', 61), { statusCode: 401 });
});

test('expired or concurrently revoked sessions cannot be renewed', async () => {
 const database = fixtureDatabase();
 const token = await issueSession(database, 'provider', 81);
 const req = { headers: { authorization: `Bearer ${token}` } };
 database.advance(31);
 await assert.rejects(authenticateAccount(database, req, 'provider', 81), { statusCode: 401 });
 const fresh = await issueSession(database, 'provider', 81);
 database.revokeDuringRenewal();
 await assert.rejects(authenticateAccount(database, { headers: { authorization: `Bearer ${fresh}` } }, 'provider', 81), { statusCode: 401 });
});

test('HTTP login cookies survive a server restart, recover profiles, and logout revokes only that browser', { timeout: 20000 }, async t => {
 const database = fixtureDatabase();
 let server = await startFixture(database);
 t.after(() => closeServer(server));
 const port = server.address().port;
 const base = `http://127.0.0.1:${port}`;
 const login = async role => {
  const response = await fetch(`${base}/api/auth/${role}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: database.accounts[role].email, password: 'FixturePassword123' }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  return { cookie: response.headers.get('set-cookie').split(';')[0], user: (await response.json()).user };
 };
 const first = await login('customer');
 const second = await login('customer');
 const provider = await login('provider');
 await closeServer(server);
 server = await startFixture(database, port);
 for (const account of [first, provider]) {
  const role = account === provider ? 'provider' : 'customer';
  const response = await fetch(`${base}/api/auth/${role}/session`, { headers: { cookie: `${first.cookie}; ${provider.cookie}` } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { user } = await response.json();
  assert.equal(user.id, account.user.id);
  assert.equal(user.auth_token, account.user.auth_token);
 }
 assert.equal((await fetch(`${base}/api/auth/customer/session`)).status, 401, 'account ID alone cannot restore authentication');
 const legacyToken = 'c'.repeat(64);
 database.sessions.set(hashToken(legacyToken), { account_role: 'customer', account_id: 61, expires_at: Date.now() + 7 * DAY });
 const legacy = await fetch(`${base}/api/auth/customer/session`, { headers: { authorization: `Bearer ${legacyToken}` } });
 assert.equal(legacy.status, 200, 'a still-valid seven-day session upgrades without another login');
 assert.match(legacy.headers.get('set-cookie'), /sn_customer_session=/);
 assert.equal((await fetch(`${base}/api/auth/customer/session`, { headers: { authorization: `Bearer ${provider.user.auth_token}` } })).status, 403);
 assert.equal((await fetch(`${base}/api/auth/customer/logout`, { method: 'POST', headers: { cookie: first.cookie } })).status, 204);
 assert.equal((await fetch(`${base}/api/auth/customer/session`, { headers: { cookie: first.cookie } })).status, 401);
 assert.equal((await fetch(`${base}/api/auth/customer/session`, { headers: { cookie: second.cookie } })).status, 200);
});

test('customer and provider pages remember login on refresh, PWA update and restart, but not after logout', { timeout: 90000 }, async t => {
 const { chromium } = require('playwright');
 const database = fixtureDatabase();
 let server = await startFixture(database);
 const port = server.address().port;
 const base = `http://127.0.0.1:${port}`;
 const browser = await chromium.launch({ headless: true, channel: 'msedge' });
 t.after(async () => { await browser.close(); await closeServer(server); });
 for (const role of ['customer', 'provider']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block' });
  const account = database.accounts[role];
  const errors = [];
  let refreshUnavailable = false;
  await context.route('**/*', async route => {
   const url = new URL(route.request().url());
   if (url.origin !== base) return route.fulfill({ body: '', contentType: url.hostname === 'fonts.googleapis.com' || url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
   if (url.pathname.endsWith('/session')) {
    if (refreshUnavailable) return route.fulfill({ status: 503, json: { message: 'Fixture deployment in progress' } });
    return route.continue();
   }
   if (url.pathname.startsWith('/api/auth/')) return route.continue();
   if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { customer: database.accounts.customer, provider: database.accounts.provider, metrics: {}, bookings: [], history_bookings: [], services: [], favorites: [], reviews: [], messages: [], conversations: [], notifications: [], categories: [], providers: [], availability: [], assessment: null } });
   return route.continue();
  });
  const login = await context.request.post(`${base}/api/auth/${role}/login`, { data: { email: account.email, password: 'FixturePassword123' } });
  assert.equal(login.status(), 200);
  const { user } = await login.json();
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const pageUrl = `${base}/pages/${role}/dashboard/dashboard.html`;
  async function remembered(url = pageUrl) {
   await page.goto(url);
   await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key) || 'null')?.id === id, { key: `sn_${role}_user`, id: account.id });
   await page.locator('#sn-user-name').filter({ hasText: account.full_name }).waitFor({ state: 'attached' });
   assert.ok(page.url().includes(`/pages/${role}/`));
   assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).auth_token, `sn_${role}_user`), user.auth_token);
  }
  await remembered(); // Only the HttpOnly cookie exists initially.
  for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 950 });
   await page.reload();
   await page.locator('#sn-user-name').filter({ hasText: account.full_name }).waitFor({ state: 'attached' });
   await page.screenshot({ path: path.join(os.tmpdir(), `remembered-${role}-${width}.png`), fullPage: true });
  }
  await closeServer(server);
  server = await startFixture(database, port);
  await page.evaluate(key => localStorage.removeItem(key), `sn_${role}_user`);
  await remembered();
  if (role === 'customer') {
   for (const section of ['bookings', 'profile', 'history', 'reviews', 'favorites', 'search', 'inbox']) {
    await page.evaluate(key => localStorage.removeItem(key), `sn_${role}_user`);
    await remembered(`${base}/pages/customer/${section}/${section}.html`);
   }
  } else {
   await remembered(`${base}/pages/provider/profile/profile.html`);
   await remembered(`${base}/pages/provider/requests/requests.html`);
  }
  await remembered();
  refreshUnavailable = true;
  await remembered();
  refreshUnavailable = false;
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  await page.waitForLoadState('load');
  await page.locator('#sn-user-name').filter({ hasText: account.full_name }).waitFor({ state: 'attached' });
  await page.setViewportSize({ width: 1440, height: 950 });
  if (!await page.locator('#sn-logout').isVisible()) await page.locator('#sn-hamburger-top').click();
  const logoutResponse = page.waitForResponse(response => response.url().endsWith(`/api/auth/${role}/logout`));
  await page.locator('#sn-logout').click();
  assert.equal((await logoutResponse).status(), 204);
  await page.waitForURL(url => !url.pathname.includes(`/pages/${role}/`));
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `sn_${role}_user`), null);
  const status = await context.request.get(`${base}/api/auth/${role}/session`);
  assert.equal(status.status(), 401);
  await page.goto(pageUrl);
  await page.waitForURL(url => url.pathname.includes('/pages/auth/'));
  const signedInAgain = await context.request.post(`${base}/api/auth/${role}/login`, { data: { email: account.email, password: 'FixturePassword123' } });
  const newUser = (await signedInAgain.json()).user;
  await page.evaluate(({ key, user }) => localStorage.setItem(key, JSON.stringify(user)), { key: `sn_${role}_user`, user: newUser });
  await page.goto(pageUrl);
  await page.locator('#sn-user-name').filter({ hasText: account.full_name }).waitFor({ state: 'attached' });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `sn_${role}_logged_out`), null);
  let heldRefresh;
  const refreshStarted = new Promise(resolve => {
   page.route(`**/api/auth/${role}/session`, route => { heldRefresh = route; resolve(); });
  });
  await page.evaluate(() => { window.fixtureSessionRefresh = window.snAccountSession.restore(); });
  await refreshStarted;
  const revoked = page.waitForResponse(response => response.url().endsWith(`/api/auth/${role}/logout`));
  await page.evaluate(() => window.snAccountSession.logout());
  assert.equal((await revoked).status(), 204);
  await heldRefresh.fulfill({ json: { user: newUser } });
  await page.evaluate(() => window.fixtureSessionRefresh);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), `sn_${role}_user`), null, 'a delayed refresh cannot undo manual logout');
  assert.deepEqual(errors, []);
  await context.close();
 }
});
