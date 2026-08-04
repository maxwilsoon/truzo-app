// verify_038.js — Verify migration 038: session enforcement on Circle write RPCs
//                 and push-token removal from their responses.
//
// Prerequisites:
//   DATABASE_URL — postgres superuser connection string
//
// Run:
//   node supabase/verify_038.js
//
// Requires at least 2 unfrozen children.
// A temporary third child (cC) is inserted for the remove/re-add tests so that
// existing production data (funded loans between real children) is never touched.
// cC is deleted from the children table in the finally block.
//
// Test assignment:
//   A + B — T01-T05  (send, accept, decline path)
//   B + C — T06-T08  (B sends to C; C declines)
//   C + B — T09-T10  (C sends to B; cancel tests)
//   A + C — T11-T14  (remove / loan-block / re-add)
//   A + C — T23-T24  (notification / circle-state integrity)

'use strict';
const { Client } = require('pg');
const crypto = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set');

let c;
let passed = 0;
let total  = 0;
const failures = [];

// ─── runners ─────────────────────────────────────────────────────────────────
async function test(name, fn) {            // fail-fast (structural phase)
  total++;
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}: ${e.message}`);
    console.error('\nVerification stopped (structural phase).');
    if (c) await c.end().catch(() => {});
    process.exit(1);
  }
}

async function ltest(name, fn) {          // live test — continues on failure
  total++;
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}: ${e.message}`);
    failures.push({ name, msg: e.message });
  }
}

async function assertThrows(fn, substr) {
  try { await fn(); } catch (e) {
    if (!e.message.includes(substr))
      throw new Error(`Expected '${substr}', got: ${e.message}`);
    return;
  }
  throw new Error(`Expected error containing '${substr}' but call succeeded`);
}

// ─── DB helpers ──────────────────────────────────────────────────────────────
async function getGrantees(fn) {
  const { rows } = await c.query(`
    SELECT grantee FROM information_schema.role_routine_grants
    WHERE routine_schema='public' AND routine_name=$1 AND privilege_type='EXECUTE'`, [fn]);
  return rows.map(r => r.grantee);
}

// ─── Session helpers ─────────────────────────────────────────────────────────
const makeToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = t  => crypto.createHash('sha256').update(t).digest('hex');

