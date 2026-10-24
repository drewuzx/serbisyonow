'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPayMongo } = require('./paymongo');
const { startQrFixture } = require('./provider-qr-test-fixture');
const { issueSession } = require('./account-sessions');

async function fixture(livemode = true) {
 const sessions = new Map();
 let calls = 0, failCreate = false;
 const env = { PAYMONGO_SECRET_KEY:`sk_${livemode ? 'live' : 'test'}_fixture`,PAYMONGO_WEBHOOK_SECRET:'wh_fixture',PAYMONGO_LIVE_PAYMENTS_ENABLED:'true' };
 const gateway = createPayMongo({ env, fetcher:async (url, options) => {
  if (url.endsWith('/v2/checkout_sessions')) {
   calls++;
   if (failCreate) throw new Error('Simulated ambiguous gateway timeout');
   const attributes = JSON.parse(options.body).data.attributes;
   assert.deepEqual(attributes.payment_method_types,['qrph']);
   const id = `cs_promo${calls}`;
   const session = { id,attributes:{ ...attributes,livemode,status:'active',checkout_url:`https://checkout.paymongo.com/${id}`,payments:[] } };
   sessions.set(id,session);
   return { ok:true,json:async () => ({data:session}) };
  }
  const id = url.split('/')[5];
  const session = sessions.get(id);
  assert.ok(session, url);
  if (url.endsWith('/expire')) {
   if (session.attributes.payments.length) return { ok:false,json:async () => ({}) };
   session.attributes.status = 'expired';
  }
  return { ok:true,json:async () => ({data:session}) };
 } });
 const f = await startQrFixture({gateway,promotionChannel:'paymongo',returnBase:'https://fixture.invalid'});
 const admin = (await f.db.query("INSERT INTO admins(username,password_hash) VALUES('gateway-admin','fixture') RETURNING id")).rows[0];
 const adminToken = await issueSession(f.db,'admin',admin.id);
 const adminRequest = (path='',method='GET',body) => f.request('/api/admin/promotions'+path,method,body,adminToken);
 const providerRequest = (path='',method='GET',body,token=f.providerToken) => f.request('/api/provider/81/promotions'+path,method,body,token);
 const plan = (await adminRequest('/plans','POST',{name:'QR Ph Boost',description:'Test',kind:'promotion',duration_days:14,price:'199',enabled:true})).data.plan;
 const create = async () => {
  const result = await providerRequest('/orders','POST',{plan_id:plan.id,revision:plan.updated_at,request_id:crypto.randomUUID(),accept_terms:true});
  assert.equal(result.status,201,JSON.stringify(result.data)); return result.data.id;
 };
 const pay = (id, amount=19900) => {
  const session = [...sessions.values()].find(s => s.attributes.metadata.promotion_order_id === String(id));
  session.attributes.payments = [{id:`pay_order${id}`,attributes:{status:'paid',amount,currency:'PHP',livemode}}];
  return session;
 };
 const webhook = async (session, bad = false) => {
  const raw = JSON.stringify({data:{type:'event',attributes:{type:'checkout_session.payment.paid',livemode,data:session}}});
  const timestamp = Math.floor(Date.now()/1000);
  const signature = crypto.createHmac('sha256',env.PAYMONGO_WEBHOOK_SECRET).update(`${timestamp}.${raw}`).digest('hex');
  const result = await fetch(f.base+'/api/payments/paymongo/webhook',{method:'POST',headers:{'Content-Type':'application/json','paymongo-signature':`t=${timestamp},${livemode ? 'li' : 'te'}=${bad ? '0'.repeat(64) : signature}`},body:raw});
  return {status:result.status,data:await result.json()};
 };
 return { ...f,gateway,adminRequest,providerRequest,create,pay,webhook,sessions,get calls(){return calls;},breakCreate(){failCreate=true;} };
}

