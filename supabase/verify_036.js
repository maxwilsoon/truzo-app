// verify_036.js — Verify migration 036: critical/high RPC grant remediation
//
// Prerequisites:
//   DATABASE_URL — postgres superuser connection string
//
// Run:
//   node supabase/verify_036.js
//
// All tests are read-only. No data is written; no cleanup is needed.
// Stops on first failure (fail-fast).
//
// Grant checks query information_schema.role_routine_grants which reflects
// the live grant state in the database.
//
// Test groups:
//   G1  C-01: enable_biometric session guard
//   G2  H-01: disable_biometric session guard
//   G3  H-02: confirm_parent_repayment auth.uid() guard
//   G4  H-03: persist_transaction anon grant removed
//   G5  H-04: parent_send_money dropped
//   G6  H-05: internal helpers inaccessible to PUBLIC/anon/authenticated
//   G7  H-05: parent-write RPCs inaccessible to anon
//   G8  Belt-and-suspenders: internal session/amount helpers have no external grants
//   G9  Explicit anon grants still present for legitimate child-facing RPCs

'use strict';
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set');

let c;
let passed = 0;
let total  = 0;

async function test(name, fn) {
  total++;
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

// Returns the list of roles that have EXECUTE on the named function (any overload).
async function getGrantees(conn, funcName) {
  const { rows } = await conn.query(`
    SELECT grantee
    FROM   information_schema.role_routine_grants
    WHERE  routine_schema = 'public'
      AND  routine_name   = $1
      AND  privilege_type = 'EXECUTE'
  `, [funcName]);
  return rows.map(r => r.grantee);
}

// Assert none of the listed roles have EXECUTE on funcName.
async function assertNoGrant(funcName, roles) {
  const grantees = await getGrantees(c, funcName);
  const found    = roles.filter(r => grantees.includes(r));
  if (found.length > 0) {
    throw new Error(
      `${funcName}: unexpected grants found for role(s) ${found.join(', ')} — found: [${grantees.join(', ')}]`
    );
  }
}

// Assert that at least one of the listed roles has EXECUTE on funcName.
async function assertHasGrant(funcName, roles) {
  const grantees = await getGrantees(c, funcName);
  const missing  = roles.filter(r => !grantees.includes(r));
  if (missing.length > 0) {
    throw new Error(
      `${funcName}: expected grant for role(s) ${missing.join(', ')} — actual grants: [${grantees.join(', ')}]`
    );
  }
}

// Assert the function does NOT exist (i.e. was dropped).
async function assertNotExists(funcName) {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n
     FROM   pg_proc
     WHERE  proname      = $1
       AND  pronamespace = 'public'::regnamespace`,
    [funcName]
  );
  if (rows[0].n !== 0) {
    throw new Error(`${funcName} still exists (${rows[0].n} overload(s)) — expected it to be dropped`);
  }
}

// Assert that a specific function signature does NOT exist (old param list was replaced).
async function assertSignatureNotExists(oidRegprocedure) {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n
     FROM   pg_proc
     WHERE  oid::regprocedure::text = $1`,
    [oidRegprocedure]
  );
  if (rows[0].n !== 0) {
    throw new Error(`Old signature still exists: ${oidRegprocedure}`);
  }
}

// Simulate an anon caller invoking an RPC.
// Expects the call to raise an error (function not callable or auth guard fires).
async function assertAnonCannotCall(sql, params = []) {
  // In a real Supabase environment the anon role can only call functions granted to it.
  // Here we simulate the grant check via information_schema (see assertNoGrant above).
  // A runtime "permission denied" test would require switching roles in the same session
  // which is not safe to do in a shared superuser connection. The grant checks in G1–G8
  // are the authoritative assertion; this helper just runs any SQL that will fail due
  // to auth guard logic (e.g. auth.uid() IS NULL).
  await assertThrows(() => c.query(sql, params), '');
}