async function insertSession(childId, token, deviceId, opts = {}) {
  const now       = new Date();
  const future    = new Date(now.getTime() + 3_600_000);
  const farFuture = new Date(now.getTime() + 30 * 86_400_000);
  const past      = new Date(now.getTime() - 3_600_000);
  const expiresAt = opts.expired ? past    : future;
  const absExpiry = opts.expired ? past    : farFuture;
  const revokedAt = opts.revoked ? now     : null;
  const { rows: [row] } = await c.query(
    `INSERT INTO child_sessions(child_id,token_hash,device_id,expires_at,absolute_expires_at,revoked_at)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [childId, hashToken(token), deviceId, expiresAt, absExpiry, revokedAt]
  );
  return row.id;
}

// ─── RPC shims ────────────────────────────────────────────────────────────────
const callSend    = (fId, tId, tok, dev) =>
  c.query(`SELECT public.send_circle_request($1,$2,$3,$4)`,    [fId, tId, tok, dev]);
const callAccept  = (rId, aId, tok, dev) =>
  c.query(`SELECT public.accept_circle_request($1,$2,$3,$4)`,  [rId, aId, tok, dev]);
const callDecline = (rId, aId, tok, dev) =>
  c.query(`SELECT public.decline_circle_request($1,$2,$3,$4)`, [rId, aId, tok, dev]);
const callCancel  = (fId, tId, tok, dev) =>
  c.query(`SELECT public.cancel_circle_request($1,$2,$3,$4)`,  [fId, tId, tok, dev]);
const callRemove  = (cId, fId, tok, dev) =>
  c.query(`SELECT public.remove_from_circle($1,$2,$3,$4)`,     [cId, fId, tok, dev]);

// ─── Setup / teardown ─────────────────────────────────────────────────────────
async function setup() {
  // Real children A and B (may have pre-existing loans — never used for remove tests).
  const { rows: realKids } = await c.query(
    `SELECT id FROM children WHERE COALESCE(account_frozen,false)=false LIMIT 2`
  );
  if (realKids.length < 2)
    throw new Error('Need at least 2 unfrozen children to run live tests');
  const [cA, cB] = realKids;

  // Temporary third child cC — has no loans, circle history, or real sessions.
  const { rows: [cCRow] } = await c.query(
    `INSERT INTO children(display_name,username,avatar_emoji,account_frozen)
     VALUES('test_v038_tmp','test_v038_tmp','🧪',false) RETURNING id`
  );
  const cC = cCRow;

  const tokens = {
    A: makeToken(), B: makeToken(), C: makeToken(),
    expA: makeToken(), revA: makeToken(),
  };
  const devices = { A: 'v038-dev-a', B: 'v038-dev-b', C: 'v038-dev-c' };

  const sessionIds = [];
  sessionIds.push(await insertSession(cA.id, tokens.A,    devices.A));
  sessionIds.push(await insertSession(cB.id, tokens.B,    devices.B));
  sessionIds.push(await insertSession(cC.id, tokens.C,    devices.C));
  sessionIds.push(await insertSession(cA.id, tokens.expA, devices.A, { expired: true }));
  sessionIds.push(await insertSession(cA.id, tokens.revA, devices.A, { revoked: true }));

  // Save existing A↔B circle state so we can restore it in teardown.
  const { rows: savedAB } = await c.query(
    `SELECT child_id, friend_id, status, removed_at, removed_by FROM circles
     WHERE (child_id=$1 AND friend_id=$2) OR (child_id=$2 AND friend_id=$1)`,
    [cA.id, cB.id]
  );

  // Clean start for A↔B: remove pending requests and circles.
  await c.query(
    `DELETE FROM circle_requests
     WHERE (from_id=$1 OR to_id=$1) AND (from_id=$2 OR to_id=$2) AND status='pending'`,
    [cA.id, cB.id]
  );
  await c.query(
    `DELETE FROM circles
     WHERE (child_id=$1 AND friend_id=$2) OR (child_id=$2 AND friend_id=$1)`,
    [cA.id, cB.id]
  );

  // Seed A↔C friendship for T11-T14 tests (cC is fresh — no loans).
  await c.query(
    `INSERT INTO circles(child_id,friend_id,status) VALUES($1,$2,'active'),($2,$1,'active')`,
    [cA.id, cC.id]
  );

  return {
    cA, cB, cC, tokens, devices,
    sessionIds, savedAB,
    createdRequestIds: [],
    loanId: null,
    tempChildId: cC.id,
  };
}

async function teardown(ctx) {
  if (!ctx) return;
  const { cA, cB, sessionIds, createdRequestIds, savedAB, loanId, tempChildId } = ctx;

  // Delete test sessions.
  if (sessionIds.length)
    await c.query(`DELETE FROM child_sessions WHERE id=ANY($1::uuid[])`, [sessionIds]).catch(() => {});

  // Delete tracked circle_requests.
  if (createdRequestIds.length)
    await c.query(`DELETE FROM circle_requests WHERE id=ANY($1::uuid[])`, [createdRequestIds]).catch(() => {});

  // Wipe any remaining requests between real children.
  await c.query(
    `DELETE FROM circle_requests WHERE (from_id=$1 OR to_id=$1) AND (from_id=$2 OR to_id=$2)`,
    [cA.id, cB.id]
  ).catch(() => {});

  // Delete circles between A↔B, then restore saved state.
  await c.query(
    `DELETE FROM circles WHERE (child_id=$1 AND friend_id=$2) OR (child_id=$2 AND friend_id=$1)`,
    [cA.id, cB.id]
  ).catch(() => {});
  for (const row of savedAB) {
    await c.query(
      `INSERT INTO circles(child_id,friend_id,status,removed_at,removed_by)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(child_id,friend_id) DO UPDATE SET status=$3,removed_at=$4,removed_by=$5`,
      [row.child_id, row.friend_id, row.status, row.removed_at, row.removed_by]
    ).catch(() => {});
  }

  // Delete test loan.
  if (loanId)
    await c.query(`DELETE FROM money_requests WHERE id=$1`, [loanId]).catch(() => {});

  // Clean up temp child cC and all rows referencing it.
  if (tempChildId) {
    await c.query(`DELETE FROM child_sessions WHERE child_id=$1`,      [tempChildId]).catch(() => {});
    await c.query(`DELETE FROM circle_requests WHERE from_id=$1 OR to_id=$1`, [tempChildId]).catch(() => {});
    await c.query(`DELETE FROM circles WHERE child_id=$1 OR friend_id=$1`,    [tempChildId]).catch(() => {});
    await c.query(`DELETE FROM money_requests WHERE from_id=$1 OR funded_by=$1`, [tempChildId]).catch(() => {});
    await c.query(`DELETE FROM children WHERE id=$1`, [tempChildId]).catch(() => {});
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  c = new Client({ connectionString: DATABASE_URL });
  await c.connect();

  let ctx = null;

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 1 — Structural (T19-T22)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n══ Phase 1: Structural ══\n');

    const NEW_SIGS = [
      ['send_circle_request',    'send_circle_request(uuid,uuid,text,text)'],
      ['accept_circle_request',  'accept_circle_request(uuid,uuid,text,text)'],
      ['decline_circle_request', 'decline_circle_request(uuid,uuid,text,text)'],
      ['cancel_circle_request',  'cancel_circle_request(uuid,uuid,text,text)'],
      ['remove_from_circle',     'remove_from_circle(uuid,uuid,text,text)'],
    ];
    const OLD_SIGS = [
      'send_circle_request(uuid,uuid)',
      'accept_circle_request(uuid)',
      'decline_circle_request(uuid)',
      'cancel_circle_request(uuid,uuid)',
      'remove_from_circle(uuid,uuid)',
    ];

    await test('T19: old unprotected signatures do not exist', async () => {
      const still = [];
      for (const sig of OLD_SIGS) {
        const { rows } = await c.query(
          `SELECT count(*)::int n FROM pg_proc WHERE oid::regprocedure::text=$1`, [sig]
        );
        if (rows[0].n > 0) still.push(sig);
      }
      if (still.length) throw new Error(`Still present: ${still.join(', ')}`);
    });

    await test('T20: PUBLIC and authenticated have no EXECUTE on any new signature', async () => {
      const bad = [];
      for (const [fn] of NEW_SIGS) {
        const g = await getGrantees(fn);
        if (g.includes('PUBLIC'))        bad.push(`${fn}→PUBLIC`);
        if (g.includes('authenticated')) bad.push(`${fn}→authenticated`);
      }
      if (bad.length) throw new Error(`Unexpected grants: ${bad.join(', ')}`);
    });

    await test('T21: anon, postgres and service_role have EXECUTE on all 5 new signatures', async () => {
      const missing = [];
      for (const [fn] of NEW_SIGS) {
        const g = await getGrantees(fn);
        for (const role of ['anon', 'postgres', 'service_role']) {
          if (!g.includes(role)) missing.push(`${fn}→${role}`);
        }
      }
      if (missing.length) throw new Error(`Missing grants: ${missing.join(', ')}`);
    });

    await test('T22: no Circle write RPC body exposes push_token, from_push_token or to_push_token', async () => {
      const BANNED = ['push_token', 'from_push_token', 'to_push_token'];
      const leaks  = [];
      for (const [fn] of NEW_SIGS) {
        const { rows } = await c.query(
          `SELECT pg_get_functiondef(oid) def FROM pg_proc
           WHERE proname=$1 AND pronamespace='public'::regnamespace
           ORDER BY oid DESC LIMIT 1`, [fn]
        );
        if (!rows.length) { leaks.push(`${fn}: not found`); continue; }
        // Strip the require_valid_child_session call before checking.
        const stripped = rows[0].def.replace(/PERFORM require_valid_child_session[^;]+;/gi, '');
        for (const banned of BANNED) {
          if (stripped.toLowerCase().includes(banned.toLowerCase()))
            leaks.push(`${fn} contains '${banned}'`);
        }
      }
      if (leaks.length) throw new Error(leaks.join('; '));
    });

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 2 — Session enforcement (T15-T18)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n══ Phase 2: Session enforcement ══\n');

    const FAKE_ID  = '00000000-0000-0000-0000-000000000001';
    const FAKE_TOK = 'a'.repeat(64);
    const FAKE_DEV = 'fake-device';

    await ltest('T15: empty session token → invalid_child_session', () =>
      assertThrows(
        () => c.query(`SELECT public.send_circle_request($1,$2,$3,$4)`,
          [FAKE_ID, FAKE_ID, '', FAKE_DEV]),
        'invalid_child_session'
      )
    );

    await ltest('T16: wrong device_id (fake token/device) → invalid_child_session', () =>
      assertThrows(
        () => c.query(`SELECT public.send_circle_request($1,$2,$3,$4)`,
          [FAKE_ID, FAKE_ID, FAKE_TOK, FAKE_DEV]),
        'invalid_child_session'
      )
    );

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 3 — Behavioural live tests (T01-T14) + deferred T17/T18
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n══ Phase 3: Behavioural live tests ══\n');

    ctx = await setup();
    const { cA, cB, cC, tokens, devices } = ctx;
    console.log(`  A=${cA.id.slice(0,8)}… (real)  B=${cB.id.slice(0,8)}… (real)  C=${cC.id.slice(0,8)}… (temp)`);
    console.log(`  A↔B: send/accept/decline tests   A↔C: remove/loan/re-add tests\n`);

    await ltest('T17: expired token → child_session_expired', () =>
      assertThrows(() => callSend(cA.id, cB.id, tokens.expA, devices.A), 'child_session_expired')
    );
    await ltest('T18: revoked token → child_session_revoked', () =>
      assertThrows(() => callSend(cA.id, cB.id, tokens.revA, devices.A), 'child_session_revoked')
    );

    // ── A→B tests (T01-T05) ──────────────────────────────────────────────────
    let reqAB_id;
    await ltest('T01: valid child sends a circle request', async () => {
      await callSend(cA.id, cB.id, tokens.A, devices.A);
      const { rows } = await c.query(
        `SELECT id FROM circle_requests WHERE from_id=$1 AND to_id=$2 AND status='pending'`,
        [cA.id, cB.id]
      );
      if (!rows.length) throw new Error('circle_request row not created');
      reqAB_id = rows[0].id;
      ctx.createdRequestIds.push(reqAB_id);
    });

    await ltest('T02: child A cannot send while claiming to be child B', () =>
      assertThrows(
        () => callSend(cB.id, cA.id, tokens.A, devices.A),   // A's session, B's from_id
        'invalid_child_session'
      )
    );

    await ltest('T04: non-recipient (sender) cannot accept the request', () => {
      if (!reqAB_id) throw new Error('skipped — T01 did not run');
      // A is from_id; p_acting_child_id=A ≠ to_id=B → not_authorized
      return assertThrows(() => callAccept(reqAB_id, cA.id, tokens.A, devices.A), 'not_authorized');
    });

    await ltest('T03: valid recipient accepts a pending request', async () => {
      if (!reqAB_id) throw new Error('skipped');
      await callAccept(reqAB_id, cB.id, tokens.B, devices.B);
      const { rows: [req] } = await c.query(
        `SELECT status FROM circle_requests WHERE id=$1`, [reqAB_id]
      );
      if (req?.status !== 'accepted') throw new Error('status not updated to accepted');
      const { rows: c1 } = await c.query(
        `SELECT 1 FROM circles WHERE child_id=$1 AND friend_id=$2 AND status='active'`,
        [cA.id, cB.id]
      );
      const { rows: c2 } = await c.query(
        `SELECT 1 FROM circles WHERE child_id=$1 AND friend_id=$2 AND status='active'`,
        [cB.id, cA.id]
      );
      if (!c1.length || !c2.length) throw new Error('bi-directional circle rows not created');
    });

    await ltest('T05: accepted request cannot be accepted again', () => {
      if (!reqAB_id) throw new Error('skipped');
      return assertThrows(() => callAccept(reqAB_id, cB.id, tokens.B, devices.B), 'request_not_found');
    });

    // ── B→C tests (T06-T08) ──────────────────────────────────────────────────
    let reqBC_id;
    await ltest('T06-T08 setup: B sends request to C', async () => {
      await callSend(cB.id, cC.id, tokens.B, devices.B);
      const { rows } = await c.query(
        `SELECT id FROM circle_requests WHERE from_id=$1 AND to_id=$2 AND status='pending'`,
        [cB.id, cC.id]
      );
      if (!rows.length) throw new Error('B→C request not created');
      reqBC_id = rows[0].id;
      ctx.createdRequestIds.push(reqBC_id);
    });

    await ltest('T08: non-recipient (sender B) cannot decline their own outgoing request', () => {
      if (!reqBC_id) throw new Error('skipped');
      // B is from_id; p_acting_child_id=B ≠ to_id=C → not_authorized
      return assertThrows(() => callDecline(reqBC_id, cB.id, tokens.B, devices.B), 'not_authorized');
    });

    await ltest('T07: valid recipient C declines a pending request', async () => {
      if (!reqBC_id) throw new Error('skipped');
      await callDecline(reqBC_id, cC.id, tokens.C, devices.C);
      const { rows: [req] } = await c.query(
        `SELECT status FROM circle_requests WHERE id=$1`, [reqBC_id]
      );
      if (req?.status !== 'declined') throw new Error('status not updated to declined');
    });

    await ltest('T06: declined request cannot later be accepted with the same stale request ID', () => {
      if (!reqBC_id) throw new Error('skipped');
      // C is to_id; C tries to accept the declined request → request_not_found
      return assertThrows(() => callAccept(reqBC_id, cC.id, tokens.C, devices.C), 'request_not_found');
    });

    // ── C→B cancel tests (T09-T10) ────────────────────────────────────────────
    let reqCB_id;
    await ltest('T09-T10 setup: C sends request to B', async () => {
      await callSend(cC.id, cB.id, tokens.C, devices.C);
      const { rows } = await c.query(
        `SELECT id FROM circle_requests WHERE from_id=$1 AND to_id=$2 AND status='pending'`,
        [cC.id, cB.id]
      );
      if (!rows.length) throw new Error('C→B request not created');
      reqCB_id = rows[0].id;
      ctx.createdRequestIds.push(reqCB_id);
    });

    await ltest('T10: another child (A) cannot cancel C\'s pending request', () => {
      if (!reqCB_id) throw new Error('skipped');
      // p_from_id=C but A's session → require_valid_child_session(C, tokenA, devA) → invalid
      return assertThrows(() => callCancel(cC.id, cB.id, tokens.A, devices.A), 'invalid_child_session');
    });

    await ltest('T09: sender C cancels their own pending request', async () => {
      if (!reqCB_id) throw new Error('skipped');
      await callCancel(cC.id, cB.id, tokens.C, devices.C);
      const { rows } = await c.query(
        `SELECT 1 FROM circle_requests WHERE id=$1`, [reqCB_id]
      );
      if (rows.length) throw new Error('request still exists after cancel');
      ctx.createdRequestIds = ctx.createdRequestIds.filter(id => id !== reqCB_id);
    });

    // ── A↔C remove / loan-block / re-add tests (T11-T14) ─────────────────────
    // cC is the temp child — no pre-existing funded loans with cA.

    await ltest('T12: another child (B) cannot remove an A↔C friendship it does not own', () =>
      // p_child_id=A but B's session → invalid_child_session
      assertThrows(() => callRemove(cA.id, cC.id, tokens.B, devices.B), 'invalid_child_session')
    );

    await ltest('T13: active funded loan blocks remove_from_circle', async () => {
      const future = new Date(Date.now() + 30 * 86_400_000);
      const { rows: [loan] } = await c.query(
        `INSERT INTO money_requests
           (from_id, funded_by, amount, reason, reason_emoji, deadline_days,
            repay_by_date, expires_at, status)
         VALUES ($1,$2,5.00,'v038_loan_block','🧪',7,$3,$4,'funded')
         RETURNING id`,
        [cA.id, cC.id, future.toISOString().slice(0,10), future.toISOString()]
      );
      ctx.loanId = loan.id;
      await assertThrows(() => callRemove(cA.id, cC.id, tokens.A, devices.A), 'active_loan');
      // Delete test loan so T11 can proceed.
      await c.query(`DELETE FROM money_requests WHERE id=$1`, [loan.id]);
      ctx.loanId = null;
    });

    await ltest('T11: acting child removes a friend from their circle', async () => {
      await callRemove(cA.id, cC.id, tokens.A, devices.A);
      const { rows: [row] } = await c.query(
        `SELECT status FROM circles WHERE child_id=$1 AND friend_id=$2`, [cA.id, cC.id]
      );
      if (row?.status !== 'removed') throw new Error('circle row not marked removed');
    });

    await ltest('T14: removed friend can be re-added and accepted normally', async () => {
      // A sends to C (no longer friends from T11).
      await callSend(cA.id, cC.id, tokens.A, devices.A);
      const { rows: [req] } = await c.query(
        `SELECT id FROM circle_requests WHERE from_id=$1 AND to_id=$2 AND status='pending'`,
        [cA.id, cC.id]
      );
      if (!req) throw new Error('re-add request not created');
      ctx.createdRequestIds.push(req.id);
      await callAccept(req.id, cC.id, tokens.C, devices.C);
      const { rows: c1 } = await c.query(
        `SELECT 1 FROM circles WHERE child_id=$1 AND friend_id=$2 AND status='active'`,
        [cA.id, cC.id]
      );
      if (!c1.length) throw new Error('circle not restored after re-add');
    });

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 4 — Notification / circle-state integrity (T23, T24)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n══ Phase 4: Notification / circle-state integrity ══\n');

    // T23: after send, recipient sees the pending request via get_pending_requests.
    await ltest('T23: friend-request is visible to the recipient via get_pending_requests', async () => {
      // A and C are friends (from T14). Remove to allow a fresh send.
      await callRemove(cA.id, cC.id, tokens.A, devices.A);

      await callSend(cA.id, cC.id, tokens.A, devices.A);
      const { rows: [req] } = await c.query(
        `SELECT id FROM circle_requests WHERE from_id=$1 AND to_id=$2 AND status='pending'`,
        [cA.id, cC.id]
      );
      if (!req) throw new Error('request not created after send');
      ctx.createdRequestIds.push(req.id);

      const { rows } = await c.query(
        `SELECT public.get_pending_requests($1,$2,$3)`,
        [cC.id, tokens.C, devices.C]
      );
      const list = rows[0]?.get_pending_requests ?? [];
      if (!Array.isArray(list)) throw new Error('get_pending_requests did not return an array');
      if (!list.some(r => r.id === cA.id))
        throw new Error('A\'s request not visible to C via get_pending_requests');

      // Accept so T24 can verify circle state.
      await callAccept(req.id, cC.id, tokens.C, devices.C);
    });

    // T24: after accept, both parties appear in each other's get_circle.
    await ltest('T24: after acceptance both parties appear in each other\'s get_circle', async () => {
      const { rows: ra } = await c.query(
        `SELECT public.get_circle($1,$2,$3)`, [cA.id, tokens.A, devices.A]
      );
      const { rows: rc } = await c.query(
        `SELECT public.get_circle($1,$2,$3)`, [cC.id, tokens.C, devices.C]
      );
      const circleA = ra[0]?.get_circle ?? [];
      const circleC = rc[0]?.get_circle ?? [];
      if (!Array.isArray(circleA)) throw new Error('get_circle(A) did not return an array');
      if (!Array.isArray(circleC)) throw new Error('get_circle(C) did not return an array');
      if (!circleA.some(m => m.id === cC.id)) throw new Error('C not in A\'s circle after accept');
      if (!circleC.some(m => m.id === cA.id)) throw new Error('A not in C\'s circle after accept');
    });

  } finally {
    await teardown(ctx);
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  const failed = total - passed;
  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  ${passed}/${total} passed — migration 038 verification`);
  if (failures.length) {
    console.log('\n  Failed tests:');
    failures.forEach(f => console.log(`    ✗ ${f.name}: ${f.msg}`));
  }
  console.log();

  await c.end();
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message ?? String(err));
  process.exit(1);
});
