'use strict';

const crypto = require('node:crypto');
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const SESSION_DAYS = 30;
const sessionCookieName = role => `sn_${role}_session`;

function requestSessionToken(req, role) {
 const authorization = String(req.headers.authorization || '');
 if (authorization) return authorization.match(/^Bearer ([a-f0-9]{64})$/)?.[1] || '';
 const cookie = String(req.headers.cookie || '').split(';').map(value => value.trim())
  .find(value => value.startsWith(`${sessionCookieName(role)}=`));
 const token = cookie?.slice(cookie.indexOf('=') + 1) || '';
 return /^[a-f0-9]{64}$/.test(token) ? token : '';
}

function rememberSession(req, res, role, token) {
 res.cookie(sessionCookieName(role), token, {
  httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/',
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
 });
}

async function issueSession(db, role, accountId, { req, res } = {}) {
 const token = crypto.randomBytes(32).toString('hex');
 await db.query(`INSERT INTO account_sessions (token_hash, account_role, account_id, expires_at)
  VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`, [hashToken(token), role, accountId]);
 if (req && res) rememberSession(req, res, role, token);
 return token;
}

async function authenticateAccount(db, req, role, accountId) {
 const token = requestSessionToken(req, role);
 const result = token ? await db.query(`SELECT account_role, account_id FROM account_sessions
  WHERE token_hash = $1 AND expires_at > NOW()`, [hashToken(token)]) : { rows: [] };
 const session = result.rows[0];
 if (!session) {
  const error = new Error('Please log in again before managing a booking payment.');
  error.statusCode = 401;
  throw error;
 }
 if (session.account_role !== role || (accountId != null && String(session.account_id) !== String(accountId))) {
  const error = new Error('This booking action belongs to another account.');
  error.statusCode = 403;
  throw error;
 }
 const renewal = await db.query(`UPDATE account_sessions SET expires_at = NOW() + INTERVAL '30 days'
  WHERE token_hash = $1 AND account_role = $2 AND account_id = $3 AND expires_at > NOW()
  RETURNING account_id`,
 [hashToken(token), role, session.account_id]);
 if (!renewal.rows.length) {
  const error = new Error('Please log in again before managing a booking payment.');
  error.statusCode = 401;
  throw error;
 }
 return { role, id: Number(session.account_id) };
}

async function revokeSession(db, req, res, role) {
 const token = requestSessionToken(req, role);
 if (token) await db.query('DELETE FROM account_sessions WHERE token_hash = $1 AND account_role = $2', [hashToken(token), role]);
 res.clearCookie(sessionCookieName(role), { httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/' });
}

module.exports = { hashToken, issueSession, authenticateAccount, requestSessionToken, rememberSession, revokeSession };
