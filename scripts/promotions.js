'use strict';
const { fail, transaction } = require('./booking-payments');
const { imageFile } = require('./provider-qr-payments');
const { authenticateAccount } = require('./account-sessions');

const orderColumns = `o.id,o.provider_id,o.plan_id,o.plan_name,o.description,o.duration_days,o.amount_centavos,o.status,
 o.wallet,o.account_name,o.account_number,o.receipt_id,o.paid_at,o.starts_at,o.expires_at,o.created_at,
 p.full_name AS provider_name,r.reference_number,r.review_note,
 CASE WHEN o.status='paid' AND o.expires_at<=NOW() THEN 'expired'
 WHEN o.status='paid' AND o.starts_at>NOW() THEN 'scheduled'
 WHEN o.status='paid' THEN 'active' ELSE o.status END AS display_status`;
const orderJoin = `FROM promotion_orders o JOIN providers p ON p.id=o.provider_id LEFT JOIN promotion_receipts r ON r.id=o.receipt_id`;
const wrap = fn => (req, res, next) => Promise.resolve().then(() => {
 for (const [key, value] of Object.entries(req.params)) {
  if (['id', 'orderId', 'planId'].includes(key) && (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647)) fail(400, 'Invalid record identifier.');
 }
 return fn(req, res);
}).catch(next);
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value || '');
function text(value, label, max, required = true) {
 if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(400, `Enter a valid ${label}.`);
 return value.trim();
}
function planInput(body) {
 const name = text(body.name, 'plan name', 100), description = text(body.description || '', 'description', 1000, false);
 const days = Number(body.duration_days);
 if (!Number.isInteger(days) || days < 1 || days > 365) fail(400, 'Duration must be 1-365 days.');
 if (!['promotion', 'subscription'].includes(body.kind) || typeof body.enabled !== 'boolean') fail(400, 'Choose a plan type and availability.');
 if (!/^\d+(\.\d{1,2})?$/.test(String(body.price))) fail(400, 'Enter a price with up to two decimal places.');
 const cents = Math.round(Number(body.price) * 100);
 if (!Number.isSafeInteger(cents) || cents > 10000000 || (body.enabled && cents < 100)) fail(400, 'Enabled plans require a price from PHP 1 to PHP 100,000.');
 return [name, description, body.kind, days, cents, body.enabled];
}
async function orders(db, providerId, query) {
 const page = Number(query.page || 1), size = 25;
 if (!Number.isInteger(page) || page < 1 || page > 100000) fail(400, 'Invalid history page.');
 const filters = { all:'TRUE',awaiting_payment:"o.status='awaiting_payment'",awaiting_verification:"o.status='awaiting_verification'",rejected:"o.status='rejected'",cancelled:"o.status='cancelled'",
  active:"o.status='paid' AND o.starts_at<=NOW() AND o.expires_at>NOW()",scheduled:"o.status='paid' AND o.starts_at>NOW()",expired:"o.status='paid' AND o.expires_at<=NOW()" };
 const filter = query.status || 'all';
 if (!Object.hasOwn(filters,filter)) fail(400, 'Invalid payment status.');
 const params = providerId ? [providerId] : [];
 const where = `WHERE ${providerId ? 'o.provider_id=$1 AND ' : ''}(${filters[filter]})`;
 const count = (await db.query(`SELECT COUNT(*)::int AS total FROM promotion_orders o ${where}`,params)).rows[0].total;
 const rows = (await db.query(`SELECT ${orderColumns} ${orderJoin} ${where} ORDER BY o.created_at DESC,o.id DESC LIMIT ${size} OFFSET $${params.length+1}`,[...params,(page-1)*size])).rows;
 return { orders:rows,order_count:count,order_page:page,page_size:size };
}

