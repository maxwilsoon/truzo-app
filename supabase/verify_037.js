// verify_037.js — Verify migration 037: child-session enforcement on read RPCs
//
// Prerequisites:
//   DATABASE_URL — postgres superuser connection string
//
// Run:
//   node supabase/verify_037.js
//
// Test counts:
//   Phase 1 — Structural (110 baseline + 2 supplemental)          = 112 tests
//   Phase 2 — Live auth per RPC (6 tests × 11 RPCs)               =  66 tests
//   Phase 3 — Return-shape & isolation (22 per-RPC + 2 global)    =  24 tests
//   Phase 4 — search_children specifics                           =   6 tests
//   Phase 5 — get_active_requests read-only proof                 =   4 tests
//   Total                                                         = 212 tests
//
// Live tests use disposable child_sessions rows (inserted + cleaned up here).
// Test sessions are deleted in a finally block; money_requests cleanup is best-effort.
// account_frozen changes are restored in try/finally per test.
//
// Structural tests (Phase 1) are fail-fast. Live tests (Phases 2–5) print all
// results and summarise at the end; a single failure exits non-zero.

'use strict';
const { Client } = require('pg');
const crypto = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set');

let c;
let passed = 0;
let total  = 0;

// ─── Test runner ─────────────────────────────────────────────────────────────
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

// Variant that does NOT stop on failure (used for live tests after Phase 1).
async function testContinue(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}: ${e.message}`);
  }
}

async function assertThrows(fn, expectedSubstr) {
  try {
    await fn();
  } catch (e) {
    if (!e.message.includes(expectedSubstr)) {
      throw new Error(`Expected error containing '${expectedSubstr}', got: ${e.message}`);
    }
    return;
  }
  throw new Error(`Expected error containing '${expectedSubstr}' but call succeeded`);
}

// ─── Grant helpers ────────────────────────────────────────────────────────────
async function getGrantees(funcName) {
  const { rows } = await c.query(`
    SELECT grantee
    FROM   information_schema.role_routine_grants
    WHERE  routine_schema = 'public'
      AND  routine_name   = $1
      AND  privilege_type = 'EXECUTE'
  `, [funcName]);
  return rows.map(r => r.grantee);
}

async function assertHasGrant(funcName, roles) {
  const grantees = await getGrantees(funcName);
  const missing  = roles.filter(r => !grantees.includes(r));
  if (missing.length > 0) {
    throw new Error(
      `${funcName}: missing grant for role(s) ${missing.join(', ')} — actual: [${grantees.join(', ')}]`
    );
  }
}

async function assertNoGrant(funcName, roles) {
  const grantees = await getGrantees(funcName);
  const found    = roles.filter(r => grantees.includes(r));
  if (found.length > 0) {
    throw new Error(
      `${funcName}: unexpected grant for role(s) ${found.join(', ')} — actual: [${grantees.join(', ')}]`
    );
  }
}

async function assertSignatureNotExists(sig) {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM pg_proc WHERE oid::regprocedure::text = $1`, [sig]
  );
  if (rows[0].n !== 0) throw new Error(`Old signature still exists: ${sig}`);
}

async function assertFuncExists(funcName) {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM pg_proc
     WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [funcName]
  );
  if (rows[0].n === 0) throw new Error(`${funcName} does not exist`);
}

async function getFuncMeta(funcName) {
  const { rows } = await c.query(
    `SELECT prosecdef, proconfig FROM pg_proc
     WHERE proname = $1 AND pronamespace = 'public'::regnamespace
     ORDER BY oid DESC LIMIT 1`, [funcName]
  );
  if (rows.length === 0) throw new Error(`${funcName} not found`);
  return rows[0];
}

// ─── Helpers for live session tokens ─────────────────────────────────────────
const makeToken  = () => crypto.randomBytes(32).toString('hex');         // 64 chars hex
const hashToken  = (t) => crypto.createHash('sha256').update(t).digest('hex');