test('QR Ph checkout activates automatically once, remains authorized, and recovers delayed webhooks', async () => {
 const f = await fixture();
 try {
  const id = await f.create();
  const route = `/orders/${id}`;
  assert.equal((await f.providerRequest(route+'/checkout','POST',undefined,f.otherProviderToken)).status,403);
  const [first,second] = await Promise.all([f.providerRequest(route+'/checkout','POST'),f.providerRequest(route+'/checkout','POST')]);
  assert.ok([first,second].some(r=>r.status===200)); assert.equal(f.calls,1);
  const retry = await f.providerRequest(route+'/checkout','POST'); assert.equal(retry.status,200); assert.equal(f.calls,1);
  assert.equal((await f.providerRequest(route+'/receipt','POST',f.receiptForm(1))).status,409);
  assert.equal((await f.adminRequest(route+'/review','PATCH',{decision:'verify',payment_received:true})).status,409);
  let order = (await f.providerRequest()).data.orders[0]; assert.equal(order.status,'awaiting_payment');
  const paid = f.pay(id);
  assert.equal((await f.webhook(paid,true)).status,401);
  const wrongReference = structuredClone(paid); wrongReference.attributes.reference_number='wrong';
  assert.equal((await f.webhook(wrongReference)).status,400);
  const results = await Promise.all([f.webhook(paid),f.webhook(paid)]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);
  order = (await f.providerRequest()).data.orders[0]; assert.equal(order.display_status,'active');
  assert.equal((new Date(order.expires_at)-new Date(order.starts_at))/86400000,14);
  assert.equal(Number((await f.adminRequest()).data.metrics.revenue_centavos),19900);
  assert.equal((await f.providerRequest(route+'/cancel','PATCH')).status,409);
  const next = await f.create();
  await f.providerRequest(`/orders/${next}/checkout`,'POST'); f.pay(next);
  assert.equal((await f.providerRequest(`/orders/${next}/payment-status`,'POST')).status,200);
  const scheduled = (await f.providerRequest()).data.orders.find(o=>o.id===next);
  assert.equal(scheduled.display_status,'scheduled'); assert.equal(scheduled.starts_at,order.expires_at);
  assert.equal(Number((await f.adminRequest()).data.metrics.revenue_centavos),39800);
  const cancelled = await f.create(); await f.providerRequest(`/orders/${cancelled}/checkout`,'POST');
  assert.equal((await f.providerRequest(`/orders/${cancelled}/cancel`,'PATCH')).status,200);
  assert.equal((await f.providerRequest()).data.orders.find(o=>o.id===cancelled).status,'cancelled');
  assert.equal((await f.webhook(f.pay(cancelled))).status,200);
  assert.equal((await f.providerRequest()).data.orders.find(o=>o.id===cancelled).status,'refund_review');
  assert.equal(Number((await f.adminRequest()).data.metrics.revenue_centavos),39800);
 } finally { await f.close(); }
});

test('test QR Ph payments never activate real boosts or inflate revenue', async () => {
 const f = await fixture(false);
 try {
  const id = await f.create(); await f.providerRequest(`/orders/${id}/checkout`,'POST');
  assert.equal((await f.webhook(f.pay(id))).status,200);
  const state = (await f.providerRequest()).data;
  assert.equal(state.orders[0].status,'test_paid'); assert.equal(state.current_boost,null);
  assert.equal(Number((await f.adminRequest()).data.metrics.revenue_centavos),0);
 } finally { await f.close(); }
});

test('incorrect amounts and unverified providers require review; uncertain creation cannot duplicate checkout', async () => {
 const f = await fixture();
 try {
  const id = await f.create(); await f.providerRequest(`/orders/${id}/checkout`,'POST');
  assert.equal((await f.webhook(f.pay(id,100))).status,200);
  assert.equal((await f.providerRequest()).data.orders[0].status,'refund_review');
  const unverified = await f.create(); await f.providerRequest(`/orders/${unverified}/checkout`,'POST');
  await f.db.query('UPDATE providers SET is_verified=FALSE WHERE id=81');
  assert.equal((await f.webhook(f.pay(unverified))).status,200);
  assert.equal((await f.providerRequest()).data.orders[0].status,'refund_review');
  await f.db.query('UPDATE providers SET is_verified=TRUE WHERE id=81');
  const ambiguous = await f.create(); f.breakCreate();
  const calls = f.calls;
  assert.equal((await f.providerRequest(`/orders/${ambiguous}/checkout`,'POST')).status,502);
  assert.equal((await f.providerRequest(`/orders/${ambiguous}/checkout`,'POST')).status,409);
  assert.equal((await f.providerRequest(`/orders/${ambiguous}/cancel`,'PATCH')).status,409);
  assert.equal(f.calls,calls+1);
  assert.equal(Number((await f.adminRequest()).data.metrics.revenue_centavos),0);
 } finally { await f.close(); }
});
