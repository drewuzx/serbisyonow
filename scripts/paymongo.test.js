'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPayMongo } = require('./paymongo');
const { priceParts, bookingPaymentView } = require('./booking-payments');
const { issueSession, authenticateAccount, hashToken } = require('./account-sessions');
const env = { PAYMONGO_SECRET_KEY: 'sk_test_fixture', PAYMONGO_WEBHOOK_SECRET: 'wh_fixture' };
const event = { data: { type: 'checkout_session.payment.paid', livemode: false, data: { id: 'cs_fixture' } } };
function signature(raw, timestamp = '1800000000', mode = 'te') {
 return `t=${timestamp},${mode}=${crypto.createHmac('sha256', env.PAYMONGO_WEBHOOK_SECRET).update(`${timestamp}.`).update(raw).digest('hex')}`;
}
test('30% money calculation uses centavos and rejects invalid prices', () => {
 assert.deepEqual(priceParts('333.35'), { total: 33335, deposit: 10001, balance: 23334 });
 assert.deepEqual(priceParts(1000), { total: 100000, deposit: 30000, balance: 70000 });
 for (const invalid of [0, -1, '1.001', '1e5', true, '', 'NaN', '99999999999']) assert.throws(() => priceParts(invalid), { statusCode: 400 });
 const view = bookingPaymentView({ checkout_url: 'private', confirmed_price: '1000', deposit_required: true });
 assert.equal(view.confirmed_price, 1000);
 assert.equal(view.deposit_amount, null);
 assert.equal(view.checkout_url, undefined);
});
test('hosted checkout uses server values, e-wallets, fixed return URLs and backend-only credentials', async () => {
 let call;
 const gateway = createPayMongo({ env, fetcher: async (url, options) => { call = { url, options }; return { ok: true, json: async () => ({ data: { id: 'cs_fixture', attributes: { checkout_url: 'https://checkout.paymongo.com/cs_fixture', livemode: false } } }) }; } });
 const session = await gateway.checkout({ bookingId: 12, priceVersion: 2, amountCentavos: 30000, reference: 'ref12', service: 'Cleaning', returnBase: 'http://localhost:3003' });
 assert.equal(session.id, 'cs_fixture');
 assert.equal(call.url, 'https://api.paymongo.com/v2/checkout_sessions');
 assert.equal(call.options.headers.Authorization, `Basic ${Buffer.from('sk_test_fixture:').toString('base64')}`);
 const attributes = JSON.parse(call.options.body).data.attributes;
 assert.deepEqual(attributes.payment_method_types, ['gcash', 'paymaya']);
 assert.equal(attributes.line_items[0].amount, 30000);
 assert.equal(attributes.pass_on_fees, false);
 assert.equal(attributes.metadata.price_version, '2');
 assert.equal(new URL(attributes.success_url).searchParams.get('booking_id'), '12');
 await gateway.expire('cs_fixture');
 assert.match(call.url, /\/v1\/checkout_sessions\/cs_fixture\/expire$/);
 await assert.rejects(gateway.expire('../bad'), { statusCode: 400 });
 await assert.rejects(gateway.checkout({ amountCentavos: 1 }), { statusCode: 400 });
 assert.equal(createPayMongo({ env: {} }).ready, false);
});
test('gateway rejects unsafe checkout redirects, mode mismatch, network errors and insecure live returns', async () => {
 for (const checkoutUrl of ['https://evil.example/cs_test', 'http://checkout.paymongo.com/x', 'https://a:b@checkout.paymongo.com/x']) {
  const gateway = createPayMongo({ env, fetcher: async () => ({ ok: true, json: async () => ({ data: { id: 'cs_fixture', attributes: { checkout_url: checkoutUrl, livemode: false } } }) }) });
  await assert.rejects(gateway.checkout({ amountCentavos: 30000, returnBase: 'http://localhost:3003' }), { statusCode: 502 });
 }
 const broken = createPayMongo({ env, fetcher: async () => { throw new Error('secret diagnostic'); } });
 await assert.rejects(broken.checkout({ amountCentavos: 30000, returnBase: 'http://localhost:3003' }), { statusCode: 502 });
 await assert.rejects(createPayMongo({ env: { ...env, PAYMONGO_SECRET_KEY: 'sk_live_fixture', PAYMONGO_LIVE_PAYMENTS_ENABLED: 'true' } }).checkout({ amountCentavos: 30000, returnBase: 'http://localhost' }), { statusCode: 503 });
});

