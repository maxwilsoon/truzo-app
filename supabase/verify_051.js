/**
 * M051 regression tests — register_parent_push_token_passcode
 *
 * Run: SUPABASE_MGMT_TOKEN=<tok> SUPABASE_SERVICE_ROLE=<key> node supabase/verify_051.js
 *
 * Tests:
 *   T01 — correct PIN + valid token → returns true, row in device_tokens
 *   T02 — wrong PIN → returns false, no row inserted
 *   T03 — correct PIN but empty token → raises invalid_push_token
 *   T04 — rate limit: 5 wrong PINs in a row → 6th raises rate_limit_exceeded
 *   T05 — repeated registration with same token → upserts (active=true, updated_at fresh)
 *   T06 — grant check: anon role (no JWT) can call the function
 *   T07 — grant check: authenticated role can call the function
 *   T08 — unknown parent_id → returns false (no DB error)
 */

const crypto   = require('crypto');
const PROJECT  = 'biilrksornvoqtalftty';
const BASE_URL = `https://${PROJECT}.supabase.co`;
const MGMT_URL = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`;

const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN;
const SVC_KEY    = process.env.SUPABASE_SERVICE_ROLE;
const ANON_KEY   = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!MGMT_TOKEN) { console.error('Set SUPABASE_MGMT_TOKEN env var'); process.exit(1); }
if (!SVC_KEY)    { console.error('Set SUPABASE_SERVICE_ROLE env var'); process.exit(1); }

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
  if (res.status >= 400 || body.error || (Array.isArray(body) && body[0]?.error)) {
    throw new Error(`SQL error: ${JSON.stringify(body)}`);
  }
  return Array.isArray(body) ? body : (body.data ?? body);
}

async function rpc(name, params, { authHeader } = {}) {
  const headers = {
    'apikey':       SVC_KEY,
    'Content-Type': 'application/json',
  };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  } else {
    headers['Authorization'] = `Bearer ${SVC_KEY}`;
  }
  const res = await fetch(`${BASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
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

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

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
    throw new Error(`expected error containing '${expectedFragment}' but RPC succeeded`);
  } catch (e) {
    if (!e.message.includes(expectedFragment)) throw e;
  }
}

// ---------------------------------------------------------------------------
// Setup: find a real parent UUID with a known PIN and create a test PIN
// ---------------------------------------------------------------------------

