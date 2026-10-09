'use strict';
const { cancelBookingPayment } = require('./booking-payments');

const transitions = {
 pending: ['upcoming', 'cancelled'],
 upcoming: ['ongoing', 'cancelled'],
 ongoing: ['completed', 'cancelled'],
 completed: [],
 cancelled: [],
};

function fail(statusCode, message) {
 const error = new Error(message);
 error.statusCode = statusCode;
 throw error;
}

async function changeProviderBookingStatus(db, providerId, bookingId, nextStatus, expectedStatus, actor) {
 const status = String(nextStatus || '').trim().toLowerCase();
 if (!Object.hasOwn(transitions, status) || status === 'pending') fail(400, 'Invalid booking status.');
 const client = await db.pool.connect();
 try {
  await client.query('BEGIN');
  const current = await client.query(`
   SELECT * FROM customer_bookings WHERE provider_id = $1 AND id = $2 FOR UPDATE
  `, [providerId, bookingId]);
  const booking = current.rows[0];
  if (!booking) fail(404, 'Booking not found.');
  if (booking.deposit_required && (actor?.role !== 'provider' || String(actor.id) !== String(providerId))) fail(401, 'Please log in again before managing this booking.');
  if (booking.deposit_required && ['upcoming', 'ongoing', 'completed'].includes(status)) {
   const paid = await client.query("SELECT payment_id FROM booking_payment_receipts r JOIN booking_payments p ON p.id = r.checkout_id WHERE p.booking_id = $1 AND r.disposition = 'credited'", [bookingId]);
   if (booking.deposit_status !== 'paid' || !paid.rowCount) fail(409, 'The 30% downpayment must be verified before confirming or starting the service.');
  }
  if (booking.provider_closed) fail(409, 'This booking has already been moved to history.');
  // A retried successful request must not change availability a second time.
  if (booking.status === status) {
   await client.query('COMMIT');
   return booking;
  }
  if ((expectedStatus && expectedStatus !== booking.status) || !transitions[booking.status]?.includes(status)) {
   fail(409, `This booking is now ${booking.status}. Refresh the bookings before trying again.`);
  }
  const result = await client.query(`
   UPDATE customer_bookings SET status = $3, updated_at = NOW()
   WHERE provider_id = $1 AND id = $2 RETURNING *
  `, [providerId, bookingId, status]);
  if (status === 'cancelled') await cancelBookingPayment(client, booking);
  await client.query(`
   UPDATE provider_availability AS a
   SET is_available = NOT EXISTS (
    SELECT 1 FROM customer_bookings b
    WHERE b.provider_id = a.provider_id AND b.scheduled_date = a.available_date
      AND b.scheduled_time = a.start_time AND b.status <> 'cancelled'
   )
   WHERE a.provider_id = $1 AND a.available_date = $2 AND a.start_time = $3
  `, [booking.provider_id, booking.scheduled_date, booking.scheduled_time]);
  await client.query('COMMIT');
  if (status === 'cancelled' && booking.deposit_required) result.rows[0].deposit_status = booking.deposit_paid_at ? 'refund_review' : 'cancelled';
  return result.rows[0];
 } catch (error) {
  await client.query('ROLLBACK');
  throw error;
 } finally {
  client.release();
 }
}

module.exports = { changeProviderBookingStatus };