test('live checkout requires explicit approval while test checkout remains available', async () => {
 let calls = 0;
 const liveEnv = { ...env, PAYMONGO_SECRET_KEY: 'sk_live_fixture' };
 const fetcher = async () => {
  calls++;
  return { ok: true, json: async () => ({ data: { id: 'cs_livefixture', attributes: { checkout_url: 'https://checkout.paymongo.com/cs_livefixture', livemode: true } } }) };
 };
 const disabled = createPayMongo({ env: liveEnv, fetcher, now: () => 1800000000000 });
 assert.equal(disabled.ready, false);
 await assert.rejects(disabled.checkout({ amountCentavos: 30000, returnBase: 'https://example.test' }), { statusCode: 503 });
 assert.equal(calls, 0, 'a live key alone must never initiate a real charge');
 const approved = createPayMongo({ env: { ...liveEnv, PAYMONGO_LIVE_PAYMENTS_ENABLED: 'true' }, fetcher });
 assert.equal(approved.ready, true);
 assert.equal((await approved.checkout({ amountCentavos: 30000, returnBase: 'https://example.test' })).livemode, true);
 assert.equal(calls, 1);
 assert.equal(createPayMongo({ env: { ...env, PAYMONGO_LIVE_PAYMENTS_ENABLED: 'false' } }).ready, true);
 const paid = Buffer.from(JSON.stringify({ data: { ...event.data, livemode: true } }));
 assert.equal(disabled.verifyWebhook(paid, signature(paid, '1800000000', 'li')).livemode, true, 'existing paid checkouts can still settle when new live checkout is disabled');
 await disabled.expire('cs_livefixture');
 assert.equal(calls, 2, 'existing checkout cancellation remains available');
});
test('webhooks require the original body, correct signature, timestamp and environment', () => {
 const gateway = createPayMongo({ env, now: () => 1800000000000 });
 const raw = Buffer.from(JSON.stringify(event));
 assert.equal(gateway.verifyWebhook(raw, signature(raw)).session.id, 'cs_fixture');
 assert.throws(() => gateway.verifyWebhook(Buffer.from(JSON.stringify(event, null, 2)), signature(raw)), { statusCode: 401 });
 assert.throws(() => gateway.verifyWebhook(raw, signature(raw, '1799999000')), { statusCode: 401 });
 assert.throws(() => gateway.verifyWebhook(raw, signature(raw, '1800000000', 'li')), { statusCode: 401 });
 assert.throws(() => gateway.verifyWebhook(raw, ''), { statusCode: 401 });
 const wrongMode = Buffer.from(JSON.stringify({ data: { ...event.data, livemode: true } }));
 assert.throws(() => gateway.verifyWebhook(wrongMode, signature(wrongMode)), { statusCode: 400 });
 const legacy = Buffer.from(JSON.stringify({ data: { type: 'event', attributes: event.data } }));
 assert.equal(gateway.verifyWebhook(legacy, signature(legacy)).type, 'checkout_session.payment.paid');
 const empty = Buffer.from('null');
 assert.throws(() => gateway.verifyWebhook(empty, signature(empty)), { statusCode: 400 });
});
test('opaque login sessions store only a hash and authorize only the matching account', async () => {
 let stored;
 const db = { async query(sql, params) {
  if (sql.startsWith('INSERT')) stored = params;
  return { rows: (sql.startsWith('SELECT') || sql.startsWith('UPDATE account_sessions')) && params[0] === stored?.[0] ? [{ account_role: stored[1], account_id: stored[2] }] : [] };
 } };
 const token = await issueSession(db, 'customer', 61);
 assert.match(token, /^[a-f0-9]{64}$/);
 assert.equal(stored[0], hashToken(token));
 assert.notEqual(stored[0], token);
 assert.deepEqual(await authenticateAccount(db, { headers: { authorization: `Bearer ${token}` } }, 'customer', 61), { role: 'customer', id: 61 });
 await assert.rejects(authenticateAccount(db, { headers: {} }, 'customer', 61), { statusCode: 401 });
 await assert.rejects(authenticateAccount(db, { headers: { authorization: `Bearer ${token}` } }, 'provider', 61), { statusCode: 403 });
});
