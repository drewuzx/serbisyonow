'use strict';

const { transaction, fail } = require('./booking-payments');
const time = require('../shared/js/time-format');

function dateKey(value) {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, 'Choose a valid date.');
 const date = new Date(`${value}T00:00:00Z`);
 if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(400, 'Choose a valid date.');
 return value;
}

function monday(value) {
 const date = new Date(`${dateKey(value)}T00:00:00Z`);
 date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
 return date.toISOString().slice(0, 10);
}

async function loadWeek(db, providerId, start) {
 start = monday(start);
 const slots = await db.query(`SELECT av.*, to_char(av.available_date, 'YYYY-MM-DD') AS available_date
  FROM provider_availability av WHERE provider_id=$1 AND available_date >= $2::date
  AND available_date < $2::date + 7 ORDER BY av.available_date, av.start_time`, [providerId, start]);
 const bookings = await db.query(`SELECT b.id, b.service, b.scheduled_time, b.status,
  to_char(b.scheduled_date, 'YYYY-MM-DD') AS scheduled_date, c.full_name AS customer_name
  FROM customer_bookings b LEFT JOIN customers c ON c.id=b.customer_id
  WHERE b.provider_id=$1 AND b.scheduled_date >= $2::date AND b.scheduled_date < $2::date + 7
  AND b.status NOT IN ('cancelled', 'completed') ORDER BY b.scheduled_date, b.id`, [providerId, start]);
 return { week_start: start, availability: slots.rows, bookings: bookings.rows };
}

async function saveWeek(db, providerId, body) {
 if (!Array.isArray(body.dates) || !body.dates.length || body.dates.length > 7) fail(400, 'Select one to seven days.');
 const dates = [...new Set(body.dates.map(dateKey))].sort();
 if (dates.some(date => monday(date) !== monday(dates[0]))) fail(400, 'Select dates within the same week.');
 const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
 if (dates.some(date => date < today)) fail(400, 'Availability cannot be added to a past date.');
 const start = time.minutes(body.start_time), end = time.minutes(body.end_time);
 if (start === null || end === null || end <= start) fail(400, 'End time must be later than start time.');
 if (typeof body.is_available !== 'boolean') fail(400, 'Choose whether these hours are open for booking.');
 return transaction(db, async client => {
  // Serialize weekly submissions so overlapping batches cannot both pass validation.
  await client.query('SELECT id FROM providers WHERE id=$1 FOR UPDATE', [providerId]);
  const existing = await client.query(`SELECT * FROM provider_availability
   WHERE provider_id=$1 AND available_date=ANY($2::date[]) FOR UPDATE`, [providerId, dates]);
  if (existing.rows.some(slot => start < time.minutes(slot.end_time) && end > time.minutes(slot.start_time))) {
   fail(409, 'These hours overlap an existing availability slot. No days were saved.');
  }
  const booked = await client.query(`SELECT scheduled_time FROM customer_bookings WHERE provider_id=$1
   AND scheduled_date=ANY($2::date[]) AND status NOT IN ('cancelled', 'completed')`, [providerId, dates]);
  if (booked.rows.some(booking => time.minutes(booking.scheduled_time) >= start && time.minutes(booking.scheduled_time) < end)) {
   fail(409, 'These hours include an existing appointment. No days were saved.');
  }
  const result = await client.query(`INSERT INTO provider_availability (provider_id, available_date, start_time, end_time, is_available)
   SELECT $1, day, $3, $4, $5 FROM unnest($2::date[]) AS day RETURNING *`,
  [providerId, dates, time.to24(body.start_time), time.to24(body.end_time), body.is_available]);
  return { availability: result.rows };
 });
}

module.exports = { loadWeek, saveWeek };
