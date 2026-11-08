'use strict';
const {transaction,fail}=require('./booking-payments');
const time=require('../shared/js/time-format');

// These predicates are shared by listing, reopening and booking slots.
const futureSlot=(alias='a')=>`(${alias}.available_date + ${alias}.start_time::time) > (NOW() AT TIME ZONE 'Asia/Manila')`;
const unoccupiedSlot=(alias='a')=>`NOT EXISTS (
 SELECT 1 FROM customer_bookings occupied
 WHERE occupied.provider_id=${alias}.provider_id AND occupied.scheduled_date=${alias}.available_date
 AND occupied.status NOT IN ('cancelled','completed')
 AND occupied.scheduled_time::time >= ${alias}.start_time::time
 AND occupied.scheduled_time::time < ${alias}.end_time::time
)`;
const bookableSlot=(alias='a')=>`${alias}.is_available=TRUE AND ${futureSlot(alias)} AND ${unoccupiedSlot(alias)}`;

async function updateSlot(db,providerId,slotId,body) {
 return transaction(db,async client=>{
  await client.query('SELECT id FROM providers WHERE id=$1 FOR UPDATE',[providerId]);
  const result=await client.query(`SELECT *,to_char(available_date,'YYYY-MM-DD') AS available_date
   FROM provider_availability WHERE provider_id=$1 AND id=$2 FOR UPDATE`,[providerId,slotId]);
  const current=result.rows[0];
  if(!current) fail(404,'Availability slot not found.');
  if(body.is_available!==undefined && typeof body.is_available!=='boolean') fail(400,'Choose whether the slot is open for booking.');
  const date=body.available_date ?? current.available_date;
  const parsed=new Date(`${date}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date) fail(400,'Choose a valid date.');
  const start=body.start_time ?? current.start_time,end=body.end_time ?? current.end_time;
  if(time.minutes(start)===null || time.minutes(end)===null || time.minutes(end)<=time.minutes(start)) fail(400,'End time must be later than start time.');
  const open=body.is_available ?? current.is_available;
  if(open) {
   // Check after the slot lock, so a concurrent customer booking cannot be reopened.
   const check=await client.query(`SELECT ${futureSlot()} AS future,${unoccupiedSlot()} AS free
    FROM (SELECT $1::int AS provider_id,$2::date AS available_date,$3::text AS start_time,$4::text AS end_time) a`,[providerId,date,start,end]);
   if(!check.rows[0].future) fail(409,'This time has already passed. Add a new availability slot for a future date or time.');
   if(!check.rows[0].free) fail(409,'This slot still has an active appointment. Complete or cancel that appointment before reopening it.');
  }
  return (await client.query(`UPDATE provider_availability SET available_date=$3,start_time=$4,end_time=$5,
   is_available=$6,repeat_id=NULL WHERE provider_id=$1 AND id=$2 RETURNING *`,[providerId,slotId,date,start,end,open])).rows[0];
 });
}

module.exports={futureSlot,unoccupiedSlot,bookableSlot,updateSlot};
