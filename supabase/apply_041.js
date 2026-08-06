#!/usr/bin/env node
'use strict';
const { Client } = require('pg');
const fs   = require('fs');
const path = require('path');

const PG = new Client({
  host:     'aws-0-eu-west-1.pooler.supabase.com',
  port:     6543,
  database: 'postgres',
  user:     'postgres.biilrksornvoqtalftty',
  password: '&Z3YcdQRVM&g$QN',
  ssl:      { rejectUnauthorized: false },
});

(async () => {
  await PG.connect();
  const sql = fs.readFileSync(path.join(__dirname, '20260806_041_child_rpc_authenticated_grants.sql'), 'utf8');
  try {
    await PG.query(sql);
    console.log('M041 applied successfully.');
  } catch (e) {
    console.error('M041 failed:', e.message);
    process.exit(1);
  }
  await PG.end();

  // Run verification
  console.log('\nRunning verification...');
  require('./verify_041.js');
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
