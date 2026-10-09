'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const express = require('express');
const { createPayMongo } = require('./paymongo');
const { hashToken } = require('./account-sessions');

test('downpayment HTTP flow: ownership, confirmed price, checkout, signed settlement and cancellation', { timeout: 20000 }, async t => {
 const filename = path.join(__dirname, 'auth-server.js');
 const localRequire = createRequire(filename);
 const providerToken = 'a'.repeat(64);
 const customerToken = 'b'.repeat(64);
 let bookings = [1, 2, 3, 4].map(id => ({ id, customer_id: 61, provider_id: 81, service: 'Plumbing Services',
  amount: 500, status: 'pending', deposit_required: true, deposit_status: 'awaiting_price', price_version: 0, scheduled_date: '2099-10-10', scheduled_time: '10:00 AM' }));
 let checkouts = [];
 let receipts = [];
 let snapshot;
 let createCalls = 0;
 let failGateway = false;
 let failWrite = false;
 let customerVerified = true;
 const database = { async query(sql, params = []) {
  const q = sql.trim().replace(/\s+/g, ' ');
  let rows = [];
  const booking = bookings.find(item => item.id === Number(q.includes('WHERE provider_id = $1') || q.includes('WHERE customer_id = $1') ? params[1] : params[0]));
  const checkout = checkouts.find(item => item.id === Number(params[0]));
  if (q === 'BEGIN') snapshot = structuredClone({ bookings, checkouts, receipts });
  else if (q === 'ROLLBACK') ({ bookings, checkouts, receipts } = snapshot);
  else if (q.startsWith('SELECT account_role')) {
   if (params[0] === hashToken(providerToken)) rows = [{ account_role: 'provider', account_id: 81 }];
   if (params[0] === hashToken(customerToken)) rows = [{ account_role: 'customer', account_id: 61 }];
  } else if (q.startsWith('UPDATE account_sessions')) rows = [{ account_id: params[2] }];
  else if (q.startsWith('SELECT is_verified')) rows = [{ is_verified: q.includes('providers') || customerVerified }];
  else if (q.startsWith('SELECT * FROM customer_bookings')) rows = booking && (!q.includes('provider_id = $1') || booking.provider_id === Number(params[0])) && (!q.includes('customer_id = $1') || booking.customer_id === Number(params[0])) ? [booking] : [];
  else if (q.startsWith('SELECT * FROM booking_payments')) rows = checkouts.filter(item => q.includes('checkout_session_id = $1') ? item.checkout_session_id === params[0] : item.booking_id === Number(params[0])).filter(item => !q.includes("status = 'expire_pending'") || item.status === 'expire_pending');
  else if (q.startsWith('SELECT payment_id FROM booking_payment_receipts')) rows = receipts.filter(item => item.disposition === 'credited' && checkouts.find(payment => payment.id === item.checkout_id)?.booking_id === Number(params[0]));
  else if (q.startsWith('INSERT INTO booking_payments')) {
   const payment = { id: checkouts.length + 1, booking_id: Number(params[0]), amount_centavos: params[1], livemode: params[2], price_version: params[3], status: 'creating' };
   checkouts.push(payment); rows = [payment];
  } else if (q.startsWith('UPDATE booking_payments SET reference_number')) Object.assign(checkout, { reference_number: params[1], checkout_session_id: params[2], checkout_url: params[3], status: 'active' });
  else if (q.startsWith('INSERT INTO booking_payment_receipts')) {
   if (!receipts.some(item => item.payment_id === params[0])) {
    receipts.push({ payment_id: params[0], checkout_id: params[1], amount_centavos: params[2], livemode: params[3], disposition: params[4] }); rows = [{ payment_id: params[0] }];
   }
  } else if (q.startsWith('UPDATE customer_bookings SET confirmed_price')) {
   Object.assign(booking, { confirmed_price: params[2], amount: params[2], deposit_amount: params[3], balance_due: params[4], price_notes: params[5], price_version: booking.price_version + 1, price_confirmed_at: 'now', deposit_status: 'awaiting_payment' }); rows = [booking];
  } else if (q.startsWith('UPDATE customer_bookings SET customer_agreed_at')) booking.customer_agreed_at = 'now';
  else if (q.startsWith('UPDATE customer_bookings SET status')) {
   if (failWrite) throw new Error('Test database write failure');
   booking.status = q.includes("status = 'upcoming'") ? 'upcoming' : q.includes("status = 'cancelled'") ? 'cancelled' : params[2];
   if (q.includes("deposit_status = 'paid'")) Object.assign(booking, { deposit_status: 'paid', deposit_paid_at: 'now', deposit_livemode: params[1] });
   rows = [booking];
  } else if (q.startsWith('UPDATE customer_bookings SET deposit_status')) {
   booking.deposit_status = q.includes('CASE WHEN') ? booking.deposit_paid_at ? 'refund_review' : 'cancelled' : 'refund_review';
   if (!q.includes('CASE WHEN')) Object.assign(booking, { deposit_paid_at: 'now', deposit_livemode: params[1] });
  } else if (q.startsWith('UPDATE booking_payments SET status = CASE')) {
   checkouts.filter(item => item.booking_id === Number(params[0]) && ['active', 'creating', 'paid'].includes(item.status)).forEach(item => { item.status = item.status === 'paid' ? 'refund_review' : 'expire_pending'; });
  } else if (q.startsWith('UPDATE booking_payments SET status')) {
   if (checkout && (!q.includes("AND status = 'expire_pending'") || checkout.status === 'expire_pending')) checkout.status = q.includes("status = 'paid'") ? 'paid' : q.includes("status = 'expired'") ? 'expired' : 'refund_review';
  }
  return { rows: structuredClone(rows), rowCount: rows.length };
 } };
 database.pool = { async connect() { return { query: database.query, release() {} }; } };
 const env = { PAYMONGO_SECRET_KEY: 'sk_test_fixture', PAYMONGO_WEBHOOK_SECRET: 'webhook_fixture' };
 const gateway = createPayMongo({ env, fetcher: async (url, options) => {
  if (failGateway) throw new Error('Fixture gateway failure');
  if (url.endsWith('/expire')) return { ok: true, json: async () => ({ data: {} }) };
  createCalls++;
  const attributes = JSON.parse(options.body).data.attributes;
  assert.equal(attributes.line_items[0].currency, 'PHP');
  return { ok: true, json: async () => ({ data: { id: `cs_fixture${createCalls}`, attributes: { checkout_url: `https://checkout.paymongo.com/cs_fixture${createCalls}`, livemode: false } } }) };
 } });
 let resolveServer;
 const ready = new Promise(resolve => { resolveServer = resolve; });
 const expressFactory = Object.assign(() => {
  const app = express(); const listen = app.listen.bind(app);
  app.listen = () => { const server = listen(0, '127.0.0.1', () => resolveServer(server)); return server; };
  return app;
 }, express);
 vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  __dirname, __filename: filename, Buffer, URL, URLSearchParams, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval,
  process: { env: { PORT: '0', FRONTEND_BASE_URL: 'http://localhost:3003' } }, console: { log() {}, error() {} },
  require(name) {
   if (name === './db') return database;
   if (name === './paymongo') return { createPayMongo: () => gateway };
   if (name === 'express') return expressFactory;
   if (name === 'dotenv') return { config() {} };
   if (name === 'fs') return { ...fs, mkdirSync() {}, readdirSync: () => [], promises: { ...fs.promises, readdir: async () => [] } };
   return localRequire(name);
  },
 }, { filename });
 const server = await ready;
 t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
 const base = `http://127.0.0.1:${server.address().port}`;
 async function request(route, method = 'GET', body, token = customerToken) {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
 }
 const price = (id, value = '1000', version = 0) => request(`/api/provider/81/bookings/${id}/price`, 'PATCH', { price: value, price_version: version, notes: 'Labor and listed materials included' }, providerToken);
 const checkout = (id, version = 1, extras = {}) => request(`/api/customer/61/bookings/${id}/checkout`, 'POST', { accept_price: true, price_version: version, ...extras });
 function eventFor(id, amount, paymentId = `pay_fixture${id}`) {
  const payment = checkouts.find(item => item.booking_id === id);
  return { event_type: 'send.webhook', data: { type: 'checkout_session.payment.paid', livemode: false, data: { id: payment.checkout_session_id, type: 'checkout_session', attributes: { reference_number: payment.reference_number, metadata: { booking_id: String(id), price_version: String(payment.price_version), purpose: 'booking_downpayment' }, payments: [{ id: paymentId, attributes: { amount: amount ?? payment.amount_centavos, currency: 'PHP', status: 'paid' } }] } } } };
 }
 async function notify(event, valid = true) {
  const raw = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', env.PAYMONGO_WEBHOOK_SECRET).update(`${timestamp}.${raw}`).digest('hex');
  const response = await fetch(base + '/api/payments/paymongo/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paymongo-Signature': `t=${timestamp},te=${valid ? signature : '0'.repeat(64)}` }, body: raw });
  return { status: response.status, data: await response.json() };
 }
 await t.test('protected financial actions reject anonymous, other roles and other accounts', async () => {
  assert.equal((await request('/api/provider/81/bookings/1/price', 'PATCH', { price: 1000 }, '')).status, 401);
  assert.equal((await request('/api/provider/81/bookings/1/price', 'PATCH', { price: 1000 })).status, 403);
  assert.equal((await request('/api/customer/62/bookings/1/payment')).status, 403);
  customerVerified = false;
  assert.equal((await checkout(1)).status, 403);
  customerVerified = true;
 });
 await t.test('provider confirms price and cannot accept an unpaid booking', async () => {
  assert.equal((await checkout(1)).status, 409);
  const result = await price(1, '333.35');
  assert.equal(result.status, 200);
  assert.equal(result.data.booking.deposit_amount, 100.01);
  assert.equal(result.data.booking.balance_due, 233.34);
  assert.equal(result.data.booking.status, 'pending');
  assert.equal((await request('/api/provider/81/bookings/1/status', 'PATCH', { status: 'upcoming' }, providerToken)).status, 409);
  assert.equal((await price(1, '999', 0)).status, 409);
 });
 await t.test('customer agrees to current price; retries reuse one server-calculated checkout', async () => {
  assert.equal((await checkout(1, 0)).status, 409);
  assert.equal((await checkout(1, 1, { accept_price: false })).status, 400);
  failGateway = true;
  assert.equal((await checkout(1)).status, 502);
  assert.equal(checkouts.length, 0);
  assert.equal(bookings[0].customer_agreed_at, undefined);
  failGateway = false;
  const result = await checkout(1, 1, { amount: 1, deposit_amount: 1 });
  assert.equal(result.status, 200);
  assert.equal(checkouts[0].amount_centavos, 10001);
  assert.equal((await checkout(1)).data.checkout_url, result.data.checkout_url);
  assert.equal(createCalls, 1);
  assert.equal((await price(1, '500', 1)).status, 409);
  assert.equal(bookings[0].status, 'pending', 'checkout or return URL cannot confirm the schedule');
 });
 await t.test('raw signed paid webhook verifies amount; retries cannot credit twice', async () => {
  const event = eventFor(1);
  assert.equal((await notify(event, false)).status, 401);
  const wrongReference = structuredClone(event);
  wrongReference.data.data.attributes.reference_number = 'other_order';
  assert.equal((await notify(wrongReference)).status, 400);
  failWrite = true;
  assert.equal((await notify(event)).status, 500);
  assert.equal(receipts.length, 0);
  assert.equal(bookings[0].status, 'pending');
  failWrite = false;
  assert.equal((await notify(event)).status, 200);
  assert.equal(bookings[0].status, 'upcoming');
  assert.equal(bookings[0].deposit_status, 'paid');
  assert.equal(bookings[0].deposit_livemode, false);
  assert.equal((await notify(event)).status, 200);
  assert.equal(receipts.length, 1);
  assert.equal((await checkout(1)).status, 409);
  assert.equal((await request('/api/provider/81/bookings/1/status', 'PATCH', { status: 'ongoing', expected_status: 'upcoming' }, providerToken)).status, 200);
 });
 await t.test('cancellation after payment is refund review, never an automatic refund', async () => {
  const result = await request('/api/customer/61/bookings/1/cancel', 'PATCH');
  assert.equal(result.status, 200);
  assert.equal(result.data.booking.status, 'cancelled');
  assert.equal(result.data.booking.deposit_status, 'refund_review');
  assert.equal((await notify(eventFor(1))).status, 200);
  assert.equal(bookings[0].status, 'cancelled');
 });
 await t.test('late payment after an unpaid cancellation never restores the schedule', async () => {
  await price(2); await checkout(2);
  assert.equal((await request('/api/provider/81/bookings/2/status', 'PATCH', { status: 'cancelled' }, providerToken)).status, 200);
  assert.equal(checkouts.find(item => item.booking_id === 2).status, 'expired');
  assert.equal((await notify(eventFor(2))).status, 200);
  assert.equal(bookings[1].status, 'cancelled');
  assert.equal(bookings[1].deposit_status, 'refund_review');
  assert.equal(receipts.at(-1).disposition, 'refund_review');
 });
 await t.test('wrong amount is retained for review and cannot start service', async () => {
  await price(3); await checkout(3);
  assert.equal((await notify(eventFor(3, 1))).status, 200);
  assert.equal(bookings[2].status, 'pending');
  assert.equal(bookings[2].deposit_status, 'refund_review');
  assert.equal((await request('/api/provider/81/bookings/3/status', 'PATCH', { status: 'upcoming' }, providerToken)).status, 409);
  assert.equal((await request('/api/customer/61/bookings/3/payment')).data.booking.checkout_url, undefined);
 });
 await t.test('past schedules cannot open a payable checkout', async () => {
  await price(4);
  bookings[3].scheduled_date = '2000-01-01';
  assert.equal((await checkout(4)).status, 409);
  assert.equal(checkouts.some(item => item.booking_id === 4), false);
 });
});
