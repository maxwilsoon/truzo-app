/**
 * M048 regression tests — secure push-token account switching
 *
 * Run: node supabase/verify_048.js
 *
 * Requires SUPABASE_SERVICE_ROLE env var or falls back to the hardcoded key.
 * Tests call register_child_device_token and deregister_child_device_token via
 * the Supabase Management API so no pg driver is needed.
 *
 * Children used:
 *   A = Hudson Red  (c69bee88-3c1e-4512-bf18-b91e16536af5)
 *   B = Daisy Corcut (6df9ed7d-17c2-4e6a-b1eb-8cb7a822f350)
 *   C = Maya Wilson  (ea5c7f58-6360-402a-8223-42d4d50e02db)
 */

const crypto    = require('crypto');
const PROJECT   = 'biilrksornvoqtalftty';
const BASE_URL  = `https://${PROJECT}.supabase.co`;
const MGMT_URL  = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`;
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN;
const SVC_KEY    = process.env.SUPABASE_SERVICE_ROLE;
if (!MGMT_TOKEN) { console.error('Set SUPABASE_MGMT_TOKEN env var'); process.exit(1); }
if (!SVC_KEY)    { console.error('Set SUPABASE_SERVICE_ROLE env var'); process.exit(1); }

const CHILD_A = 'c69bee88-3c1e-4512-bf18-b91e16536af5'; // Hudson Red
const CHILD_B = '6df9ed7d-17c2-4e6a-b1eb-8cb7a822f350'; // Daisy Corcut
const CHILD_C = 'ea5c7f58-6360-402a-8223-42d4d50e02db'; // Maya Wilson

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sql(query) {
  const res = await fetch(MGMT_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (res.status >= 400) throw new Error(`SQL error: ${JSON.stringify(body)}`);
  return body; // array of rows
}

async function rpc(name, params) {
  const res = await fetch(`${BASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SVC_KEY}`,
      'apikey': SVC_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (res.status === 204 || res.status === 200) {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const body = await res.json();
  // PostgREST wraps DB exceptions as { code, message }
  const err = new Error(body.message || JSON.stringify(body));
  err.code = body.code;
  err.hint = body.hint;
  throw err;
}

/** Create a test child session directly (bypasses password check) */
async function loginChild(childId) {
  // require_valid_child_session enforces length(token) = 64; use a 64-char hex string.
  const token    = crypto.randomBytes(32).toString('hex'); // 64 hex chars
  const deviceId = `testdev-${childId.slice(0, 8)}-${Date.now()}`;
  // Hash computed in Node so we don't depend on pgcrypto being in search_path.
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await sql(`
    INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (
      '${childId}',
      '${tokenHash}',
      '${deviceId}',
      now() + interval '1 hour',
      now() + interval '30 days'
    )
  `);
  return { session_token: token, device_id: deviceId };
}

/** Delete all device_tokens rows matching a push token — test teardown */
async function clearToken(expoToken) {
  await sql(`DELETE FROM device_tokens WHERE expo_push_token = '${expoToken}'`);
}

/** Revoke all test sessions created in this run */
async function clearSessions(deviceIds) {
  for (const d of deviceIds) {
    await sql(`UPDATE child_sessions SET revoked_at = now(), revoked_reason = 'test_teardown'
               WHERE device_id = '${d}' AND revoked_at IS NULL`);
  }
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const sessions = []; // track device_ids for teardown

async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('PASS');
    passed++;
  } catch (e) {
    console.log(`FAIL — ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