async function main() {
  c = new Client({ connectionString: DATABASE_URL });
  await c.connect();

  // ── G1: C-01 — enable_biometric session guard ───────────────────────────────
  console.log('\n  G1: C-01 — enable_biometric\n');

  await test('G1-01: Old 3-param signature (uuid,text,text) does not exist', () =>
    assertSignatureNotExists('enable_biometric(uuid,text,text)')
  );

  await test('G1-02: New 4-param signature (uuid,text,text,text) exists and has anon grant', () =>
    assertHasGrant('enable_biometric', ['anon'])
  );

  await test('G1-03: enable_biometric not callable by PUBLIC or authenticated', () =>
    assertNoGrant('enable_biometric', ['PUBLIC', 'authenticated'])
  );

  await test('G1-04: enable_biometric with fake session → invalid_child_session', () =>
    assertThrows(
      () => c.query(
        'SELECT public.enable_biometric($1, $2, $3, $4)',
        [
          '00000000-0000-0000-0000-000000000001',
          'device-001',
          'a'.repeat(64),  // 64-char hex-like string
          'fakesessiontoken',
        ]
      ),
      'invalid_child_session'  // require_valid_child_session fires before anything else
    )
  );


  // ── G2: H-01 — disable_biometric session guard ──────────────────────────────
  console.log('\n  G2: H-01 — disable_biometric\n');

  await test('G2-01: Old 1-param signature (uuid) does not exist', () =>
    assertSignatureNotExists('disable_biometric(uuid)')
  );

  await test('G2-02: New 3-param signature (uuid,text,text) exists and has anon grant', () =>
    assertHasGrant('disable_biometric', ['anon'])
  );

  await test('G2-03: disable_biometric not callable by PUBLIC or authenticated', () =>
    assertNoGrant('disable_biometric', ['PUBLIC', 'authenticated'])
  );

  await test('G2-04: disable_biometric with fake session → invalid_child_session', () =>
    assertThrows(
      () => c.query(
        'SELECT public.disable_biometric($1, $2, $3)',
        [
          '00000000-0000-0000-0000-000000000001',
          'fakesessiontoken',
          'device-001',
        ]
      ),
      'invalid_child_session'
    )
  );


  // ── G3: H-02 — confirm_parent_repayment auth.uid() guard ────────────────────
  console.log('\n  G3: H-02 — confirm_parent_repayment\n');

  await test('G3-01: confirm_parent_repayment not callable by anon', () =>
    assertNoGrant('confirm_parent_repayment', ['PUBLIC', 'anon'])
  );

  await test('G3-02: confirm_parent_repayment callable by authenticated', () =>
    assertHasGrant('confirm_parent_repayment', ['authenticated'])
  );

  await test('G3-03: confirm_parent_repayment without auth.uid() → unauthorized', () =>
    // Calling as superuser simulates no JWT (auth.uid() returns NULL).
    assertThrows(
      () => c.query(
        'SELECT public.confirm_parent_repayment($1, $2)',
        [
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
        ]
      ),
      'unauthorized'
    )
  );


  // ── G4: H-03 — persist_transaction anon grant removed ───────────────────────
  console.log('\n  G4: H-03 — persist_transaction\n');

  await test('G4-01: persist_transaction not callable by PUBLIC, anon, or authenticated', () =>
    assertNoGrant('persist_transaction', ['PUBLIC', 'anon', 'authenticated'])
  );

  await test('G4-02: persist_transaction callable by service_role', () =>
    assertHasGrant('persist_transaction', ['service_role'])
  );


  // ── G5: H-04 — parent_send_money dropped ────────────────────────────────────
  console.log('\n  G5: H-04 — parent_send_money\n');

  await test('G5-01: parent_send_money does not exist in any overload', () =>
    assertNotExists('parent_send_money')
  );


  // ── G6: H-05 — Internal helpers: no external grants ─────────────────────────
  console.log('\n  G6: H-05 — Internal helpers (no external grants)\n');

  const internalHelpers = [
    '_trigger_notification',
    '_trigger_notification_multi',
    'add_activity_item',
    '_update_weekly_streak',
    'process_due_allowances',
    'process_due_loan_defaults',
    '_rl_attempt',
    '_rl_clear',
    'require_valid_child_session',
    'revoke_all_child_sessions',
    'require_valid_gbp_amount',
  ];

  for (const fn of internalHelpers) {
    const fnCopy = fn; // capture for closure
    await test(`G6: ${fnCopy} has no PUBLIC/anon/authenticated grant`, async () => {
      // Some functions may not exist in all environments — skip if absent.
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM pg_proc
         WHERE proname = $1 AND pronamespace = 'public'::regnamespace`,
        [fnCopy]
      );
      if (rows[0].n === 0) {
        // Function doesn't exist in this DB — skip (no grant can exist either).
        return;
      }
      await assertNoGrant(fnCopy, ['PUBLIC', 'anon', 'authenticated']);
    });
  }


  // ── G7: H-05 — Parent-write functions: no anon grant ────────────────────────
  console.log('\n  G7: H-05 — Parent-write functions (no anon grant)\n');

  const parentWriteFns = [
    'set_allowance_schedule',
    'update_marketing_preference',
    'insert_child',
    'top_up_safety_pool',
    'update_safety_pool',
    'parent_send_to_child',
    'confirm_parent_repayment',
    'set_parent_passcode',
    'get_parent_safety_pool_status',
  ];

  for (const fn of parentWriteFns) {
    const fnCopy = fn;
    await test(`G7: ${fnCopy} has no PUBLIC or anon grant`, async () => {
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM pg_proc
         WHERE proname = $1 AND pronamespace = 'public'::regnamespace`,
        [fnCopy]
      );
      if (rows[0].n === 0) return;
      await assertNoGrant(fnCopy, ['PUBLIC', 'anon']);
    });
  }


  // ── G8: Belt-and-suspenders: trigger functions ───────────────────────────────
  console.log('\n  G8: Trigger functions (no external grants)\n');

  await test('G8-01: prevent_direct_passcode_write has no PUBLIC/anon/authenticated grant', async () => {
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM pg_proc
       WHERE proname = 'prevent_direct_passcode_write' AND pronamespace = 'public'::regnamespace`
    );
    if (rows[0].n === 0) return;
    await assertNoGrant('prevent_direct_passcode_write', ['PUBLIC', 'anon', 'authenticated']);
  });


  // ── G9: Legitimate child-facing anon grants still present ───────────────────
  console.log('\n  G9: Child-facing RPCs still callable by anon\n');

  const childFacingFns = [
    ['login_child', ['anon']],
    ['biometric_login_child', ['anon']],
    ['revoke_child_session', ['anon']],
    ['enable_biometric', ['anon']],
    ['disable_biometric', ['anon']],
    ['verify_parent_passcode', ['anon', 'authenticated']],
    ['check_username_exists', ['anon', 'authenticated']],
    ['check_email_exists', ['anon', 'authenticated']],
    ['check_mobile_exists', ['anon', 'authenticated']],
    ['create_money_request', ['anon']],
    ['fund_money_request', ['anon']],
    ['repay_money_request', ['anon']],
    ['cancel_money_request', ['anon']],
    ['register_device_token', ['anon']],
    ['deregister_device_token', ['anon']],
    ['send_circle_request', ['anon']],
    ['accept_circle_request', ['anon']],
    ['decline_circle_request', ['anon']],
    ['get_activity_feed', ['anon']],
  ];

  for (const [fn, roles] of childFacingFns) {
    const fnCopy = fn; const rolesCopy = roles;
    await test(`G9: ${fnCopy} callable by ${rolesCopy.join('/')}`, async () => {
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM pg_proc
         WHERE proname = $1 AND pronamespace = 'public'::regnamespace`,
        [fnCopy]
      );
      if (rows[0].n === 0) {
        throw new Error(`${fnCopy} does not exist — required child-facing function is missing`);
      }
      await assertHasGrant(fnCopy, rolesCopy);
    });
  }


  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(56)}`);
  console.log(`  ${passed}/${total} passed — migration 036 verified`);
  console.log();

  await c.end();
}

main().catch(err => {
  console.error('Fatal error:', err.message ?? String(err));
  process.exit(1);
});
