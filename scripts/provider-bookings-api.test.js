'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');

test('provider booking HTTP workflow, GPS serialization and transaction rollback', { timeout: 15000 }, async t => {
 const filename = path.join(__dirname, 'auth-server.js');
 const localRequire = createRequire(filename);
 let bookings = Array.from({ length: 5 }, (_, index) => ({
  id: index + 1, provider_id: 81, customer_id: 61, service: 'General House Cleaning',
  status: 'pending', provider_closed: false, scheduled_date: '2026-10-01', scheduled_time: '09:00 AM',
  address: 'Test address, Angeles City', latitude: null, longitude: null,
 }));
 Object.assign(bookings[0], { latitude: '15.1443', longitude: '120.5894' });
 let available = false;
 let snapshot;
 let failAvailability = false;
 let writes = 0;
 let releases = 0;
 const database = {
  async query(sql, params = []) {
   const query = sql.trim().replace(/\s+/g, ' ');
   let rows = [];
   const booking = bookings.find(row => row.provider_id === Number(params[0]) && row.id === Number(params[1]));
   if (query === 'BEGIN') snapshot = { bookings: structuredClone(bookings), available };
   else if (query === 'ROLLBACK') { bookings = snapshot.bookings; available = snapshot.available; }
   else if (query.startsWith('SELECT * FROM customer_bookings')) rows = booking ? [booking] : [];
   else if (query.startsWith('UPDATE customer_bookings SET status')) {
    booking.status = params[2];
    writes++;
    rows = [booking];
   } else if (query.startsWith('UPDATE provider_availability AS a')) {
    if (failAvailability) throw new Error('Availability write failed');
    assert.match(query, /NOT EXISTS/);
    assert.match(query, /b.status <> 'cancelled'/);
    available = !bookings.some(row => row.provider_id === params[0] && row.scheduled_date === params[1] && row.scheduled_time === params[2] && row.status !== 'cancelled');
   } else if (query.startsWith('UPDATE customer_bookings SET provider_closed')) {
    if (booking && ['completed', 'cancelled'].includes(booking.status)) {
     booking.provider_closed = true;
     rows = [booking];
    }
   }
   return { rows: structuredClone(rows), rowCount: rows.length };
  },
 };
 database.pool = { async connect() { return { query: database.query, release() { releases++; } }; } };
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
 // Exercise the real API without connecting to PostgreSQL or reading user uploads.
 vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  __dirname, __filename: filename, Buffer, URL, URLSearchParams, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval,
  process: { env: { PORT: '0' } },
  console: { log() {}, error(error) { if (typeof error === 'string') rejectServer(new Error(error)); } },
  require(name) {
   if (name === './db') return database;
   if (name === 'express') return expressFactory;
   if (name === 'dotenv') return { config() {} };
   if (name === 'fs') return { ...fs, mkdirSync() {}, readdirSync: () => [], promises: { ...fs.promises, readdir: async () => [] } };
   return localRequire(name);
  },
 }, { filename });
 const server = await ready;
 t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
 const base = `http://127.0.0.1:${server.address().port}`;
 async function request(id, status, expectedStatus, providerId = 81) {
  const response = await fetch(`${base}/api/provider/${providerId}/bookings/${id}/${status === 'archive' ? 'close' : 'status'}`, {
   method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, expected_status: expectedStatus }),
  });
  return { status: response.status, data: await response.json() };
 }

 await t.test('accept returns saved GPS and is idempotent', async () => {
  const result = await request(1, 'upcoming', 'pending');
  assert.equal(result.status, 200);
  assert.equal(result.data.booking.status, 'upcoming');
  assert.equal(result.data.booking.customer_latitude, 15.1443);
  assert.equal(result.data.booking.customer_longitude, 120.5894);
  assert.equal(result.data.booking.customer_location_source, 'booking-gps');
  assert.equal(available, false);
  const before = writes;
  assert.equal((await request(1, 'upcoming', 'pending')).status, 200);
  assert.equal(writes, before);
 });
 await t.test('reject invalid transitions, stale state and other providers', async () => {
  assert.equal((await request(1, 'completed', 'upcoming')).status, 409);
  assert.equal((await request(1, 'ongoing', 'pending')).status, 409);
  assert.equal((await request(1, 'ongoing', 'upcoming', 82)).status, 404);
  assert.equal((await request(999, 'upcoming')).status, 404);
  for (const invalid of ['pending', 'unknown', 'toString', '']) assert.equal((await request(1, invalid)).status, 400);
  assert.equal((await request(1, 'archive')).status, 404);
 });
 await t.test('start, complete and archive preserve history', async () => {
  assert.equal((await request(1, 'ongoing', 'upcoming')).data.booking.status, 'ongoing');
  assert.equal((await request(1, 'completed', 'ongoing')).data.booking.status, 'completed');
  assert.equal((await request(1, 'cancelled')).status, 409);
  const archived = await request(1, 'archive');
  assert.equal(archived.status, 200);
  assert.equal(archived.data.booking.provider_closed, true);
  assert.equal(bookings.find(row => row.id === 1).status, 'completed');
  assert.equal((await request(1, 'completed')).status, 409);
 });
 await t.test('missing GPS does not become zero or throw after saving', async () => {
  const result = await request(2, 'cancelled', 'pending');
  assert.equal(result.status, 200);
  assert.equal(result.data.booking.customer_latitude, null);
  assert.equal(result.data.booking.customer_longitude, null);
  assert.equal(result.data.booking.customer_location_source, 'none');
  assert.equal(available, false, 'another booking still occupies this slot');
  assert.equal((await request(2, 'upcoming')).status, 409);
  assert.equal((await request(2, 'archive')).data.booking.provider_closed, true);
 });
 await t.test('availability failure rolls back the booking update', async () => {
  failAvailability = true;
  assert.equal((await request(3, 'upcoming')).status, 500);
  assert.equal(bookings.find(row => row.id === 3).status, 'pending');
  assert.equal(available, false);
  failAvailability = false;
  assert.equal((await request(3, 'upcoming')).status, 200);
 });
 await t.test('only cancellation of the last occupied slot reopens it', async () => {
  bookings = bookings.filter(row => row.id === 4);
  assert.equal((await request(4, 'cancelled')).status, 200);
  assert.equal(available, true);
  assert.ok(releases > 10, 'clients released for success and error paths');
 });
});
