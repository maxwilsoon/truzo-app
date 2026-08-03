// verify_035_rollback.js — Confirm rollback 035 failed closed
//
// Prerequisites:
//   DATABASE_URL   — postgres superuser connection string
//   TEST_PARENT_ID — UUID of an existing parents row
//
// Proves after rollback:
//   RV01–RV04: No PUBLIC or anon EXECUTE grants on the three parent-facing RPCs
//   RV05–RV06: auth.uid() ownership checks still block cross-parent calls
//   RV07–RV08: Inline validation still rejects null/negative amounts
//   RV09:      require_valid_gbp_amount does NOT exist (dropped by rollback)
//   RV10:      CHECK constraint chk_children_wallet_nonneg still exists
//
// Stops immediately on first failure.
// All tests are read-only or wrapped in transactions that always ROLLBACK.
// No data is written to the database.

'use strict';
const { Client } = require('pg');

const DATABASE_URL   = process.env.DATABASE_URL;
const TEST_PARENT_ID = process.env.TEST_PARENT_ID;

if (!DATABASE_URL)   throw new Error('DATABASE_URL not set');
if (!TEST_PARENT_ID) throw new Error('TEST_PARENT_ID not set');

let c;
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}: ${e.message}`);
    console.error('\nRollback verification failed — stopping immediately.');
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

// Run fn(conn) as an authenticated parent (sets auth.uid()). Always ROLLBACKs.
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

// Fake UUID representing a different parent — never matches TEST_PARENT_ID.
const OTHER_PARENT_ID = '00000000-dead-beef-0000-000000000001';

async function main() {
  c = new Client({ connectionString: DATABASE_URL });
  await c.connect();

  // ── RV01–RV04: No PUBLIC or anon grants on the three parent-facing RPCs ──────
  console.log('\n  Grant verification\n');

  await test('RV01–RV04: No PUBLIC or anon EXECUTE grants on parent-facing RPCs', async () => {
    const { rows } = await c.query(`
      SELECT routine_name, grantee
      FROM information_schema.role_routine_grants
      WHERE routine_schema = 'public'
        AND routine_name IN ('top_up_safety_pool', 'update_safety_pool', 'parent_send_to_child')
        AND grantee IN ('PUBLIC', 'anon')
    `);
    if (rows.length > 0) {
      const found = rows.map(r => `${r.grantee} on ${r.routine_name}`).join(', ');
      throw new Error(`Found revoked grants still present: ${found}`);
    }
  });

  // ── RV05–RV06: auth.uid() ownership guard still blocks cross-parent calls ────
  console.log('\n  Cross-parent auth guard\n');

  await test('RV05: top_up_safety_pool — Parent A cannot act for Parent B', () =>
    assertThrows(
      () => asParentRollback(c, TEST_PARENT_ID, conn =>
        conn.query('SELECT public.top_up_safety_pool($1, 5.00)', [OTHER_PARENT_ID])
      ),
      'unauthorized'
    )
  );

  await test('RV06: update_safety_pool — Parent A cannot act for Parent B', () =>
    assertThrows(
      () => asParentRollback(c, TEST_PARENT_ID, conn =>
        conn.query('SELECT public.update_safety_pool($1, 50.00)', [OTHER_PARENT_ID])
      ),
      'unauthorized'
    )
  );

  // ── RV07–RV08: Inline validation still rejects bad amounts ───────────────────
  console.log('\n  Inline amount validation\n');

  await test('RV07: top_up_safety_pool(null) as valid parent → invalid_amount', () =>
    assertThrows(
      () => asParentRollback(c, TEST_PARENT_ID, conn =>
        conn.query('SELECT public.top_up_safety_pool($1, NULL::numeric)', [TEST_PARENT_ID])
      ),
      'invalid_amount'
    )
  );

  await test('RV08: top_up_safety_pool(-1) as valid parent → invalid_amount', () =>
    assertThrows(
      () => asParentRollback(c, TEST_PARENT_ID, conn =>
        conn.query('SELECT public.top_up_safety_pool($1, -1::numeric)', [TEST_PARENT_ID])
      ),
      'invalid_amount'
    )
  );

  // ── RV09: require_valid_gbp_amount does NOT exist ────────────────────────────
  console.log('\n  Helper removal\n');

  await test('RV09: require_valid_gbp_amount does not exist after rollback', async () => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n
      FROM pg_proc
      WHERE proname = 'require_valid_gbp_amount'
        AND pronamespace = 'public'::regnamespace
    `);
    if (rows[0].n !== 0) {
      throw new Error(`require_valid_gbp_amount still exists (${rows[0].n} overload(s)) — was it dropped?`);
    }
  });

  // ── RV10: Non-negative CHECK constraint still exists ─────────────────────────
  console.log('\n  Schema constraints\n');

  await test('RV10: chk_children_wallet_nonneg CHECK constraint still exists', async () => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n
      FROM pg_constraint
      WHERE conname = 'chk_children_wallet_nonneg'
        AND conrelid = 'public.children'::regclass
    `);
    if (rows[0].n === 0) {
      throw new Error('chk_children_wallet_nonneg constraint missing — it should not be dropped by the rollback');
    }
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  ${passed}/10 passed — rollback verified as fail-closed\n`);

  await c.end();
}

main().catch(err => { console.error(err); process.exit(1); });
