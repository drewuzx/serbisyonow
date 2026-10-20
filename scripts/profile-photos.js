'use strict';

const crypto = require('node:crypto');
const multer = require('multer');
const sharp = require('sharp');
const { authenticateAccount } = require('./account-sessions');
const { transaction, fail } = require('./booking-payments');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 2 },
 fileFilter(_req, file, done) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
   const error = new Error('Choose a JPG, PNG, or WebP image.'); error.statusCode = 400; return done(error);
  }
  done(null, true);
 },
});

async function image(file, portrait = false) {
 if (!file?.buffer?.length) fail(400, portrait ? 'Take a selfie first.' : 'Upload the front of your photo ID.');
 try {
  const decoder = sharp(file.buffer, { limitInputPixels: 24 * 1000 * 1000, failOn: 'warning' });
  const meta = await decoder.metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1 || meta.width < 120 || meta.height < 120) {
   fail(400, 'Use a clear, still JPG, PNG, or WebP image at least 120 pixels wide and tall.');
  }
  // Decode and re-encode to reject malformed files and remove EXIF/location metadata.
  return await decoder.rotate().resize(portrait ? { width: 600, height: 600, fit: 'cover' }
   : { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
 } catch (error) {
  if (error.statusCode) throw error;
  fail(400, 'This image could not be read. Choose a different JPG, PNG, or WebP image.');
 }
}

function registerProfilePhotos(app, db) {
 const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
 // Authentication must finish before multipart parsing allocates upload buffers.
 const authenticate = role => (req, res, next) => authenticateAccount(db, req, role).then(account => {
  req.photoAccount = account; res.set('Cache-Control', 'private, no-store'); next();
 }).catch(next);
 const id = req => {
  if (!/^[1-9]\d{0,9}$/.test(req.params.id) || Number(req.params.id) > 2147483647) fail(400, 'Invalid account.');
  return Number(req.params.id);
 };
 const jpeg = (res, content) => res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).type('image/jpeg').send(content);

 app.get('/api/profile-photos/:role/:id', route(async (req, res) => {
  if (!['customer', 'provider'].includes(req.params.role)) fail(404, 'Photo not found.');
  const result = await db.query(`SELECT content FROM profile_photos WHERE ${req.params.role}_id=$1`, [id(req)]);
  if (!result.rows[0]) { res.set('Cache-Control', 'no-store'); return res.status(404).end(); }
  jpeg(res, result.rows[0].content);
 }));
 app.post('/api/customer/profile-photo', authenticate('customer'), upload.single('photo'), route(async (req, res) => {
  const content = await image(req.file, true);
  await db.query(`INSERT INTO profile_photos(customer_id,content) VALUES($1,$2)
   ON CONFLICT(customer_id) DO UPDATE SET content=$2,updated_at=NOW()`, [req.photoAccount.id, content]);
  res.json({ message: 'Profile photo updated.' });
 }));
 app.delete('/api/customer/profile-photo', authenticate('customer'), route(async (req, res) => {
  await db.query('DELETE FROM profile_photos WHERE customer_id=$1', [req.photoAccount.id]);
  res.json({ message: 'Profile photo removed.' });
 }));
 app.get('/api/provider/profile-photo', authenticate('provider'), route(async (req, res) => {
  const result = await db.query('SELECT revision,status,reason,submitted_at,reviewed_at FROM provider_photo_reviews WHERE provider_id=$1', [req.photoAccount.id]);
  res.json({ review: result.rows[0] || null });
 }));
 app.post('/api/provider/profile-photo', authenticate('provider'), upload.fields([
  { name: 'selfie', maxCount: 1 }, { name: 'idFront', maxCount: 1 }, { name: 'idBack', maxCount: 1 },
 ]), route(async (req, res) => {
  if (req.body.consent !== 'true') fail(400, 'Confirm that you agree to manual ID and selfie review.');
  const files = req.files || {};
  const selfie = await image(files.selfie?.[0], true);
  const front = await image(files.idFront?.[0]);
  const back = files.idBack?.[0] ? await image(files.idBack[0]) : null;
  const revision = crypto.randomUUID();
  await transaction(db, async client => {
   await client.query('SELECT id FROM providers WHERE id=$1 FOR UPDATE', [req.photoAccount.id]);
   const pending = await client.query("SELECT status FROM provider_photo_reviews WHERE provider_id=$1 AND status='pending'", [req.photoAccount.id]);
   if (pending.rows.length) fail(409, 'Your selfie is already awaiting admin review.');
   await client.query(`INSERT INTO provider_photo_reviews(provider_id,revision,status,selfie,id_front,id_back)
    VALUES($1,$2,'pending',$3,$4,$5) ON CONFLICT(provider_id) DO UPDATE SET revision=$2,status='pending',
    selfie=$3,id_front=$4,id_back=$5,reason='',submitted_at=NOW(),reviewed_at=NULL,reviewed_by=NULL`,
   [req.photoAccount.id, revision, selfie, front, back]);
  });
  res.status(201).json({ message: 'Selfie submitted for admin review. Your current account verification is unchanged.', revision });
 }));
 app.get('/api/admin/profile-photo-reviews', authenticate('admin'), route(async (_req, res) => {
  const result = await db.query(`SELECT r.provider_id,r.revision,r.submitted_at,p.full_name FROM provider_photo_reviews r
   JOIN providers p ON p.id=r.provider_id WHERE r.status='pending' ORDER BY r.submitted_at`);
  res.json({ reviews: result.rows });
 }));
 app.get('/api/admin/profile-photo-reviews/:id/:revision/:kind', authenticate('admin'), route(async (req, res) => {
  const field = { selfie: 'selfie', front: 'id_front', back: 'id_back' }[req.params.kind];
  if (!field || !/^[a-f0-9-]{36}$/.test(req.params.revision)) fail(404, 'Image not found.');
  const row = (await db.query(`SELECT ${field} AS content FROM provider_photo_reviews WHERE provider_id=$1 AND revision::text=$2 AND status='pending'`, [id(req), req.params.revision])).rows[0];
  if (!row?.content) fail(404, 'Image is unavailable or this submission has already been reviewed.');
  jpeg(res, row.content);
 }));
 app.post('/api/admin/profile-photo-reviews/:id', authenticate('admin'), route(async (req, res) => {
  const providerId = id(req), { revision, decision } = req.body;
  const reason = String(req.body.reason || '').trim();
  if (!['approved', 'declined'].includes(decision) || typeof revision !== 'string') fail(400, 'Choose approve or decline.');
  if ((decision === 'declined' && !reason) || reason.length > 500) fail(400, 'Enter a decline reason of 1 to 500 characters.');
  await transaction(db, async client => {
   await client.query('SELECT id FROM providers WHERE id=$1 FOR UPDATE', [providerId]);
   const row = (await client.query("SELECT * FROM provider_photo_reviews WHERE provider_id=$1 AND revision::text=$2 AND status='pending' FOR UPDATE", [providerId, revision])).rows[0];
   if (!row) fail(409, 'This submission has changed or was already reviewed. Refresh the queue.');
   if (decision === 'approved') await client.query(`INSERT INTO profile_photos(provider_id,content) VALUES($1,$2)
    ON CONFLICT(provider_id) DO UPDATE SET content=$2,updated_at=NOW()`, [providerId, row.selfie]);
   // Keep the decision, but discard private review images after the review is complete.
   await client.query(`UPDATE provider_photo_reviews SET status=$2,reason=$3,reviewed_at=NOW(),reviewed_by=$4,
    selfie=NULL,id_front=NULL,id_back=NULL WHERE provider_id=$1`, [providerId, decision, decision === 'declined' ? reason : '', req.photoAccount.id]);
  });
  res.json({ message: decision === 'approved' ? 'Profile photo approved.' : 'Photo declined. The provider can submit again.' });
 }));
}

module.exports = { registerProfilePhotos, image };
