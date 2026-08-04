// apply_036.js — Apply migration 036: critical/high RPC authorization hardening
//
// Usage:
//   node supabase/apply_036.js
//
// Steps:
//   1. Connects to live DB.
//   2. Applies 20260803_036_revoke_public_grants.sql.
//   3. Sets DATABASE_URL and runs verify_036.js inline (same connection config).
//   4. Fails fast — stops on any verification failure and reports the exact group.
//   5. Credentials are never printed to stdout or stderr.

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

const MIGRATION_FILE = path.join(__dirname, '20260803_036_revoke_public_grants.sql');
const VERIFY_FILE    = path.join(__dirname, 'verify_036.js');

async function applyMigration() {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');

  const c = new Client(DB_CONFIG);
  await c.connect();
  console.log('Connected to live DB.\n');

  try {
    console.log('Applying migration 036...');
    await c.query(sql);
    console.log('Migration 036 applied successfully.\n');
  } catch (e) {
    console.error('Migration 036 FAILED:', e.message);
    await c.end();
    process.exit(1);
  }

  await c.end();
}

function buildDatabaseUrl() {
  // URL-encode special characters in the password.
  const pw = DB_CONFIG.password
    .replace(/%/g, '%25')
    .replace(/&/g, '%26')
    .replace(/\$/g, '%24')
    .replace(/#/g, '%23')
    .replace(/@/g, '%40')
    .replace(/\+/g, '%2B')
    .replace(/=/g, '%3D')
    .replace(/\?/g, '%3F');
  return `postgresql://${DB_CONFIG.user}:${pw}@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}?sslmode=no-verify`;
}

async function runVerify() {
  console.log('Running verify_036.js...\n');
  const env = {
    ...process.env,
    DATABASE_URL: buildDatabaseUrl(),
  };

  try {
    const output = execSync(`node "${VERIFY_FILE}"`, {
      env,
      stdio: 'inherit',
      timeout: 60_000,
    });
  } catch (e) {
    console.error('\nverify_036.js exited non-zero — migration applied but verification failed.');
    process.exit(1);
  }
}

async function main() {
  const verifyOnly = process.argv.includes('--verify-only');
  if (!verifyOnly) {
    await applyMigration();
  }
  await runVerify();
  if (verifyOnly) {
    console.log('\nMigration 036 verification complete.');
  } else {
    console.log('\nMigration 036 applied and verified successfully.');
  }
}

main().catch(e => {
  console.error('Fatal:', e.message ?? String(e));
  process.exit(1);
});
