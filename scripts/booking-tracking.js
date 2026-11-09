'use strict';
const crypto = require('node:crypto');
const { authenticateAccount } = require('./account-sessions');
const { transaction, fail } = require('./booking-payments');
const eligible = booking => ['upcoming', 'ongoing'].includes(booking.status) && !booking.provider_closed;
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

async function clearBookingTracking(db, bookingId) {
 await db.query('UPDATE booking_live_locations SET active=FALSE,latitude=NULL,longitude=NULL,accuracy_m=NULL,observed_at=NULL WHERE booking_id=$1', [bookingId]);
}

function registerBookingTracking(app, db, wrap, bookingView) {
 const providerRoute = '/api/provider/:id/bookings/:bookingId/tracking';
 app.post(providerRoute, wrap(async (req, res) => {
  await authenticateAccount(db, req, 'provider', req.params.id);
  const result = await transaction(db, async client => {
   await client.query('SELECT id FROM providers WHERE id=$1 FOR UPDATE', [req.params.id]);
   const { rows:[booking] } = await client.query('SELECT * FROM customer_bookings WHERE id=$1 AND provider_id=$2 FOR UPDATE', [req.params.bookingId,req.params.id]);
   if (!booking) fail(404,'Booking not found.');
   if (!eligible(booking)) fail(409,'Live tracking is available only for accepted or ongoing bookings.');
   await client.query('UPDATE booking_live_locations SET active=FALSE,latitude=NULL,longitude=NULL,accuracy_m=NULL,observed_at=NULL WHERE provider_id=$1', [req.params.id]);
   const session = crypto.randomUUID();
   await client.query(`INSERT INTO booking_live_locations(booking_id,provider_id,session_id) VALUES($1,$2,$3)
    ON CONFLICT(booking_id) DO UPDATE SET session_id=$3,active=TRUE,latitude=NULL,longitude=NULL,accuracy_m=NULL,observed_at=NULL,updated_at=NULL,sequence=0`, [booking.id,req.params.id,session]);
   return { session_id:session };
  });
  res.set('Cache-Control','no-store').json(result);
 }));
 app.patch(providerRoute, wrap(async (req,res) => {
  await authenticateAccount(db,req,'provider',req.params.id);
  const p=req.body, observed=Date.parse(p.observed_at);
  if (!number(p.latitude,-90,90) || !number(p.longitude,-180,180) || !number(p.accuracy,0,99999999.99)
   || !Number.isInteger(p.sequence) || p.sequence<1 || p.sequence>2147483647 || !Number.isFinite(observed)
   || observed<Date.now()-30000 || observed>Date.now()+60000) fail(400,'A fresh valid GPS reading is required.');
  await transaction(db,async client=>{
   const {rows:[booking]}=await client.query('SELECT * FROM customer_bookings WHERE id=$1 AND provider_id=$2 FOR UPDATE',[req.params.bookingId,req.params.id]);
   if (!booking) fail(404,'Booking not found.');
   if (!eligible(booking)) fail(409,'Tracking has ended for this booking.');
   const r=await client.query(`UPDATE booking_live_locations SET latitude=$4,longitude=$5,accuracy_m=$6,observed_at=$7,updated_at=NOW(),sequence=$8
    WHERE booking_id=$1 AND provider_id=$2 AND session_id=$3 AND active=TRUE AND sequence<$8 RETURNING booking_id`,
   [req.params.bookingId,req.params.id,p.session_id,p.latitude,p.longitude,p.accuracy,new Date(observed),p.sequence]);
   if (!r.rowCount) fail(409,'Tracking session has ended or this GPS update is outdated.');
  });
  res.set('Cache-Control','no-store').json({ok:true});
 }));
 app.post(providerRoute+'/stop',wrap(async(req,res)=>{
  await authenticateAccount(db,req,'provider',req.params.id);
  await db.query(`UPDATE booking_live_locations SET active=FALSE,latitude=NULL,longitude=NULL,accuracy_m=NULL,observed_at=NULL
   WHERE booking_id=$1 AND provider_id=$2 AND session_id=$3`,[req.params.bookingId,req.params.id,req.body.session_id]);
  res.json({ok:true});
 }));
 app.get('/api/customer/:id/bookings/:bookingId/track',wrap(async(req,res)=>{
  await authenticateAccount(db,req,'customer',req.params.id);
  const {rows:[row]}=await db.query(`SELECT b.*,p.full_name AS provider_name,p.category AS provider_category,
   l.active AS tracking_active,l.latitude AS live_lat,l.longitude AS live_lng,l.accuracy_m AS live_accuracy,
   l.updated_at AS live_updated_at,
   (l.updated_at>NOW()-INTERVAL '30 seconds' AND l.observed_at>NOW()-INTERVAL '30 seconds') AS location_fresh
   FROM customer_bookings b LEFT JOIN providers p ON p.id=b.provider_id
   LEFT JOIN booking_live_locations l ON l.booking_id=b.id
   WHERE b.id=$1 AND b.customer_id=$2`,[req.params.bookingId,req.params.id]);
  if (!row) fail(404,'Booking not found.');
  const enabled=eligible(row), live=enabled && row.tracking_active && row.location_fresh && row.live_lat!=null && row.live_lng!=null;
  const state=!enabled?'ended':!row.tracking_active?'not-sharing':live?'live':row.live_updated_at?'stale':'waiting';
  const messages={ended:'Live tracking is not active for this booking.', 'not-sharing':'Provider is not sharing live location.',live:'Provider location is live.',stale:'Location updates delayed. Waiting for the provider to reconnect.',waiting:'Provider is on the way. Waiting for a fresh GPS location.'};
  res.set('Cache-Control','no-store').json({booking:bookingView(row),tracking_enabled:enabled,tracking_state:state,
   customer_pin:row.latitude!=null && row.longitude!=null?{lat:Number(row.latitude),lng:Number(row.longitude),address:row.address}:null,
   provider_location:live?{lat:Number(row.live_lat),lng:Number(row.live_lng),accuracy_m:Number(row.live_accuracy),updated_at:row.live_updated_at,name:row.provider_name}:null,
   last_updated_at:enabled && row.tracking_active?row.live_updated_at:null,message:messages[state]});
 }));
}
module.exports={registerBookingTracking,clearBookingTracking};
