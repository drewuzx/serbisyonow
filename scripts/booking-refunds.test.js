'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  refundRequestView,
  createRefundRequest,
  reviewRefundRequest,
  markRefundSent,
  confirmRefundReceived,
} = require('./booking-refunds');

test('refund view exposes amount and proof presence without the proof bytes', () => {
  const view = refundRequestView({ id: '9', amount_centavos: '15000', status: 'refund_sent', proof_content: Buffer.from('image') });
  assert.equal(view.amount, 150);
  assert.equal(view.has_proof, true);
  assert.equal('proof_content' in view, false);
});

test('refund requests require a useful reason before opening a database transaction', async () => {
  await assert.rejects(createRefundRequest({}, 1, 2, { reason: 'no' }), /5 to 1,000 characters/);
});

test('refund review accepts only approve or reject', async () => {
  await assert.rejects(reviewRefundRequest({}, 1, 2, { decision: 'send' }), /Choose approve or reject/);
});

test('refund transfer requires reference, explicit confirmation, and an image proof', async () => {
  await assert.rejects(markRefundSent({}, 1, 2, { reference: 'ABC', confirm_sent: 'true' }, null), /Upload proof/);
  await assert.rejects(markRefundSent({}, 1, 2, { reference: 'A', confirm_sent: 'true' }, { mimetype: 'image/png', buffer: Buffer.from('x') }), /reference/);
  await assert.rejects(markRefundSent({}, 1, 2, { reference: 'ABC', confirm_sent: 'false' }, { mimetype: 'image/png', buffer: Buffer.from('x') }), /Confirm that you sent/);
});

test('customer receipt confirmation requires an explicit acknowledgement', async () => {
  await assert.rejects(confirmRefundReceived({}, 1, 2, { confirm_received: false }), /Confirm that the refund has arrived/);
});
