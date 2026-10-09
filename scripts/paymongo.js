'use strict';

const crypto = require('node:crypto');
function fail(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; throw error; }
const validSessionId = value => /^cs_[a-zA-Z0-9]+$/.test(String(value || ''));

function createPayMongo({ env = process.env, fetcher = globalThis.fetch, now = () => Date.now() } = {}) {
 const secretKey = env.PAYMONGO_SECRET_KEY || '';
 const webhookSecret = env.PAYMONGO_WEBHOOK_SECRET || '';
 const livemode = secretKey.startsWith('sk_live_');
 const paymentMethods = [...new Set(String(env.PAYMONGO_PAYMENT_METHODS || 'gcash,paymaya').split(',').map(value => value.trim()).filter(Boolean))];
 const configured = /^sk_(test|live)_.+/.test(secretKey) && !!webhookSecret
  && paymentMethods.length > 0 && paymentMethods.every(value => ['gcash', 'paymaya', 'grab_pay', 'shopeepay', 'qrph'].includes(value));
 const ready = configured && (!livemode || env.PAYMONGO_LIVE_PAYMENTS_ENABLED === 'true');

 async function request(endpoint, method, attributes) {
  if (!configured) fail(503, 'E-wallet downpayment checkout is not configured yet. Please contact support.');
  let response;
  try {
   response = await fetcher(`https://api.paymongo.com${endpoint}`, {
    method, headers: { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(attributes ? { body: JSON.stringify({ data: { attributes } }) } : {}),
    signal: AbortSignal.timeout(15000),
   });
  } catch { fail(502, 'PayMongo could not be reached. No booking has been confirmed; please try again.'); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) fail(502, 'PayMongo could not complete this request. Please try again or contact support.');
  return payload.data;
 }

 async function checkout({ bookingId, priceVersion, amountCentavos, reference, service, returnBase }) {
  if (!ready) fail(503, 'E-wallet downpayment checkout is not available yet. Please contact support.');
  if (!Number.isSafeInteger(amountCentavos) || amountCentavos < 100 || amountCentavos > 10000000) fail(400, 'The 30% e-wallet downpayment must be from PHP 1 to PHP 100,000.');
  let url;
  try { url = new URL(returnBase); } catch { fail(503, 'The payment return address is not configured.'); }
  if (!['http:', 'https:'].includes(url.protocol) || (livemode && url.protocol !== 'https:') || url.username || url.password) fail(503, 'Configure a valid payment return address; live payments require HTTPS.');
  const success = new URL('/pages/customer/bookings/bookings.html', url);
  success.searchParams.set('payment_return', 'success');
  success.searchParams.set('booking_id', String(bookingId));
  const cancel = new URL(success);
  cancel.searchParams.set('payment_return', 'cancelled');
  const session = await request('/v2/checkout_sessions', 'POST', {
   line_items: [{ name: `30% downpayment - ${String(service).slice(0, 120)}`, amount: amountCentavos, currency: 'PHP', quantity: 1 }],
   payment_method_types: paymentMethods, success_url: success.href, cancel_url: cancel.href,
   reference_number: reference, send_email_receipt: true, pass_on_fees: false,
   metadata: { booking_id: String(bookingId), price_version: String(priceVersion), purpose: 'booking_downpayment' },
  });
  let checkoutUrl;
  try { checkoutUrl = new URL(session?.attributes?.checkout_url); } catch { fail(502, 'PayMongo returned an invalid checkout address.'); }
  if (!validSessionId(session?.id) || checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.paymongo.com' || checkoutUrl.port || checkoutUrl.username || checkoutUrl.password || session.attributes.livemode !== livemode) fail(502, 'PayMongo returned an invalid checkout session.');
  return { id: session.id, url: checkoutUrl.href, livemode };
 }

 async function expire(sessionId) {
  if (!validSessionId(sessionId)) fail(400, 'Invalid checkout session.');
  return request(`/v1/checkout_sessions/${sessionId}/expire`, 'POST');
 }

 function verifyWebhook(raw, header) {
  if (!configured) fail(503, 'PayMongo webhook is not configured.');
  if (!Buffer.isBuffer(raw)) fail(400, 'A raw webhook body is required.');
  const parts = String(header || '').split(',').map(part => part.trim().split('='));
  const values = Object.fromEntries(parts);
  const timestamp = values.t;
  const signature = values[livemode ? 'li' : 'te'];
  if (!/^\d+$/.test(timestamp || '') || !/^[a-f0-9]{64}$/i.test(signature || '') || Math.abs(now() / 1000 - Number(timestamp)) > 300) fail(401, 'Invalid or expired PayMongo signature.');
  const expected = crypto.createHmac('sha256', webhookSecret).update(`${timestamp}.`).update(raw).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) fail(401, 'Invalid PayMongo signature.');
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { fail(400, 'Invalid webhook JSON.'); }
  const event = payload?.data?.type === 'event' ? payload.data.attributes : payload?.data;
  if (!event || typeof event.type !== 'string' || event.livemode !== livemode) fail(400, 'The PayMongo event mode does not match this integration.');
  return { type: event.type, session: event.data, livemode };
 }
 return { ready, livemode, paymentMethods, checkout, expire, verifyWebhook };
}

module.exports = { createPayMongo };
