'use strict';

const { transaction } = require('./booking-payments');
const PROMPT_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

function fail(statusCode, message) {
 const error = new Error(message);
 error.statusCode = statusCode;
 throw error;
}

function feedbackRole(role) {
 if (!['customer', 'provider'].includes(role)) fail(400, 'Choose a valid account type.');
 return role;
}

function nextPrompt(row) {
 return row ? new Date(new Date(row.created_at).getTime() + PROMPT_DELAY_MS).toISOString() : null;
}

async function feedbackState(db, actor) {
 const column = feedbackRole(actor.role) === 'customer' ? 'customer_id' : 'provider_id';
 const { rows: [latest] } = await db.query(`SELECT created_at FROM admin_feedback
  WHERE source = 'system' AND ${column} = $1 ORDER BY created_at DESC LIMIT 1`, [actor.id]);
 return { next_prompt_at: nextPrompt(latest) };
}

async function submitSystemFeedback(db, actor, body) {
 feedbackRole(actor.role);
 if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) fail(400, 'Choose a rating from 1 to 5 stars.');
 if (body.comment != null && typeof body.comment !== 'string') fail(400, 'Enter a valid comment.');
 const comment = (body.comment || '').trim();
 if (comment.length > 2000) fail(400, 'Keep your comment within 2,000 characters.');
 if (typeof body.submission_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.submission_id)) {
  fail(400, 'Refresh the feedback form and try again.');
 }
 const customer = actor.role === 'customer';
 const table = customer ? 'customers' : 'providers';
 const column = customer ? 'customer_id' : 'provider_id';
 return transaction(db, async client => {
  // Serialize submissions per account, including simultaneous requests from separate tabs.
  const { rows: [account] } = await client.query(`SELECT full_name FROM ${table} WHERE id = $1 FOR UPDATE`, [actor.id]);
  if (!account) fail(401, 'Please sign in again to submit feedback.');
  const { rows: [duplicate] } = await client.query('SELECT * FROM admin_feedback WHERE submission_id = $1', [body.submission_id]);
  if (duplicate) {
   if (duplicate.submitted_role !== actor.role || Number(duplicate[column]) !== actor.id) fail(409, 'This feedback submission already exists.');
   return { id: duplicate.id, next_prompt_at: nextPrompt(duplicate) };
  }
  // Delay automatic reminders, not feedback intentionally submitted by the user.
  const { rows: [feedback] } = await client.query(`INSERT INTO admin_feedback
   (type, source, subject, message, submitted_by, submitted_role, rating, submission_id, customer_id, provider_id)
   VALUES ('feedback', 'system', 'System Rating', $1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
  [comment, account.full_name, actor.role, body.rating, body.submission_id, customer ? actor.id : null, customer ? null : actor.id]);
  return { id: feedback.id, next_prompt_at: nextPrompt(feedback) };
 });
}

module.exports = { feedbackRole, feedbackState, submitSystemFeedback };
