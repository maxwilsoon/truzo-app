/**
 * M050 regression tests — block guard: active loan outstanding
 *
 * Run: node supabase/verify_050.js
 *
 * Requires SUPABASE_MGMT_TOKEN and SUPABASE_SERVICE_ROLE env vars.
 *
 * Children used:
 *   A = Hudson Red   (c69bee88-3c1e-4512-bf18-b91e16536af5)
 *   B = Daisy Corcut (6df9ed7d-17c2-4e6a-b1eb-8cb7a822f350)
 *   C = Maya Wilson  (ea5c7f58-6360-402a-8223-42d4d50e02db)
 */

const crypto   = require('crypto');
const PROJECT  = 'biilrksornvoqtalftty';
const BASE_URL = `https://${PROJECT}.supabase.co`;
const MGMT_URL = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`;

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
  return body;
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
  const err = new Error(body.message || JSON.stringify(body));
  err.code = body.code;
  throw err;
}

async function loginChild(childId) {
  const token    = crypto.randomBytes(32).toString('hex');
  const deviceId = `testdev-050-${childId.slice(0, 8)}-${Date.now()}`;
  const hash     = crypto.createHash('sha256').update(token).digest('hex');
  await sql(`
    INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (
      '${childId}', '${hash}', '${deviceId}',
      now() + interval '1 hour',
      now() + interval '30 days'
    )
  `);
  return { session_token: token, device_id: deviceId };
}

async function insertFundedLoan(borrowerId, funderId, amount, reqId) {
  await sql(`
    INSERT INTO money_requests (id, from_id, funded_by, amount, reason, reason_emoji,
      deadline_days, repay_by_date, expires_at, status, safety_pool_reserved_amount)
    VALUES (
      '${reqId}', '${borrowerId}', '${funderId}', ${amount}, 'Test', '🧪',
      7, (now() + interval '7 days')::date, now() + interval '7 days',
      'funded', ${amount}
    )
  `);
}

async function clearSessions(deviceIds) {
  for (const d of deviceIds) {
    await sql(`
      UPDATE child_sessions SET revoked_at=now(), revoked_reason='test_teardown'
      WHERE device_id='${d}' AND revoked_at IS NULL
    `);
  }
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const sessions = [];

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

async function assertRpcError(fn, expectedFragment) {
  try {
    await fn();
    throw new Error(`expected error '${expectedFragment}' but RPC succeeded`);
  } catch (e) {
    if (!e.message.includes(expectedFragment)) throw e;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

(async () => {
  console.log('\nM050 regression tests — block guard: active loan outstanding\n');

  let sessA, sessB, sessC;

  try {
    sessA = await loginChild(CHILD_A);
    sessB = await loginChild(CHILD_B);
    sessC = await loginChild(CHILD_C);
    sessions.push(sessA.device_id, sessB.device_id, sessC.device_id);
  } catch (e) {
    console.error('SETUP FAILED:', e.message);
    process.exit(1);
  }

  // ── T01: A borrows from B → A cannot block B ──────────────────────────────
  await test('T01 A has outstanding loan from B → A cannot block B (active_loan_outstanding)', async () => {
    const reqId = crypto.randomUUID();
    await insertFundedLoan(CHILD_A, CHILD_B, 5.00, reqId); // A borrows from B
    try {
      await assertRpcError(
        () => rpc('block_user', {
          p_blocker_id: CHILD_A, p_session_token: sessA.session_token,
          p_device_id: sessA.device_id, p_blocked_id: CHILD_B,
        }),
        'active_loan_outstanding',
      );
      // Confirm no block row was inserted
      const [row] = await sql(`SELECT id FROM user_blocks WHERE blocker_id='${CHILD_A}' AND blocked_id='${CHILD_B}'`);
      assert(!row, 'no user_blocks row must exist — block must have been rejected');
    } finally {
      await sql(`DELETE FROM money_requests WHERE id='${reqId}'`);
    }
  });

  // ── T02: B lent to A → B also cannot block A ──────────────────────────────
  await test('T02 B lent to A → B cannot block A either (active_loan_outstanding)', async () => {
    const reqId = crypto.randomUUID();
    await insertFundedLoan(CHILD_A, CHILD_B, 3.00, reqId); // A borrows from B
    try {
      // The lender (B) also cannot block the borrower (A)
      await assertRpcError(
        () => rpc('block_user', {
          p_blocker_id: CHILD_B, p_session_token: sessB.session_token,
          p_device_id: sessB.device_id, p_blocked_id: CHILD_A,
        }),
        'active_loan_outstanding',
      );
      const [row] = await sql(`SELECT id FROM user_blocks WHERE blocker_id='${CHILD_B}' AND blocked_id='${CHILD_A}'`);
      assert(!row, 'no user_blocks row must exist');
    } finally {
      await sql(`DELETE FROM money_requests WHERE id='${reqId}'`);
    }
  });

  // ── T03: No loan → block succeeds ─────────────────────────────────────────
  await test('T03 no active loan between A and C → block_user succeeds', async () => {
    await rpc('block_user', {
      p_blocker_id: CHILD_A, p_session_token: sessA.session_token,
      p_device_id: sessA.device_id, p_blocked_id: CHILD_C,
    });
    try {
      const [row] = await sql(`SELECT id FROM user_blocks WHERE blocker_id='${CHILD_A}' AND blocked_id='${CHILD_C}'`);
      assert(row, 'user_blocks row must exist when no loan is outstanding');
    } finally {
      await sql(`DELETE FROM user_blocks WHERE blocker_id='${CHILD_A}' AND blocked_id='${CHILD_C}'`);
    }
  });

  // ── T04: Loan repaid → block is then allowed ───────────────────────────────
  await test('T04 after loan is repaid, block_user succeeds', async () => {
    const reqId = crypto.randomUUID();
    // Snapshot original wallet balances before any mutation
    const [snapA] = await sql(`SELECT wallet_balance FROM children WHERE id='${CHILD_A}'`);
    const [snapB] = await sql(`SELECT wallet_balance FROM children WHERE id='${CHILD_B}'`);
    const origBalA = parseFloat(snapA.wallet_balance ?? 0);
    const origBalB = parseFloat(snapB.wallet_balance ?? 0);

    await insertFundedLoan(CHILD_A, CHILD_B, 2.00, reqId);
    // Set A's wallet to a known value large enough to repay
    await sql(`UPDATE children SET wallet_balance = 10 WHERE id='${CHILD_A}'`);
    try {
      // Confirm blocked while loan active
      await assertRpcError(
        () => rpc('block_user', {
          p_blocker_id: CHILD_A, p_session_token: sessA.session_token,
          p_device_id: sessA.device_id, p_blocked_id: CHILD_B,
        }),
        'active_loan_outstanding',
      );
      // Repay the loan
      await rpc('repay_money_request', {
        p_request_id: reqId, p_borrower_id: CHILD_A,
        p_session_token: sessA.session_token, p_device_id: sessA.device_id,
      });
      // Now block should succeed
      await rpc('block_user', {
        p_blocker_id: CHILD_A, p_session_token: sessA.session_token,
        p_device_id: sessA.device_id, p_blocked_id: CHILD_B,
      });
      const [row] = await sql(`SELECT id FROM user_blocks WHERE blocker_id='${CHILD_A}' AND blocked_id='${CHILD_B}'`);
      assert(row, 'user_blocks row must exist after repayment and block');
    } finally {
      await sql(`DELETE FROM user_blocks WHERE blocker_id='${CHILD_A}' AND blocked_id='${CHILD_B}'`);
      await sql(`DELETE FROM money_requests WHERE id='${reqId}'`);
      // Restore original wallet balances (repayment moved funds between test accounts)
      await sql(`UPDATE children SET wallet_balance = ${origBalA} WHERE id='${CHILD_A}'`);
      await sql(`UPDATE children SET wallet_balance = ${origBalB} WHERE id='${CHILD_B}'`);
    }
  });

  // ── T05: Unrelated loan (A/B loan, C tries to block A) — allowed ──────────
  await test('T05 A has a loan with B, but C blocking A is allowed (unrelated parties)', async () => {
    const reqId = crypto.randomUUID();
    await insertFundedLoan(CHILD_A, CHILD_B, 2.00, reqId); // A borrows from B
    try {
      // C has no loan with A, so C can block A
      await rpc('block_user', {
        p_blocker_id: CHILD_C, p_session_token: sessC.session_token,
        p_device_id: sessC.device_id, p_blocked_id: CHILD_A,
      });
      const [row] = await sql(`SELECT id FROM user_blocks WHERE blocker_id='${CHILD_C}' AND blocked_id='${CHILD_A}'`);
      assert(row, 'C blocking A must succeed — they have no loan together');
    } finally {
      await sql(`DELETE FROM user_blocks WHERE blocker_id='${CHILD_C}' AND blocked_id='${CHILD_A}'`);
      await sql(`DELETE FROM money_requests WHERE id='${reqId}'`);
    }
  });

  // ── Teardown ──────────────────────────────────────────────────────────────
  await clearSessions(sessions);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