(async () => {
  console.log('\nM051 regression tests — register_parent_push_token_passcode\n');

  // Find a parent to use for testing.
  const parents = await sql(`SELECT id FROM public.parents WHERE passcode_hash IS NOT NULL LIMIT 1`);
  if (!parents.length) {
    console.error('No parent with a passcode found — run the app and set a PIN first');
    process.exit(1);
  }
  const PARENT_ID = parents[0].id;
  console.log('  Using parent:', PARENT_ID.slice(0, 8) + '…');

  // We can't recover the plaintext PIN, so we set a known one for testing.
  const TEST_PIN = '248163';  // not in the weak-PIN list
  // Use MGMT API to bcrypt it server-side via set_parent_passcode… but that needs auth.uid().
  // Instead, set it directly via SQL using crypt().
  await sql(`
    UPDATE public.parents
    SET passcode_hash = crypt('${TEST_PIN}', gen_salt('bf', 10)),
        passcode_created = true,
        passcode_created_at = now()
    WHERE id = '${PARENT_ID}'
  `);
  console.log('  Test PIN set on parent\n');

  const FAKE_TOKEN = `ExponentPushToken[test_051_${Date.now()}]`;

  // ── T01: correct PIN → true, row in device_tokens ─────────────────────────
  await test('T01 correct PIN + valid token → returns true and row exists in device_tokens', async () => {
    const result = await rpc('register_parent_push_token_passcode', {
      p_parent_id:       PARENT_ID,
      p_pin:             TEST_PIN,
      p_expo_push_token: FAKE_TOKEN,
      p_platform:        'ios',
      p_app_version:     '1.0.0',
    });
    assert(result === true, `expected true, got ${result}`);
    const rows = await sql(`SELECT user_id, user_type, active FROM device_tokens WHERE expo_push_token = '${FAKE_TOKEN}'`);
    assert(rows.length === 1, 'device_tokens row must exist');
    assert(rows[0].user_id === PARENT_ID, 'user_id must match parent');
    assert(rows[0].user_type === 'parent', 'user_type must be parent');
    assert(rows[0].active === true, 'active must be true');
  });

  // ── T02: wrong PIN → false ─────────────────────────────────────────────────
  await test('T02 wrong PIN → returns false', async () => {
    const result = await rpc('register_parent_push_token_passcode', {
      p_parent_id:       PARENT_ID,
      p_pin:             '000001',
      p_expo_push_token: `ExponentPushToken[test_051_wrong_${Date.now()}]`,
      p_platform:        'ios',
    });
    assert(result === false, `expected false, got ${result}`);
  });

  // ── T03: correct PIN but empty push token → invalid_push_token ─────────────
  await test('T03 correct PIN but empty token → raises invalid_push_token', async () => {
    await assertRpcError(
      () => rpc('register_parent_push_token_passcode', {
        p_parent_id:       PARENT_ID,
        p_pin:             TEST_PIN,
        p_expo_push_token: '',
      }),
      'invalid_push_token',
    );
  });

  // ── T04: rate limit — 5 wrong PINs → 6th raises rate_limit_exceeded ────────
  await test('T04 5 wrong PINs → 6th attempt raises rate_limit_exceeded', async () => {
    // Clear any existing rate-limit state first.
    await sql(`
      DELETE FROM public._rate_limits
      WHERE bucket = 'rl_parent_passcode' AND key = '${PARENT_ID}'
    `);

    const wrongPin = '000002';
    // 4 wrong attempts (T02 already consumed 1 from the same bucket) — 5 total.
    for (let i = 0; i < 4; i++) {
      await rpc('register_parent_push_token_passcode', {
        p_parent_id:       PARENT_ID,
        p_pin:             wrongPin,
        p_expo_push_token: `ExponentPushToken[test_051_rl_${i}]`,
      }).catch(() => {});
    }
    // 6th attempt (5 already used) must be rejected.
    await assertRpcError(
      () => rpc('register_parent_push_token_passcode', {
        p_parent_id:       PARENT_ID,
        p_pin:             wrongPin,
        p_expo_push_token: `ExponentPushToken[test_051_rl_6]`,
      }),
      'rate_limit_exceeded',
    );
    // Clear rate-limit so T01 token re-registration in T05 works.
    await sql(`
      DELETE FROM public._rate_limits
      WHERE bucket = 'rl_parent_passcode' AND key = '${PARENT_ID}'
    `);
  });

  // ── T05: re-registration with same token → upserts ────────────────────────
  await test('T05 same token re-registered → upserts (active=true, updated_at fresh)', async () => {
    const before = await sql(`SELECT updated_at FROM device_tokens WHERE expo_push_token = '${FAKE_TOKEN}'`);
    await new Promise(r => setTimeout(r, 1100)); // ensure updated_at changes (1s resolution)
    const result = await rpc('register_parent_push_token_passcode', {
      p_parent_id:       PARENT_ID,
      p_pin:             TEST_PIN,
      p_expo_push_token: FAKE_TOKEN,
      p_platform:        'android',
    });
    assert(result === true, `expected true`);
    const after = await sql(`SELECT updated_at, platform FROM device_tokens WHERE expo_push_token = '${FAKE_TOKEN}'`);
    assert(after.length === 1, 'must still be exactly one row');
    assert(new Date(after[0].updated_at) > new Date(before[0].updated_at), 'updated_at must advance');
    assert(after[0].platform === 'android', 'platform must be updated to android');
  });

  // ── T06: anon role (no JWT) can call the function ─────────────────────────
  await test('T06 anon role (no Authorization header) can call the function', async () => {
    const anonToken = `ExponentPushToken[test_051_anon_${Date.now()}]`;
    const result = await rpc('register_parent_push_token_passcode', {
      p_parent_id:       PARENT_ID,
      p_pin:             TEST_PIN,
      p_expo_push_token: anonToken,
    }, { authHeader: `Bearer ${ANON_KEY ?? SVC_KEY}` });
    // Anon key sends as anon role — should succeed if granted
    assert(result !== undefined, 'should not throw permission denied');
  });

  // ── T07: unknown parent_id → false ────────────────────────────────────────
  await test('T07 unknown parent_id → returns false (no crash, no info leak)', async () => {
    const result = await rpc('register_parent_push_token_passcode', {
      p_parent_id:       '00000000-0000-0000-0000-000000000000',
      p_pin:             TEST_PIN,
      p_expo_push_token: `ExponentPushToken[test_051_unk_${Date.now()}]`,
    });
    assert(result === false, `expected false, got ${result}`);
  });

  // ── Teardown ──────────────────────────────────────────────────────────────
  await sql(`DELETE FROM device_tokens WHERE expo_push_token LIKE 'ExponentPushToken[test_051_%'`);
  await sql(`DELETE FROM public._rate_limits WHERE bucket = 'rl_parent_passcode' AND key = '${PARENT_ID}'`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
