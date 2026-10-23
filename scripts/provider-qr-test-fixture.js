'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { Pool } = require('pg');
const express = require('express');
const { issueSession } = require('./account-sessions');

async function startQrFixture() {
 const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/serbisyonow_db';
 if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) throw new Error('QR tests only run against a local PostgreSQL instance.');
 const schema = `sn_qr_test_${crypto.randomBytes(8).toString('hex')}`;
 const admin = new Pool({ connectionString: url });
 const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
 let server;
 const close = async () => {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await pool.end();
  if (!/^sn_qr_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Invalid test schema.');
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
 };
 try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = { pool, query: (sql, values) => pool.query(sql, values) };
  await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await db.query(fs.readFileSync(path.join(__dirname, 'payment-schema.sql'), 'utf8'));
  for (const id of [61, 62]) await db.query(`INSERT INTO customers (id, full_name, address, gender, contact, dob, email, password_hash, is_verified, verification_status)
   VALUES ($1, 'QR Test Customer', 'Test address', 'Female', '09123456789', '2000-01-01', $2, 'fixture', TRUE, 'verified')`, [id, `customer${id}@fixture.invalid`]);
  for (const id of [81, 82]) await db.query(`INSERT INTO providers (id, full_name, address, gender, contact, dob, email, password_hash, category, service,
   experience, experience_years, experience_certification, is_verified, verification_status)
   VALUES ($1, 'QR Test Provider', 'Test address', 'Female', '09123456789', '2000-01-01', $2, 'fixture', 'Cleaning Services', 'General House Cleaning', '', '1', '', TRUE, 'verified')`, [id, `provider${id}@fixture.invalid`]);
  const customerToken = await issueSession(db, 'customer', 61);
  const otherCustomerToken = await issueSession(db, 'customer', 62);
  const providerToken = await issueSession(db, 'provider', 81);
  const otherProviderToken = await issueSession(db, 'provider', 82);
  const filename = path.join(__dirname, 'auth-server.js');
  const localRequire = createRequire(filename);
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const expressFactory = Object.assign(() => {
   const app = express();
   const listen = app.listen.bind(app);
   app.listen = () => { server = listen(0, '127.0.0.1', () => resolveReady(server)); return server; };
   return app;
  }, express);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
   __dirname, __filename: filename, Buffer, URL, URLSearchParams, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval,
   process: { env: { PORT: '0' } }, console: { log() {}, error(...args) { if (args[0] === 'Failed to initialize admin database tables.') resolveReady(Promise.reject(args[1])); } },
   require(name) {
    if (name === './db') return db;
    if (name === './paymongo') return { createPayMongo: () => ({ ready: false, livemode: false, verifyWebhook() { throw new Error('No gateway calls in direct QR tests.'); } }) };
    if (name === 'express') return expressFactory;
    if (name === 'dotenv') return { config() {} };
    if (name === 'fs') return { ...fs, mkdirSync() {}, readdirSync: () => [], promises: { ...fs.promises, readdir: async () => [] } };
    return localRequire(name);
   },
  }, { filename });
  await ready;
  const base = `http://127.0.0.1:${server.address().port}`;
  const image = fs.readFileSync(path.join(__dirname, '../image_logo/pwa/icon-192.png'));
  async function request(route, method = 'GET', body, token = customerToken) {
   const multipart = body instanceof FormData;
   const response = await fetch(base + route, { method, headers: { ...(multipart ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) });
   const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
   return { status: response.status, data, headers: response.headers };
  }
  const createBooking = async (extras = {}) => {
   const { rows: [booking] } = await db.query(`INSERT INTO customer_bookings (customer_id, provider_id, service, scheduled_date, scheduled_time, address,
    amount, status, deposit_required, deposit_status, price_version) VALUES (61, 81, 'General House Cleaning', '2099-10-10', '10:00 AM', 'Test address', 1000, 'pending', TRUE, 'awaiting_price', 0) RETURNING *`);
   for (const [key, value] of Object.entries(extras)) {
    if (!/^[a-z_]+$/.test(key)) throw new Error('Invalid fixture field.');
    await db.query(`UPDATE customer_bookings SET ${key} = $2 WHERE id = $1`, [booking.id, value]);
   }
   return (await db.query('SELECT * FROM customer_bookings WHERE id = $1', [booking.id])).rows[0];
  };
  const qrForm = (name = 'QR Test Provider') => {
   const form = new FormData();
   form.append('wallet', 'GCash'); form.append('account_name', name); form.append('account_number', '09123456789'); form.append('confirm_account', 'true');
   form.append('qr', new Blob([image], { type: 'image/png' }), 'fixture-qr.png');
   return form;
  };
  const receiptForm = (version, reference = 'TEST-REF-0001') => {
   const form = new FormData();
   form.append('price_version', String(version)); form.append('reference_number', reference);
   form.append('receipt', new Blob([image], { type: 'image/png' }), 'fixture-receipt.png');
   return form;
  };
  return { db, base, image, request, createBooking, qrForm, receiptForm, customerToken, otherCustomerToken, providerToken, otherProviderToken, close };
 } catch (error) { await close(); throw error; }
}

module.exports = { startQrFixture };
