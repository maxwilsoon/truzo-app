// apply_035.js — Apply migration 035: server-side financial amount validation
//
// Usage:
//   node supabase/apply_035.js
//
// Prerequisites:
//   DATABASE_URL   — postgres superuser connection string (never printed)
//   TEST_PARENT_ID — UUID of an existing parents row (required for post-apply verification)
//
// Behaviour:
//   1. Applies migration 035 SQL inside its own BEGIN/COMMIT block.
//   2. Runs all 20 verification tests inline (same process, no subprocess).
//   3. Stops immediately if any test fails (fail-fast).
//   4. DATABASE_URL is never printed to stdout or stderr.
//   5. No credentials are written to files or passed to child processes.
//   6. All verify tests are read-only or wrapped in transactions that always ROLLBACK.
//      No test data is written; no cleanup step is needed.

'use strict';
const { Client } = require('pg');
const fs   = require('fs');
const path = require('path');

// ── Credential safety ─────────────────────────────────────────────────────────
// DATABASE_URL is read from env and passed only to the pg Client constructor.
// It is never interpolated into log messages, SQL strings, or error text.

const DATABASE_URL   = process.env.DATABASE_URL;
const TEST_PARENT_ID = process.env.TEST_PARENT_ID;

if (!DATABASE_URL)   { console.error('Error: DATABASE_URL not set'); process.exit(1); }
if (!TEST_PARENT_ID) { console.error('Error: TEST_PARENT_ID not set (required for post-apply verification)'); process.exit(1); }

// ── Helpers ───────────────────────────────────────────────────────────────────

