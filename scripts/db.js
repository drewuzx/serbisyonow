'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL
  || 'postgres://postgres:postgres@localhost:5432/serbisyonow_db';

const useSsl = String(process.env.DATABASE_SSL || process.env.PGSSLMODE || '')
  .toLowerCase()
  .includes('true')
  || String(process.env.PGSSLMODE || '').toLowerCase() === 'require';

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
