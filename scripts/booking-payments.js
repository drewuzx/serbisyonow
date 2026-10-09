'use strict';

function fail(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; throw error; }
function priceParts(value) {
 if (!['number', 'string'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value))) fail(400, 'Enter a positive price with at most two decimal places.');
 const [whole, fraction = ''] = String(value).split('.');
 const total = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
 const deposit = Math.round(total * 30 / 100);
 if (!Number.isSafeInteger(total) || deposit < 100 || deposit > 10000000) fail(400, 'The 30% e-wallet downpayment must be from PHP 1 to PHP 100,000.');
 return { total, deposit, balance: total - deposit };
}
function bookingPaymentView(row) {
 const amount = key => row[key] == null ? null : Number(row[key]);
 return {
  deposit_required: Boolean(row.deposit_required), deposit_status: row.deposit_status || 'not_required',
  deposit_percentage: 30, confirmed_price: amount('confirmed_price'), deposit_amount: amount('deposit_amount'), balance_due: amount('balance_due'),
  price_version: Number(row.price_version || 0), price_notes: row.price_notes || '', price_confirmed_at: row.price_confirmed_at || null,
  customer_agreed_at: row.customer_agreed_at || null, deposit_paid_at: row.deposit_paid_at || null, deposit_livemode: row.deposit_livemode ?? null,
 };
}
async function transaction(db, work) {
 const client = await db.pool.connect();
 try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
 catch (error) { await client.query('ROLLBACK'); throw error; }
 finally { client.release(); }
}
async function confirmBookingPrice(db, providerId, bookingId, body) {
 const parts = priceParts(body.price);
 const notes = String(body.notes || '').trim();
 if (notes.length > 1000) fail(400, 'Price notes must be 1,000 characters or fewer.');
 return transaction(db, async client => {
  const { rows: [booking] } = await client.query('SELECT * FROM customer_bookings WHERE provider_id = $1 AND id = $2 FOR UPDATE', [providerId, bookingId]);
  if (!booking) fail(404, 'Booking not found.');
  if (!booking.deposit_required || booking.status !== 'pending' || booking.provider_closed) fail(409, 'This booking cannot receive a new downpayment price.');
  if (booking.customer_agreed_at || booking.deposit_status === 'paid') fail(409, 'The customer has already started payment. The agreed price is locked.');
  if (Number(body.price_version) !== Number(booking.price_version)) fail(409, 'The price has changed. Refresh this booking first.');
  const result = await client.query(`UPDATE customer_bookings SET confirmed_price = $3, amount = $3, deposit_amount = $4,
   balance_due = $5, price_notes = $6, price_version = price_version + 1, price_confirmed_at = NOW(),
   deposit_status = 'awaiting_payment', updated_at = NOW() WHERE provider_id = $1 AND id = $2 RETURNING *`,
  [providerId, bookingId, parts.total / 100, parts.deposit / 100, parts.balance / 100, notes]);
  return result.rows[0];
 });
}
async function createBookingCheckout(db, gateway, customerId, bookingId, body, returnBase) {
 if (!gateway.ready) fail(503, 'E-wallet downpayment checkout is not configured yet. Please contact support.');
 if (body.accept_price !== true) fail(400, 'Agree to the confirmed service price before paying.');
 let createdSession;
 try {
  return await transaction(db, async client => {
   const { rows: [booking] } = await client.query('SELECT * FROM customer_bookings WHERE customer_id = $1 AND id = $2 FOR UPDATE', [customerId, bookingId]);
   if (!booking) fail(404, 'Booking not found.');
   if (!booking.deposit_required || booking.status !== 'pending' || booking.deposit_status !== 'awaiting_payment' || !booking.confirmed_price) fail(409, 'This booking is not waiting for a downpayment.');
   const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' });
   const scheduledDay = booking.scheduled_date instanceof Date ? dateFormat.format(booking.scheduled_date) : String(booking.scheduled_date || '').slice(0, 10);
   if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDay) || scheduledDay < dateFormat.format(new Date())) fail(409, 'The booking date has passed. Cancel this request and choose a new schedule before paying.');
   if (Number(body.price_version) !== Number(booking.price_version)) fail(409, 'The confirmed price has changed. Review the latest price before paying.');
   const parts = priceParts(booking.confirmed_price);
   const { rows: [existing] } = await client.query('SELECT * FROM booking_payments WHERE booking_id = $1 FOR UPDATE', [bookingId]);
   if (existing) {
    if (existing.status === 'active' && existing.livemode === gateway.livemode && Number(existing.price_version) === Number(booking.price_version) && Number(existing.amount_centavos) === parts.deposit) return { checkout_url: existing.checkout_url, ...bookingPaymentView(booking), livemode: existing.livemode };
    fail(409, 'This checkout is no longer available. Contact support before making another payment.');
   }
   const { rows: [payment] } = await client.query(`INSERT INTO booking_payments (booking_id, amount_centavos, livemode, price_version)
    VALUES ($1, $2, $3, $4) RETURNING *`, [bookingId, parts.deposit, gateway.livemode, booking.price_version]);
   const reference = `SN-BK${booking.id}-DP${payment.id}`;
   // The booking lock prevents two tabs from creating separate payable checkouts.
   createdSession = await gateway.checkout({ bookingId: booking.id, priceVersion: booking.price_version, amountCentavos: parts.deposit, reference, service: booking.service, returnBase });
   await client.query(`UPDATE booking_payments SET reference_number = $2, checkout_session_id = $3, checkout_url = $4,
    status = 'active', updated_at = NOW() WHERE id = $1`, [payment.id, reference, createdSession.id, createdSession.url]);
   await client.query('UPDATE customer_bookings SET customer_agreed_at = NOW(), updated_at = NOW() WHERE id = $1', [bookingId]);
   return { checkout_url: createdSession.url, ...bookingPaymentView(booking), livemode: gateway.livemode };
  });
 } catch (error) {
  if (createdSession) await gateway.expire(createdSession.id).catch(() => {});
  throw error;
 }
}
async function settleBookingPayment(db, event) {
 if (event.type !== 'checkout_session.payment.paid') return { ignored: true };
 const session = event.session;
 if (!/^cs_[a-zA-Z0-9]+$/.test(session?.id || '')) fail(400, 'Invalid checkout notification.');
 const { rows: [lookup] } = await db.query('SELECT * FROM booking_payments WHERE checkout_session_id = $1', [session.id]);
 if (!lookup) return { ignored: true };
 return transaction(db, async client => {
  const { rows: [booking] } = await client.query('SELECT * FROM customer_bookings WHERE id = $1 FOR UPDATE', [lookup.booking_id]);
  const { rows: [checkout] } = await client.query('SELECT * FROM booking_payments WHERE booking_id = $1 FOR UPDATE', [lookup.booking_id]);
  const attributes = session.attributes || {};
  if (!booking || !checkout || event.livemode !== checkout.livemode || attributes.reference_number !== checkout.reference_number
   || attributes.metadata?.booking_id !== String(booking.id) || attributes.metadata?.price_version !== String(checkout.price_version)
   || attributes.metadata?.purpose !== 'booking_downpayment') fail(400, 'The payment reference does not match the booking.');
  const paid = (Array.isArray(attributes.payments) ? attributes.payments : []).filter(payment => payment.attributes?.status === 'paid');
  if (!paid.length) fail(400, 'The notification does not contain a paid payment.');
  for (const payment of paid) {
   const amount = payment.attributes.amount;
   if (!/^pay_[a-zA-Z0-9]+$/.test(payment.id || '') || !Number.isSafeInteger(amount) || amount <= 0 || payment.attributes.currency !== 'PHP') fail(400, 'Invalid payment amount or currency.');
   const credit = amount === Number(checkout.amount_centavos) && booking.status === 'pending'
    && booking.deposit_status === 'awaiting_payment' && checkout.status === 'active'
    && Number(booking.price_version) === Number(checkout.price_version);
   const result = await client.query(`INSERT INTO booking_payment_receipts (payment_id, checkout_id, amount_centavos, currency, livemode, disposition)
    VALUES ($1, $2, $3, 'PHP', $4, $5) ON CONFLICT (payment_id) DO NOTHING RETURNING payment_id`,
   [payment.id, checkout.id, amount, event.livemode, credit ? 'credited' : 'refund_review']);
   if (!result.rowCount) continue;
   if (credit) {
    await client.query("UPDATE booking_payments SET status = 'paid', updated_at = NOW() WHERE id = $1", [checkout.id]);
    const updated = await client.query(`UPDATE customer_bookings SET status = 'upcoming', deposit_status = 'paid',
     deposit_paid_at = NOW(), deposit_livemode = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [booking.id, event.livemode]);
    Object.assign(booking, updated.rows[0]);
    checkout.status = 'paid';
   } else if (booking.deposit_status !== 'paid') {
    await client.query("UPDATE booking_payments SET status = 'refund_review', updated_at = NOW() WHERE id = $1", [checkout.id]);
    await client.query(`UPDATE customer_bookings SET deposit_status = 'refund_review', deposit_paid_at = NOW(),
     deposit_livemode = $2, updated_at = NOW() WHERE id = $1`, [booking.id, event.livemode]);
    booking.deposit_status = 'refund_review';
   }
  }
  return { received: true };
 });
}
async function expireCancelledCheckout(db, gateway, bookingId) {
 const { rows: [payment] } = await db.query("SELECT * FROM booking_payments WHERE booking_id = $1 AND status = 'expire_pending'", [bookingId]);
 if (!payment?.checkout_session_id || !gateway.ready) return;
 try {
  await gateway.expire(payment.checkout_session_id);
  await db.query("UPDATE booking_payments SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'expire_pending'", [payment.id]);
 } catch { /* Keep expire_pending for retry; a late payment must go to refund review. */ }
}
async function cancelBookingPayment(client, booking) {
 if (!booking.deposit_required) return;
 await client.query(`UPDATE customer_bookings SET deposit_status = CASE WHEN deposit_paid_at IS NOT NULL THEN 'refund_review' ELSE 'cancelled' END,
  updated_at = NOW() WHERE id = $1`, [booking.id]);
 await client.query(`UPDATE booking_payments SET status = CASE WHEN status = 'paid' THEN 'refund_review' ELSE 'expire_pending' END,
  updated_at = NOW() WHERE booking_id = $1 AND status IN ('active', 'creating', 'paid')`, [booking.id]);
}

module.exports = { fail, priceParts, bookingPaymentView, transaction, confirmBookingPrice, createBookingCheckout, settleBookingPayment, expireCancelledCheckout, cancelBookingPayment };
