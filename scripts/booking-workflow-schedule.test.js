'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const scheduleWindow = require('../shared/js/schedule-window');
const { changeProviderBookingStatus, confirmFullPaymentReceived } = require('./booking-workflow');

test('provider cannot transition a booking to ongoing before its Manila schedule', async () => {
 const now = scheduleWindow.manilaNow();
 const scheduledMinutes = now.minutes + 10;
 const booking = {
  id: 4, provider_id: 81, status: 'upcoming', provider_closed: false,
  scheduled_date: scheduledMinutes < 1440 ? now.date : scheduleWindow.dateKey(new Date(Date.now() + 86400000)),
  scheduled_time: `${String(Math.floor((scheduledMinutes % 1440) / 60)).padStart(2, '0')}:${String(scheduledMinutes % 60).padStart(2, '0')}`,
 };
 const db = { pool: { async connect() {
  return { async query(sql, params = []) {
   if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
   if (sql.includes('SELECT * FROM customer_bookings')) return { rows: [booking], rowCount: 1 };
   if (sql.includes('UPDATE customer_bookings SET status')) {
    booking.status = params[2];
    return { rows: [booking], rowCount: 1 };
   }
   return { rows: [], rowCount: 0 };
  }, release() {} };
 } } };
 await assert.rejects(
  changeProviderBookingStatus(db, 81, 4, 'ongoing', 'upcoming', { role: 'provider', id: 81 }),
  error => error.statusCode === 409 && /Service can start/.test(error.message),
 );
 booking.scheduled_date = now.date;
 booking.scheduled_time = `${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')}`;
 const started = await changeProviderBookingStatus(db, 81, 4, 'ongoing', 'upcoming', { role: 'provider', id: 81 });
 assert.equal(started.status, 'ongoing');
});

test('provider must confirm full payment before completing an ongoing service', async () => {
 const booking = { id: 5, provider_id: 81, status: 'ongoing', provider_closed: false, deposit_required: false,
  scheduled_date: '2099-10-10', scheduled_time: '10:00', full_payment_received_at: null };
 const db = { pool: { async connect() {
  return { async query(sql, params = []) {
   if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
   if (sql.includes('SELECT * FROM customer_bookings')) return { rows: [booking], rowCount: 1 };
   if (sql.includes('SET full_payment_received_at')) {
    booking.full_payment_received_at = '2026-11-12T12:00:00.000Z';
    return { rows: [booking], rowCount: 1 };
   }
   if (sql.includes('UPDATE customer_bookings SET status')) {
    booking.status = params[2];
    return { rows: [booking], rowCount: 1 };
   }
   return { rows: [], rowCount: 0 };
  }, release() {} };
 } } };
 const provider = { role: 'provider', id: 81 };
 await assert.rejects(
  changeProviderBookingStatus(db, 81, 5, 'completed', 'ongoing', provider),
  error => error.statusCode === 409 && /full payment was received/.test(error.message),
 );
 assert.equal(booking.status, 'ongoing');
 await assert.rejects(
  confirmFullPaymentReceived(db, 81, 5, { role: 'customer', id: 61 }),
  error => error.statusCode === 401,
 );
 await confirmFullPaymentReceived(db, 81, 5, provider);
 assert.ok(booking.full_payment_received_at);
 const completed = await changeProviderBookingStatus(db, 81, 5, 'completed', 'ongoing', provider);
 assert.equal(completed.status, 'completed');
});
