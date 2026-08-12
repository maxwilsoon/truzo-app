/**
 * M049 regression tests — block and report
 *
 * Run: node supabase/verify_049.js
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
  const token    = crypto.randomBytes(32).toString('hex'); // 64-char hex
  const deviceId = `testdev-049-${childId.slice(0, 8)}-${Date.now()}`;
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

async function clearBlock(blockerId, blockedId) {
  await sql(`DELETE FROM user_blocks WHERE blocker_id='${blockerId}' AND blocked_id='${blockedId}'`);
}

async function clearReports(reporterId, reportedId) {
  await sql(`DELETE FROM user_reports WHERE reporter_id='${reporterId}' AND reported_id='${reportedId}'`);
}

async function clearCircleRequests(a, b) {
  await sql(`
    DELETE FROM circle_requests
    WHERE (from_id='${a}' AND to_id='${b}') OR (from_id='${b}' AND to_id='${a}')
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
  console.log('\nM049 regression tests — block and report\n');

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

  // Fetch B's username for search tests
  let childBUsername = 'daisy';
  try {
    const [row] = await sql(`SELECT username FROM children WHERE id='${CHILD_B}'`);
    if (row?.username) childBUsername = row.username;
  } catch (_) {}

  // Fetch A's wallet_balance before mutation for T08/T15 cleanup
  let origBalanceA = 0;
  try {
    const [row] = await sql(`SELECT wallet_balance FROM children WHERE id='${CHILD_A}'`);
    origBalanceA = parseFloat(row?.wallet_balance ?? 0);
  } catch (_) {}

  // ── T01: A blocks B → B cannot send circle request to A ──────────────────
  await test('T01 A blocks B → B cannot send circle_request to A (user_blocked)', async () => {
    await sql(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${CHILD_A}','${CHILD_B}')`);
    try {
      await assertRpcError(
        () => rpc('send_circle_request', {
          p_from_id: CHILD_B, p_to_id: CHILD_A,
          p_session_token: sessB.session_token, p_device_id: sessB.device_id,
        }),
        'user_blocked',
      );
    } finally {
      await clearBlock(CHILD_A, CHILD_B);
    }
  });

  // ── T02: A blocks B → A also cannot send circle request to B ─────────────
  await test('T02 A blocks B → A cannot send circle_request to B either (user_blocked)', async () => {
    await sql(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${CHILD_A}','${CHILD_B}')`);
    try {
      await assertRpcError(
        () => rpc('send_circle_request', {
          p_from_id: CHILD_A, p_to_id: CHILD_B,
          p_session_token: sessA.session_token, p_device_id: sessA.device_id,
        }),
        'user_blocked',
      );
    } finally {
      await clearBlock(CHILD_A, CHILD_B);
    }
  });

  // ── T03: A blocks B → B cannot fund A's pending money request ─────────────
  await test('T03 A blocks B → B cannot fund A money_request (user_blocked)', async () => {
    const reqId = crypto.randomUUID();
    await sql(`
      INSERT INTO money_requests (id, from_id, amount, reason, reason_emoji, deadline_days, repay_by_date, expires_at)
      VALUES (
        '${reqId}', '${CHILD_A}', 2.00, 'Test', '🧪', 7,
        (now() + interval '7 days')::date,
        now() + interval '24 hours'
      )
    `);
    await sql(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${CHILD_A}','${CHILD_B}')`);
    try {
      await assertRpcError(
        () => rpc('fund_money_request', {
          p_request_id: reqId, p_funder_id: CHILD_B, p_amount: 2.00,
          p_session_token: sessB.session_token, p_device_id: sessB.device_id,
        }),
        'user_blocked',
      );
    } finally {
      await clearBlock(CHILD_A, CHILD_B);
      await sql(`DELETE FROM money_requests WHERE id='${reqId}'`);
    }
  });

  // ── T04: A blocks B → search_children by A excludes B ────────────────────
  await test('T04 A blocks B → search_children by A excludes B from results', async () => {
    // Confirm B is visible before blocking
    const before = await rpc('search_children', {
      p_query: childBUsername, p_exclude_id: CHILD_A,
      p_session_token: sessA.session_token, p_device_id: sessA.device_id,
    });
    const beforeIds = (Array.isArray(before) ? before : (before || [])).map(r => r.id);
    assert(beforeIds.includes(CHILD_B), 'B must appear in search before block');

    // Block and re-search
    await sql(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${CHILD_A}','${CHILD_B}')`);
    try {
      const after = await rpc('search_children', {
        p_query: childBUsername, p_exclude_id: CHILD_A,
        p_session_token: sessA.session_token, p_device_id: sessA.device_id,
      });
      const afterIds = (Array.isArray(after) ? after : (after || [])).map(r => r.id);
      assert(!afterIds.includes(CHILD_B), 'B must NOT appear in search after A blocks B');
    } finally {
      await clearBlock(CHILD_A, CHILD_B);
    }
  });

  // ── T05: A unblocks B → B can then send a circle request to A ─────────────
  await test('T05 A unblocks B → send_circle_request B→A succeeds', async () => {
    // Block first
    await sql(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${CHILD_A}','${CHILD_B}')`);
    // Confirm blocked
    await assertRpcError(
      () => rpc('send_circle_request', {
        p_from_id: CHILD_B, p_to_id: CHILD_A,
        p_session_token: sessB.session_token, p_device_id: sessB.device_id,
      }),
      'user_blocked',
    );
    // Unblock via RPC
    await rpc('unblock_user', {
      p_blocker_id: CHILD_A, p_session_token: sessA.session_token,
      p_device_id: sessA.device_id, p_blocked_id: CHILD_B,
    });
    // Verify block row is gone
    const [blockRow] = await sql(`
      SELECT id FROM user_blocks WHERE blocker_id='${CHILD_A}' AND blocked_id='${CHILD_B}'
    `);
    assert(!blockRow, 'user_blocks row must be deleted after unblock_user');
    // Request should now succeed
    try {
      await rpc('send_circle_request', {
        p_from_id: CHILD_B, p_to_id: CHILD_A,
        p_session_token: sessB.session_token, p_device_id: sessB.device_id,
      });
    } finally {
      await clearCircleRequests(CHILD_A, CHILD_B);
    }
  });

  // ── T06: block_user stores the row and prevents friend_request notifications ─
  await test('T06 block_user RPC creates user_blocks row and blocks notification path', async () => {
    await rpc('block_user', {
      p_blocker_id: CHILD_A, p_session_token: sessA.session_token,
      p_device_id: sessA.device_id, p_blocked_id: CHILD_B,
    });
    try {
      const [row] = await sql(`
        SELECT blocker_id, blocked_id FROM user_blocks
        WHERE blocker_id='${CHILD_A}' AND blocked_id='${CHILD_B}'
      `);
      assert(row, 'user_blocks row must exist after block_user');
      assert(row.blocker_id === CHILD_A, 'blocker_id must be A');
      assert(row.blocked_id === CHILD_B, 'blocked_id must be B');
      // Notification path is guarded: B cannot send friend_request to A while blocked
      await assertRpcError(
        () => rpc('send_circle_request', {
          p_from_id: CHILD_B, p_to_id: CHILD_A,
          p_session_token: sessB.session_token, p_device_id: sessB.device_id,
        }),
        'user_blocked',
      );
    } finally {
      await clearBlock(CHILD_A, CHILD_B);
    }
  });

  // ── T07: block_user auto-declines pending circle requests ─────────────────
  await test('T07 block_user auto-declines pending circle_request from blocked user', async () => {
    // Insert a pending circle request B→A directly (bypassing RPC to avoid block)
    await sql(`
      INSERT INTO circle_requests (from_id, to_id, status, created_at)
      VALUES ('${CHILD_B}','${CHILD_A}','pending', now())
    `);
    // A blocks B → block_user should set that request to 'declined'
    await rpc('block_user', {
      p_blocker_id: CHILD_A, p_session_token: sessA.session_token,
      p_device_id: sessA.device_id, p_blocked_id: CHILD_B,
    });
    try {
      const rows = await sql(`
        SELECT status FROM circle_requests
        WHERE from_id='${CHILD_B}' AND to_id='${CHILD_A}'
        ORDER BY created_at DESC LIMIT 1
      `);
      assert(rows.length > 0, 'circle_request row must exist');
      assert(rows[0].status === 'declined', `status must be 'declined', got '${rows[0].status}'`);
    } finally {
      await clearBlock(CHILD_A, CHILD_B);
      await clearCircleRequests(CHILD_A, CHILD_B);
    }
  });

  // ── T08 + T15: Funded loan is visible and repayable after mutual blocking ──
  await test('T08/T15 funded loan remains visible and repayable after both parties block each other', async () => {
    const reqId = crypto.randomUUID();
    const loanAmount = 3.00;

    // Insert a funded money_request: A borrows from B
    await sql(`
      INSERT INTO money_requests (id, from_id, funded_by, amount, reason, reason_emoji,
        deadline_days, repay_by_date, expires_at, status, safety_pool_reserved_amount)
      VALUES (
        '${reqId}', '${CHILD_A}', '${CHILD_B}', ${loanAmount}, 'Test loan', '🧪',
        7, (now() + interval '7 days')::date, now() + interval '7 days',
        'funded', ${loanAmount}
      )
    `);

    // Give A enough balance to repay
    await sql(`UPDATE children SET wallet_balance = wallet_balance + ${loanAmount + 2} WHERE id='${CHILD_A}'`);

    // Mutual block
    await sql(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${CHILD_A}','${CHILD_B}')`);
    await sql(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${CHILD_B}','${CHILD_A}')`);

    try {
      // T08: funded loan still visible to A (borrower: from_id = CHILD_A)
      const forA = await rpc('get_active_requests', {
        p_child_id: CHILD_A,
        p_session_token: sessA.session_token,
        p_device_id: sessA.device_id,
      });
      const forAList = Array.isArray(forA) ? forA : (forA || []);
      assert(forAList.some(r => r.id === reqId), 'funded loan must be visible to A (borrower) after mutual block');

      // T15: funded loan still visible to B (funder: funded_by = CHILD_B)
      const forB = await rpc('get_active_requests', {
        p_child_id: CHILD_B,
        p_session_token: sessB.session_token,
        p_device_id: sessB.device_id,
      });
      const forBList = Array.isArray(forB) ? forB : (forB || []);
      assert(forBList.some(r => r.id === reqId), 'funded loan must be visible to B (funder) after mutual block');

      // Repay: A repays the loan → must succeed (no block check in repay_money_request)
      await rpc('repay_money_request', {
        p_request_id: reqId, p_borrower_id: CHILD_A,
        p_session_token: sessA.session_token, p_device_id: sessA.device_id,
      });
      const [repaid] = await sql(`SELECT status FROM money_requests WHERE id='${reqId}'`);
      assert(repaid?.status === 'repaid', `loan status must be 'repaid', got '${repaid?.status}'`);
    } finally {
      await clearBlock(CHILD_A, CHILD_B);
      await clearBlock(CHILD_B, CHILD_A);
      await sql(`DELETE FROM money_requests WHERE id='${reqId}'`);
      // Restore A's wallet balance (repay moved funds from A to B; undo the +topup)
      await sql(`UPDATE children SET wallet_balance = wallet_balance - 2 WHERE id='${CHILD_A}'`);
      // Note: the repayment itself shifted ${loanAmount} from A to B which is self-consistent
    }
  });

  // ── T09: A reports B → user_reports row created ───────────────────────────
  await test('T09 report_user creates user_reports row', async () => {
    await rpc('report_user', {
      p_reporter_id: CHILD_A, p_session_token: sessA.session_token,
      p_device_id: sessA.device_id, p_reported_id: CHILD_B,
      p_reason: 'spam',
    });
    try {
      const rows = await sql(`
        SELECT reason, status FROM user_reports
        WHERE reporter_id='${CHILD_A}' AND reported_id='${CHILD_B}' AND reason='spam'
      `);
      assert(rows.length === 1, 'user_reports row must exist');
      assert(rows[0].status === 'open', `status must be 'open', got '${rows[0].status}'`);
    } finally {
      await clearReports(CHILD_A, CHILD_B);
    }
  });

  // ── T10: A reports self → cannot_report_self ──────────────────────────────
  await test('T10 report_user self → cannot_report_self', async () => {
    await assertRpcError(
      () => rpc('report_user', {
        p_reporter_id: CHILD_A, p_session_token: sessA.session_token,
        p_device_id: sessA.device_id, p_reported_id: CHILD_A,
        p_reason: 'spam',
      }),
      'cannot_report_self',
    );
  });

  // ── T11: Duplicate report (same reason) is a silent no-op ─────────────────
  await test('T11 duplicate report (same reason) is a silent no-op', async () => {
    await rpc('report_user', {
      p_reporter_id: CHILD_B, p_session_token: sessB.session_token,
      p_device_id: sessB.device_id, p_reported_id: CHILD_C,
      p_reason: 'harassment_bullying',
    });
    // Second call — must not throw
    await rpc('report_user', {
      p_reporter_id: CHILD_B, p_session_token: sessB.session_token,
      p_device_id: sessB.device_id, p_reported_id: CHILD_C,
      p_reason: 'harassment_bullying',
    });
    try {
      const rows = await sql(`
        SELECT id FROM user_reports
        WHERE reporter_id='${CHILD_B}' AND reported_id='${CHILD_C}' AND reason='harassment_bullying'
      `);
      assert(rows.length === 1, `must have exactly 1 row (dedup); got ${rows.length}`);
    } finally {
      await clearReports(CHILD_B, CHILD_C);
    }
  });

  // ── T12: RLS — direct client access to user_blocks / user_reports is denied ─
  await test('T12 RLS enabled on user_blocks and user_reports with no permissive client policies', async () => {
    const rlsRows = await sql(`
      SELECT tablename, rowsecurity FROM pg_tables
      WHERE schemaname='public' AND tablename IN ('user_blocks','user_reports')
      ORDER BY tablename
    `);
    assert(rlsRows.length === 2, 'both tables must exist in pg_tables');
    const blocks  = rlsRows.find(r => r.tablename === 'user_blocks');
    const reports = rlsRows.find(r => r.tablename === 'user_reports');
    assert(blocks?.rowsecurity  === true, 'user_blocks must have RLS enabled');
    assert(reports?.rowsecurity === true, 'user_reports must have RLS enabled');

    // No permissive SELECT or ALL policies should exist for non-service roles
    const policies = await sql(`
      SELECT tablename, cmd, permissive FROM pg_policies
      WHERE schemaname='public'
        AND tablename IN ('user_blocks','user_reports')
        AND cmd IN ('SELECT','ALL')
        AND permissive = 'PERMISSIVE'
    `);
    assert(policies.length === 0,
      `found ${policies.length} permissive SELECT policy(ies) on block/report tables — none expected`);
  });

  // ── T13: B blocks A → A cannot send circle request to B ───────────────────
  await test('T13 B blocks A → A cannot send circle_request to B (user_blocked)', async () => {
    await sql(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${CHILD_B}','${CHILD_A}')`);
    try {
      await assertRpcError(
        () => rpc('send_circle_request', {
          p_from_id: CHILD_A, p_to_id: CHILD_B,
          p_session_token: sessA.session_token, p_device_id: sessA.device_id,
        }),
        'user_blocked',
      );
    } finally {
      await clearBlock(CHILD_B, CHILD_A);
    }
  });

  // ── T14: A blocks B → all interaction paths from B to A are blocked ────────
  await test('T14 A blocks B → B blocked on friend_request AND fund_money_request paths', async () => {
    const reqId = crypto.randomUUID();
    await sql(`
      INSERT INTO money_requests (id, from_id, amount, reason, reason_emoji,
        deadline_days, repay_by_date, expires_at)
      VALUES (
        '${reqId}', '${CHILD_A}', 2.00, 'Test', '🧪', 7,
        (now() + interval '7 days')::date, now() + interval '24 hours'
      )
    `);
    await sql(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${CHILD_A}','${CHILD_B}')`);
    try {
      // friend_request path
      await assertRpcError(
        () => rpc('send_circle_request', {
          p_from_id: CHILD_B, p_to_id: CHILD_A,
          p_session_token: sessB.session_token, p_device_id: sessB.device_id,
        }),
        'user_blocked',
      );
      // fund_money_request path (B trying to fund A's loan)
      await assertRpcError(
        () => rpc('fund_money_request', {
          p_request_id: reqId, p_funder_id: CHILD_B, p_amount: 2.00,
          p_session_token: sessB.session_token, p_device_id: sessB.device_id,
        }),
        'user_blocked',
      );
    } finally {
      await clearBlock(CHILD_A, CHILD_B);
      await sql(`DELETE FROM money_requests WHERE id='${reqId}'`);
    }
  });

  // ── Teardown ──────────────────────────────────────────────────────────────
  await clearSessions(sessions);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
