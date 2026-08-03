// apply_035.js — Apply migration 035: server-side financial amount validation
//
// Usage:
//   node supabase/apply_035.js
//
// Prerequisites:
//   DATABASE_URL — postgres superuser connection string

'use strict';
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set');

async function main() {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();

  const sqlPath = path.join(__dirname, '20260803_035_financial_amount_validation.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Applying migration 035: server-side financial amount validation...');
  await c.query(sql);
  console.log('Migration 035 applied successfully.');

  await c.end();
}

main().catch(err => { console.error(err); process.exit(1); });