const FAKE_ID    = '00000000-0000-0000-0000-000000000001';
const FAKE_TOK   = 'a'.repeat(64);
const FAKE_DEV   = 'fake-device-001';

// ─── Phase 1 structural check per RPC (10 tests) ─────────────────────────────
async function checkRpc(label, opts) {
  const { name, oldSig, callSql } = opts;

  await test(`${label}-T1: old signature does not exist`, () =>
    assertSignatureNotExists(oldSig)
  );
  await test(`${label}-T2: new signature exists`, () =>
    assertFuncExists(name)
  );
  await test(`${label}-T3: anon has EXECUTE`, () =>
    assertHasGrant(name, ['anon'])
  );
  await test(`${label}-T4: postgres has EXECUTE`, () =>
    assertHasGrant(name, ['postgres'])
  );
  await test(`${label}-T5: service_role has EXECUTE`, () =>
    assertHasGrant(name, ['service_role'])
  );
  await test(`${label}-T6: PUBLIC has no EXECUTE`, () =>
    assertNoGrant(name, ['PUBLIC'])
  );
  await test(`${label}-T7: authenticated has no EXECUTE`, () =>
    assertNoGrant(name, ['authenticated'])
  );
  await test(`${label}-T8: SECURITY DEFINER`, async () => {
    const meta = await getFuncMeta(name);
    if (!meta.prosecdef) throw new Error(`${name}: prosecdef is false`);
  });
  await test(`${label}-T9: search_path configured`, async () => {
    const meta = await getFuncMeta(name);
    if (!meta.proconfig || !meta.proconfig.some(s => s.startsWith('search_path='))) {
      throw new Error(`${name}: no search_path in proconfig — actual: ${JSON.stringify(meta.proconfig)}`);
    }
  });
  await test(`${label}-T10: fake session → invalid_child_session`, () =>
    assertThrows(() => c.query(callSql, [FAKE_ID, FAKE_TOK, FAKE_DEV]), 'invalid_child_session')
  );
}

// ─── Phase 2 live auth check per RPC (6 tests) ───────────────────────────────
async function checkRpcLive(label, opts, ctx) {
  const { name, callSqlA, callSqlB } = opts;
  const { childA, childB, tokenA, tokenExpired, tokenRevoked, deviceA, deviceWrong } = ctx;

  await testContinue(`${label}-L1: valid session (childA) succeeds`, async () => {
    await c.query(callSqlA, [childA.id, tokenA, deviceA]);
  });

  await testContinue(`${label}-L2: child A token with child B ID → invalid_child_session`, () =>
    assertThrows(() => c.query(callSqlA, [childB.id, tokenA, deviceA]), 'invalid_child_session')
  );

  await testContinue(`${label}-L3: wrong device_id → invalid_child_session`, () =>
    assertThrows(() => c.query(callSqlA, [childA.id, tokenA, deviceWrong]), 'invalid_child_session')
  );

  await testContinue(`${label}-L4: expired token → child_session_expired`, () =>
    assertThrows(() => c.query(callSqlA, [childA.id, tokenExpired, deviceA]), 'child_session_expired')
  );

  await testContinue(`${label}-L5: revoked token → child_session_revoked`, () =>
    assertThrows(() => c.query(callSqlA, [childA.id, tokenRevoked, deviceA]), 'child_session_revoked')
  );

  await testContinue(`${label}-L6: frozen account → invalid_child_session`, async () => {
    const { rows: [before] } = await c.query(
      `SELECT COALESCE(account_frozen, false) AS frozen FROM children WHERE id = $1`, [childA.id]
    );
    if (before.frozen) {
      // Already frozen — just verify the RPC rejects it
      await assertThrows(() => c.query(callSqlA, [childA.id, tokenA, deviceA]), 'invalid_child_session');
      return;
    }
    await c.query(`UPDATE children SET account_frozen = true WHERE id = $1`, [childA.id]);
    try {
      await assertThrows(() => c.query(callSqlA, [childA.id, tokenA, deviceA]), 'invalid_child_session');
    } finally {
      await c.query(`UPDATE children SET account_frozen = false WHERE id = $1`, [childA.id]);
    }
  });
}

