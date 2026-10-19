'use strict';
const { authenticateAccount } = require('./account-sessions');
const { fail } = require('./booking-payments');

async function buildReport(db, days, sort, aliases) {
 const categoryNames=Object.fromEntries(Object.entries(aliases).flatMap(([key,value])=>[[key,value],[value.toLowerCase(),value]]));
 const client = await db.pool.connect();
 try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const period = (await client.query(`SELECT
   (date_trunc('day',NOW() AT TIME ZONE 'Asia/Manila') - ($1-1)*INTERVAL '1 day') AT TIME ZONE 'Asia/Manila' AS start,
   (date_trunc('day',NOW() AT TIME ZONE 'Asia/Manila') + INTERVAL '1 day') AT TIME ZONE 'Asia/Manila' AS finish,
   (date_trunc('day',NOW() AT TIME ZONE 'Asia/Manila') - ($1*2-1)*INTERVAL '1 day') AT TIME ZONE 'Asia/Manila' AS previous_start`,[days])).rows[0];
  const bounds = [period.start,period.finish,period.previous_start];
  const bookings = (await client.query(`SELECT
   COUNT(*) FILTER(WHERE created_at >= $1)::int AS total,
   COUNT(*) FILTER(WHERE created_at < $1)::int AS previous_total,
   COUNT(*) FILTER(WHERE created_at >= $1 AND status='completed')::int AS completed,
   COUNT(*) FILTER(WHERE created_at >= $1 AND status='cancelled')::int AS cancelled,
   COUNT(*) FILTER(WHERE created_at >= $1 AND status IN ('pending','upcoming','ongoing'))::int AS active
   FROM customer_bookings WHERE created_at >= $3 AND created_at < $2`,bounds)).rows[0];
  const revenue = (await client.query(`SELECT
   COALESCE(SUM(amount_centavos) FILTER(WHERE paid_at >= $1),0)::float AS total_centavos,
   COALESCE(SUM(amount_centavos) FILTER(WHERE paid_at < $1),0)::float AS previous_centavos,
   COUNT(*) FILTER(WHERE paid_at >= $1)::int AS payments
   FROM promotion_orders WHERE status='paid' AND paid_at >= $3 AND paid_at < $2`,bounds)).rows[0];
  const reviews = (await client.query(`SELECT COUNT(*)::int AS count,AVG(rating)::float AS average
   FROM customer_reviews WHERE created_at >= $1 AND created_at < $2`,bounds.slice(0,2))).rows[0];
  // Daily rows include zero-activity days; the UI can aggregate these without inventing data.
  const trend = (await client.query(`WITH dates AS (
    SELECT generate_series(($1::timestamptz AT TIME ZONE 'Asia/Manila')::date,
     ($2::timestamptz AT TIME ZONE 'Asia/Manila')::date-1,INTERVAL '1 day')::date AS day
   ), b AS (SELECT (created_at AT TIME ZONE 'Asia/Manila')::date AS day,COUNT(*)::int AS bookings,
    COUNT(*) FILTER(WHERE status='completed')::int AS completed FROM customer_bookings
    WHERE created_at >= $1 AND created_at < $2 GROUP BY 1),
   r AS (SELECT (paid_at AT TIME ZONE 'Asia/Manila')::date AS day,SUM(amount_centavos)::float AS revenue_centavos
    FROM promotion_orders WHERE status='paid' AND paid_at >= $1 AND paid_at < $2 GROUP BY 1)
   SELECT to_char(d.day,'YYYY-MM-DD') AS date,COALESCE(b.bookings,0) AS bookings,
    COALESCE(b.completed,0) AS completed,COALESCE(r.revenue_centavos,0) AS revenue_centavos
   FROM dates d LEFT JOIN b USING(day) LEFT JOIN r USING(day) ORDER BY d.day`,bounds.slice(0,2))).rows;
  const categories = (await client.query(`WITH names AS (
    SELECT COALESCE(NULLIF(trim(b.service_details->>'category'),''),s.category,NULLIF(trim(p.category),''),'Uncategorized') AS name
    FROM customer_bookings b LEFT JOIN providers p ON p.id=b.provider_id
    LEFT JOIN LATERAL (SELECT NULLIF(trim(category),'') AS category FROM provider_services
     WHERE provider_id=b.provider_id AND lower(trim(title))=lower(trim(b.service)) ORDER BY id LIMIT 1) s ON TRUE
    WHERE b.created_at >= $1 AND b.created_at < $2 AND b.status <> 'cancelled'
   ), normalized AS (SELECT lower(COALESCE($3::jsonb->>lower(name),name)) AS key,name FROM names)
   SELECT COALESCE($3::jsonb->>key,MIN(name)) AS name,COUNT(*)::int AS bookings
   FROM normalized GROUP BY key ORDER BY bookings DESC,name ASC`,
   [...bounds.slice(0,2),JSON.stringify(categoryNames)] )).rows;
  const providers = (await client.query(`WITH b AS (
    SELECT provider_id,COUNT(*)::int AS bookings,COUNT(*) FILTER(WHERE status='completed')::int AS completed
    FROM customer_bookings WHERE created_at >= $1 AND created_at < $2 AND status <> 'cancelled' GROUP BY provider_id
   ), r AS (SELECT provider_id,COUNT(*)::int AS reviews,AVG(rating)::float AS rating FROM customer_reviews
    WHERE created_at >= $1 AND created_at < $2 GROUP BY provider_id)
   SELECT p.id,p.full_name,COALESCE(b.bookings,0) AS bookings,COALESCE(b.completed,0) AS completed,
    COALESCE(r.reviews,0) AS reviews,r.rating FROM providers p LEFT JOIN b ON b.provider_id=p.id LEFT JOIN r ON r.provider_id=p.id
   WHERE ${sort === 'rating' ? 'r.reviews > 0' : 'b.bookings > 0'}
   ORDER BY ${sort === 'rating' ? 'r.rating DESC NULLS LAST,r.reviews DESC,b.bookings DESC NULLS LAST' : 'b.bookings DESC,r.rating DESC NULLS LAST,b.completed DESC'},p.id LIMIT 10`,bounds.slice(0,2))).rows;
  const plans = (await client.query(`SELECT plan_name,COUNT(*)::int AS payments,SUM(amount_centavos)::float AS revenue_centavos
   FROM promotion_orders WHERE status='paid' AND paid_at >= $1 AND paid_at < $2
   GROUP BY plan_name ORDER BY revenue_centavos DESC,plan_name`,bounds.slice(0,2))).rows;
  await client.query('COMMIT');
  return {days,sort,period,bookings,revenue,reviews,trend,categories,providers,plans};
 } catch(error) { await client.query('ROLLBACK'); throw error; }
 finally { client.release(); }
}

function registerAdminReports(app,db,aliases) {
 app.get('/api/admin/reports',(req,res,next)=>Promise.resolve().then(async()=>{
  await authenticateAccount(db,req,'admin');
  res.set('Cache-Control','private, no-store');
  if((req.query.days !== undefined && typeof req.query.days !== 'string') || (req.query.sort !== undefined && typeof req.query.sort !== 'string')) fail(400,'Choose a valid reporting period and ranking.');
  const days=Number(req.query.days || 30),sort=req.query.sort || 'bookings';
  if(![7,30,90,365].includes(days) || !['bookings','rating'].includes(sort)) fail(400,'Choose a valid reporting period and ranking.');
  res.json(await buildReport(db,days,sort,aliases));
 }).catch(next));
}
module.exports={registerAdminReports};
