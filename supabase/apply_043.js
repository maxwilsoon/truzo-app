#!/usr/bin/env node
'use strict';
const { Client } = require('pg');
const fs   = require('fs');
const path = require('path');

const PG = new Client({
  host:     'aws-0-eu-west-1.pooler.supabase.com',
  port:     5432,
  database: 'postgres',
  user:     'postgres.biilrksornvoqtalftty',
  password: '&Z3YcdQRVM&g$QN',
  ssl:      { rejectUnauthorized: false },
});

(async () => {
  await PG.connect();
  const sql = fs.readFileSync(path.join(__dirname, '20260809_043_actor_filter.sql'), 'utf8');
  try {
    await PG.query(sql);
    console.log('M043 applied successfully.');
  } catch (e) {
    console.error('M043 failed:', e.message);
    await PG.end();
    process.exit(1);
  }
  await PG.end();

  console.log('\nRunning verification...\n');
  await import('./verify_043.js');
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
