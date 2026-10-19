'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startQrFixture } = require('./provider-qr-test-fixture');

test('service availability and Cash/QR options persist and gate new bookings', async () => {
 const f = await startQrFixture();
 try {
  await f.db.query('UPDATE provider_services SET is_active=FALSE WHERE provider_id=81');
  const { rows: [service] } = await f.db.query("INSERT INTO provider_services(provider_id,title,category,accepts_cash,accepts_gcash) VALUES(81,'Options Test','General',TRUE,FALSE) RETURNING *");
  const path = `/api/provider/81/services/${service.id}`;
  const patch = body => f.request(path, 'PATCH', body, f.providerToken);
  assert.equal((await f.request(path, 'PATCH', { is_active: false }, f.otherProviderToken)).status, 403);
  for (const body of [{ is_active: 'false' }, { accepts_cash: null }, { accepts_other: true }, { accepts_cash: false }]) {
   assert.equal((await patch(body)).status, 400);
  }
  assert.equal((await patch({ is_active: false })).data.service.is_active, false);
  const hidden = await f.request('/api/providers/search?q=Options%20Test');
  assert.equal(hidden.status, 200);
  assert.equal(hidden.data.providers.some(provider => provider.id === 81), false);
  const booking = { provider_id: 81, provider_service_id: service.id, service: 'Options Test', scheduled_date: '2099-10-10', scheduled_time: '10:00 AM', address: 'Test', payment_method: 'cash' };
  const book = body => f.request('/api/customer/61/bookings', 'POST', { ...booking, ...body });
  assert.equal((await book({})).status, 400);
  assert.equal((await book({ provider_service_id: null })).status, 400, 'A disabled service cannot be booked by omitting its ID');
  assert.equal((await patch({ accepts_cash: false })).status, 200);
  assert.equal((await patch({ is_active: true })).status, 400);
  assert.equal((await patch({ accepts_gcash: true, is_active: true })).status, 200);
  const shown = await f.request('/api/providers/search?q=Options%20Test');
  assert.equal(shown.data.providers.some(provider => provider.id === 81), true);
  for (const payment_method of ['cash', 'other', 'card']) assert.equal((await book({ payment_method })).status, 400);
  await f.db.query("INSERT INTO provider_availability(provider_id,available_date,start_time,end_time) VALUES(81,'2099-10-10','10:00 AM','12:00 PM'),(81,'2099-10-11','10:00 AM','12:00 PM')");
  const qrBooking = await book({ payment_method: 'qr' });
  assert.equal(qrBooking.status, 201, JSON.stringify(qrBooking.data));
  assert.equal(qrBooking.data.booking.payment_method, 'gcash');
  assert.equal(qrBooking.data.booking.deposit_status, 'awaiting_price');
  assert.equal((await patch({ accepts_cash: true, accepts_gcash: false })).status, 200);
  assert.equal((await book({ scheduled_date: '2099-10-11', payment_method: 'gcash' })).status, 400);
  const cashBooking = await book({ scheduled_date: '2099-10-11' });
  assert.equal(cashBooking.status, 201, JSON.stringify(cashBooking.data));
  assert.equal(cashBooking.data.booking.payment_method, 'cash');
  await patch({ is_active: false });
  const rows = (await f.db.query('SELECT payment_method,status FROM customer_bookings WHERE id=ANY($1::int[]) ORDER BY id', [[qrBooking.data.booking.id, cashBooking.data.booking.id]])).rows;
  assert.deepEqual(rows.map(row => row.payment_method), ['gcash', 'cash']);
  assert.ok(rows.every(row => row.status === 'pending'), 'Switching off does not cancel existing bookings');
  await patch({ is_active: true, accepts_cash: true, accepts_gcash: true });
  const concurrent = await Promise.all([patch({ accepts_cash: false }), patch({ accepts_gcash: false })]);
  assert.ok(concurrent.some(result => result.status !== 200));
  const saved = (await f.db.query('SELECT * FROM provider_services WHERE id=$1', [service.id])).rows[0];
  assert.ok(saved.accepts_cash || saved.accepts_gcash, 'Concurrent saves must not disable every payment option');
 } finally { await f.close(); }
});
