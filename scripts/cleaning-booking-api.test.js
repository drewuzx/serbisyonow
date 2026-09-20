'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const pricing = require('../shared/js/cleaningPricing');
const personalPricing = require('../shared/js/personalCarePricing');

test('cleaning and personal care HTTP bookings validate prices, selections and provider settings', { timeout: 15000 }, async t => {
 const filename = path.join(__dirname, 'auth-server.js');
 const localRequire = createRequire(filename);
 const offered = { id: 71, provider_id: 81, title: 'Cleaning', category: 'Cleaning', is_active: true, laundry_pickup_delivery: false };
 const personalOffered = { id: 72, provider_id: 81, title: 'Personal Care', category: 'Personal Care', is_active: true, massage_types: [] };
 let lastInsert;
 let insertCount = 0;
 const database = {
  async query(sql, params = []) {
   const query = sql.trim();
   let rows = [];
   if (query.startsWith('SELECT * FROM provider_services')) rows = [offered, personalOffered];
   else if (query.startsWith('SELECT id FROM provider_availability')) rows = [{ id: 91 }];
   else if (query.startsWith('INSERT INTO customer_bookings')) {
    insertCount += 1;
    lastInsert = { id: 101, customer_id: params[0], provider_id: params[1], service: params[2], scheduled_date: params[3], scheduled_time: params[4], address: params[5], amount: params[9], payment_method: params[10], service_details: JSON.parse(params[11]), pricing_type: params[12], estimated_min: params[13], estimated_max: params[14], status: 'pending' };
    rows = [lastInsert];
   } else if (query.startsWith('UPDATE provider_services') && query.includes('WHERE provider_id = $1 AND id = $2')) {
    const service = [offered, personalOffered].find(item => item.id === Number(params[1]));
    if (params[11] !== null && params[11] !== undefined) service.laundry_pickup_delivery = params[11];
    if (params[12] !== null && params[12] !== undefined) service.massage_types = params[12];
    rows = [service];
   }
   return { rows, rowCount: rows.length };
  },
 };
 let resolveServer;
 let rejectServer;
 const ready = new Promise((resolve, reject) => { resolveServer = resolve; rejectServer = reject; });
 const expressFactory = Object.assign(() => {
  const app = express();
  const listen = app.listen.bind(app);
  app.listen = () => {
   const server = listen(0, '127.0.0.1', () => resolveServer(server));
   server.on('error', rejectServer);
   return server;
  };
  return app;
 }, express);
 // Run the real routes with an isolated database adapter; no test accounts or bookings reach PostgreSQL.
 vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  __dirname, __filename: filename, Buffer, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval,
  process: { env: { PORT: '0' } },
  console: { log() {}, error(error) { if (typeof error === 'string') rejectServer(new Error(error)); } },
  require(name) {
   if (name === './db') return database;
   if (name === 'express') return expressFactory;
   if (name === 'dotenv') return { config() {} };
   if (name === 'fs') return { ...fs, mkdirSync() {}, readdirSync: () => [] };
   return localRequire(name);
  },
 }, { filename });
 const server = await ready;
 t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
 const base = `http://127.0.0.1:${server.address().port}`;
 async function request(route, body, method = 'POST') {
  const response = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
 }
 const body = {
  provider_id: 81, provider_service_id: 71, service: 'Bathroom cleaning', scheduled_date: '2026-10-01', scheduled_time: '09:00 AM', address: 'Test address',
  amount: 1, estimated_min: 1, estimated_max: 1, pricing_type: 'free',
  service_details: { inputs: { ...pricing.defaults('bathroom cleaning'), bathrooms: 2, size: 'Large', cleaning_level: 'Deep cleaning' }, sample_rates: false },
 };
 const result = await request('/api/customer/61/bookings', body);
 assert.equal(result.status, 201);
 assert.equal(result.data.booking.amount, 1600);
 assert.equal(lastInsert.service, 'Bathroom Cleaning');
 assert.equal(lastInsert.pricing_type, 'calculated');
 assert.equal(lastInsert.service_details.sample_rates, true);
 assert.equal(lastInsert.service_details.answers['Number of bathrooms'], '2');
 assert.equal(lastInsert.service_details.breakdown.length, 2);
 for (const invalid of [
  { ...body, service_details: {} },
  { ...body, provider_service_id: 999 },
  { ...body, service_details: { inputs: { ...body.service_details.inputs, bathrooms: -5 } } },
 ]) {
  assert.equal((await request('/api/customer/61/bookings', invalid)).status, 400);
 }
 assert.equal(insertCount, 1);
 const laundry = { ...body, service: 'Laundry Services', service_details: { inputs: { ...pricing.defaults('laundry services'), fulfillment: 'Pickup + delivery' } } };
 assert.equal((await request('/api/customer/61/bookings', laundry)).status, 400);
 assert.equal((await request('/api/provider/81/services/71', { laundry_pickup_delivery: 'false' }, 'PATCH')).status, 400);
 const settings = await request('/api/provider/81/services/71', { laundry_pickup_delivery: true }, 'PATCH');
 assert.equal(settings.status, 200);
 assert.equal(settings.data.service.laundry_pickup_delivery, true);
 const delivery = await request('/api/customer/61/bookings', laundry);
 assert.equal(delivery.status, 201);
 assert.equal(delivery.data.booking.amount, 235);
 assert.equal(lastInsert.service_details.answers['Pickup / delivery'], 'Pickup + delivery');

 const defaultPrices = { 'massage therapy': 300, 'home spa services': 450, haircut: 150, 'nail care': 150, 'eyelash care': 800, grooming: 150 };
 for (const [service, amount] of Object.entries(defaultPrices)) {
  const result = await request('/api/customer/61/bookings', { ...body, provider_service_id: 72, service,
   service_details: { inputs: personalPricing.defaults(service), sample_rates: false, answers: { Fake: 'Do not save' }, breakdown: [{ amount: 1 }] } });
  assert.equal(result.status, 201, service);
  assert.equal(result.data.booking.amount, amount, service);
  assert.equal(lastInsert.service_details.category, 'Personal Care');
  assert.equal(lastInsert.service_details.sample_rates, true);
  assert.equal(lastInsert.service_details.answers.Fake, undefined);
 }
 const customMassage = { ...body, provider_service_id: 72, service: 'Massage Therapy', service_details: { inputs: {
  massage_type: 'Other provider-offered type', other_massage_type: 'Foot massage', duration: '60 min',
 }, massage_types: ['Foot massage'] } };
 assert.equal((await request('/api/customer/61/bookings', customMassage)).status, 400);
 const customSettings = await request('/api/provider/81/services/72', { massage_types: ['Foot massage'] }, 'PATCH');
 assert.equal(customSettings.status, 200);
 assert.deepEqual(customSettings.data.service.massage_types, ['Foot massage']);
 const customResult = await request('/api/customer/61/bookings', customMassage);
 assert.equal(customResult.status, 201);
 assert.equal(customResult.data.booking.amount, 500);
 assert.equal(lastInsert.service_details.answers['Other provider-offered type'], 'Foot massage');
 assert.equal((await request('/api/customer/61/bookings', { ...customMassage, provider_service_id: 71 })).status, 400);
 assert.equal((await request('/api/customer/61/bookings', { ...customMassage, service_details: {} })).status, 400);
 assert.equal((await request('/api/provider/81/services/72', { massage_types: 'Foot massage' }, 'PATCH')).status, 400);
 const cleared = await request('/api/provider/81/services/72', { massage_types: [] }, 'PATCH');
 assert.equal(cleared.status, 200);
 assert.deepEqual(cleared.data.service.massage_types, []);
 assert.equal((await request('/api/customer/61/bookings', customMassage)).status, 400);
});
