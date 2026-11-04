'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { startQrFixture } = require('./provider-qr-test-fixture');

test('weekly repeats persist, expand without provider login, preserve exceptions and stop safely', async () => {
 const f = await startQrFixture();
 try {
  const route='/api/provider/81/availability-week';
  const body={dates:['2099-10-05','2099-10-07'],start_time:'09:00',end_time:'12:00',is_available:true,repeat_weekly:true};
  const send=(body)=>f.request(route,'POST',body,f.providerToken);
  const week=(date)=>f.request(`/api/provider/81/schedule-week?start=${date}`,'GET',undefined,f.providerToken);
  assert.equal((await f.request(route,'POST',body,f.otherProviderToken)).status,403);
  assert.equal((await send({...body,repeat_weekly:'true'})).status,400);
  await send({...body,dates:['2099-10-05'],repeat_weekly:false,is_available:false});
  await f.createBooking({scheduled_date:'2099-10-07',scheduled_time:'10:00'});
  const created=await send(body);
  assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal(created.data.created,22);
  assert.equal(created.data.skipped,2);
  const id=created.data.repeat.id;
  assert.equal((await send(body)).status,409);
  let result=await week('2099-10-12');
  assert.equal(result.data.repeats.length,1);
  assert.deepEqual(result.data.availability.map(s=>s.available_date),['2099-10-12','2099-10-14']);
  const [deleted,changed]=result.data.availability;
  assert.equal((await f.request(`/api/provider/81/availability/${deleted.id}`,'DELETE',undefined,f.providerToken)).status,200);
  assert.equal((await f.request(`/api/provider/81/availability/${changed.id}`,'PATCH',{is_available:false},f.providerToken)).status,200);
  result=await week('2099-10-12');
  assert.equal(result.data.availability.length,1);
  assert.equal(result.data.availability[0].repeat_id,null);
  assert.equal(result.data.availability[0].is_available,false);
  assert.equal((await week('2099-10-05')).data.availability.length,1);
  // A customer request, beyond the original horizon, generates the same weekly hours.
  const future=await f.request('/api/providers/81/availability?date=2100-02-01');
  assert.equal(future.status,200,JSON.stringify(future.data));
  assert.equal(future.data.availability.length,1);
  assert.equal(future.data.availability[0].start_time,'09:00');
  await Promise.all([week('2100-07-05'),week('2100-07-05')]);
  assert.equal((await week('2100-07-05')).data.availability.length,2);
  assert.equal((await send({...body,dates:['2100-07-05'],repeat_weekly:false})).status,409);
  const booking=await f.createBooking({scheduled_date:'2099-10-19',scheduled_time:'09:00'});
  const providerBooking=await f.createBooking({scheduled_date:'2099-10-21',scheduled_time:'09:00'});
  await f.db.query("UPDATE provider_availability SET is_available=FALSE WHERE available_date IN ('2099-10-19','2099-10-21')");
  const stop=`/api/provider/81/schedule-repeats/${id}`;
  assert.equal((await f.request(stop,'DELETE',undefined,f.otherProviderToken)).status,403);
  assert.equal((await f.request(stop,'DELETE',undefined,null)).status,401);
  assert.equal((await f.request(stop,'DELETE',undefined,f.providerToken)).status,200);
  assert.equal((await week('2099-10-19')).data.availability.length,2);
  assert.equal((await week('2099-10-19')).data.repeats.length,0);
  assert.equal((await week('2100-07-05')).data.availability.length,0);
  assert.equal((await week('2099-10-12')).data.availability.length,1);
  assert.equal((await f.request('/api/providers/81/availability?date=2101-02-07')).data.availability.length,0);
  const cancelled=await f.request(`/api/customer/61/bookings/${booking.id}/cancel`,'PATCH',{});
  assert.equal(cancelled.status,200,JSON.stringify(cancelled.data));
  assert.equal((await f.request('/api/providers/81/availability?date=2099-10-19')).data.availability.length,0);
  const providerCancelled=await f.request(`/api/provider/81/bookings/${providerBooking.id}/status`,'PATCH',{status:'cancelled'},f.providerToken);
  assert.equal(providerCancelled.status,200,JSON.stringify(providerCancelled.data));
  assert.equal((await f.request('/api/providers/81/availability?date=2099-10-21')).data.availability.length,0);
  // Reapplying the migration must preserve existing rules and occurrence exceptions.
  await f.db.query(fs.readFileSync(path.join(__dirname,'recurring-schedule-schema.sql'),'utf8'));
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM provider_schedule_repeats')).rows[0].n,1);
 } finally { await f.close(); }
});

test('concurrent repeat creation, closed repeats and rolling search horizon', async () => {
 const f=await startQrFixture();
 try {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const body={dates:[today],start_time:'09:00',end_time:'12:00',is_available:true,repeat_weekly:true};
  const results=await Promise.all([1,2].map(()=>f.request('/api/provider/81/availability-week','POST',body,f.providerToken)));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const rule=results.find(r=>r.status===201).data.repeat;
  // Simulate an old rule whose initial window has elapsed without provider activity.
  await f.db.query('DELETE FROM provider_availability WHERE repeat_id=$1',[rule.id]);
  await f.db.query('DELETE FROM provider_schedule_occurrences WHERE repeat_id=$1',[rule.id]);
  await f.db.query("UPDATE provider_schedule_repeats SET start_date=start_date-365 WHERE id=$1",[rule.id]);
  assert.equal((await f.request('/api/providers/search')).status,200);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM provider_availability WHERE repeat_id=$1',[rule.id])).rows[0].n,12);
  const closed=await f.request('/api/provider/82/availability-week','POST',{...body,is_available:false},f.otherProviderToken);
  assert.equal(closed.status,201);
  assert.equal((await f.request(`/api/providers/82/availability?date=${today}`)).data.availability.length,0);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM provider_availability WHERE provider_id=82 AND NOT is_available')).rows[0].n,12);
 } finally { await f.close(); }
});
