'use strict';
const { fail, transaction } = require('./booking-payments');

async function createPromotionCheckout(db, gateway, providerId, orderId, returnBase) {
 if (!gateway?.ready) fail(503, 'PayMongo QR Ph checkout is not configured yet. Contact the admin.');
 const attempt = await transaction(db, async client => {
  const account = (await client.query('SELECT is_verified FROM providers WHERE id=$1 FOR UPDATE', [providerId])).rows[0];
  const order = (await client.query('SELECT * FROM promotion_orders WHERE id=$1 AND provider_id=$2 FOR UPDATE', [orderId, providerId])).rows[0];
  if (!order) fail(404, 'Order not found.');
  if (!account?.is_verified) fail(403, 'Provider verification is required.');
  if (order.payment_channel !== 'paymongo' || order.status !== 'awaiting_payment') fail(409, 'This order is not awaiting QR Ph payment.');
  const existing = (await client.query('SELECT * FROM promotion_checkouts WHERE order_id=$1', [orderId])).rows[0];
  if (existing) {
   if (existing.status === 'active' && existing.livemode === gateway.livemode) return { existing };
   fail(409, 'Checkout is processing or needs review. Check payment status or contact the admin before paying again.');
  }
  const reference = `SN-PROMO-${order.id}`;
  await client.query('INSERT INTO promotion_checkouts(order_id,reference_number,livemode) VALUES($1,$2,$3)', [order.id, reference, gateway.livemode]);
  await client.query('UPDATE promotion_orders SET payment_livemode=$2 WHERE id=$1', [order.id, gateway.livemode]);
  return { order, reference };
 });
 if (attempt.existing) return { checkout_url: attempt.existing.checkout_url, livemode: attempt.existing.livemode };
 // Persist the attempt before contacting the gateway: ambiguous failures must not create a second payable session.
 try {
  const session = await gateway.checkout({ promotionOrderId: attempt.order.id, amountCentavos: attempt.order.amount_centavos,
   reference: attempt.reference, service: attempt.order.plan_name, returnBase });
  await db.query(`UPDATE promotion_checkouts SET checkout_session_id=$2,checkout_url=$3,
   status=CASE WHEN status='creating' THEN 'active' ELSE status END,updated_at=NOW() WHERE order_id=$1`, [orderId, session.id, session.url]);
  return { checkout_url: session.url, livemode: session.livemode };
 } catch (error) {
  await db.query("UPDATE promotion_checkouts SET status='review',updated_at=NOW() WHERE order_id=$1 AND status='creating'", [orderId]);
  throw error;
 }
}

