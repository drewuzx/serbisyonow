'use strict';

const crypto = require('node:crypto');
const { fail, priceParts, transaction } = require('./booking-payments');

function imageFile(file) {
 const buffer = file?.buffer;
 if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 5 * 1024 * 1024) fail(400, 'Upload a PNG, JPG or WebP image up to 5 MB.');
 let mime;
 if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) mime = 'image/png';
 else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) mime = 'image/jpeg';
 else if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
 if (!mime || (file.mimetype && file.mimetype !== mime)) fail(400, 'Upload a valid PNG, JPG or WebP image.');
 return { mime, buffer, extension: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime] };
}

function qrView(row) {
 return {
  qr_url: row.payment_qr_file ? `/uploads/provider-payment-qrs/${encodeURIComponent(row.payment_qr_file)}` : null,
  account_name: row.payment_account_name || '', account_number: row.payment_account_number || '', wallet: row.payment_wallet || '',
 };
}

function ensureSchedule(booking) {
 const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' });
 const day = booking.scheduled_date instanceof Date ? format.format(booking.scheduled_date) : String(booking.scheduled_date || '').slice(0, 10);
 if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < format.format(new Date())) fail(409, 'The booking date has passed. Contact the provider before making or confirming payment.');
}

function payable(booking, version) {
 if (booking.deposit_channel !== 'provider_qr' || !booking.deposit_required || booking.status !== 'pending' || booking.provider_closed
  || booking.deposit_status !== 'awaiting_payment' || !booking.confirmed_price) fail(409, 'This booking is not waiting for a direct downpayment.');
 if (Number(version) !== Number(booking.price_version)) fail(409, 'The confirmed price changed. Review the booking again.');
 ensureSchedule(booking);
}

async function saveProviderQr(db, providerId, body, file) {
 if (body.confirm_account !== 'true') fail(400, 'Confirm that the QR and account details belong to your receiving account.');
 const name = String(body.account_name || '').trim();
 const number = String(body.account_number || '').trim();
 const wallet = String(body.wallet || '').trim();
 if (!name || name.length > 120 || !number || number.length > 60 || !['GCash', 'Maya', 'Bank / Other QR Ph'].includes(wallet)) fail(400, 'Complete the account name, account number and payment app.');
 const image = file ? imageFile(file) : null;
 return transaction(db, async client => {
  const { rows: [provider] } = await client.query('SELECT * FROM providers WHERE id = $1 FOR UPDATE', [providerId]);
  if (!provider) fail(404, 'Provider not found.');
  if (!image && !provider.payment_qr_file) fail(400, 'Upload your payment QR first.');
  const filename = image ? `${crypto.randomUUID()}.${image.extension}` : provider.payment_qr_file;
  if (image) await client.query(`INSERT INTO uploaded_files (folder, filename, original_name, mime_type, size_bytes, content, owner_role, owner_id)
   VALUES ('provider-payment-qrs', $1, $1, $2, $3, $4, 'provider', $5)`, [filename, image.mime, image.buffer.length, image.buffer, providerId]);
  const { rows: [updated] } = await client.query(`UPDATE providers SET payment_qr_file = $2, payment_account_name = $3,
   payment_account_number = $4, payment_wallet = $5, updated_at = NOW() WHERE id = $1 RETURNING *`, [providerId, filename, name, number, wallet]);
  return updated;
 });
}

async function prepareDirectPayment(db, customerId, bookingId, body) {
 if (body.accept_price !== true) fail(400, 'Agree to the confirmed service price first.');
 return transaction(db, async client => {
  const { rows: [booking] } = await client.query('SELECT * FROM customer_bookings WHERE customer_id = $1 AND id = $2 FOR UPDATE', [customerId, bookingId]);
  if (!booking) fail(404, 'Booking not found.');
  payable(booking, body.price_version);
  // Freeze the recipient before displaying a payable QR; profile edits cannot redirect this payment.
  if (booking.customer_agreed_at && booking.payment_qr_file) return booking;
  const { rows: [provider] } = await client.query('SELECT * FROM providers WHERE id = $1 FOR SHARE', [booking.provider_id]);
  if (!provider?.is_verified || !provider.payment_qr_file || !provider.payment_account_name || !provider.payment_account_number) fail(409, 'The provider must save their payment QR and account details before you can pay.');
  const { rows: [updated] } = await client.query(`UPDATE customer_bookings SET customer_agreed_at = NOW(), payment_qr_file = $2,
   payment_account_name = $3, payment_account_number = $4, payment_wallet = $5, updated_at = NOW() WHERE id = $1 RETURNING *`,
  [bookingId, provider.payment_qr_file, provider.payment_account_name, provider.payment_account_number, provider.payment_wallet]);
  return updated;
 });
}

