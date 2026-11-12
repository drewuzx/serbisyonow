'use strict';

const { transaction, fail } = require('./booking-payments');

const STATUSES = new Set(['pending_provider', 'approved', 'rejected', 'refund_sent', 'customer_confirmed']);

function refundRequestView(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    amount: Number(row.amount_centavos) / 100,
    reason: row.reason,
    status: row.status,
    provider_note: row.provider_note || '',
    refund_reference: row.refund_reference || '',
    has_proof: Boolean(row.proof_content || row.has_proof),
    requested_at: row.requested_at,
    reviewed_at: row.reviewed_at,
    sent_at: row.sent_at,
    customer_confirmed_at: row.customer_confirmed_at,
  };
}

async function createRefundRequest(db, customerId, bookingId, body) {
  const reason = String(body.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000) fail(400, 'Describe the refund request in 5 to 1,000 characters.');
  return transaction(db, async client => {
    const { rows: [booking] } = await client.query('SELECT * FROM customer_bookings WHERE customer_id = $1 AND id = $2 FOR UPDATE', [customerId, bookingId]);
    if (!booking) fail(404, 'Booking not found.');
    if (booking.deposit_channel !== 'provider_qr') fail(409, 'This deposit was paid through the platform. Contact support to request a refund.');
    if (booking.status !== 'cancelled' || !booking.deposit_required || booking.deposit_status !== 'refund_review' || !booking.deposit_paid_at || !booking.deposit_amount) fail(409, 'Only a cancelled booking with a verified, paid downpayment can request a refund.');
    const { rows: [active] } = await client.query("SELECT id FROM booking_refund_requests WHERE booking_id = $1 AND status IN ('pending_provider','approved','refund_sent','customer_confirmed') LIMIT 1", [bookingId]);
    if (active) fail(409, 'A refund request already exists for this booking.');
    const { rows: [request] } = await client.query(`INSERT INTO booking_refund_requests
      (booking_id, customer_id, provider_id, amount_centavos, reason)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`, [booking.id, customerId, booking.provider_id,
      Math.round(Number(booking.deposit_amount) * 100), reason]);
    return refundRequestView(request);
  });
}

async function reviewRefundRequest(db, providerId, bookingId, body) {
  const decision = body.decision;
  if (!['approve', 'reject'].includes(decision)) fail(400, 'Choose approve or reject.');
  const note = String(body.note || '').trim();
  if (decision === 'reject' && (note.length < 3 || note.length > 1000)) fail(400, 'Add a short reason for rejecting this request.');
  if (note.length > 1000) fail(400, 'Notes must be 1,000 characters or fewer.');
  return transaction(db, async client => {
    const { rows: [request] } = await client.query(`SELECT r.* FROM booking_refund_requests r
      JOIN customer_bookings b ON b.id = r.booking_id
      WHERE r.provider_id = $1 AND r.booking_id = $2 AND b.provider_id = $1
      ORDER BY r.id DESC LIMIT 1 FOR UPDATE OF r`, [providerId, bookingId]);
    if (!request) fail(404, 'Refund request not found.');
    if (request.status !== 'pending_provider') fail(409, 'This refund request has already been reviewed.');
    const { rows: [updated] } = await client.query(`UPDATE booking_refund_requests SET status = $2, provider_note = $3,
      reviewed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`, [request.id, decision === 'approve' ? 'approved' : 'rejected', note]);
    return refundRequestView(updated);
  });
}

async function markRefundSent(db, providerId, bookingId, body, file) {
  const reference = String(body.reference || '').trim();
  if (reference.length < 3 || reference.length > 160) fail(400, 'Enter the refund transfer reference (3 to 160 characters).');
  if (body.confirm_sent !== 'true') fail(400, 'Confirm that you sent the refund before submitting.');
  if (!file?.buffer || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) fail(400, 'Upload proof of the refund transfer (PNG, JPG, or WebP).');
  return transaction(db, async client => {
    const { rows: [request] } = await client.query(`SELECT * FROM booking_refund_requests
      WHERE provider_id = $1 AND booking_id = $2 ORDER BY id DESC LIMIT 1 FOR UPDATE`, [providerId, bookingId]);
    if (!request) fail(404, 'Refund request not found.');
    if (request.status !== 'approved') fail(409, 'Only an approved refund request can be marked sent.');
    const { rows: [updated] } = await client.query(`UPDATE booking_refund_requests SET status = 'refund_sent',
      refund_reference = $2, proof_mime = $3, proof_content = $4, sent_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`, [request.id, reference, file.mimetype, file.buffer]);
    return refundRequestView(updated);
  });
}

async function confirmRefundReceived(db, customerId, bookingId, body) {
  if (body.confirm_received !== true) fail(400, 'Confirm that the refund has arrived in your account.');
  return transaction(db, async client => {
    const { rows: [request] } = await client.query(`SELECT * FROM booking_refund_requests
      WHERE customer_id = $1 AND booking_id = $2 ORDER BY id DESC LIMIT 1 FOR UPDATE`, [customerId, bookingId]);
    if (!request) fail(404, 'Refund request not found.');
    if (request.status !== 'refund_sent' || !request.proof_content || !request.refund_reference) fail(409, 'The provider has not recorded a refund transfer with proof.');
    const { rows: [updated] } = await client.query(`UPDATE booking_refund_requests SET status = 'customer_confirmed',
      customer_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`, [request.id]);
    return refundRequestView(updated);
  });
}

async function getRefundProof(db, actor, role, refundId) {
  if (!['customer', 'provider'].includes(role) || !actor?.id) fail(400, 'Invalid account role.');
  const owner = role === 'customer' ? 'customer_id' : 'provider_id';
  const { rows: [proof] } = await db.query(`SELECT proof_mime, proof_content FROM booking_refund_requests WHERE id = $1 AND ${owner} = $2`, [refundId, actor.id]);
  if (!proof?.proof_content) fail(404, 'Refund proof not found.');
  return proof;
}

module.exports = { STATUSES, refundRequestView, createRefundRequest, reviewRefundRequest, markRefundSent, confirmRefundReceived, getRefundProof };
