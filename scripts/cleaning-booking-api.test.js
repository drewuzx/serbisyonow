'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const pricing = require('../shared/js/cleaningPricing');

test('cleaning HTTP booking and provider settings use server-owned prices and capabilities', { timeout: 15000 }, async t => {
 const filename = path.join(__dirname, 'auth-server.js');
 const localRequire = createRequire(filename);
 const offered = { id: 71, provider_id: 81, title: 'Cleaning', category: 'Cleaning', is_active: true, laundry_pickup_delivery: false };
 let lastInsert;
 let insertCount = 0;
 const database = {
  async query(sql, params = []) {
   const query = sql.trim();
   let rows = [];
   if (query.startsWith('SELECT * FROM provider_services')) rows = [offered];
   else if (query.startsWith('SELECT id FROM provider_availability')) rows = [{ id: 91 }];
   else if (query.startsWith('INSERT INTO customer_bookings')) {
    insertCount += 1;
    lastInsert = { id: 101, customer_id: params[0], provider_id: params[1], service: params[2], scheduled_date: params[3], scheduled_time: params[4], address: params[5], amount: params[9], payment_method: params[10], service_details: JSON.parse(params[11]), pricing_type: params[12], estimated_min: params[13], estimated_max: params[14], status: 'pending' };
    rows = [lastInsert];
   } else if (query.startsWith('UPDATE provider_services') && query.includes('WHERE provider_id = $1 AND id = $2')) {
    if (params[11] !== null && params[11] !== undefined) offered.laundry_pickup_delivery = params[11];
    rows = [offered];
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
});