async function submitDirectReceipt(db, customerId, bookingId, body, file) {
 const image = imageFile(file);
 const reference = String(body.reference_number || '').trim().toUpperCase();
 if (!/^[A-Z0-9][A-Z0-9 -]{3,119}$/.test(reference)) fail(400, 'Enter the transaction reference number from your payment receipt (4-120 characters).');
 try {
  return await transaction(db, async client => {
   const { rows: [booking] } = await client.query('SELECT * FROM customer_bookings WHERE customer_id = $1 AND id = $2 FOR UPDATE', [customerId, bookingId]);
   if (!booking) fail(404, 'Booking not found.');
   payable(booking, body.price_version);
   if (!booking.customer_agreed_at || !booking.payment_qr_file) fail(409, 'Review the price and provider QR before submitting payment.');
   const { rows: [receipt] } = await client.query(`INSERT INTO provider_direct_payment_receipts
    (booking_id, provider_id, reference_number, amount_centavos, price_version, mime_type, content)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
   [booking.id, booking.provider_id, reference, priceParts(booking.confirmed_price).deposit, booking.price_version, image.mime, image.buffer]);
   const { rows: [updated] } = await client.query(`UPDATE customer_bookings SET deposit_status = 'awaiting_verification',
    deposit_receipt_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [booking.id, receipt.id]);
   return updated;
  });
 } catch (error) {
  if (error.code === '23505') fail(409, 'That transaction reference has already been submitted to this provider. Do not pay again; contact the provider.');
  throw error;
 }
}

async function directPaymentDetails(db, booking) {
 let receipt = null;
 if (booking.deposit_receipt_id) {
  const { rows: [row] } = await db.query(`SELECT id, reference_number, amount_centavos, status, review_note, submitted_at, reviewed_at
   FROM provider_direct_payment_receipts WHERE id = $1 AND booking_id = $2`, [booking.deposit_receipt_id, booking.id]);
  if (row) receipt = { ...row, amount: Number(row.amount_centavos) / 100, image_url: `/api/payment-receipts/${row.id}/image` };
 }
 return { recipient: booking.customer_agreed_at ? qrView(booking) : null, receipt };
}

async function reviewDirectReceipt(db, providerId, bookingId, body) {
 const decision = body.decision;
 const note = String(body.notes || '').trim();
 if (!['verify', 'reject'].includes(decision) || note.length > 1000) fail(400, 'Choose verify or reject, with notes up to 1,000 characters.');
 if (decision === 'verify' && body.payment_received !== true) fail(400, 'Check your wallet and confirm the exact downpayment was received.');
 if (decision === 'reject' && !note) fail(400, 'Explain why the payment could not be verified.');
 return transaction(db, async client => {
  const { rows: [booking] } = await client.query('SELECT * FROM customer_bookings WHERE provider_id = $1 AND id = $2 FOR UPDATE', [providerId, bookingId]);
  if (!booking) fail(404, 'Booking not found.');
  if (booking.deposit_channel !== 'provider_qr' || booking.status !== 'pending' || booking.provider_closed
   || booking.deposit_status !== 'awaiting_verification' || String(body.receipt_id) !== String(booking.deposit_receipt_id)
   || Number(body.price_version) !== Number(booking.price_version)) fail(409, 'This payment is no longer awaiting review. Refresh the booking.');
  const { rows: [receipt] } = await client.query('SELECT * FROM provider_direct_payment_receipts WHERE id = $1 AND booking_id = $2 FOR UPDATE', [booking.deposit_receipt_id, bookingId]);
  if (!receipt || receipt.status !== 'pending' || Number(receipt.price_version) !== Number(booking.price_version)
   || Number(receipt.amount_centavos) !== priceParts(booking.confirmed_price).deposit) fail(409, 'The receipt does not match this confirmed price.');
  if (decision === 'verify') ensureSchedule(booking);
  await client.query(`UPDATE provider_direct_payment_receipts SET status = $2, review_note = $3, reviewed_at = NOW() WHERE id = $1`,
   [receipt.id, decision === 'verify' ? 'verified' : 'rejected', note]);
  const { rows: [updated] } = await client.query(decision === 'verify'
   ? `UPDATE customer_bookings SET status = 'upcoming', deposit_status = 'paid', deposit_paid_at = NOW(), deposit_livemode = TRUE,
      updated_at = NOW() WHERE id = $1 RETURNING *`
   : `UPDATE customer_bookings SET deposit_status = 'awaiting_payment', updated_at = NOW() WHERE id = $1 RETURNING *`, [bookingId]);
  return updated;
 });
}

module.exports = { imageFile, qrView, saveProviderQr, prepareDirectPayment, submitDirectReceipt, directPaymentDetails, reviewDirectReceipt };