function registerPromotionRoutes(app, db, upload) {
 const admin = async req => {
  const actor = await authenticateAccount(db, req, 'admin');
  if (!(await db.query('SELECT id FROM admins WHERE id=$1', [actor.id])).rowCount) fail(403, 'An admin account is required.');
  return actor;
 };
 const provider = req => authenticateAccount(db, req, 'provider', req.params.id);
 const adminGuard = (req, res, next) => admin(req).then(actor => { req.promotionActor = actor; next(); }).catch(next);
 const providerGuard = (req, res, next) => provider(req).then(actor => { req.promotionActor = actor; next(); }).catch(next);
 const noCache = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
 app.use(['/api/admin/promotions', '/api/provider/:id/promotions', '/api/promotion-media'], noCache);

 app.get('/api/admin/promotions', adminGuard, wrap(async (req, res) => {
  const plans = (await db.query('SELECT * FROM promotion_plans ORDER BY id')).rows;
  const settings = (await db.query('SELECT wallet,account_name,account_number,qr_content IS NOT NULL AS configured,updated_at FROM platform_payment_settings WHERE id=1')).rows[0];
  const metrics = (await db.query(`SELECT
   COALESCE(SUM(amount_centavos) FILTER(WHERE status='paid'),0) AS revenue_centavos,
   COUNT(*) FILTER(WHERE status='awaiting_verification')::int AS pending_count,
   COUNT(DISTINCT provider_id) FILTER(WHERE status='paid' AND starts_at<=NOW() AND expires_at>NOW())::int AS active_providers
   FROM promotion_orders`)).rows[0];
  const earnings = (await db.query(`SELECT p.id,p.full_name,
   COUNT(b.id) FILTER(WHERE b.status='completed')::int AS completed_jobs,
   COALESCE(SUM(b.deposit_amount) FILTER(WHERE b.deposit_status='paid' AND b.deposit_livemode IS DISTINCT FROM FALSE),0) AS verified_downpayments,
   COALESCE(SUM(b.balance_due) FILTER(WHERE b.status='completed'),0) AS unverified_balances,
   COALESCE(SUM(b.confirmed_price) FILTER(WHERE b.status='completed'),0) AS completed_service_totals
   FROM providers p JOIN customer_bookings b ON b.provider_id=p.id
   GROUP BY p.id ORDER BY p.full_name LIMIT 200`)).rows;
  res.json({ plans, settings, metrics, ...await orders(db,null,req.query), earnings });
 }));
 app.post('/api/admin/promotions/plans', adminGuard, wrap(async (req, res) => {
  const result = await db.query(`INSERT INTO promotion_plans(name,description,kind,duration_days,price_centavos,enabled) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, planInput(req.body));
  res.status(201).json({ plan: result.rows[0] });
 }));
 app.patch('/api/admin/promotions/plans/:planId', adminGuard, wrap(async (req, res) => {
  const result = await db.query(`UPDATE promotion_plans SET name=$1,description=$2,kind=$3,duration_days=$4,price_centavos=$5,enabled=$6,updated_at=NOW() WHERE id=$7 RETURNING *`, [...planInput(req.body), req.params.planId]);
  if (!result.rowCount) fail(404, 'Plan not found.');
  res.json({ plan: result.rows[0] });
 }));
 app.put('/api/admin/promotions/payment-qr', adminGuard, upload.single('qr'), wrap(async (req, res) => {
  if (req.body.confirm_account !== 'true') fail(400, 'Confirm the receiving account belongs to the platform.');
  const name = text(req.body.account_name, 'account name', 120), number = text(req.body.account_number, 'account number', 60);
  const wallet = text(req.body.wallet, 'payment app', 60);
  if (!['GCash', 'Maya', 'Bank / QR Ph'].includes(wallet)) fail(400, 'Choose a supported payment app.');
  const image = req.file ? imageFile(req.file) : null;
  await transaction(db, async client => {
   const current = (await client.query('SELECT qr_content FROM platform_payment_settings WHERE id=1 FOR UPDATE')).rows[0];
   if (!image && !current?.qr_content) fail(400, 'Upload the platform payment QR.');
   await client.query(`UPDATE platform_payment_settings SET wallet=$1,account_name=$2,account_number=$3,qr_content=COALESCE($4,qr_content),qr_mime=COALESCE($5,qr_mime),updated_at=NOW() WHERE id=1`, [wallet, name, number, image?.buffer || null, image?.mime || null]);
  });
  res.json({ ok: true });
 }));

 app.get('/api/provider/:id/promotions', providerGuard, wrap(async (req, res) => {
  const account = (await db.query('SELECT is_verified FROM providers WHERE id=$1', [req.params.id])).rows[0];
  const settings = (await db.query('SELECT qr_content IS NOT NULL AS configured FROM platform_payment_settings WHERE id=1')).rows[0];
  const pending = (await db.query("SELECT EXISTS(SELECT 1 FROM promotion_orders WHERE provider_id=$1 AND status IN ('awaiting_payment','awaiting_verification','rejected')) AS pending",[req.params.id])).rows[0].pending;
  const currentBoost = (await db.query(`SELECT ${orderColumns} ${orderJoin} WHERE o.provider_id=$1 AND o.status='paid' AND o.starts_at<=NOW() AND o.expires_at>NOW() ORDER BY o.expires_at DESC LIMIT 1`, [req.params.id])).rows[0] || null;
  res.json({ plans: (await db.query('SELECT * FROM promotion_plans WHERE enabled=TRUE ORDER BY price_centavos,id')).rows,
   payment_ready: Boolean(settings?.configured), verified: Boolean(account?.is_verified), has_pending:pending, current_boost:currentBoost, ...await orders(db, req.params.id,req.query) });
 }));
 app.post('/api/provider/:id/promotions/orders', providerGuard, wrap(async (req, res) => {
  if (!Number.isInteger(Number(req.body.plan_id)) || Number(req.body.plan_id) < 1 || Number(req.body.plan_id) > 2147483647) fail(400, 'Choose a valid plan.');
  if (!uuid(req.body.request_id) || req.body.accept_terms !== true) fail(400, 'Confirm the plan, price and one-time payment terms.');
  const id = await transaction(db, async client => {
   const account = (await client.query('SELECT is_verified FROM providers WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
   if (!account?.is_verified) fail(403, 'Your provider account must be verified before purchasing a promotion.');
   const duplicate = (await client.query('SELECT id,provider_id FROM promotion_orders WHERE request_id=$1', [req.body.request_id])).rows[0];
   if (duplicate) { if (String(duplicate.provider_id) !== req.params.id) fail(409, 'This payment request already exists.'); return duplicate.id; }
   const open = (await client.query("SELECT id FROM promotion_orders WHERE provider_id=$1 AND status IN ('awaiting_payment','awaiting_verification','rejected')", [req.params.id])).rows[0];
   if (open) fail(409, 'Finish or cancel your existing promotion payment first.');
   const plan = (await client.query('SELECT * FROM promotion_plans WHERE id=$1 AND enabled=TRUE FOR SHARE', [req.body.plan_id])).rows[0];
   if (!plan || new Date(plan.updated_at).toISOString() !== req.body.revision) fail(409, 'The plan has changed. Refresh and review the current price.');
   const accountQr = (await client.query('SELECT * FROM platform_payment_settings WHERE id=1 FOR SHARE')).rows[0];
   if (!accountQr?.qr_content) fail(409, 'The admin has not configured platform payments yet.');
   const result = await client.query(`INSERT INTO promotion_orders(provider_id,plan_id,request_id,plan_name,description,duration_days,amount_centavos,wallet,account_name,account_number,qr_content,qr_mime)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [req.params.id, plan.id, req.body.request_id, plan.name, plan.description, plan.duration_days, plan.price_centavos, accountQr.wallet, accountQr.account_name, accountQr.account_number, accountQr.qr_content, accountQr.qr_mime]);
   return result.rows[0].id;
  });
  res.status(201).json({ id });
 }));
 app.post('/api/provider/:id/promotions/orders/:orderId/receipt', providerGuard, upload.single('receipt'), wrap(async (req, res) => {
  const image = imageFile(req.file), reference = text(req.body.reference_number, 'transaction reference', 120).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{3,119}$/.test(reference)) fail(400, 'Enter a transaction reference of 4-120 letters or digits.');
  await transaction(db, async client => {
   const order = (await client.query('SELECT status FROM promotion_orders WHERE id=$1 AND provider_id=$2 FOR UPDATE', [req.params.orderId, req.params.id])).rows[0];
   if (!order) fail(404, 'Order not found.');
   if (!['awaiting_payment', 'rejected'].includes(order.status)) fail(409, 'This order is not waiting for a receipt.');
   await client.query('INSERT INTO promotion_references(reference_number,order_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [reference, req.params.orderId]);
   const previous = (await client.query('SELECT order_id FROM promotion_references WHERE reference_number=$1', [reference])).rows[0];
   if (String(previous.order_id) !== req.params.orderId) fail(409, 'This reference is already attached to another payment.');
   const receipt = (await client.query('INSERT INTO promotion_receipts(order_id,reference_number,content,mime_type) VALUES($1,$2,$3,$4) RETURNING id', [req.params.orderId, reference, image.buffer, image.mime])).rows[0];
   await client.query("UPDATE promotion_orders SET status='awaiting_verification',receipt_id=$2 WHERE id=$1", [req.params.orderId, receipt.id]);
  });
  res.status(201).json({ ok: true });
 }));
 app.patch('/api/provider/:id/promotions/orders/:orderId/cancel', providerGuard, wrap(async (req, res) => {
  // Receipt-bearing orders cannot disappear while money may already have arrived.
  const result = await db.query("UPDATE promotion_orders SET status='cancelled' WHERE id=$1 AND provider_id=$2 AND status='awaiting_payment' AND receipt_id IS NULL RETURNING id", [req.params.orderId, req.params.id]);
  if (!result.rowCount) fail(409, 'Only unpaid orders without a submitted receipt can be cancelled. Contact the admin if you already transferred money.');
  res.json({ ok: true });
 }));
 app.patch('/api/admin/promotions/orders/:orderId/review', adminGuard, wrap(async (req, res) => {
  const decision = req.body.decision, note = text(req.body.notes || '', 'review note', 1000, false);
  if (!['verify', 'reject'].includes(decision) || (decision === 'verify' && req.body.payment_received !== true) || (decision === 'reject' && !note)) fail(400, 'Confirm actual receipt of the funds, or provide a rejection reason.');
  await transaction(db, async client => {
   const ref = (await client.query('SELECT provider_id FROM promotion_orders WHERE id=$1', [req.params.orderId])).rows[0];
   if (!ref) fail(404, 'Order not found.');
   const account = (await client.query('SELECT is_verified FROM providers WHERE id=$1 FOR UPDATE', [ref.provider_id])).rows[0];
   const order = (await client.query('SELECT * FROM promotion_orders WHERE id=$1 FOR UPDATE', [req.params.orderId])).rows[0];
   if (order.status !== 'awaiting_verification' || Number(order.receipt_id) !== Number(req.body.receipt_id)) fail(409, 'The payment has changed or was already reviewed. Refresh first.');
   if (decision === 'verify' && !account?.is_verified) fail(409, 'Resolve provider verification before activating this purchase.');
   await client.query('UPDATE promotion_receipts SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=NOW() WHERE id=$1', [order.receipt_id, decision === 'verify' ? 'verified' : 'rejected', note, req.promotionActor.id]);
   if (decision === 'reject') await client.query("UPDATE promotion_orders SET status='rejected',reviewed_by=$2 WHERE id=$1", [order.id, req.promotionActor.id]);
   else await client.query(`UPDATE promotion_orders SET status='paid',reviewed_by=$2,paid_at=NOW(),
    starts_at=GREATEST(NOW(),COALESCE((SELECT MAX(expires_at) FROM promotion_orders WHERE provider_id=$3 AND status='paid'),NOW())),
    expires_at=GREATEST(NOW(),COALESCE((SELECT MAX(expires_at) FROM promotion_orders WHERE provider_id=$3 AND status='paid'),NOW())) + duration_days * INTERVAL '1 day'
    WHERE id=$1`, [order.id, req.promotionActor.id, order.provider_id]);
  });
  res.json({ ok: true });
 }));

 app.get('/api/promotion-media/:kind/:id', wrap(async (req, res) => {
  const role = req.query.role;
  if (!['admin', 'provider'].includes(role)) fail(403, 'Sign in to view this payment image.');
  const actor = role === 'admin' ? await admin(req) : await authenticateAccount(db, req, 'provider');
  let image;
  if (req.params.kind === 'settings' && role === 'admin') image = (await db.query('SELECT qr_content AS content,qr_mime AS mime_type FROM platform_payment_settings WHERE id=1')).rows[0];
  else if (req.params.kind === 'qr') image = (await db.query(`SELECT qr_content AS content,qr_mime AS mime_type FROM promotion_orders WHERE id=$1 ${role === 'provider' ? 'AND provider_id=$2' : ''}`, role === 'provider' ? [req.params.id, actor.id] : [req.params.id])).rows[0];
  else if (req.params.kind === 'receipt') image = (await db.query(`SELECT r.content,r.mime_type FROM promotion_receipts r JOIN promotion_orders o ON o.id=r.order_id WHERE r.id=$1 ${role === 'provider' ? 'AND o.provider_id=$2' : ''}`, role === 'provider' ? [req.params.id, actor.id] : [req.params.id])).rows[0];
  if (!image?.content) fail(404, 'Payment image not found.');
  res.set('X-Content-Type-Options', 'nosniff').type(image.mime_type).send(image.content);
 }));
}
module.exports = { registerPromotionRoutes, planInput };
