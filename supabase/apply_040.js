// apply_040.js — Apply migration 040: grant login_child/biometric_login_child to authenticated
//
// Usage:
//   node supabase/apply_040.js              # apply + verify
//   node supabase/apply_040.js --verify-only

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

const MIGRATION_FILE = path.join(__dirname, '20260806_040_auth_role_login_grants.sql');
const VERIFY_FILE    = path.join(__dirname, 'verify_040.js');

async function applyMigration() {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  const c = new Client(DB_CONFIG);
  await c.connect();
  console.log('Connected to live DB.\n');
  try {
    console.log('Applying migration 040...');
    await c.query(sql);
    console.log('Migration 040 applied successfully.\n');
  } catch (e) {
    console.error('Migration 040 FAILED:', e.message);
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
  console.log('Running verify_040.js...\n');
  const env = { ...process.env, DATABASE_URL: buildDatabaseUrl() };
  try {
    execSync(`node "${VERIFY_FILE}"`, { env, stdio: 'inherit', timeout: 180_000 });
  } catch (e) {
    console.error('\nverify_040.js exited non-zero — migration applied but verification failed.');
    process.exit(1);
  }
}

async function main() {
  const verifyOnly = process.argv.includes('--verify-only');
  if (!verifyOnly) await applyMigration();
  await runVerify();
  console.log(verifyOnly
    ? '\nMigration 040 verification complete.'
    : '\nMigration 040 applied and verified successfully.');
}

main().catch(e => {
  console.error('Fatal:', e.message ?? String(e));
  process.exit(1);
});
