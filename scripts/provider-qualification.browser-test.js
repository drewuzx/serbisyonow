'use strict';
const assert = require('node:assert/strict');
const { startQrFixture } = require('./provider-qr-test-fixture');

async function main() {
 const f = await startQrFixture();
 try {
  await f.db.query(`UPDATE provider_skill_assessments SET score = 50, badge = 'Not Yet Qualified'
   WHERE provider_id = 82`);
  await f.db.query(`INSERT INTO provider_services (provider_id, title, category, starting_price, is_active)
   VALUES (81, 'General House Cleaning', 'Cleaning', 100, TRUE), (82, 'General House Cleaning', 'Cleaning', 100, TRUE)`);
  await f.db.query(`INSERT INTO provider_availability (provider_id, available_date, start_time, end_time, is_available)
   VALUES (82, CURRENT_DATE + 1, '09:00', '10:00', TRUE)`);

  const search = await f.request('/api/providers/search?q=cleaning');
  assert.equal(search.status, 200);
  assert.deepEqual(search.data.providers.map(provider => provider.id), [81]);
  const map = await f.request('/api/customer/61/location-map');
  assert.deepEqual(map.data.providers.map(provider => provider.id), [81]);
  const recommendations = await f.request('/api/customer/61/recommendations');
  assert.deepEqual(recommendations.data.providers.map(provider => provider.id), [81]);
  assert.deepEqual((await f.request('/api/providers/82/services')).data.services, []);
  assert.deepEqual((await f.request('/api/providers/82/availability?date=2099-10-10')).data.availability, []);

  const booking = await f.request('/api/customer/61/bookings', 'POST', {
   provider_id: 82, service: 'General House Cleaning', scheduled_date: '2099-10-10',
   scheduled_time: '09:00 AM', address: 'Test address', latitude: 15.15, longitude: 120.59,
   location_confirmed: true,
  });
  assert.equal(booking.status, 403);
  assert.match(booking.data.message, /not yet qualified/i);
  console.log('PASS: providers below the qualification threshold are hidden from all customer discovery and booking endpoints.');
 } finally {
  await f.close();
 }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
