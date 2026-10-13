'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { transaction, fail } = require('./booking-payments');

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

module.exports = { profileDescription, credentialType, validateCredential, saveProviderCredentials };
