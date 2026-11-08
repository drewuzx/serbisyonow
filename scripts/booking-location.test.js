'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startQrFixture } = require('./provider-qr-test-fixture');

test('booking pins are required, persisted per booking and private to the booking accounts', async () => {
 const f = await startQrFixture();
 try {
  await f.db.query('UPDATE customers SET latitude=15.1, longitude=120.5 WHERE id=61');
  const service = (await f.db.query("INSERT INTO provider_services(provider_id,title,category,starting_price) VALUES(81,'Fixture work','Fixture',500) RETURNING id")).rows[0];
  await f.db.query("INSERT INTO provider_availability(provider_id,available_date,start_time,end_time,is_available) VALUES(81,'2099-10-10','10:00','11:00',TRUE),(81,'2099-10-11','10:00','11:00',TRUE)");
  const body = { provider_id:81, provider_service_id:service.id, service:'Fixture work', scheduled_date:'2099-10-10', scheduled_time:'10:00', address:'Booking address', payment_method:'cash', latitude:15.1456789, longitude:120.5912345, location_confirmed:true, landmark:'Unit 2, blue gate' };
  for (const invalid of [
   { latitude:null }, { latitude:'' }, { latitude:' ' }, { latitude:true }, { latitude:[] },
   { latitude:91 }, { longitude:-181 }, { longitude:'NaN' }, { longitude:undefined },
   { location_confirmed:false }, { location_confirmed:undefined }, { location_confirmed:'yes' },
   { accuracy:-1 }, { accuracy:'bad' }, { accuracy:1e100 }, { landmark:'x'.repeat(501) },
  ]) {
   const r = await f.request('/api/customer/61/bookings','POST',{ ...body, ...invalid });
   assert.equal(r.status,400,JSON.stringify({ invalid, result:r.data }));
  }
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM customer_bookings')).rows[0].count,0);
  assert.equal((await f.request('/api/providers/81/availability?date=2099-10-10')).data.availability.length,1);
  const result = await f.request('/api/customer/61/bookings','POST',body);
  assert.equal(result.status,201,JSON.stringify(result.data));
  const booking = result.data.booking;
  assert.equal(booking.latitude,body.latitude);
  assert.equal(booking.longitude,body.longitude);
  assert.equal(booking.service_details.booking_location.landmark,body.landmark);
  assert.ok(booking.service_details.booking_location.confirmed_at);
  assert.equal(booking.location_accuracy_m,null);
  const customer = (await f.db.query('SELECT address,latitude,longitude FROM customers WHERE id=61')).rows[0];
  assert.equal(customer.address,'Test address');
  assert.equal(Number(customer.latitude),15.1);
  // Later profile updates cannot move an existing booking's pin.
  await f.db.query('UPDATE customers SET latitude=16,longitude=121,location_accuracy_m=12 WHERE id=61');
  const dashboard = await f.request('/api/provider/81/dashboard','GET',undefined,f.providerToken);
  assert.equal(dashboard.status,200);
  assert.equal(dashboard.data.bookings[0].customer_latitude,body.latitude);
  assert.equal(dashboard.data.bookings[0].customer_longitude,body.longitude);
  assert.equal(dashboard.data.bookings[0].customer_location_accuracy_m,null,'Manual pin does not inherit profile GPS accuracy');
  for (const [route, wrongToken] of [
   ['/api/provider/81/dashboard',f.otherProviderToken],
   ['/api/customer/61/dashboard',f.otherCustomerToken],
   ['/api/customer/61/bookings',f.otherCustomerToken],
   [`/api/customer/61/bookings/${booking.id}/track`,f.otherCustomerToken],
  ]) {
   assert.equal((await f.request(route,'GET',undefined,'')).status,401,route);
   assert.equal((await f.request(route,'GET',undefined,wrongToken)).status,403,route);
  }
  const publicServices = await f.request('/api/providers/81/services','GET',undefined,'');
  assert.equal(publicServices.status,200);
  assert.deepEqual(Object.keys(publicServices.data),['services']);
  const form = new FormData();
  Object.entries({ ...body, scheduled_date:'2099-10-11', latitude:0, longitude:0, accuracy:8 }).forEach(([key,value]) => form.append(key,String(value)));
  const uploaded = await f.request('/api/customer/61/bookings','POST',form);
  assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));
  assert.equal(uploaded.data.booking.latitude,0);
  assert.equal(uploaded.data.booking.location_accuracy_m,8);
 } finally { await f.close(); }
});
