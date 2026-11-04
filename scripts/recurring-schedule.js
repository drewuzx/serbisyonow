'use strict';
const { transaction, fail } = require('./booking-payments');
const time = require('../shared/js/time-format');

function today() {
 return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
}
function day(value, offset=0) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400,'Choose a valid date.');
 const date=new Date(`${value}T00:00:00Z`);
 if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) fail(400,'Choose a valid date.');
 date.setUTCDate(date.getUTCDate()+offset);
 return date.toISOString().slice(0,10);
}
const overlaps=(start,end,slot)=>start<time.minutes(slot.end_time) && end>time.minutes(slot.start_time);

async function materialize(client, providerId, from, through) {
 const rules=(await client.query(`SELECT *,to_char(start_date,'YYYY-MM-DD') AS start_date
  FROM provider_schedule_repeats WHERE provider_id=$1 AND is_active ORDER BY id`,[providerId])).rows;
 let created=0,skipped=0;
 for(const rule of rules) {
  const first=[from,today(),rule.start_date].sort().at(-1);
  if(first>through) continue;
  const dates=(await client.query(`INSERT INTO provider_schedule_occurrences(repeat_id,occurrence_date)
   SELECT $1,d::date FROM generate_series($2::date,$3::date,interval '1 day') d
   WHERE extract(dow FROM d)::int=ANY($4::int[])
   ON CONFLICT DO NOTHING RETURNING to_char(occurrence_date,'YYYY-MM-DD') AS date`,
   [rule.id,first,through,rule.weekdays])).rows.map(row=>row.date);
  if(!dates.length) continue;
  const slots=(await client.query(`SELECT *,to_char(available_date,'YYYY-MM-DD') AS date FROM provider_availability
   WHERE provider_id=$1 AND available_date=ANY($2::date[]) FOR UPDATE`,[providerId,dates])).rows;
  const bookings=(await client.query(`SELECT scheduled_time,to_char(scheduled_date,'YYYY-MM-DD') AS date
   FROM customer_bookings WHERE provider_id=$1 AND scheduled_date=ANY($2::date[])
   AND status NOT IN ('cancelled','completed')`,[providerId,dates])).rows;
  const start=time.minutes(rule.start_time),end=time.minutes(rule.end_time);
  const safe=dates.filter(date=>!slots.some(slot=>slot.date===date && overlaps(start,end,slot))
   && !bookings.some(booking=>booking.date===date && time.minutes(booking.scheduled_time)>=start && time.minutes(booking.scheduled_time)<end));
  if(safe.length) {
   const result=await client.query(`INSERT INTO provider_availability(provider_id,available_date,start_time,end_time,is_available,repeat_id)
    SELECT $1,d,$3,$4,$5,$6 FROM unnest($2::date[]) d ON CONFLICT DO NOTHING RETURNING id`,
    [providerId,safe,rule.start_time,rule.end_time,rule.is_available,rule.id]);
   created+=result.rowCount;
  }
  skipped+=dates.length-safe.length;
 }
 return {created,skipped};
}

async function ensureRepeats(db, providerId=null, from=today(), through=day(from,83)) {
 from=day(from); through=day(through);
 if(through<from || through>day(from,90)) fail(400,'Request at most 13 weeks at a time.');
 const providers=(await db.query(`SELECT DISTINCT provider_id FROM provider_schedule_repeats
  WHERE is_active AND ($1::int IS NULL OR provider_id=$1) ORDER BY provider_id`,[providerId])).rows;
 for(const provider of providers) await transaction(db,async client=>{
  await client.query('SELECT id FROM providers WHERE id=$1 FOR UPDATE',[provider.provider_id]);
  await materialize(client,provider.provider_id,from,through);
 });
}

async function createRepeat(db, providerId, values) {
 const weekdays=[...new Set(values.dates.map(date=>new Date(`${date}T00:00:00Z`).getUTCDay()))].sort();
 return transaction(db,async client=>{
  await client.query('SELECT id FROM providers WHERE id=$1 FOR UPDATE',[providerId]);
  const existing=(await client.query('SELECT * FROM provider_schedule_repeats WHERE provider_id=$1 AND is_active',[providerId])).rows;
  if(existing.some(rule=>rule.weekdays.some(d=>weekdays.includes(d)) && overlaps(time.minutes(values.start_time),time.minutes(values.end_time),rule))) {
   fail(409,'A weekly repeat already covers these days and hours. Stop that repeat before changing it.');
  }
  const rule=(await client.query(`INSERT INTO provider_schedule_repeats(provider_id,start_date,weekdays,start_time,end_time,is_available)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[providerId,values.dates[0],weekdays,values.start_time,values.end_time,values.is_available])).rows[0];
  const result=await materialize(client,providerId,values.dates[0],day(values.dates[0],83));
  return {repeat:rule,...result};
 });
}

async function stopRepeat(db, providerId, id) {
 return transaction(db,async client=>{
  await client.query('SELECT id FROM providers WHERE id=$1 FOR UPDATE',[providerId]);
  const rule=await client.query('UPDATE provider_schedule_repeats SET is_active=FALSE WHERE provider_id=$1 AND id=$2 RETURNING id',[providerId,id]);
  if(!rule.rowCount) fail(404,'Weekly repeat not found.');
  // Lock slots before checking bookings so in-flight bookings are preserved.
  await client.query(`SELECT id FROM provider_availability WHERE provider_id=$1 AND repeat_id=$2
   AND available_date >= $3::date FOR UPDATE`,[providerId,id,today()]);
  const removed=await client.query(`DELETE FROM provider_availability a WHERE a.provider_id=$1 AND a.repeat_id=$2
   AND (a.available_date > $3::date OR (a.available_date=$3::date AND a.start_time::time > (NOW() AT TIME ZONE 'Asia/Manila')::time))
   AND NOT EXISTS (SELECT 1 FROM customer_bookings b WHERE b.provider_id=a.provider_id AND b.scheduled_date=a.available_date
    AND b.status <> 'cancelled' AND b.scheduled_time::time >= a.start_time::time AND b.scheduled_time::time < a.end_time::time)
   RETURNING id`,[providerId,id,today()]);
  return {ok:true,removed:removed.rowCount};
 });
}

module.exports={ensureRepeats,createRepeat,stopRepeat};