async function assertRpcError(fn, expectedMsgFragment) {
  try {
    await fn();
    throw new Error(`expected error '${expectedMsgFragment}' but RPC succeeded`);
  } catch (e) {
    if (!e.message.includes(expectedMsgFragment)) throw e;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

(async () => {
  console.log('\nM048 regression tests — secure push-token account switching\n');

  const TOKEN_X  = `ExponentPushToken[test-M048-X-${Date.now()}]`;
  const TOKEN_Y  = `ExponentPushToken[test-M048-Y-${Date.now()}]`;

  let sessA, sessB, sessC;

  // ── Setup ─────────────────────────────────────────────────────────────────

  try {
    sessA = await loginChild(CHILD_A);
    sessB = await loginChild(CHILD_B);
    sessC = await loginChild(CHILD_C);
    sessions.push(sessA.device_id, sessB.device_id, sessC.device_id);
  } catch (e) {
    console.error('SETUP FAILED:', e.message);
    process.exit(1);
  }

  // ── T01: Fresh device — first-time registration succeeds ─────────────────
  await test('T01 fresh device: first-time registration succeeds', async () => {
    await clearToken(TOKEN_X);
    await rpc('register_child_device_token', {
      p_child_id: CHILD_A, p_session_token: sessA.session_token,
      p_device_id: sessA.device_id, p_expo_push_token: TOKEN_X, p_platform: 'ios',
    });
    const [row] = await sql(`SELECT user_id, active FROM device_tokens WHERE expo_push_token = '${TOKEN_X}'`);
    assert(row, 'row should exist');
    assert(row.user_id === CHILD_A, 'user_id should be Child A');
    assert(row.active === true, 'token should be active');
  });

  // ── T02: Same user re-registers their own active token ───────────────────
  await test('T02 same user re-register active token: allowed (idempotent)', async () => {
    await rpc('register_child_device_token', {
      p_child_id: CHILD_A, p_session_token: sessA.session_token,
      p_device_id: sessA.device_id, p_expo_push_token: TOKEN_X, p_platform: 'ios',
    });
    const [row] = await sql(`SELECT user_id, active FROM device_tokens WHERE expo_push_token = '${TOKEN_X}'`);
    assert(row.user_id === CHILD_A, 'owner unchanged');
    assert(row.active === true, 'still active');
  });

  // ── T03: Different user, token ACTIVE → blocked (M039 preserved) ─────────
  await test('T03 different user claims ACTIVE token: token_owned_by_another_user (M039)', async () => {
    // TOKEN_X is active and owned by A. B must NOT be able to claim it.
    await assertRpcError(
      () => rpc('register_child_device_token', {
        p_child_id: CHILD_B, p_session_token: sessB.session_token,
        p_device_id: sessB.device_id, p_expo_push_token: TOKEN_X, p_platform: 'android',
      }),
      'token_owned_by_another_user',
    );
    // Verify ownership unchanged
    const [row] = await sql(`SELECT user_id, active FROM device_tokens WHERE expo_push_token = '${TOKEN_X}'`);
    assert(row.user_id === CHILD_A, 'owner must still be A');
    assert(row.active === true, 'must still be active');
  });

  // ── T04: Proper logout — deregister sets active = false ──────────────────
  await test('T04 authenticated logout sets active=false (does not delete row)', async () => {
    await rpc('deregister_child_device_token', {
      p_child_id: CHILD_A, p_session_token: sessA.session_token,
      p_device_id: sessA.device_id, p_expo_push_token: TOKEN_X,
    });
    const [row] = await sql(`SELECT user_id, active FROM device_tokens WHERE expo_push_token = '${TOKEN_X}'`);
    assert(row, 'row must still exist (not deleted)');
    assert(row.user_id === CHILD_A, 'user_id preserved for audit trail');
    assert(row.active === false, 'active must be false after deregister');
  });

  // ── T05: Different user claims INACTIVE token — allowed (account switch) ─
  await test('T05 different user claims INACTIVE token after proper logout: allowed', async () => {
    // TOKEN_X is now active=false (A logged out). B should be able to claim it.
    await rpc('register_child_device_token', {
      p_child_id: CHILD_B, p_session_token: sessB.session_token,
      p_device_id: sessB.device_id, p_expo_push_token: TOKEN_X, p_platform: 'android',
    });
    const [row] = await sql(`SELECT user_id, active FROM device_tokens WHERE expo_push_token = '${TOKEN_X}'`);
    assert(row.user_id === CHILD_B, 'owner must be transferred to B');
    assert(row.active === true, 'token must be active again for B');
  });

  // ── T06: A can no longer receive notifications on this device ─────────────
  await test('T06 after transfer: no active token for A on this push token', async () => {
    const rows = await sql(
      `SELECT * FROM device_tokens WHERE expo_push_token = '${TOKEN_X}' AND user_id = '${CHILD_A}' AND active = true`
    );
    assert(rows.length === 0, 'A must have no active token for TOKEN_X');
  });

  // ── T07: Race — two users try to claim same inactive token simultaneously ─
  await test('T07 race condition: only one of two concurrent claimants wins', async () => {
    // Set TOKEN_X back to inactive to simulate the race start
    await sql(`UPDATE device_tokens SET active = false WHERE expo_push_token = '${TOKEN_X}'`);

    const results = await Promise.allSettled([
      rpc('register_child_device_token', {
        p_child_id: CHILD_A, p_session_token: sessA.session_token,
        p_device_id: sessA.device_id, p_expo_push_token: TOKEN_X,
      }),
      rpc('register_child_device_token', {
        p_child_id: CHILD_C, p_session_token: sessC.session_token,
        p_device_id: sessC.device_id, p_expo_push_token: TOKEN_X,
      }),
    ]);

    const wins   = results.filter(r => r.status === 'fulfilled').length;
    const losses = results.filter(r => r.status === 'rejected').length;
    assert(wins === 1 && losses === 1,
      `Expected exactly 1 winner and 1 loser, got wins=${wins} losses=${losses}`);

    const [row] = await sql(`SELECT user_id, active FROM device_tokens WHERE expo_push_token = '${TOKEN_X}'`);
    assert(row.active === true, 'winning token must be active');
    assert([CHILD_A, CHILD_C].includes(row.user_id), 'winner must be A or C');
  });

  // ── T08: Deregister with wrong user — no effect (user_id guard) ───────────
  await test('T08 deregister with wrong child_id: no rows affected, token stays active', async () => {
    // TOKEN_X is owned by A or C (whichever won T07). Try to deregister as the other.
    const [row] = await sql(`SELECT user_id FROM device_tokens WHERE expo_push_token = '${TOKEN_X}' LIMIT 1`);
    const wrongChild = row.user_id === CHILD_A ? CHILD_C : CHILD_A;
    const wrongSess  = row.user_id === CHILD_A ? sessC : sessA;
    // deregister_child_device_token runs require_valid_child_session first.
    // The session belongs to wrongChild so the session check passes,
    // but the WHERE user_id = wrongChild won't match TOKEN_X's owner → 0 rows.
    // No exception is raised (silent no-op), token stays active.
    await rpc('deregister_child_device_token', {
      p_child_id: wrongChild, p_session_token: wrongSess.session_token,
      p_device_id: wrongSess.device_id, p_expo_push_token: TOKEN_X,
    });
    const [after] = await sql(`SELECT active FROM device_tokens WHERE expo_push_token = '${TOKEN_X}'`);
    assert(after.active === true, 'token must still be active — wrong user cannot deregister it');
  });

  // ── T09: Registration with invalid/empty push token ──────────────────────
  await test('T09 register null/empty expo token: invalid_push_token', async () => {
    await assertRpcError(
      () => rpc('register_child_device_token', {
        p_child_id: CHILD_A, p_session_token: sessA.session_token,
        p_device_id: sessA.device_id, p_expo_push_token: '',
      }),
      'invalid_push_token',
    );
  });

  // ── T10: Registration with invalid session ────────────────────────────────
  await test('T10 register with invalid session token: invalid_child_session', async () => {
    await clearToken(TOKEN_Y);
    await assertRpcError(
      () => rpc('register_child_device_token', {
        p_child_id: CHILD_A, p_session_token: 'not-a-real-session-token',
        p_device_id: sessA.device_id, p_expo_push_token: TOKEN_Y,
      }),
      'invalid_child_session',
    );
    // Verify no row was inserted
    const rows = await sql(`SELECT * FROM device_tokens WHERE expo_push_token = '${TOKEN_Y}'`);
    assert(rows.length === 0, 'no token row should exist after invalid-session attempt');
  });

  // ── Teardown ──────────────────────────────────────────────────────────────
  await clearToken(TOKEN_X);
  await clearToken(TOKEN_Y);
  await clearSessions(sessions);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
