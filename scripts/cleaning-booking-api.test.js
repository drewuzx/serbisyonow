'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const multer = require('multer');
const pricing = require('../shared/js/cleaningPricing');
const personalPricing = require('../shared/js/personalCarePricing');
const appliancePricing = require('../shared/js/appliancePricing');
const installationPricing = require('../shared/js/installationPricing');
const outdoorPricing = require('../shared/js/outdoorPricing');

test('category HTTP bookings validate prices, selections and provider settings', { timeout: 15000 }, async t => {
 const filename = path.join(__dirname, 'auth-server.js');
 const localRequire = createRequire(filename);
 const offered = { id: 71, provider_id: 81, title: 'Cleaning', category: 'Cleaning', is_active: true, laundry_pickup_delivery: false };
 const personalOffered = { id: 72, provider_id: 81, title: 'Personal Care', category: 'Personal Care', is_active: true, massage_types: [] };
 const applianceOffered = { id: 73, provider_id: 81, title: 'Appliance Maintenance', category: 'Appliance Maintenance', is_active: true };
 const combinedOffered = { id: 74, provider_id: 81, title: 'TV / Electronics', category: 'Appliance Maintenance', is_active: true };
 const installationOffered = { id: 75, provider_id: 81, title: 'Installation Services', category: 'Installation Services', is_active: true };
 const assemblyOffered = { id: 76, provider_id: 81, title: 'Furniture assembly', category: 'Installation Services', is_active: true };
 const outdoorOffered = { id: 77, provider_id: 81, title: 'Outdoor and Property Maintenance', category: 'Outdoor and Property Maintenance', is_active: true };
 const lawnOffered = { id: 78, provider_id: 81, title: 'Lawn mowing', category: 'Outdoor and Property Maintenance', is_active: true };
 let lastInsert;
 let insertCount = 0;
 const uploads = new Map();
 const persistedUploads = [];
 let uploadCount = 0;
 const memory = multer.memoryStorage();
 const testStorage = {
  _handleFile(req, file, cb) {
   memory._handleFile(req, file, (error, result) => {
    if (error) return cb(error);
    const filename = `test-${++uploadCount}-${file.originalname}`;
    uploads.set(filename, result.buffer);
    cb(null, { ...result, filename, path: filename });
   });
  },
  _removeFile(_req, file, cb) { uploads.delete(file.filename); cb(null); },
 };
 const database = {
  async query(sql, params = []) {
   const query = sql.trim();
   let rows = [];
   if (query.startsWith('SELECT account_role')) rows = [{ account_role: 'customer', account_id: 61 }];
   else if (query.startsWith('UPDATE account_sessions')) rows = [{ account_id: 61 }];
   else if (query.startsWith('SELECT * FROM provider_services')) rows = [offered, personalOffered, applianceOffered, combinedOffered, installationOffered, assemblyOffered, outdoorOffered, lawnOffered];
   else if (query.startsWith('INSERT INTO uploaded_files')) persistedUploads.push(params);
   else if (query.startsWith('SELECT id FROM provider_availability')) {
    assert.match(query, /FOR UPDATE/);
    assert.match(query, /NOT EXISTS/);
    rows = [{ id: 91 }];
   }
   else if (query.startsWith('INSERT INTO customer_bookings')) {
    assert.match(query, /'pending', TRUE, 'awaiting_price'/);
    insertCount += 1;
    lastInsert = { id: 101, customer_id: params[0], provider_id: params[1], service: params[2], scheduled_date: params[3], scheduled_time: params[4], address: params[5], amount: params[9], payment_method: params[10], service_details: JSON.parse(params[11]), pricing_type: params[12], estimated_min: params[13], estimated_max: params[14], status: 'pending' };
    Object.assign(lastInsert, { deposit_required: true, deposit_status: 'awaiting_price', price_version: 0 });
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
 database.pool = { async connect() { return { query: database.query, release() {} }; } };
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
   if (name === 'multer') return Object.assign(options => multer({ ...options, storage: testStorage }), multer);
   if (name === 'fs') return { ...fs, mkdirSync() {}, readdirSync: () => [], promises: { ...fs.promises, readdir: async () => [], readFile: async name => uploads.get(name) } };
   return localRequire(name);
  },
 }, { filename });
 const server = await ready;
 t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
 const base = `http://127.0.0.1:${server.address().port}`;
 async function request(route, body, method = 'POST') {
  const multipart = body instanceof FormData;
  const response = await fetch(`${base}${route}`, { method, headers: { ...(!multipart ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${'a'.repeat(64)}` }, body: multipart ? body : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
 }
 const body = {
  provider_id: 81, provider_service_id: 71, service: 'Bathroom cleaning', scheduled_date: '2026-10-01', scheduled_time: '09:00 AM', address: 'Test address',
  amount: 1, estimated_min: 1, estimated_max: 1, pricing_type: 'free',
  service_details: { inputs: { ...pricing.defaults('bathroom cleaning'), bathrooms: 2, size: 'Large', cleaning_level: 'Deep cleaning' }, sample_rates: false },
 };
 const result = await request('/api/customer/61/bookings', body);
 assert.equal(result.status, 201);
 assert.equal(result.data.booking.deposit_required, true);
 assert.equal(result.data.booking.deposit_status, 'awaiting_price');
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
 for (const [key, config] of Object.entries(appliancePricing.configs)) {
  const inputs = { ...appliancePricing.defaults(key), brand: 'Test brand', problem: 'Test symptom', ...(key === 'electronics' || key === 'small appliances' ? { appliance_type: 'Test appliance' } : {}) };
  const result = await request('/api/customer/61/bookings', { ...body, service: config.title, provider_service_id: 73,
   amount: 1, estimated_min: 1, estimated_max: 1, pricing_type: 'free',
   service_details: { inputs, sample_rates: false, answers: { Fake: 'Do not save' }, media_files: [{ url: '/fake-upload' }] } });
  assert.equal(result.status, 201, key);
  assert.equal(lastInsert.amount, appliancePricing.assessment(key, inputs).amount);
  assert.equal(lastInsert.pricing_type, config.pricingType);
  assert.equal(lastInsert.service_details.category, 'Appliance Maintenance');
  assert.equal(lastInsert.service_details.answers.Fake, undefined);
  assert.deepEqual(lastInsert.service_details.media_files, []);
  assert.equal(lastInsert.service_details.sample_rates, true);
 }
 const aircon = { ...body, service: 'Aircon', provider_service_id: 73, service_details: { inputs: { unit_type: 'Split-type', units: 2, service: 'Deep cleaning' } } };
 assert.equal((await request('/api/customer/61/bookings', aircon)).data.booking.amount, 2000);
 for (const invalid of [
  { ...aircon, service_details: {} },
  { ...aircon, provider_service_id: 72 },
  { ...aircon, service_details: { inputs: { ...aircon.service_details.inputs, units: -5 } } },
  { ...aircon, service: 'Appliance Maintenance' },
  { ...aircon, service: 'TV / Electronics', provider_service_id: 74 },
 ]) assert.equal((await request('/api/customer/61/bookings', invalid)).status, 400);
 const tv = { ...aircon, service: 'TV', provider_service_id: 74, service_details: { inputs: { ...appliancePricing.defaults('tv'), brand: 'Test brand', problem: 'Screen does not light up' } } };
 assert.equal((await request('/api/customer/61/bookings', tv)).status, 201);
 assert.equal((await request('/api/customer/61/bookings', { ...tv, provider_service_id: undefined })).status, 201, 'provider offering auto-selection supports the existing combined title');
 assert.equal((await request('/api/customer/61/bookings', { ...aircon, provider_service_id: 74 })).status, 400);
 function uploadForm(files, booking = tv) {
  const form = new FormData();
  Object.entries(booking).forEach(([key, value]) => form.append(key, key === 'service_details' ? JSON.stringify(value) : String(value)));
  files.forEach(file => form.append('assessmentMedia', file.blob, file.name));
  return form;
 }
 const photo = { name: 'appliance.png', blob: new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1hYAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }) };
 const video = { name: 'symptom.mp4', blob: new Blob(['test video transport'], { type: 'video/mp4' }) };
 const uploaded = await request('/api/customer/61/bookings', uploadForm([photo, video]));
 assert.equal(uploaded.status, 201);
 assert.equal(uploaded.data.booking.service_details.media_files.length, 2);
 assert.match(uploaded.data.booking.service_details.media_files[0].url, /^\/uploads\/booking-media\/test-/);
 assert.equal(uploaded.data.booking.service_details.media_files[1].name, 'symptom.mp4');
 assert.equal(persistedUploads.length, 2, 'media content is saved in persistent storage');
 assert.equal(persistedUploads[0][0], 'booking-media');
 assert.equal(persistedUploads[0][6], 'booking');
 assert.equal(persistedUploads[0][7], 101);
 assert.ok(Buffer.isBuffer(persistedUploads[0][5]));
 const invalidFile = { name: 'notes.txt', blob: new Blob(['not a photo'], { type: 'text/plain' }) };
 assert.equal((await request('/api/customer/61/bookings', uploadForm([invalidFile]))).status, 400);
 assert.equal((await request('/api/customer/61/bookings', uploadForm([photo, photo, photo, photo]))).status, 400);
 const oversized = { name: 'too-large.png', blob: new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)], { type: 'image/png' }) };
 assert.equal((await request('/api/customer/61/bookings', uploadForm([oversized]))).status, 400);
 for (const [key, config] of Object.entries(installationPricing.configs)) {
  const inputs = { ...installationPricing.defaults(key), brand: 'Test brand', dimensions: '80 x 120 x 40 cm' };
  const expected = installationPricing.assessment(key, inputs);
  const result = await request('/api/customer/61/bookings', { ...body, provider_service_id: 75, service: config.title,
   amount: 1, pricing_type: 'free', estimated_min: 1, estimated_max: 1,
   service_details: { inputs, sample_rates: false, answers: { Fake: 'Do not save' }, breakdown: [{ amount: 1 }] } });
  assert.equal(result.status, 201, key);
  assert.equal(lastInsert.amount, expected.amount);
  assert.equal(lastInsert.estimated_max, expected.estimatedMax);
  assert.equal(lastInsert.pricing_type, expected.pricingType);
  assert.equal(lastInsert.service_details.category, 'Installation Services');
  assert.equal(lastInsert.service_details.sample_rates, true);
  assert.equal(lastInsert.service_details.answers.Fake, undefined);
 }
 const assembly = { ...body, service: 'Furniture assembly', provider_service_id: 76,
  service_details: { inputs: { ...installationPricing.defaults('furniture installation'), units: 2, product_url: 'https://example.com/furniture' } } };
 assert.equal((await request('/api/customer/61/bookings', assembly)).data.booking.amount, 500);
 assert.equal(lastInsert.service_details.product_url, 'https://example.com/furniture');
 for (const invalid of [
  { ...assembly, service_details: {} }, { ...assembly, provider_service_id: 73 },
  { ...assembly, service: 'Installation Services' },
  { ...assembly, service_details: { inputs: { ...assembly.service_details.inputs, product_url: 'javascript:alert(1)' } } },
 ]) assert.equal((await request('/api/customer/61/bookings', invalid)).status, 400);
 const furnitureUpload = await request('/api/customer/61/bookings', uploadForm([photo], assembly));
 assert.equal(furnitureUpload.status, 201);
 assert.equal(furnitureUpload.data.booking.service_details.media_files[0].name, 'appliance.png');
 assert.equal(furnitureUpload.data.booking.service_details.answers['Number of units'], '2');
 assert.equal(persistedUploads.length, 3);
 for (const [key, config] of Object.entries(outdoorPricing.configs)) {
  const inputs = { ...outdoorPricing.defaults(key), ...(config.perVisit ? { frequency: 'Weekly' } : {}) };
  const expected = outdoorPricing.assessment(key, inputs);
  const result = await request('/api/customer/61/bookings', { ...body, provider_service_id: 77, service: config.title,
   amount: 1, pricing_type: 'free', estimated_min: 1, estimated_max: 1,
   service_details: { inputs, sample_rates: false, answers: { Fake: 'Do not save' }, note: 'Fake note', media_files: [{ url: '/fake-upload' }] } });
  assert.equal(result.status, 201, key);
  assert.equal(lastInsert.amount, expected.amount);
  assert.equal(lastInsert.estimated_max, expected.estimatedMax);
  assert.equal(lastInsert.pricing_type, expected.pricingType);
  assert.equal(lastInsert.service_details.category, 'Outdoor and Property Maintenance');
  assert.equal(lastInsert.service_details.pricing_basis, config.perVisit ? 'per_visit' : 'per_job');
  assert.equal(lastInsert.service_details.sample_rates, true);
  assert.equal(lastInsert.service_details.answers.Fake, undefined);
  assert.deepEqual(lastInsert.service_details.media_files, []);
 }
 const lawn = { ...body, service: 'Lawn mowing', provider_service_id: 78,
  service_details: { inputs: { ...outdoorPricing.defaults('lawn mowing'), lawn_size: 'Custom m2', area_m2: 80, grass_height: 'Tall (over 30 cm)', cleanup: 'Bag grass clippings' } } };
 assert.equal((await request('/api/customer/61/bookings', lawn)).data.booking.amount, 1304);
 assert.equal((await request('/api/customer/61/bookings', { ...lawn, provider_service_id: undefined })).status, 201);
 const beforeInvalid = insertCount;
 for (const invalid of [
  { ...lawn, service_details: {} }, { ...lawn, provider_service_id: 75 },
  { ...lawn, service: 'Tree Trimming' }, { ...lawn, service: 'Outdoor & Property Maintenance' },
  { ...lawn, service_details: { inputs: { ...lawn.service_details.inputs, area_m2: -5 } } },
 ]) assert.equal((await request('/api/customer/61/bookings', invalid)).status, 400);
 assert.equal(insertCount, beforeInvalid);
 const tree = { ...body, service: 'Tree Trimming', provider_service_id: 77,
  service_details: { inputs: { ...outdoorPricing.defaults('tree trimming'), trees: 2, tree_type: 'Mango', near_power_lines: 'Yes' }, requires_safety_assessment: false, safety_note: 'No assessment needed' } };
 const treeUpload = await request('/api/customer/61/bookings', uploadForm([{ ...photo, name: 'tree.png' }], tree));
 assert.equal(treeUpload.status, 201);
 assert.equal(treeUpload.data.booking.service_details.answers['Tree type (if known)'], 'Mango');
 assert.equal(treeUpload.data.booking.service_details.answers['Near power lines?'], 'Yes');
 assert.equal(treeUpload.data.booking.service_details.requires_safety_assessment, true);
 assert.equal(treeUpload.data.booking.service_details.safety_note, outdoorPricing.SAFETY_NOTE);
 assert.equal(treeUpload.data.booking.service_details.media_files[0].name, 'tree.png');
 assert.equal(persistedUploads.length, 4);
});
