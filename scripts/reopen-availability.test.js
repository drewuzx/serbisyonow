'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {startQrFixture}=require('./provider-qr-test-fixture');

test('reopened future slots can be booked again without completed history blocking them',async()=>{
 const f=await startQrFixture();
 try {
  const service=(await f.db.query("INSERT INTO provider_services(provider_id,title,category,starting_price) VALUES(81,'Fixture work','Fixture',500) RETURNING id")).rows[0];
  const body={provider_id:81,provider_service_id:service.id,service:'Fixture work',scheduled_date:'2099-10-10',scheduled_time:'10:00',address:'Test address',payment_method:'cash',latitude:15.145,longitude:120.59,location_confirmed:true};
  const slot=(await f.db.query("INSERT INTO provider_availability(provider_id,available_date,start_time,end_time,is_available) VALUES(81,'2099-10-10','10:00 AM','12:00 PM',FALSE) RETURNING id")).rows[0];
  const route=`/api/provider/81/availability/${slot.id}`;
  const reopen=(token=f.providerToken)=>f.request(route,'PATCH',{is_available:true},token);
  const list=()=>f.request('/api/providers/81/availability?date=2099-10-10');
  await f.createBooking({scheduled_time:'10:00',status:'completed'});
  assert.equal((await reopen(f.otherProviderToken)).status,403);
  assert.equal((await reopen()).status,200);
  assert.equal((await list()).data.availability.length,1);
  // Equivalent AM/PM and 24-hour values refer to the same slot.
  const booked=await f.request('/api/customer/61/bookings','POST',body);
  assert.equal(booked.status,201,JSON.stringify(booked.data));
  assert.equal((await list()).data.availability.length,0);
  const occupied=await reopen();
  assert.equal(occupied.status,409);
  assert.match(occupied.data.message,/active appointment/);
  assert.equal((await f.db.query('SELECT is_available FROM provider_availability WHERE id=$1',[slot.id])).rows[0].is_available,false);
  // Stale legacy open flags must not advertise occupied slots or alternatives.
  await f.db.query('UPDATE provider_availability SET is_available=TRUE WHERE id=$1',[slot.id]);
  assert.equal((await list()).data.availability.length,0);
  const search=await f.request('/api/providers/search?available=true&q=Fixture');
  assert.equal(search.status,200,JSON.stringify(search.data));
  assert.equal(search.data.providers.length,0);
  const rejected=await f.request('/api/customer/61/bookings','POST',body);
  assert.equal(rejected.status,409);
  assert.equal(rejected.data.alternatives.length,0);
  assert.equal((await f.request(`/api/customer/61/bookings/${booked.data.booking.id}/cancel`,'PATCH',{})).status,200);
  assert.equal((await list()).data.availability.length,1);
  await f.request(route,'PATCH',{is_available:false},f.providerToken);
  assert.equal((await reopen()).status,200);
  // Two customers racing for the reopened slot still produce only one booking.
  const concurrent=await Promise.all([f.request('/api/customer/61/bookings','POST',body),f.request('/api/customer/62/bookings','POST',body,f.otherCustomerToken)]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409]);
  assert.equal((await list()).data.availability.length,0);
 } finally {await f.close();}
});

test('reopen rejects active appointment ranges and expired times, while closed history stays intact',async()=>{
 const f=await startQrFixture();
 try {
  const slot=(await f.db.query("INSERT INTO provider_availability(provider_id,available_date,start_time,end_time,is_available) VALUES(81,'2099-10-10','09:00','12:00',FALSE) RETURNING id")).rows[0];
  const booking=await f.createBooking({scheduled_time:'10:00 AM',status:'ongoing'});
  const route=`/api/provider/81/availability/${slot.id}`;
  assert.equal((await f.request(route,'PATCH',{is_available:true},f.providerToken)).status,409);
  await f.db.query("UPDATE customer_bookings SET status='completed' WHERE id=$1",[booking.id]);
  assert.equal((await f.request(route,'PATCH',{is_available:true},f.providerToken)).status,200);
  assert.equal((await f.db.query('SELECT status FROM customer_bookings WHERE id=$1',[booking.id])).rows[0].status,'completed');
  const expired=(await f.db.query("INSERT INTO provider_availability(provider_id,available_date,start_time,end_time,is_available) VALUES(81,'2000-01-01','09:00','12:00',FALSE) RETURNING id")).rows[0];
  const rejected=await f.request(`/api/provider/81/availability/${expired.id}`,'PATCH',{is_available:true},f.providerToken);
  assert.equal(rejected.status,409);
  assert.match(rejected.data.message,/already passed/);
  await f.db.query('UPDATE provider_availability SET is_available=TRUE WHERE id=$1',[expired.id]);
  assert.equal((await f.request('/api/providers/81/availability?date=2000-01-01')).data.availability.length,0);
  const service=(await f.db.query("INSERT INTO provider_services(provider_id,title,category,starting_price) VALUES(81,'Fixture work','Fixture',500) RETURNING id")).rows[0];
  const pastBooking=await f.request('/api/customer/61/bookings','POST',{provider_id:81,provider_service_id:service.id,service:'Fixture work',scheduled_date:'2000-01-01',scheduled_time:'09:00',address:'Test',latitude:15.145,longitude:120.59,location_confirmed:true});
  assert.equal(pastBooking.status,409);
 } finally {await f.close();}
});
