'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { startQrFixture } = require('./provider-qr-test-fixture');

test('weekly availability: ownership, validation, atomic saves, conflicts and full week results', async () => {
 const f = await startQrFixture();
 try {
  const route = '/api/provider/81/availability-week';
  const body = { dates: ['2099-10-05', '2099-10-06', '2099-10-07', '2099-10-08', '2099-10-09', '2099-10-10', '2099-10-11'], start_time:'09:00', end_time:'12:00', is_available:true };
  assert.equal((await f.request(route, 'POST', body, null)).status, 401);
  assert.equal((await f.request(route, 'POST', body, f.otherProviderToken)).status, 403);
  assert.equal((await f.request('/api/provider/81/schedule-week?start=2099-10-05', 'GET', undefined, f.customerToken)).status, 403);
  for (const patch of [{ dates:[] }, { dates:['2099-02-30'] }, { dates:['2099-10-05','2099-10-12'] }, { dates:['2000-01-01'] }, { end_time:'08:00' }, { start_time:'25:00' }, { is_available:'true' }]) {
   assert.equal((await f.request(route, 'POST', {...body,...patch}, f.providerToken)).status, 400, JSON.stringify(patch));
  }
  assert.equal((await f.request(route, 'POST', body, f.providerToken)).status, 201);
  assert.equal((await f.request(route, 'POST', body, f.providerToken)).status, 409);
  const conflict = await f.request(route, 'POST', {...body, dates:['2099-10-05','2099-10-06'], start_time:'11:00', end_time:'14:00'}, f.providerToken);
  assert.equal(conflict.status,409);
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM provider_availability')).rows[0].count,7);
  for (const start of ['13:00','15:00','17:00']) {
   assert.equal((await f.request(route, 'POST', {...body,start_time:start,end_time:`${Number(start.slice(0,2))+1}:00`}, f.providerToken)).status,201);
  }
  await f.createBooking({scheduled_date:'2099-10-10',scheduled_time:'19:00'});
  assert.equal((await f.request(route,'POST',{...body,start_time:'18:30',end_time:'20:00'},f.providerToken)).status,409);
  const week = await f.request('/api/provider/81/schedule-week?start=2099-10-07','GET',undefined,f.providerToken);
  assert.equal(week.status,200);
  assert.equal(week.data.week_start,'2099-10-05');
  assert.equal(week.data.availability.length,28);
  assert.equal(week.data.bookings.length,1);
  assert.equal((await f.request('/api/provider/81/schedule-week?start=2099-10-12','GET',undefined,f.providerToken)).data.availability.length,0);
  const slot = week.data.availability[0];
  assert.equal((await f.request(`/api/provider/81/availability/${slot.id}`,'PATCH',{is_available:false},f.otherProviderToken)).status,403);
  assert.equal((await f.request(`/api/provider/81/availability/${slot.id}`,'PATCH',{is_available:false},f.providerToken)).status,200);
  const concurrent = await Promise.all([1,2].map(() => f.request(route,'POST',{...body,dates:['2099-10-12'],start_time:'09:00',end_time:'10:00'},f.providerToken)));
  assert.deepEqual(concurrent.map(result=>result.status).sort(),[201,409]);
 } finally { await f.close(); }
});
