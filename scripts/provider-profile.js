'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { transaction, fail } = require('./booking-payments');
const { authenticateAccount, requestSessionToken, hashToken } = require('./account-sessions');

function profileBirthDate(value) {
  // PostgreSQL DATE is a local-midnight Date, not a UTC timestamp.
  if (value && typeof value.getFullYear === 'function') return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return value ? String(value).slice(0, 10) : null;
}

function profilePersonalFields(body) {
  const gender = body.gender === undefined ? null : body.gender;
  const dob = body.dob === undefined ? null : body.dob;
  if (gender !== null && !['Male', 'Female', 'Prefer not to say'].includes(gender)) fail(400, 'Choose a valid gender.');
  if (dob !== null) {
    const date = typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? new Date(`${dob}T00:00:00Z`) : null;
    if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dob || dob < '1900-01-01' || date > new Date()) fail(400, 'Enter a valid date of birth that is not in the future.');
  }
  return { gender, dob };
}

async function changeProviderPassword(db, req) {
  const account = await authenticateAccount(db, req, 'provider', req.params.id);
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (typeof currentPassword !== 'string' || !currentPassword || Buffer.byteLength(currentPassword) > 1024) fail(400, 'Enter your current password.');
  if (typeof newPassword !== 'string' || newPassword.length < 8 || Buffer.byteLength(newPassword) > 72) fail(400, 'New password must be at least 8 characters and no more than 72 bytes.');
  if (newPassword !== confirmPassword) fail(400, 'New passwords do not match.');
  return transaction(db, async client => {
    const { rows: [provider] } = await client.query('SELECT password_hash, auth_provider FROM providers WHERE id = $1 FOR UPDATE', [account.id]);
    if (!provider) fail(404, 'Provider not found.');
    if (provider.auth_provider === 'google' || !provider.password_hash) fail(409, 'This account uses Google sign-in. Use Forgot Password to set an email password first.');
    if (!await bcrypt.compare(currentPassword, provider.password_hash)) fail(400, 'Current password is incorrect.');
    if (await bcrypt.compare(newPassword, provider.password_hash)) fail(400, 'Choose a new password different from your current password.');
    // Keep this browser signed in, but invalidate other sessions and outstanding reset links.
    const currentHash = hashToken(requestSessionToken(req, 'provider'));
    const active = await client.query("SELECT token_hash FROM account_sessions WHERE token_hash = $1 AND account_role = 'provider' AND account_id = $2 AND expires_at > NOW() FOR UPDATE", [currentHash, account.id]);
    if (!active.rowCount) fail(401, 'Please sign in again before changing your password.');
    await client.query("UPDATE providers SET password_hash = $2, auth_provider = 'password', updated_at = NOW() WHERE id = $1", [account.id, await bcrypt.hash(newPassword, 12)]);
    await client.query("DELETE FROM account_sessions WHERE account_role = 'provider' AND account_id = $1 AND token_hash <> $2", [account.id, currentHash]);
    await client.query("DELETE FROM password_reset_tokens WHERE account_type = 'provider' AND account_id = $1", [account.id]);
    return { ok: true, message: 'Password updated. This device stays signed in; other sessions have been signed out.' };
  });
}

function profileDescription(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.trim().length > 2000) fail(400, 'Description must be 2,000 characters or fewer.');
  return value.trim();
}

function credentialType(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  const mime = types[extension];
  if (!mime || (file.fieldname !== 'docs' && ['.doc', '.docx'].includes(extension))) fail(400, 'Credentials must be JPG, PNG, WebP, PDF, DOC or DOCX. ID files must be an image or PDF.');
  return { extension, mime };
}

function validateCredential(file) {
  const type = credentialType(file);
  const buffer = file.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) fail(400, 'Empty files cannot be uploaded.');
  if (buffer.length > 10 * 1024 * 1024) fail(400, 'Each credential file must be 10 MB or smaller.');
  const signatures = {
    '.jpg': () => buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
    '.png': () => buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    '.webp': () => buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP',
    '.pdf': () => buffer.toString('ascii', 0, 5) === '%PDF-',
    '.doc': () => buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11e0', 'hex')),
    '.docx': () => buffer.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')) && buffer.includes(Buffer.from('[Content_Types].xml')) && buffer.includes(Buffer.from('word/')),
  };
  if (!signatures[type.extension === '.jpeg' ? '.jpg' : type.extension]()) fail(400, 'A selected file does not match its file type. Choose a valid image or document.');
  return type;
}

async function saveProviderCredentials(db, providerId, files) {
  if (!files.length) fail(400, 'Choose at least one credential or proof-of-work file.');
  if (files.filter(file => file.fieldname === 'docs').length > 10 || ['idFront', 'idBack'].some(field => files.filter(file => file.fieldname === field).length > 1)) fail(400, 'Upload up to 10 credentials and one file per ID side.');
  const uploads = files.map(file => {
    const { extension, mime } = validateCredential(file);
    const name = path.basename(file.originalname, path.extname(file.originalname)).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60) || 'document';
    return { ...file, mime, filename: `${Date.now()}-${crypto.randomBytes(12).toString('hex')}-${name}${extension}`, folder: file.fieldname === 'docs' ? 'provider-docs' : 'customer-ids' };
  });
  return transaction(db, async client => {
    const { rowCount } = await client.query('SELECT id FROM providers WHERE id = $1 FOR UPDATE', [providerId]);
    if (!rowCount) fail(404, 'Provider not found.');
    for (const file of uploads) {
      await client.query(`INSERT INTO uploaded_files (folder, filename, original_name, mime_type, size_bytes, content, owner_role, owner_id)
        VALUES ($1, $2, $3, $4, $5, $6, 'provider', $7)`, [file.folder, file.filename, file.originalname, file.mime, file.buffer.length, file.buffer, providerId]);
    }
    const result = await client.query(`UPDATE providers SET
      documents_files = COALESCE(documents_files, ARRAY[]::TEXT[]) || $2::TEXT[],
      id_front_file = COALESCE($3, id_front_file), id_back_file = COALESCE($4, id_back_file),
      is_verified = FALSE, verification_status = 'pending', updated_at = NOW()
      WHERE id = $1 RETURNING *`, [providerId, uploads.filter(file => file.fieldname === 'docs').map(file => file.filename),
      uploads.find(file => file.fieldname === 'idFront')?.filename || null, uploads.find(file => file.fieldname === 'idBack')?.filename || null]);
    return result.rows[0];
  });
}

module.exports = { profileDescription, profileBirthDate, profilePersonalFields, changeProviderPassword, credentialType, validateCredential, saveProviderCredentials };