let c;
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}: ${e.message}`);
    console.error('\nVerification failed — stopping immediately. Migration was applied but did not pass all tests.');
    if (c) await c.end().catch(() => {});
    process.exit(1);
  }
}

async function assertThrows(fn, expectedSubstr) {
  let result;
  try {
    result = await fn();
  } catch (e) {
    if (!e.message.includes(expectedSubstr)) {
      throw new Error(`Expected error containing '${expectedSubstr}', got: ${e.message}`);
    }
    return;
  }
  throw new Error(`Expected error containing '${expectedSubstr}' but succeeded (result: ${JSON.stringify(result)})`);
}

async function assertOk(fn) {
  await fn();
}

// Always ROLLBACKs — no net state change even when the called function succeeds.
async function asParentRollback(conn, parentId, fn) {
  await conn.query('BEGIN');
  try {
    const claims = JSON.stringify({ sub: parentId, role: 'authenticated' }).replace(/'/g, "''");
    await conn.query(`SET LOCAL "request.jwt.claims" = '${claims}'`);
    return await fn(conn);
  } finally {
    await conn.query('ROLLBACK');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  c = new Client({ connectionString: DATABASE_URL });
  await c.connect();

  // ── Step 1: Apply migration ───────────────────────────────────────────────
  console.log('\nApplying migration 035: server-side financial amount validation...');
  const sqlPath = path.join(__dirname, '20260803_035_financial_amount_validation.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  try {
    await c.query(sql);
  } catch (e) {
    // Do not print e directly — it may include internal query text.
    // Print only the error code and message, which do not contain credentials.
    console.error('Migration 035 failed:', e.code ?? 'unknown error', '—', e.message ?? '');
    await c.end().catch(() => {});
    process.exit(1);
  }
  console.log('Migration 035 applied. Running verification...\n');

  // ── Step 2: Verify (fail-fast — stops on first failure) ──────────────────
  console.log('  require_valid_gbp_amount\n');

  await test('T01: null → invalid_amount', () =>
    assertThrows(
      () => c.query("SELECT public.require_valid_gbp_amount(NULL::numeric, 'test')"),
      'invalid_amount'
    )
  );

  await test('T02: negative → invalid_amount', () =>
    assertThrows(
      () => c.query("SELECT public.require_valid_gbp_amount(-1::numeric, 'test')"),
      'invalid_amount'
    )
  );

  await test('T03: zero → invalid_amount', () =>
    assertThrows(
      () => c.query("SELECT public.require_valid_gbp_amount(0::numeric, 'test')"),
      'invalid_amount'
    )
  );

  await test('T04: 0.49 → amount_below_minimum', () =>
    assertThrows(
      () => c.query("SELECT public.require_valid_gbp_amount(0.49::numeric, 'test')"),
      'amount_below_minimum'
    )
  );

  await test('T05: 0.50 → success (minimum boundary)', () =>
    assertOk(() => c.query("SELECT public.require_valid_gbp_amount(0.50::numeric, 'test')"))
  );

  await test('T06: 99999.99 → success (no cap in helper)', () =>
    assertOk(() => c.query("SELECT public.require_valid_gbp_amount(99999.99::numeric, 'test')"))
  );

  await test('T07: 1.999 → amount_precision_invalid', () =>
    assertThrows(
      () => c.query("SELECT public.require_valid_gbp_amount(1.999::numeric, 'test')"),
      'amount_precision_invalid'
    )
  );

  await test('T08: 5.55 → success (2 dp boundary)', () =>
    assertOk(() => c.query("SELECT public.require_valid_gbp_amount(5.55::numeric, 'test')"))
  );

  console.log('\n  top_up_safety_pool\n');

  await test('T09: no auth.uid() → unauthorized', () =>
    assertThrows(
      () => c.query('SELECT public.top_up_safety_pool($1, 5.00)', [TEST_PARENT_ID]),
      'unauthorized'
    )
  );

  await test('T10: null amount (as parent) → invalid_amount', () =>
    assertThrows(
      () => asParentRollback(c, TEST_PARENT_ID, conn =>
        conn.query('SELECT public.top_up_safety_pool($1, NULL::numeric)', [TEST_PARENT_ID])
      ),
      'invalid_amount'
    )
  );

  await test('T11: 0.49 (as parent) → amount_below_minimum', () =>
    assertThrows(
      () => asParentRollback(c, TEST_PARENT_ID, conn =>
        conn.query('SELECT public.top_up_safety_pool($1, 0.49)', [TEST_PARENT_ID])
      ),
      'amount_below_minimum'
    )
  );

  console.log('\n  update_safety_pool\n');

  await test('T12: no auth.uid() → unauthorized', () =>
    assertThrows(
      () => c.query('SELECT public.update_safety_pool($1, 50.00)', [TEST_PARENT_ID]),
      'unauthorized'
    )
  );

  await test('T13: null limit (as parent) → invalid_amount', () =>
    assertThrows(
      () => asParentRollback(c, TEST_PARENT_ID, conn =>
        conn.query('SELECT public.update_safety_pool($1, NULL::numeric)', [TEST_PARENT_ID])
      ),
      'invalid_amount'
    )
  );

  await test('T14: 50.999 (as parent) → amount_precision_invalid', () =>
    assertThrows(
      () => asParentRollback(c, TEST_PARENT_ID, conn =>
        conn.query('SELECT public.update_safety_pool($1, 50.999)', [TEST_PARENT_ID])
      ),
      'amount_precision_invalid'
    )
  );

  console.log('\n  parent_send_to_child\n');

  await test('T15: no auth.uid() → unauthorized', () =>
    assertThrows(
      () => c.query(
        'SELECT public.parent_send_to_child($1, $2, 5.00, $3)',
        [TEST_PARENT_ID, '00000000-0000-0000-0000-000000000001', 'Test Parent']
      ),
      'unauthorized'
    )
  );

  await test('T16: 0.001 (as parent) → amount_precision_invalid', () =>
    assertThrows(
      () => asParentRollback(c, TEST_PARENT_ID, conn =>
        conn.query(
          'SELECT public.parent_send_to_child($1, $2, 0.001, $3)',
          [TEST_PARENT_ID, '00000000-0000-0000-0000-000000000001', 'Test Parent']
        )
      ),
      'amount_precision_invalid'
    )
  );

  console.log('\n  create_money_request (amount validation before session check)\n');

  await test('T17: null amount + fake session → invalid_amount (not session error)', () =>
    assertThrows(
      () => c.query(
        'SELECT public.create_money_request($1, NULL::numeric, 7, $2, $3)',
        ['00000000-0000-0000-0000-000000000001', 'fake_token', 'fake_device']
      ),
      'invalid_amount'
    )
  );

  await test('T18: 0.49 + fake session → amount_below_minimum (not session error)', () =>
    assertThrows(
      () => c.query(
        'SELECT public.create_money_request($1, 0.49, 7, $2, $3)',
        ['00000000-0000-0000-0000-000000000001', 'fake_token', 'fake_device']
      ),
      'amount_below_minimum'
    )
  );

  console.log('\n  fund_money_request (amount validation before session check)\n');

  await test('T19: null amount + fake session → invalid_amount (not session error)', () =>
    assertThrows(
      () => c.query(
        'SELECT public.fund_money_request($1, $2, NULL::numeric, $3, $4)',
        [
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
          'fake_token',
          'fake_device',
        ]
      ),
      'invalid_amount'
    )
  );

  await test('T20: 0.001 + fake session → amount_precision_invalid (not session error)', () =>
    assertThrows(
      () => c.query(
        'SELECT public.fund_money_request($1, $2, 0.001, $3, $4)',
        [
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
          'fake_token',
          'fake_device',
        ]
      ),
      'amount_precision_invalid'
    )
  );

  // ── Done ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  ${passed}/20 passed — migration 035 verified\n`);

  await c.end();
}

main().catch(err => {
  // Print only the error message, not the full error object (which may contain
  // internal query state but not credentials — belt-and-suspenders).
  console.error('Fatal error:', err.message ?? String(err));
  process.exit(1);
});