async function settlePromotionPayment(db, event) {
 if (event.type !== 'checkout_session.payment.paid' || event.session?.attributes?.metadata?.purpose !== 'promotion_purchase') return { ignored: true };
 const session = event.session, attributes = session.attributes;
 if (!/^cs_[a-zA-Z0-9]+$/.test(session.id || '') || !/^[1-9]\d*$/.test(attributes.metadata.promotion_order_id || '')) fail(400, 'Invalid promotion payment notification.');
 const id = Number(attributes.metadata.promotion_order_id);
 const lookup = (await db.query('SELECT provider_id FROM promotion_orders WHERE id=$1', [id])).rows[0];
 if (!lookup) fail(400, 'Unknown promotion payment.');
 return transaction(db, async client => {
  const account = (await client.query('SELECT is_verified FROM providers WHERE id=$1 FOR UPDATE', [lookup.provider_id])).rows[0];
  const order = (await client.query('SELECT * FROM promotion_orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
  const checkout = (await client.query('SELECT * FROM promotion_checkouts WHERE order_id=$1 FOR UPDATE', [id])).rows[0];
  if (!checkout || order.payment_channel !== 'paymongo' || checkout.livemode !== event.livemode || attributes.livemode !== checkout.livemode
   || attributes.reference_number !== checkout.reference_number || (checkout.checkout_session_id && checkout.checkout_session_id !== session.id)) fail(400, 'Payment does not match the promotion checkout.');
  const paid = (attributes.payments || []).filter(payment => payment.attributes?.status === 'paid');
  if (paid.length !== 1) fail(400, 'Expected one confirmed payment.');
  const payment = paid[0], amount = payment.attributes.amount;
  if (!/^pay_[a-zA-Z0-9]+$/.test(payment.id || '') || !Number.isSafeInteger(amount) || amount <= 0
   || payment.attributes.currency !== 'PHP' || payment.attributes.livemode !== checkout.livemode) fail(400, 'Invalid payment amount, currency or mode.');
  const eligible = order.status === 'awaiting_payment' && checkout.status !== 'expired' && account?.is_verified && amount === order.amount_centavos;
  const disposition = eligible ? (event.livemode ? 'credited' : 'test') : 'refund_review';
  const inserted = await client.query(`INSERT INTO promotion_gateway_receipts(payment_id,order_id,amount_centavos,livemode,disposition)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT(payment_id) DO NOTHING RETURNING payment_id`, [payment.id,id,amount,event.livemode,disposition]);
  if (!inserted.rowCount) {
   const receipt = (await client.query('SELECT order_id FROM promotion_gateway_receipts WHERE payment_id=$1', [payment.id])).rows[0];
   if (receipt.order_id !== id) fail(400, 'Payment is already associated with another order.');
   return { received: true };
  }
  await client.query("UPDATE promotion_checkouts SET status='paid',checkout_session_id=$2,updated_at=NOW() WHERE order_id=$1", [id, session.id]);
  if (disposition === 'credited') {
   await client.query(`UPDATE promotion_orders SET status='paid',paid_at=NOW(),
    starts_at=GREATEST(NOW(),COALESCE((SELECT MAX(expires_at) FROM promotion_orders WHERE provider_id=$2 AND status='paid'),NOW())),
    expires_at=GREATEST(NOW(),COALESCE((SELECT MAX(expires_at) FROM promotion_orders WHERE provider_id=$2 AND status='paid'),NOW())) + duration_days * INTERVAL '1 day'
    WHERE id=$1`, [id, order.provider_id]);
  } else {
   await client.query("UPDATE promotion_orders SET status=$2,paid_at=NOW() WHERE id=$1 AND status<>'paid'", [id, disposition === 'test' ? 'test_paid' : 'refund_review']);
  }
  return { received: true };
 });
}

async function refreshPromotionPayment(db, gateway, providerId, orderId) {
 const order = (await db.query('SELECT * FROM promotion_orders WHERE id=$1 AND provider_id=$2', [orderId, providerId])).rows[0];
 if (!order || order.payment_channel !== 'paymongo') fail(404, 'QR Ph order not found.');
 const checkout = (await db.query('SELECT * FROM promotion_checkouts WHERE order_id=$1', [orderId])).rows[0];
 if (!checkout) return { status: order.status };
 if (!checkout.checkout_session_id) fail(409, 'Checkout confirmation is pending. Contact the admin before starting another payment.');
 if (checkout.livemode !== gateway.livemode) fail(409, 'This checkout uses a different payment environment. Contact the admin.');
 const session = await gateway.retrieve(checkout.checkout_session_id);
 if (session?.id !== checkout.checkout_session_id || session.attributes?.livemode !== checkout.livemode) fail(502, 'Invalid checkout status response.');
 if ((session.attributes.payments || []).some(payment => payment.attributes?.status === 'paid')) {
  await settlePromotionPayment(db, { type:'checkout_session.payment.paid',session,livemode:checkout.livemode });
 } else if (session.attributes.status === 'expired') {
  await transaction(db, async client => {
   await client.query("UPDATE promotion_orders SET status='cancelled' WHERE id=$1 AND status='awaiting_payment'", [orderId]);
   await client.query("UPDATE promotion_checkouts SET status='expired' WHERE order_id=$1 AND status<>'paid'", [orderId]);
  });
 }
 return { status: (await db.query('SELECT status FROM promotion_orders WHERE id=$1', [orderId])).rows[0].status };
}

async function cancelPromotionCheckout(db, gateway, providerId, orderId) {
 const order = (await db.query('SELECT * FROM promotion_orders WHERE id=$1 AND provider_id=$2', [orderId, providerId])).rows[0];
 if (!order) fail(404, 'Order not found.');
 const checkout = (await db.query('SELECT * FROM promotion_checkouts WHERE order_id=$1', [orderId])).rows[0];
 if (checkout) {
  const current = await refreshPromotionPayment(db, gateway, providerId, orderId);
  if (current.status === 'cancelled') return;
  if (current.status !== 'awaiting_payment') fail(409, 'Payment has already been received. Contact the admin.');
  await gateway.expire(checkout.checkout_session_id);
 }
 await transaction(db, async client => {
  await client.query('SELECT id FROM providers WHERE id=$1 FOR UPDATE', [providerId]);
  await client.query('SELECT id FROM promotion_orders WHERE id=$1 FOR UPDATE', [orderId]);
  const latest = (await client.query('SELECT checkout_session_id FROM promotion_checkouts WHERE order_id=$1', [orderId])).rows[0];
  if (!checkout && latest) fail(409, 'Checkout was started in another window. Check payment status before cancelling.');
  const result = await client.query("UPDATE promotion_orders SET status='cancelled' WHERE id=$1 AND provider_id=$2 AND status='awaiting_payment' RETURNING id", [orderId, providerId]);
  if (!result.rowCount) fail(409, 'This payment can no longer be cancelled.');
  await client.query("UPDATE promotion_checkouts SET status='expired',updated_at=NOW() WHERE order_id=$1", [orderId]);
 });
}
module.exports = { createPromotionCheckout, settlePromotionPayment, refreshPromotionPayment, cancelPromotionCheckout };