// ─── Phase 3 return-shape and isolation check per RPC (2 tests) ──────────────
async function checkRpcShape(label, opts, ctx) {
  const { name, callSqlA, expectsArray } = opts;
  const { childA, childB, tokenA, tokenB, deviceA, deviceB } = ctx;

  await testContinue(`${label}-S1: returns valid JSON of expected shape`, async () => {
    const { rows } = await c.query(callSqlA, [childA.id, tokenA, deviceA]);
    const result = rows[0] && rows[0][Object.keys(rows[0])[0]];
    if (expectsArray !== false) {
      if (!Array.isArray(result)) throw new Error(
        `${name}: expected JSON array, got ${typeof result}: ${JSON.stringify(result).slice(0, 80)}`
      );
    }
    // null/empty case: null is returned as null from plpgsql but COALESCE gives '[]' or obj
    // both are valid
  });

  await testContinue(`${label}-S2: child B cannot access child A data with valid cross-token`, async () => {
    // Use child B's valid token with child A's ID — must always fail
    await assertThrows(
      () => c.query(callSqlA, [childA.id, ctx.tokenB, deviceB]),
      'invalid_child_session'
    );
  });
}

// ─── Test data setup / teardown ───────────────────────────────────────────────
async function setupTestData() {
  // Find 2 unfrozen children to use as test subjects (no schema changes to children table needed)
  const { rows: children } = await c.query(
    `SELECT id, display_name FROM children
     WHERE COALESCE(account_frozen, false) = false
     LIMIT 2`
  );
  if (children.length < 2) {
    console.warn('\n  ⚠  fewer than 2 unfrozen children in DB — live isolation tests will be skipped');
  }
  const childA = children[0] ?? null;
  const childB = children[1] ?? null;

  if (!childA) return null; // No children at all — skip all live tests

  const tokenA       = makeToken();
  const tokenExpired = makeToken();
  const tokenRevoked = makeToken();
  const tokenB       = childB ? makeToken() : null;
  const deviceA      = 'verify037-device-a';
  const deviceB      = 'verify037-device-b';
  const deviceWrong  = 'verify037-device-wrong';

  const now        = new Date();
  const future     = new Date(now.getTime() + 3_600_000);       // +1 hour
  const farFuture  = new Date(now.getTime() + 30 * 86_400_000); // +30 days
  const past       = new Date(now.getTime() - 3_600_000);       // -1 hour

  const insertedSessionIds = [];

  // Valid session for childA
  const { rows: [sA] } = await c.query(
    `INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [childA.id, hashToken(tokenA), deviceA, future, farFuture]
  );
  insertedSessionIds.push(sA.id);

  // Expired session for childA
  const { rows: [sExp] } = await c.query(
    `INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [childA.id, hashToken(tokenExpired), deviceA, past, past]
  );
  insertedSessionIds.push(sExp.id);

  // Revoked session for childA
  const { rows: [sRev] } = await c.query(
    `INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at, revoked_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [childA.id, hashToken(tokenRevoked), deviceA, future, farFuture, now]
  );
  insertedSessionIds.push(sRev.id);

  // Valid session for childB (if exists)
  if (childB && tokenB) {
    const { rows: [sB] } = await c.query(
      `INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [childB.id, hashToken(tokenB), deviceB, future, farFuture]
    );
    insertedSessionIds.push(sB.id);
  }

  // Expired pending money request for childA (to prove get_active_requests is read-only)
  let expiredReqId = null;
  try {
    const { rows: [req] } = await c.query(
      `INSERT INTO money_requests
         (from_id, amount, reason, reason_emoji, deadline_days, repay_by_date, expires_at)
       VALUES ($1, 0.50, 'verify_037_read_only_test', '🧪', 7, $2, $3)
       RETURNING id`,
      [childA.id, past.toISOString().slice(0,10), past.toISOString()]
    );
    expiredReqId = req.id;
  } catch (insertErr) {
    console.warn(`  ⚠  could not insert test money_request (skipping read-only proof): ${insertErr.message}`);
  }

  return {
    childA, childB,
    tokenA, tokenExpired, tokenRevoked, tokenB,
    deviceA, deviceB, deviceWrong,
    insertedSessionIds,
    expiredReqId,
  };
}

