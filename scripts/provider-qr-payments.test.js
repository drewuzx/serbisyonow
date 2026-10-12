'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { imageFile } = require('./provider-qr-payments');
const { startQrFixture } = require('./provider-qr-test-fixture');

test('direct QR payment flow with real isolated PostgreSQL transactions', { timeout: 60000 }, async t => {
 const f = await startQrFixture();
 t.after(f.close);
 const { db, request, providerToken, otherProviderToken, otherCustomerToken } = f;
 const booking = await f.createBooking();
 const customer = `/api/customer/61/bookings/${booking.id}`;
 const provider = `/api/provider/81/bookings/${booking.id}`;
 const price = () => request(provider + '/price', 'PATCH', { price: '333.35', price_version: 0 }, providerToken);
 const prepare = (extra = {}) => request(customer + '/direct-payment', 'POST', { price_version: 1, accept_price: true, ...extra });
 let qr;
 let receipt;
 await t.test('authentication, verified accounts, and receiving QR are required', async () => {
  assert.equal(booking.deposit_channel, 'provider_qr');
  assert.equal((await request('/api/provider/81/payment-qr', 'PUT', f.qrForm(), '')).status, 401);
  assert.equal((await request('/api/provider/81/payment-qr', 'PUT', f.qrForm(), otherProviderToken)).status, 403);
  assert.equal((await price()).status, 409);
  assert.equal((await request(customer + '/direct-payment', 'POST', { accept_price: true, price_version: 1 }, otherCustomerToken)).status, 403);
  await db.query('UPDATE customers SET is_verified = FALSE WHERE id = 61');
  assert.equal((await prepare()).status, 403);
  await db.query('UPDATE customers SET is_verified = TRUE WHERE id = 61');
 });
 await t.test('saved QR persists in database storage, recipient locks before paying', async () => {
  const saved = await request('/api/provider/81/payment-qr', 'PUT', f.qrForm(), providerToken);
  assert.equal(saved.status, 200);
  qr = saved.data.payment_qr;
  assert.equal((await request(qr.qr_url, 'GET', undefined, '')).status, 200);
  assert.deepEqual((await request(qr.qr_url, 'GET', undefined, '')).data, f.image);
  assert.equal((await price()).status, 200);
  assert.equal((await prepare({ accept_price: false })).status, 400);
  assert.equal((await prepare({ price_version: 0 })).status, 409);
  const ready = await prepare();
  assert.equal(ready.status, 200);
  assert.equal(ready.data.booking.deposit_amount, 100.01);
  assert.equal(ready.data.recipient.qr_url, qr.qr_url);
  assert.equal((await request('/api/provider/81/payment-qr', 'PUT', f.qrForm('Updated Test Name'), providerToken)).status, 200);
  const retry = await prepare();
  assert.equal(retry.data.recipient.account_name, 'QR Test Provider');
  assert.equal(retry.data.recipient.qr_url, qr.qr_url);
  assert.equal((await request(customer + '/checkout', 'POST', { accept_price: true, price_version: 1 })).status, 503, 'unconfigured gateway is not used');
  assert.equal((await request(provider + '/price', 'PATCH', { price: 500, price_version: 1 }, providerToken)).status, 409);
 });
 await t.test('receipt submission stays pending, cannot bypass verification, and images remain private', async () => {
  const result = await request(customer + '/direct-payment/receipt', 'POST', f.receiptForm(1));
  assert.equal(result.status, 201);
  receipt = result.data.receipt;
  assert.equal(result.data.booking.status, 'pending');
  assert.equal(result.data.booking.deposit_status, 'awaiting_verification');
  assert.equal(receipt.amount, 100.01);
  assert.equal((await request(customer + '/direct-payment/receipt', 'POST', f.receiptForm(1))).status, 409);
  assert.equal((await request(provider + '/status', 'PATCH', { status: 'upcoming' }, providerToken)).status, 409);
  const imagePath = receipt.image_url + '?role=customer';
  assert.equal((await request(imagePath, 'GET', undefined, '')).status, 401);
  assert.equal((await request(imagePath, 'GET', undefined, otherCustomerToken)).status, 404);
  assert.equal((await request(receipt.image_url + '?role=provider', 'GET', undefined, otherProviderToken)).status, 404);
  const image = await request(imagePath);
  assert.equal(image.status, 200);
  assert.deepEqual(image.data, f.image);
  assert.match(image.headers.get('cache-control'), /no-store/);
  assert.equal((await request(receipt.image_url + '?role=provider', 'GET', undefined, providerToken)).status, 200);
 });
 await t.test('rejection requires notes; proof can be resubmitted without another transfer', async () => {
  const body = { decision: 'reject', receipt_id: receipt.id, price_version: 1 };
  assert.equal((await request(provider + '/direct-payment', 'PATCH', body, providerToken)).status, 400);
  assert.equal((await request(provider + '/direct-payment', 'PATCH', { ...body, notes: 'Reference not visible in receipt' }, providerToken)).status, 200);
  const details = await request(customer + '/payment');
  assert.equal(details.data.receipt.status, 'rejected');
  assert.equal(details.data.booking.status, 'pending');
  assert.equal(details.data.booking.deposit_status, 'awaiting_payment');
  const corrected = await request(customer + '/direct-payment/receipt', 'POST', f.receiptForm(1));
  assert.equal(corrected.status, 201);
  assert.notEqual(corrected.data.receipt.id, receipt.id);
  receipt = corrected.data.receipt;
 });
 await t.test('only the assigned provider can confirm actual receipt, and verified bookings can start', async () => {
  const body = { decision: 'verify', receipt_id: receipt.id, price_version: 1, payment_received: true };
  assert.equal((await request(provider + '/direct-payment', 'PATCH', body, otherProviderToken)).status, 403);
  assert.equal((await request(provider + '/direct-payment', 'PATCH', { ...body, payment_received: false }, providerToken)).status, 400);
  assert.equal((await request(provider + '/direct-payment', 'PATCH', { ...body, receipt_id: Number(receipt.id) + 10 }, providerToken)).status, 409);
  const result = await request(provider + '/direct-payment', 'PATCH', body, providerToken);
  assert.equal(result.status, 200);
  assert.equal(result.data.booking.status, 'upcoming');
  assert.equal(result.data.booking.deposit_status, 'paid');
  assert.equal((await request(provider + '/direct-payment', 'PATCH', body, providerToken)).status, 409);
  assert.equal((await request(provider + '/status', 'PATCH', { status: 'ongoing', expected_status: 'upcoming' }, providerToken)).status, 200);
 });
 await t.test('references cannot confirm another booking, and cancellation never resurrects a payment', async () => {
  const another = await f.createBooking();
  const nextCustomer = `/api/customer/61/bookings/${another.id}`;
  const nextProvider = `/api/provider/81/bookings/${another.id}`;
  await request(nextProvider + '/price', 'PATCH', { price: 1000, price_version: 0 }, providerToken);
  await request(nextCustomer + '/direct-payment', 'POST', { accept_price: true, price_version: 1 });
  assert.equal((await request(nextCustomer + '/direct-payment/receipt', 'POST', f.receiptForm(1))).status, 409);
  const submitted = await request(nextCustomer + '/direct-payment/receipt', 'POST', f.receiptForm(1, 'TEST-REF-0002'));
  assert.equal(submitted.status, 201);
  const cancelled = await request(nextCustomer + '/cancel', 'PATCH');
  assert.equal(cancelled.data.booking.deposit_status, 'refund_review');
  assert.equal((await request(nextProvider + '/direct-payment', 'PATCH', { decision: 'verify', payment_received: true, price_version: 1, receipt_id: submitted.data.receipt.id }, providerToken)).status, 409);
  assert.equal((await request(customer + '/cancel', 'PATCH')).data.booking.deposit_status, 'refund_review');
 });
 await t.test('stale dates, unsafe files and migration compatibility are guarded', async () => {
  assert.throws(() => imageFile({ buffer: Buffer.from('<svg onload="alert(1)">'), mimetype: 'image/png' }), { statusCode: 400 });
  assert.throws(() => imageFile({ buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }), { statusCode: 400 });
  const past = await f.createBooking({ scheduled_date: '2000-01-01' });
  await request(`/api/provider/81/bookings/${past.id}/price`, 'PATCH', { price: 1000, price_version: 0 }, providerToken);
  assert.equal((await request(`/api/customer/61/bookings/${past.id}/direct-payment`, 'POST', { accept_price: true, price_version: 1 })).status, 409);
  const old = await f.createBooking({ deposit_channel: 'paymongo', customer_agreed_at: new Date() });
  const untouched = await f.createBooking({ deposit_channel: 'paymongo' });
  await db.query(fs.readFileSync(path.join(__dirname, 'payment-schema.sql'), 'utf8'));
  assert.equal((await db.query('SELECT deposit_channel FROM customer_bookings WHERE id = $1', [old.id])).rows[0].deposit_channel, 'paymongo');
  assert.equal((await db.query('SELECT deposit_channel FROM customer_bookings WHERE id = $1', [untouched.id])).rows[0].deposit_channel, 'provider_qr');
 });
 await t.test('concurrent receipt uploads cannot create two payable proofs; cancelled rejected proof remains reviewable', async () => {
  const next = await f.createBooking();
  const c = `/api/customer/61/bookings/${next.id}`;
  const p = `/api/provider/81/bookings/${next.id}`;
  await request(p + '/price', 'PATCH', { price: 1000, price_version: 0 }, providerToken);
  await request(c + '/direct-payment', 'POST', { accept_price: true, price_version: 1 });
  const results = await Promise.all([
   request(c + '/direct-payment/receipt', 'POST', f.receiptForm(1, 'CONCURRENT-REF-1')),
   request(c + '/direct-payment/receipt', 'POST', f.receiptForm(1, 'CONCURRENT-REF-2')),
  ]);
  assert.deepEqual(results.map(item => item.status).sort(), [201, 409]);
  const current = results.find(item => item.status === 201).data.receipt;
  await request(p + '/direct-payment', 'PATCH', { decision: 'reject', receipt_id: current.id, price_version: 1, notes: 'Check with sender' }, providerToken);
  const cancelled = await request(p + '/status', 'PATCH', { status: 'cancelled' }, providerToken);
  assert.equal(cancelled.data.booking.deposit_status, 'refund_review');
  assert.equal((await request(current.image_url + '?role=provider', 'GET', undefined, providerToken)).status, 200);
 });
});
