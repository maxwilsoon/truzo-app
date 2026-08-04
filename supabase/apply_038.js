// apply_038.js — Apply migration 038: session enforcement on Circle write RPCs
//
// Usage:
//   node supabase/apply_038.js              # apply + verify
//   node supabase/apply_038.js --verify-only

'use strict';
const { Client } = require('pg');
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const DB_CONFIG = {
  host:     'aws-0-eu-west-1.pooler.supabase.com',
  port:     6543,
  database: 'postgres',
  user:     'postgres.biilrksornvoqtalftty',
  password: '&Z3YcdQRVM&g$QN',
  ssl:      { rejectUnauthorized: false },
};

const MIGRATION_FILE = path.join(__dirname, '20260804_038_circle_write_sessions.sql');
const VERIFY_FILE    = path.join(__dirname, 'verify_038.js');

async function applyMigration() {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  const c = new Client(DB_CONFIG);
  await c.connect();
  console.log('Connected to live DB.\n');
  try {
    console.log('Applying migration 038...');
    await c.query(sql);
    console.log('Migration 038 applied successfully.\n');
  } catch (e) {
    console.error('Migration 038 FAILED:', e.message);
    await c.end();
    process.exit(1);
  }
  await c.end();
}

function buildDatabaseUrl() {
  const pw = DB_CONFIG.password
    .replace(/%/g, '%25').replace(/&/g, '%26').replace(/\$/g, '%24')
    .replace(/#/g, '%23').replace(/@/g, '%40').replace(/\+/g, '%2B')
    .replace(/=/g, '%3D').replace(/\?/g, '%3F');
  return `postgresql://${DB_CONFIG.user}:${pw}@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}?sslmode=no-verify`;
}

async function runVerify() {
  console.log('Running verify_038.js...\n');
  const env = { ...process.env, DATABASE_URL: buildDatabaseUrl() };
  try {
    execSync(`node "${VERIFY_FILE}"`, { env, stdio: 'inherit', timeout: 120_000 });
  } catch (e) {
    console.error('\nverify_038.js exited non-zero — migration applied but verification failed.');
    process.exit(1);
  }
}

async function main() {
  const verifyOnly = process.argv.includes('--verify-only');
  if (!verifyOnly) await applyMigration();
  await runVerify();
  console.log(verifyOnly
    ? '\nMigration 038 verification complete.'
    : '\nMigration 038 applied and verified successfully.');
}

main().catch(e => {
  console.error('Fatal:', e.message ?? String(e));
  process.exit(1);
});
