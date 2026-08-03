// verify_035.js — M7: Server-side financial amount validation
//
// Prerequisites:
//   DATABASE_URL   — postgres superuser connection string (never printed)
//   TEST_PARENT_ID — UUID of an existing parents row with no active loans
//
// Usage:
//   node supabase/verify_035.js
//
// Behaviour:
//   Stops immediately on the first test failure (fail-fast).
//   All tests are read-only or wrapped in transactions that always ROLLBACK.
//   No data is written to the database — no cleanup step is needed.
//   The connection string is never printed; only static status messages appear.
//
// Tests T01–T08: require_valid_gbp_amount helper
// Tests T09–T11: top_up_safety_pool — auth guard + amount validation
// Tests T12–T14: update_safety_pool — auth guard + inline validation
// Tests T15–T16: parent_send_to_child — auth guard + amount validation
// Tests T17–T18: create_money_request — amount fires before session check
// Tests T19–T20: fund_money_request   — amount fires before session check

'use strict';
const { Client } = require('pg');

const DATABASE_URL   = process.env.DATABASE_URL;
const TEST_PARENT_ID = process.env.TEST_PARENT_ID;

if (!DATABASE_URL)   throw new Error('DATABASE_URL not set');
if (!TEST_PARENT_ID) throw new Error('TEST_PARENT_ID not set');

let c; // module-level so test() can close the connection on failure
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}: ${e.message}`);
    console.error('\nVerification stopped at first failure.');
    if (c) await c.end().catch(() => {});
    process.exit(1);
  }
}

// Expects fn() to throw with a message containing expectedSubstr.
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

// Run fn(conn) as an authenticated parent (sets auth.uid()). Always ROLLBACKs —
// prevents state changes even when the called function succeeds.
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

async function main() {
  c = new Client({ connectionString: DATABASE_URL });
  await c.connect();

  // ── T01–T08: require_valid_gbp_amount ───────────────────────────────────────
  console.log('\n  require_valid_gbp_amount\n');

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

  // ── T09–T11: top_up_safety_pool ─────────────────────────────────────────────
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

  // ── T12–T14: update_safety_pool ─────────────────────────────────────────────
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

  // ── T15–T16: parent_send_to_child ───────────────────────────────────────────
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

  await test('T16: 1.001 (as parent) → amount_precision_invalid', () =>
    assertThrows(
      () => asParentRollback(c, TEST_PARENT_ID, conn =>
        conn.query(
          'SELECT public.parent_send_to_child($1, $2, 1.001, $3)',
          [TEST_PARENT_ID, '00000000-0000-0000-0000-000000000001', 'Test Parent']
        )
      ),
      'amount_precision_invalid'
    )
  );

  // ── T17–T18: create_money_request amount-first ordering ─────────────────────
  // Proves amount validation fires before session check:
  // with both p_amount and session invalid, we get an amount error (not session error).
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

  // ── T19–T20: fund_money_request amount-first ordering ───────────────────────
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

  await test('T20: 1.001 + fake session → amount_precision_invalid (not session error)', () =>
    assertThrows(
      () => c.query(
        'SELECT public.fund_money_request($1, $2, 1.001, $3, $4)',
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

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  ${passed}/20 passed\n`);

  await c.end();
}

main().catch(err => { console.error(err); process.exit(1); });
