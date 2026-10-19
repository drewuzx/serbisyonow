'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { authenticateAccount } = require('./account-sessions');
const { fail } = require('./booking-payments');

function registerAdminProviderDetails(app, db, providerView, uploadDir) {
 const guard = fn => (req,res,next) => Promise.resolve().then(async () => {
  await authenticateAccount(db,req,'admin');
  if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id)>2147483647) fail(400,'Invalid provider.');
  res.set('Cache-Control','private, no-store');
  return fn(req,res);
 }).catch(next);
 app.get('/api/admin/providers/:id/details',guard(async (req,res) => {
  const page=Number(req.query.page || 1), size=10;
  if(!Number.isInteger(page) || page<1 || page>100000) fail(400,'Invalid review page.');
  const row=(await db.query('SELECT * FROM providers WHERE id=$1',[req.params.id])).rows[0];
  if(!row) fail(404,'Provider not found.');
  const summary=(await db.query('SELECT COUNT(*)::int AS total,COALESCE(AVG(rating),0)::float AS average FROM customer_reviews WHERE provider_id=$1',[row.id])).rows[0];
  const reviews=(await db.query(`SELECT r.id,r.rating,r.comment,r.created_at,COALESCE(c.full_name,'Former customer') AS customer_name,b.service
   FROM customer_reviews r LEFT JOIN customers c ON c.id=r.customer_id LEFT JOIN customer_bookings b ON b.id=r.booking_id
   WHERE r.provider_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT $2 OFFSET $3`,[row.id,size,(page-1)*size])).rows;
  res.json({provider:await providerView(row),reviews,review_summary:summary,page,page_size:size});
 }));
 app.get('/api/admin/providers/:id/documents/:kind/:index',guard(async (req,res) => {
  const {kind,index}=req.params;
  if(!['credential','front','back'].includes(kind) || !/^\d+$/.test(index) || Number(index)>10000) fail(400,'Invalid document.');
  const row=(await db.query('SELECT documents_files,id_front_file,id_back_file FROM providers WHERE id=$1',[req.params.id])).rows[0];
  if(!row) fail(404,'Provider not found.');
  const filename=kind==='credential' ? row.documents_files?.[Number(index)] : Number(index)===0 ? row[kind==='front'?'id_front_file':'id_back_file'] : null;
  if(!filename || ['.','..'].includes(filename) || path.basename(filename)!==filename || filename.includes('\\') || filename.includes('/')) fail(404,'Document not found.');
  const folder=kind==='credential'?'provider-docs':'customer-ids';
  const stored=(await db.query('SELECT content,original_name,mime_type FROM uploaded_files WHERE folder=$1 AND filename=$2',[folder,filename])).rows[0];
  res.set('X-Content-Type-Options','nosniff');
  if(stored) {
   res.attachment(stored.original_name || filename);
   res.type(stored.mime_type || 'application/octet-stream').send(stored.content);
  } else {
   const location=path.join(uploadDir,folder,filename);
   try { await fs.access(location); } catch { fail(404,'This uploaded file is no longer available. Ask the provider to upload it again.'); }
   res.download(location,filename);
  }
 }));
}
module.exports={registerAdminProviderDetails};