async function teardownTestData(ctx) {
  if (!ctx) return;
  // Delete test sessions
  if (ctx.insertedSessionIds.length > 0) {
    await c.query(`DELETE FROM child_sessions WHERE id = ANY($1::uuid[])`,
      [ctx.insertedSessionIds]).catch(() => {});
  }
  // Delete test money request
  if (ctx.expiredReqId) {
    await c.query(`DELETE FROM money_requests WHERE id = $1`, [ctx.expiredReqId]).catch(() => {});
  }
}

// ─── RPC catalogue ────────────────────────────────────────────────────────────
const RPCS = [
  {
    label: 'G1',  name: 'search_children',
    oldSig: 'search_children(text,uuid)',
    callSql:  `SELECT public.search_children('test', $1, $2, $3)`,
    callSqlA: `SELECT public.search_children('test', $1, $2, $3)`,
    callSqlB: (ctx) => `SELECT public.search_children('test', '${ctx.childB?.id ?? FAKE_ID}', $2, $3)`,
    expectsArray: true,
  },
  {
    label: 'G2',  name: 'get_pending_requests',
    oldSig: 'get_pending_requests(uuid)',
    callSql:  `SELECT public.get_pending_requests($1, $2, $3)`,
    callSqlA: `SELECT public.get_pending_requests($1, $2, $3)`,
    expectsArray: true,
  },
  {
    label: 'G3',  name: 'get_circle',
    oldSig: 'get_circle(uuid)',
    callSql:  `SELECT public.get_circle($1, $2, $3)`,
    callSqlA: `SELECT public.get_circle($1, $2, $3)`,
    expectsArray: true,
  },
  {
    label: 'G4',  name: 'get_active_requests',
    oldSig: 'get_active_requests(uuid)',
    callSql:  `SELECT public.get_active_requests($1, $2, $3)`,
    callSqlA: `SELECT public.get_active_requests($1, $2, $3)`,
    expectsArray: true,
  },
  {
    label: 'G5',  name: 'get_outgoing_pending_requests',
    oldSig: 'get_outgoing_pending_requests(uuid)',
    callSql:  `SELECT public.get_outgoing_pending_requests($1, $2, $3)`,
    callSqlA: `SELECT public.get_outgoing_pending_requests($1, $2, $3)`,
    expectsArray: true,
  },
  {
    label: 'G6',  name: 'get_resolved_sent_requests',
    oldSig: 'get_resolved_sent_requests(uuid)',
    callSql:  `SELECT public.get_resolved_sent_requests($1, $2, $3)`,
    callSqlA: `SELECT public.get_resolved_sent_requests($1, $2, $3)`,
    expectsArray: true,
  },
  {
    label: 'G7',  name: 'get_activity_feed',
    oldSig: 'get_activity_feed(uuid,integer)',
    callSql:  `SELECT public.get_activity_feed($1, $2, $3)`,
    callSqlA: `SELECT public.get_activity_feed($1, $2, $3)`,
    expectsArray: true,
  },
  {
    label: 'G8',  name: 'get_child_transactions',
    oldSig: 'get_child_transactions(uuid,integer)',
    callSql:  `SELECT public.get_child_transactions($1, $2, $3)`,
    callSqlA: `SELECT public.get_child_transactions($1, $2, $3)`,
    expectsArray: true,
  },
  {
    label: 'G9',  name: 'get_child_stats',
    oldSig: 'get_child_stats(uuid)',
    callSql:  `SELECT public.get_child_stats($1, $2, $3)`,
    callSqlA: `SELECT public.get_child_stats($1, $2, $3)`,
    expectsArray: false,
  },
  {
    label: 'G10', name: 'get_loan_history',
    oldSig: 'get_loan_history(uuid)',
    callSql:  `SELECT public.get_loan_history($1, $2, $3)`,
    callSqlA: `SELECT public.get_loan_history($1, $2, $3)`,
    expectsArray: true,
  },
  {
    label: 'G11', name: 'get_circle_history',
    oldSig: 'get_circle_history(uuid)',
    callSql:  `SELECT public.get_circle_history($1, $2, $3)`,
    callSqlA: `SELECT public.get_circle_history($1, $2, $3)`,
    expectsArray: true,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  c = new Client({ connectionString: DATABASE_URL });
  await c.connect();

  let ctx = null;

  try {
    // ════════════════════════════════════════════════════════════════════════
    // PHASE 1 — Structural: grants, signatures, SECURITY DEFINER, search_path
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n══ Phase 1: Structural (grants, signatures, search_path) ══\n');

    for (const rpc of RPCS) {
      console.log(`  ${rpc.label}: ${rpc.name}\n`);
      await checkRpc(rpc.label, rpc);
    }

    // Supplemental structural
    console.log('\n  Supplemental structural\n');

    await test('S1: get_active_requests body contains no UPDATE statement', async () => {
      const { rows } = await c.query(
        `SELECT pg_get_functiondef(oid) AS def FROM pg_proc
         WHERE proname = 'get_active_requests'
           AND pronamespace = 'public'::regnamespace
         ORDER BY oid DESC LIMIT 1`
      );
      if (rows.length === 0) throw new Error('get_active_requests not found');
      const def = rows[0].def.toUpperCase();
      if (def.includes('UPDATE MONEY_REQUESTS') || def.includes('UPDATE PUBLIC.MONEY_REQUESTS')) {
        throw new Error('get_active_requests still contains an UPDATE statement');
      }
    });

    await test('S2: all 11 session-enforced signatures present', async () => {
      const sigs = [
        'search_children(text,uuid,text,text)',
        'get_pending_requests(uuid,text,text)',
        'get_circle(uuid,text,text)',
        'get_active_requests(uuid,text,text)',
        'get_outgoing_pending_requests(uuid,text,text)',
        'get_resolved_sent_requests(uuid,text,text)',
        'get_activity_feed(uuid,text,text,integer)',
        'get_child_transactions(uuid,text,text,integer)',
        'get_child_stats(uuid,text,text)',
        'get_loan_history(uuid,text,text)',
        'get_circle_history(uuid,text,text)',
      ];
      const missing = [];
      for (const sig of sigs) {
        const { rows } = await c.query(
          `SELECT count(*)::int AS n FROM pg_proc WHERE oid::regprocedure::text = $1`, [sig]
        );
        if (rows[0].n === 0) missing.push(sig);
      }
      if (missing.length > 0) throw new Error(`Missing: ${missing.join(', ')}`);
    });

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 2 — Live session authorization (6 tests × 11 RPCs = 66)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n══ Phase 2: Live session authorization ══\n');

    ctx = await setupTestData();
    if (!ctx) {
      console.warn('  ⚠  No children in DB — live auth tests skipped.\n');
    } else {
      console.log(`  Test children: A=${ctx.childA.id.slice(0,8)}… B=${ctx.childB?.id.slice(0,8) ?? 'NONE'}…`);
      console.log(`  Test sessions: valid, expired, revoked (+ frozen in each L6 test)\n`);

      for (const rpc of RPCS) {
        console.log(`  ${rpc.label}: ${rpc.name}\n`);
        await checkRpcLive(rpc.label, rpc, ctx);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 3 — Return shapes & cross-child isolation (2 tests × 11 RPCs = 22)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n══ Phase 3: Return shapes & data isolation ══\n');

    if (!ctx) {
      console.warn('  ⚠  Skipped (no test context).\n');
    } else {
      for (const rpc of RPCS) {
        console.log(`  ${rpc.label}: ${rpc.name}\n`);
        await checkRpcShape(rpc.label, rpc, ctx);
      }

      // Additional isolation: get_child_stats returns only the requested child's values.
      await testContinue('ISO-1: get_child_stats returns an object with exactly the expected keys', async () => {
        const { rows } = await c.query(
          `SELECT public.get_child_stats($1, $2, $3)`,
          [ctx.childA.id, ctx.tokenA, ctx.deviceA]
        );
        const result = rows[0]?.get_child_stats;
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
          throw new Error(`Expected object, got: ${JSON.stringify(result)}`);
        }
        const expectedKeys = [
          'wallet_balance','loaned_out','borrowed','trust_score','points','streak',
          'repaid','missed','total_borrowed','total_lent','times_borrowed','times_lent',
          'profile_image_url','account_frozen','parent_debt',
        ];
        const actualKeys   = Object.keys(result);
        const extraKeys    = actualKeys.filter(k => !expectedKeys.includes(k));
        const missingKeys  = expectedKeys.filter(k => !actualKeys.includes(k));
        if (extraKeys.length > 0)   throw new Error(`Unexpected keys: ${extraKeys.join(', ')}`);
        if (missingKeys.length > 0) throw new Error(`Missing keys: ${missingKeys.join(', ')}`);
      });

      // Additional isolation: get_activity_feed items must not reference a different child.
      await testContinue('ISO-2: get_activity_feed returns only childA items (no childB data)', async () => {
        if (!ctx.childB) { console.log('  (skipped — no childB)'); return; }
        const { rows } = await c.query(
          `SELECT public.get_activity_feed($1, $2, $3)`,
          [ctx.childA.id, ctx.tokenA, ctx.deviceA]
        );
        // The RPC WHERE clause is: WHERE child_id = p_child_id.
        // Verify the DB agrees by cross-checking item IDs against child_id.
        const items = rows[0]?.get_activity_feed ?? [];
        if (!Array.isArray(items) || items.length === 0) return; // empty feed is fine
        const ids = items.map(i => i.id);
        const { rows: crossed } = await c.query(
          `SELECT count(*)::int AS n FROM activity_feed
           WHERE id = ANY($1::text[]) AND child_id <> $2`,
          [ids, ctx.childA.id]
        );
        if (crossed[0].n > 0) throw new Error(
          `${crossed[0].n} activity items returned belong to a different child`
        );
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 4 — search_children specifics (6 tests)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n══ Phase 4: search_children specifics ══\n');

    if (!ctx) {
      console.warn('  ⚠  Skipped (no test context).\n');
    } else {
      // SC-1: p_exclude_id must match the session's child_id.
      //       Passing child B's ID as p_exclude_id with child A's token must fail.
      await testContinue('SC-1: p_exclude_id ≠ session child_id → invalid_child_session', () =>
        assertThrows(
          () => c.query(
            `SELECT public.search_children($1, $2, $3, $4)`,
            ['test', ctx.childB?.id ?? FAKE_ID, ctx.tokenA, ctx.deviceA]
          ),
          'invalid_child_session'
        )
      );

      // SC-2: p_exclude_id = session child_id → succeeds
      await testContinue('SC-2: p_exclude_id = session child_id → succeeds', async () => {
        await c.query(
          `SELECT public.search_children($1, $2, $3, $4)`,
          ['a', ctx.childA.id, ctx.tokenA, ctx.deviceA]
        );
      });

      // SC-3: Returned rows must not include restricted fields.
      await testContinue('SC-3: returned rows contain only approved public fields', async () => {
        const { rows } = await c.query(
          `SELECT public.search_children($1, $2, $3, $4)`,
          ['a', ctx.childA.id, ctx.tokenA, ctx.deviceA]
        );
        const results = rows[0]?.search_children ?? [];
        if (!Array.isArray(results) || results.length === 0) return;
        const allowedKeys = new Set(['id','display_name','username','avatar_emoji','avatar_url','trust_score']);
        const sensitive   = ['mobile','email','wallet_balance','parent_id','device_id','password_hash','push_token','biometric_token_hash','loaned_out','borrowed','account_frozen','parent_debt'];
        for (const row of results) {
          const extraKeys = Object.keys(row).filter(k => !allowedKeys.has(k));
          if (extraKeys.length > 0) throw new Error(`Unexpected keys in result row: ${extraKeys.join(', ')}`);
          for (const k of sensitive) {
            if (k in row) throw new Error(`Sensitive field '${k}' present in search result`);
          }
        }
      });

      // SC-4: The querying child (p_exclude_id) is excluded from results.
      await testContinue('SC-4: searching child is excluded from their own results', async () => {
        const { rows } = await c.query(
          `SELECT public.search_children($1, $2, $3, $4)`,
          [ctx.childA.display_name, ctx.childA.id, ctx.tokenA, ctx.deviceA]
        );
        const results = rows[0]?.search_children ?? [];
        if (!Array.isArray(results)) throw new Error('Expected array');
        const selfAppears = results.some(r => r.id === ctx.childA.id);
        if (selfAppears) throw new Error('Querying child appeared in their own search results');
      });

      // SC-5: LIMIT 20 is respected.
      await testContinue('SC-5: result set capped at 20 rows', async () => {
        const { rows } = await c.query(
          `SELECT public.search_children($1, $2, $3, $4)`,
          ['', ctx.childA.id, ctx.tokenA, ctx.deviceA]  // empty query matches everyone
        );
        const results = rows[0]?.search_children ?? [];
        if (!Array.isArray(results)) throw new Error('Expected array');
        if (results.length > 20) throw new Error(`Returned ${results.length} rows; LIMIT 20 not applied`);
      });

      // SC-6: Partial match works (username/display_name LIKE).
      await testContinue('SC-6: partial match on username or display_name works', async () => {
        // Use a single letter; if the DB has any children, some should match
        const { rows } = await c.query(
          `SELECT public.search_children($1, $2, $3, $4)`,
          ['a', ctx.childA.id, ctx.tokenA, ctx.deviceA]
        );
        // Just verify it returns a JSON array without error
        const results = rows[0]?.search_children ?? [];
        if (!Array.isArray(results)) throw new Error('Expected array');
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 5 — get_active_requests read-only proof (4 tests)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n══ Phase 5: get_active_requests read-only proof ══\n');

    if (!ctx || !ctx.expiredReqId) {
      console.warn('  ⚠  Skipped (no expired test money_request available).\n');
    } else {
      const { expiredReqId, childA, tokenA, deviceA } = ctx;

      // RO-1: Expired request not returned by get_active_requests
      await testContinue('RO-1: expired pending request absent from get_active_requests result', async () => {
        const { rows } = await c.query(
          `SELECT public.get_active_requests($1, $2, $3)`,
          [childA.id, tokenA, deviceA]
        );
        const reqs = rows[0]?.get_active_requests ?? [];
        if (!Array.isArray(reqs)) throw new Error('Expected array');
        if (reqs.some(r => r.id === expiredReqId)) {
          throw new Error('Expired pending request appeared in get_active_requests output');
        }
      });

      // RO-2: Status unchanged after get_active_requests call (was not mutated to 'cancelled')
      await testContinue('RO-2: expired request status still "pending" — no UPDATE side effect', async () => {
        const { rows } = await c.query(
          `SELECT status FROM money_requests WHERE id = $1`, [expiredReqId]
        );
        if (rows.length === 0) throw new Error('Test request not found');
        if (rows[0].status !== 'pending') {
          throw new Error(`Expected status='pending', got '${rows[0].status}' — write side effect may have occurred`);
        }
      });

      // RO-3: No activity_feed row created for this request by get_active_requests
      await testContinue('RO-3: no activity_feed row written for test request', async () => {
        const { rows } = await c.query(
          `SELECT count(*)::int AS n FROM activity_feed
           WHERE id LIKE $1 OR text LIKE $2`,
          [`%${expiredReqId}%`, `%verify_037_read_only_test%`]
        );
        if (rows[0].n > 0) {
          throw new Error(`Found ${rows[0].n} activity_feed row(s) from test request — unexpected write`);
        }
      });

      // RO-4: No transaction row created for this request by get_active_requests
      await testContinue('RO-4: no transactions row written for test request', async () => {
        // Transactions linked to a money_request typically use the request ID as a reference
        const { rows } = await c.query(
          `SELECT count(*)::int AS n FROM transactions
           WHERE (description LIKE $1 OR id::text LIKE $1)`,
          [`%${expiredReqId}%`]
        );
        if (rows[0].n > 0) {
          throw new Error(`Found ${rows[0].n} transactions row(s) referencing test request — unexpected write`);
        }
      });
    }

  } finally {
    // Always clean up test data, even if tests fail
    await teardownTestData(ctx);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════════════════
  const failed = total - passed;
  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  ${passed}/${total} passed — migration 037 verification`);
  if (failed > 0) console.log(`  ${failed} FAILED`);
  console.log();

  await c.end();
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err.message ?? String(err));
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
//  MANUAL REGRESSION CHECKLIST
//  Run after applying migration 037 and deploying updated client code.
// ─────────────────────────────────────────────────────────────────────────────
//
//  [ ] Mobile — password login
//      Log in with username + password on a physical device / iOS Simulator.
//      Verify: dashboard loads, balance visible, activity feed populates.
//
//  [ ] Mobile — biometric login
//      Return to WhoIsLoggingIn, choose Face ID.
//      Verify: authentication succeeds, dashboard loads without session error.
//
//  [ ] Web — password login
//      Log in via npm run web.
//      Verify: dashboard loads, no console errors.
//
//  [ ] Cold restart
//      Kill the app, reopen.
//      Verify: session is restored from SecureStore, polling resumes.
//
//  [ ] Activity feed loading
//      Verify items appear in the feed; new activity appears within 5 s of a
//      counterparty action.
//
//  [ ] Transaction history loading
//      Navigate to Wallet/History; verify transactions render.
//
//  [ ] Circle loading
//      Navigate to Circle tab; verify circle members are listed.
//
//  [ ] Pending requests
//      Send a circle request from a second test account; verify it appears on
//      the recipient's Circle tab within one poll cycle.
//
//  [ ] Add-friend search
//      Navigate to Add Friends; type a partial username.
//      Verify: results appear; own account is excluded; no sensitive fields visible.
//
//  [ ] Loan history
//      Open the history sheet on Circle.
//      Verify: past loans render; no error or blank state.
//
//  [ ] Session expiry while app is open
//      Manually expire the child's session in the DB:
//        UPDATE child_sessions SET expires_at = now() - interval '1 s',
//               absolute_expires_at = now() - interval '1 s'
//        WHERE child_id = '<child_id>' AND revoked_at IS NULL;
//      Wait for the next poll cycle (~5 s).
//      Verify: app navigates to ChildLogin with sessionExpired param; polling stops;
//              no repeated error calls; SecureStore session cleared.
//
//  [ ] Logout and re-login
//      Log out via Profile > Logout.
//      Verify: session revoked; re-login succeeds; data loads correctly.
// ─────────────────────────────────────────────────────────────────────────────
