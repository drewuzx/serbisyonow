'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const db = require('./db');

async function main() {
  await ensureDatabase();

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(schema);

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const passwordHash = await bcrypt.hash(password, 12);

  await db.query(
    `INSERT INTO admins (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [username, passwordHash]
  );

  console.log('Database initialized.');
  console.log(`Database: ${process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/serbisyonow_db'}`);
  console.log(`Admin username: ${username}`);
}

async function ensureDatabase() {
  const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/serbisyonow_db';
  const target = new URL(databaseUrl);
  const isLocalDatabase = ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
  if (!isLocalDatabase || process.env.SKIP_DATABASE_CREATE === 'true') {
    console.log('Skipping database creation check for hosted PostgreSQL.');
    return;
  }

  const databaseName = target.pathname.replace(/^\//, '');
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';

  const adminClient = new Client({ connectionString: adminUrl.toString() });
  await adminClient.connect();
  try {
    const result = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (!result.rowCount) {
      await adminClient.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      console.log(`Created database: ${databaseName}`);
    }
  } finally {
    await adminClient.end();
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
