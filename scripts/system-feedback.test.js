'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const { startQrFixture } = require('./provider-qr-test-fixture');

test('system feedback API uses authenticated accounts and persists every rating for admins', async t => {
 const f = await startQrFixture();
 t.after(() => f.close());
 const payload = extras => ({ role: 'customer', rating: 5, comment: '', submission_id: crypto.randomUUID(), ...extras });
 let first;
 let adminToken;

 await t.test('rejects anonymous and wrong-role submissions', async () => {
  assert.equal((await f.request('/api/system-feedback?role=customer', 'GET', undefined, '')).status, 401);
  assert.equal((await f.request('/api/system-feedback', 'POST', payload(), '')).status, 401);
  assert.equal((await f.request('/api/system-feedback', 'POST', payload({ role: 'provider' }))).status, 403);
  assert.equal((await f.request('/api/system-feedback', 'POST', payload({ role: 'admin' }))).status, 400);
  assert.equal((await f.request('/api/system-feedback?role=customer')).data.next_prompt_at, null);
 });
 await t.test('validates rating, comment, and retry identifier before saving', async () => {
  for (const rating of [null, 0, 6, 2.5, '5', {}, true]) {
   assert.equal((await f.request('/api/system-feedback', 'POST', payload({ rating }))).status, 400);
  }
  for (const comment of [{}, ['text'], 'a'.repeat(2001)]) {
   assert.equal((await f.request('/api/system-feedback', 'POST', payload({ comment }))).status, 400);
  }
  assert.equal((await f.request('/api/system-feedback', 'POST', payload({ submission_id: 'invalid' }))).status, 400);
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM admin_feedback')).rows[0].count, 0);
 });
 await t.test('derives identity from the session, not submitted IDs or names', async () => {
  const body = payload({ rating: 1, comment: '  The booking screen could be clearer.  ', submitted_by: 'Spoofed', customer_id: 62, provider_id: 82, status: 'resolved', source: 'general' });
  first = { body, ...(await f.request('/api/system-feedback', 'POST', body)) };
  assert.equal(first.status, 201);
  const { rows: [row] } = await f.db.query('SELECT * FROM admin_feedback WHERE id = $1', [first.data.id]);
  assert.equal(row.customer_id, 61);
  assert.equal(row.provider_id, null);
  assert.equal(row.submitted_by, 'QR Test Customer');
  assert.equal(row.submitted_role, 'customer');
  assert.equal(row.status, 'open');
  assert.equal(row.source, 'system');
  assert.equal(row.rating, 1);
  assert.equal(row.message, body.comment.trim());
  assert(Date.parse(first.data.next_prompt_at) > Date.now() + 29 * 86400000);
 });
 await t.test('retries are idempotent, new feedback is allowed immediately, and other accounts cannot reuse a submission', async () => {
  assert.equal((await f.request('/api/system-feedback', 'POST', first.body)).data.id, first.data.id);
  const followup = await f.request('/api/system-feedback', 'POST', payload());
  assert.equal(followup.status, 201);
  assert.notEqual(followup.data.id, first.data.id);
  assert.equal((await f.request('/api/system-feedback?role=customer')).data.next_prompt_at, followup.data.next_prompt_at);
  assert.equal((await f.request('/api/system-feedback', 'POST', first.body, f.otherCustomerToken)).status, 409);
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM admin_feedback')).rows[0].count, 2);
 });
 await t.test('supports providers and optional comments without changing service reviews', async () => {
  const result = await f.request('/api/system-feedback', 'POST', payload({ role: 'provider' }), f.providerToken);
  assert.equal(result.status, 201);
  const { rows: [row] } = await f.db.query('SELECT * FROM admin_feedback WHERE id = $1', [result.data.id]);
  assert.equal(row.provider_id, 81);
  assert.equal(row.customer_id, null);
  assert.equal(row.message, '');
  assert.equal(row.rating, 5);
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM customer_reviews')).rows[0].count, 0);
 });
 await t.test('distinct submissions are retained while concurrent retries save only one record', async () => {
  const responses = await Promise.all([1, 2].map(() => f.request('/api/system-feedback', 'POST', payload({ role: 'provider', rating: 4 }), f.otherProviderToken)));
  assert.deepEqual(responses.map(result => result.status).sort(), [201, 201]);
  assert.notEqual(responses[0].data.id,responses[1].data.id);
  const body = payload({ rating: 3 });
  const retries = await Promise.all([1, 2].map(() => f.request('/api/system-feedback', 'POST', body, f.otherCustomerToken)));
  assert.deepEqual(retries.map(result => result.status), [201, 201]);
  assert.equal(retries[0].data.id, retries[1].data.id);
 });
 await t.test('admin login issues a real session and feedback is private', async () => {
  await f.db.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', ['feedback-test-admin', await bcrypt.hash('fixture-password', 4)]);
  const login = await f.request('/api/auth/admin/login', 'POST', { username: 'feedback-test-admin', password: 'fixture-password' }, '');
  assert.equal(login.status, 200);
  adminToken = login.data.user.auth_token;
  assert.match(adminToken, /^[a-f0-9]{64}$/);
  assert.match(login.headers.get('set-cookie'), /sn_admin_session=/);
  assert.equal((await f.request('/api/admin/feedback', 'GET', undefined, '')).status, 401);
  assert.equal((await f.request('/api/admin/feedback')).status, 403);
  assert.equal((await f.request(`/api/admin/feedback/${first.data.id}/status`, 'PATCH', {status:'resolved'})).status, 403);
  const cookieResponse = await fetch(`${f.base}/api/admin/feedback`, {headers:{Cookie:`sn_admin_session=${adminToken}`}});
  assert.equal(cookieResponse.status, 200);
 });
 await t.test('admin sees low/high ratings and legacy positive feedback; status filters still work', async () => {
  const legacy = await f.request('/api/admin/feedback', 'POST', {type:'feedback',subject:'Positive Feedback',message:'Legacy feedback',submitted_by:'Legacy user'}, adminToken);
  assert.equal(legacy.status, 201);
  const result = await f.request('/api/admin/feedback', 'GET', undefined, adminToken);
  assert.equal(result.status, 200);
  assert.equal(result.data.feedback.length, 7);
  assert(result.data.feedback.some(row => row.rating === 1 && row.submitted_role === 'customer'));
  assert(result.data.feedback.some(row => row.rating === 5 && row.submitted_role === 'provider'));
  assert(result.data.feedback.some(row => row.subject === 'Positive Feedback'));
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal((await f.request(`/api/admin/feedback/${first.data.id}/status`, 'PATCH', {status:'invalid'}, adminToken)).status, 400);
  assert.equal((await f.request(`/api/admin/feedback/${first.data.id}/status`, 'PATCH', {status:'review'}, adminToken)).status, 200);
  assert.equal((await f.request('/api/admin/feedback?status=review', 'GET', undefined, adminToken)).data.feedback.length, 1);
 });
 await t.test('later ratings are separate records and migrations are repeatable', async () => {
  await f.db.query("UPDATE admin_feedback SET created_at = NOW() - INTERVAL '31 days' WHERE id = $1", [first.data.id]);
  assert.equal((await f.request('/api/system-feedback', 'POST', payload({rating: 4}))).status, 201);
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM admin_feedback WHERE customer_id = 61')).rows[0].count, 3);
  await f.db.query(fs.readFileSync(path.join(__dirname, 'feedback-schema.sql'), 'utf8'));
  assert.equal((await f.request('/api/admin/feedback', 'GET', undefined, adminToken)).status, 200);
 });
});
