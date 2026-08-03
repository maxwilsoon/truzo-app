-- Migration 033: Server-side brute-force protection and rate limiting
--
-- Audited endpoints and findings:
--   login_child            — no throttle; unlimited bcrypt attempts on any child account
--   verify_parent_passcode — no throttle; SHA-256 PIN, entire 10 000-PIN space in <100 ms
--   biometric_login_child  — no throttle; token is 256-bit CSPRNG → online brute force
--                            computationally impossible; adding light device throttle anyway
--   check_username/email/mobile_exists — no throttle; full enumeration oracles
--
-- Design:
--   Single table auth_rate_limits, keyed by (scope, md5(scope:identifier)).
--   md5 ensures no plaintext PII (username, email, IP, device_id, parent_id) is stored.
--   Atomic UPSERT helper _rl_attempt() — no TOCTOU gap.
--   Lock is set once and NOT extended by subsequent attempts while locked, preventing
--   an attacker from perpetually locking their own (or a victim's) account.
--   Counter resets automatically when the cooldown or window expires.
--
-- Thresholds:
--   rl_child_login_dev  20 attempts / 30 min window / 10 min cooldown  (device spray)
--   rl_child_login_acc  10 attempts / 15 min window /  5 min cooldown  (targeted brute force)
--   rl_parent_passcode   5 attempts /  5 min window /  5 min cooldown  (fast SHA-256 PIN)
--   rl_bio_login        20 attempts / 60 min window / 30 min cooldown  (defence-in-depth)
--   rl_check_avail      60 attempts /  5 min window /  2 min cooldown  (enumeration bots)
--
-- Error code: RAISE EXCEPTION 'rate_limit_exceeded'
--
-- Rollback: 20260803_033_rollback.sql

BEGIN;

-- ─── 1. auth_rate_limits table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope        text         NOT NULL,
  bucket_key   text         NOT NULL,  -- md5(scope || ':' || identifier) — no plaintext PII
  attempts     integer      NOT NULL DEFAULT 1,
  window_start timestamptz  NOT NULL DEFAULT now(),
  locked_until timestamptz,            -- NULL = not locked
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT auth_rate_limits_scope_key UNIQUE (scope, bucket_key)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_cleanup_idx
  ON public.auth_rate_limits(updated_at);

-- No direct access for client roles — only accessible via SECURITY DEFINER helpers below.
REVOKE ALL ON TABLE public.auth_rate_limits FROM PUBLIC, anon, authenticated;


-- ─── 2. _rl_attempt ──────────────────────────────────────────────────────────
--
-- Atomic UPSERT:
--   Returns true  = attempt is allowed (proceed with login / check)
--   Returns false = attempt is throttled (raise rate_limit_exceeded in caller)
--
-- Parameters:
--   p_scope    — rate-limit namespace (e.g. 'rl_parent_passcode')
--   p_key      — raw identifier; stored as md5(scope:key), never plaintext
--   p_max      — N: N+1st attempt is denied (N attempts allowed per window)
--   p_window   — rolling window; counter resets on natural expiry
--   p_cooldown — lockout duration after exceeding p_max
--
-- Lock behaviour:
--   A lock is set when attempts exceeds p_max. While the lock is active, further
--   attempts do NOT extend it — an attacker cannot perpetually delay the lock
--   expiry for their own target. After cooldown expires the counter resets to 1.

CREATE OR REPLACE FUNCTION public._rl_attempt(
  p_scope     text,
  p_key       text,
  p_max       integer,
  p_window    interval,
  p_cooldown  interval
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_bucket text := md5(p_scope || ':' || p_key);
  v_locked timestamptz;
BEGIN
  INSERT INTO auth_rate_limits AS t
    (scope, bucket_key, attempts, window_start, locked_until, updated_at)
  VALUES
    (p_scope, v_bucket, 1, now(), NULL, now())
  ON CONFLICT (scope, bucket_key) DO UPDATE SET
    attempts = CASE
      -- Active lock: DO NOT increment (lock is not extended by further attempts)
      WHEN t.locked_until IS NOT NULL AND t.locked_until > now()
        THEN t.attempts
      -- Lock just expired or window expired: fresh start at 1
      WHEN (t.locked_until IS NOT NULL AND t.locked_until <= now())
           OR (t.window_start + p_window < now())
        THEN 1
      -- In active window, not locked: increment
      ELSE t.attempts + 1
    END,
    window_start = CASE
      WHEN (t.locked_until IS NOT NULL AND t.locked_until <= now())
           OR (t.window_start + p_window < now())
        THEN now()
      ELSE t.window_start
    END,
    locked_until = CASE
      -- Preserve active lock (never extend it)
      WHEN t.locked_until IS NOT NULL AND t.locked_until > now()
        THEN t.locked_until
      -- Resetting (lock/window just expired): no lock on the fresh attempt
      WHEN (t.locked_until IS NOT NULL AND t.locked_until <= now())
           OR (t.window_start + p_window < now())
        THEN NULL
      -- In window: set lock if this increment pushes count over max
      WHEN t.attempts + 1 > p_max
        THEN now() + p_cooldown
      ELSE NULL
    END,
    updated_at = now()
  RETURNING locked_until INTO v_locked;

  -- Allowed if no lock is active after this UPSERT
  RETURN v_locked IS NULL OR v_locked <= now();
END;
$$;

-- No grants — called only from within other SECURITY DEFINER functions.
REVOKE ALL ON FUNCTION public._rl_attempt(text, text, integer, interval, interval)
  FROM PUBLIC, anon, authenticated;


-- ─── 3. _rl_clear ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._rl_clear(p_scope text, p_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM auth_rate_limits
  WHERE scope      = p_scope
    AND bucket_key = md5(p_scope || ':' || p_key);
$$;

REVOKE ALL ON FUNCTION public._rl_clear(text, text)
  FROM PUBLIC, anon, authenticated;


-- ─── 4. _rl_get_ip ───────────────────────────────────────────────────────────
--
-- Extracts the caller's IP address from PostgREST request headers.
-- Returns 'no-header-context' when not called through PostgREST
-- (direct DB connections, pg_cron, etc.) — these all share a single
-- shared bucket with a conservative limit.

CREATE OR REPLACE FUNCTION public._rl_get_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_headers text := current_setting('request.headers', true);
BEGIN
  IF v_headers IS NULL OR v_headers = '' THEN
    RETURN 'no-header-context';
  END IF;
  RETURN coalesce(
    (v_headers::json ->> 'x-forwarded-for'),
    (v_headers::json ->> 'x-real-ip'),
    'no-header-context'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN 'no-header-context';
END;
$$;

REVOKE ALL ON FUNCTION public._rl_get_ip()
  FROM PUBLIC, anon, authenticated;


-- ─── 5. login_child ──────────────────────────────────────────────────────────
--
-- Rate-limit changes:
--   a. Device throttle  (rl_child_login_dev): checked first; covers unknown-username
--      enumeration and cross-account spraying. Key = md5(device_id).
--   b. Account throttle (rl_child_login_acc): checked only for known usernames,
--      after the device gate — prevents unlimited junk rows for nonexistent accounts.
--      Key = md5(lower(username)).
--   c. Both counters are cleared on successful login.
--   d. Unknown username path: timing equalized by dummy bcrypt (unchanged);
--      device counter is still incremented so enumeration bots hit device throttle.
--
-- RAISE 'rate_limit_exceeded' is distinct from RETURN NULL (wrong credentials)
-- so the client can tell the user "please wait" rather than "wrong password."

CREATE OR REPLACE FUNCTION public.login_child(
  p_username  text,
  p_password  text,
  p_device_id text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_child     children%ROWTYPE;
  v_parent    parents%ROWTYPE;
  v_raw_token text;
  v_hash      text;
  v_expires   timestamptz := now() + interval '1 hour';
  v_abs_exp   timestamptz := now() + interval '30 days';
  v_allowed   boolean;
  c_dummy CONSTANT text :=
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
BEGIN
  IF p_device_id IS NULL OR p_device_id = '' THEN
    RAISE EXCEPTION 'device_id_required';
  END IF;

  -- ── Device throttle ────────────────────────────────────────────────────────
  -- Recorded before we even look up the username so enumeration attempts
  -- consume the device budget the same as wrong-password attempts.
  v_allowed := _rl_attempt(
    'rl_child_login_dev', p_device_id,
    20, interval '30 minutes', interval '10 minutes'
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  -- ── Username lookup ────────────────────────────────────────────────────────
  SELECT * INTO v_child
    FROM children
    WHERE username = lower(p_username) AND password_hash IS NOT NULL;

  IF NOT FOUND THEN
    -- Timing equalization: unknown username costs the same bcrypt time as wrong password.
    -- Device throttle already incremented above; no per-username row created here.
    PERFORM crypt(p_password, c_dummy);
    RETURN NULL;
  END IF;

  -- ── Account throttle ───────────────────────────────────────────────────────
  -- Only reached for known usernames, preventing junk rows for nonexistent accounts.
  v_allowed := _rl_attempt(
    'rl_child_login_acc', lower(p_username),
    10, interval '15 minutes', interval '5 minutes'
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  -- ── Credential check ───────────────────────────────────────────────────────
  IF crypt(p_password, v_child.password_hash) <> v_child.password_hash THEN
    -- Both counters were incremented above; leave them incremented.
    RETURN NULL;
  END IF;

  -- ── Success: clear rate-limit counters ────────────────────────────────────
  PERFORM _rl_clear('rl_child_login_dev', p_device_id);
  PERFORM _rl_clear('rl_child_login_acc', lower(p_username));

  -- ── Issue session token ───────────────────────────────────────────────────
  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;
  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_hash      := encode(digest(v_raw_token, 'sha256'), 'hex');
  PERFORM revoke_all_child_sessions(v_child.id, 'superseded_by_new_login');
  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_child.id, v_hash, p_device_id, v_expires, v_abs_exp);

  RETURN json_build_object(
    'child', json_build_object(
      'id',                v_child.id,
      'display_name',      v_child.display_name,
      'username',          v_child.username,
      'avatar_emoji',      v_child.avatar_emoji,
      'profile_image_url', v_child.profile_image_url,
      'trust_score',       v_child.trust_score,
      'wallet_balance',    v_child.wallet_balance,
      'loaned_out',        v_child.loaned_out,
      'borrowed',          v_child.borrowed,
      'streak',            v_child.streak,
      'repaid',            v_child.repaid,
      'missed',            v_child.missed,
      'total_borrowed',    v_child.total_borrowed,
      'total_lent',        v_child.total_lent,
      'times_borrowed',    v_child.times_borrowed,
      'times_lent',        v_child.times_lent,
      'points',            v_child.points,
      'age',               v_child.age,
      'mobile',            v_child.mobile,
      'biometric_enabled', v_child.biometric_enabled,
      'last_device_id',    v_child.last_device_id,
      'account_frozen',    v_child.account_frozen,
      'parent_debt',       v_child.parent_debt
    ),
    'parent', json_build_object(
      'id',                     v_parent.id,
      'first_name',             v_parent.first_name,
      'last_name',              v_parent.last_name,
      'display_name',           v_parent.display_name,
      'safety_pool_limit',      v_parent.safety_pool_limit,
      'safety_pool_used',       v_parent.safety_pool_used,
      'safety_pool_reserved',   v_parent.safety_pool_reserved,
      'weekly_allowance',       v_parent.weekly_allowance,
      'allowance_frequency',    v_parent.allowance_frequency,
      'allowance_active',       v_parent.allowance_active,
      'allowance_next_payment', v_parent.allowance_next_payment,
      'passcode_created',       v_parent.passcode_created,
      'marketing_notifications',v_parent.marketing_notifications,
      'profile_image_url',      v_parent.profile_image_url
    ),
    'session_token',      v_raw_token,
    'session_expires_at', v_expires
  );
END;
$$;

REVOKE ALL ON FUNCTION public.login_child(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.login_child(text, text, text) TO anon;


-- ─── 6. verify_parent_passcode ────────────────────────────────────────────────
--
-- Rate-limit change: 5 attempts per 5 minutes per parent_id.
-- Key is md5('rl_parent_passcode:' || parent_id::text) — parent UUID is never stored
-- in plaintext in the rate-limit table.
-- RAISE 'rate_limit_exceeded' when throttled, so the client distinguishes
-- lockout from wrong PIN.
-- Correct PIN clears the counter so legitimate users who recover their PIN
-- are not penalised for prior failed attempts.

CREATE OR REPLACE FUNCTION public.verify_parent_passcode(
  p_parent_id uuid,
  p_pin       text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_stored_hash text;
  v_allowed     boolean;
BEGIN
  -- Check + record the attempt BEFORE the hash comparison.
  -- If already throttled: raise immediately, no hash work done.
  v_allowed := _rl_attempt(
    'rl_parent_passcode', p_parent_id::text,
    5, interval '5 minutes', interval '5 minutes'
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  SELECT passcode_hash INTO v_stored_hash FROM parents WHERE id = p_parent_id;
  IF v_stored_hash IS NULL THEN
    RETURN false;
  END IF;

  IF encode(digest(p_parent_id::text || ':' || p_pin, 'sha256'), 'hex') = v_stored_hash THEN
    PERFORM _rl_clear('rl_parent_passcode', p_parent_id::text);
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_parent_passcode(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_parent_passcode(uuid, text) TO anon;
GRANT  EXECUTE ON FUNCTION public.verify_parent_passcode(uuid, text) TO authenticated;


-- ─── 7. biometric_login_child ────────────────────────────────────────────────
--
-- Rate-limit change: light device throttle for defence-in-depth.
-- Online brute force is computationally impossible (biometric token is 256-bit
-- CSPRNG in hardware-backed SecureStore; device_id is 48-byte CSPRNG).
-- Throttle detects anomalous call patterns (logic-bug probing, stolen device_id).

CREATE OR REPLACE FUNCTION public.biometric_login_child(
  p_child_id        uuid,
  p_device_id       text,
  p_biometric_token text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_child     children%ROWTYPE;
  v_parent    parents%ROWTYPE;
  v_raw_token text;
  v_hash      text;
  v_expires   timestamptz := now() + interval '1 hour';
  v_abs_exp   timestamptz := now() + interval '30 days';
  v_allowed   boolean;
BEGIN
  IF p_biometric_token IS NULL OR length(p_biometric_token) <> 64 THEN
    RETURN NULL;
  END IF;
  IF p_device_id IS NULL OR p_device_id = '' THEN
    RETURN NULL;
  END IF;

  -- ── Device throttle ────────────────────────────────────────────────────────
  v_allowed := _rl_attempt(
    'rl_bio_login', p_device_id,
    20, interval '60 minutes', interval '30 minutes'
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  -- ── Credential check ───────────────────────────────────────────────────────
  SELECT * INTO v_child
    FROM children
    WHERE id                   = p_child_id
      AND biometric_enabled    = true
      AND last_device_id       = p_device_id
      AND biometric_token_hash = encode(digest(p_biometric_token, 'sha256'), 'hex');

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- ── Success ────────────────────────────────────────────────────────────────
  PERFORM _rl_clear('rl_bio_login', p_device_id);

  UPDATE children SET last_biometric_login = now() WHERE id = p_child_id;
  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_hash      := encode(digest(v_raw_token, 'sha256'), 'hex');
  PERFORM revoke_all_child_sessions(v_child.id, 'superseded_by_new_login');
  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_child.id, v_hash, p_device_id, v_expires, v_abs_exp);

  RETURN json_build_object(
    'child', json_build_object(
      'id',                v_child.id,
      'display_name',      v_child.display_name,
      'username',          v_child.username,
      'avatar_emoji',      v_child.avatar_emoji,
      'profile_image_url', v_child.profile_image_url,
      'trust_score',       v_child.trust_score,
      'wallet_balance',    v_child.wallet_balance,
      'loaned_out',        v_child.loaned_out,
      'borrowed',          v_child.borrowed,
      'streak',            v_child.streak,
      'repaid',            v_child.repaid,
      'missed',            v_child.missed,
      'total_borrowed',    v_child.total_borrowed,
      'total_lent',        v_child.total_lent,
      'times_borrowed',    v_child.times_borrowed,
      'times_lent',        v_child.times_lent,
      'points',            v_child.points,
      'age',               v_child.age,
      'mobile',            v_child.mobile,
      'biometric_enabled', v_child.biometric_enabled,
      'last_device_id',    v_child.last_device_id,
      'account_frozen',    v_child.account_frozen,
      'parent_debt',       v_child.parent_debt
    ),
    'parent', json_build_object(
      'id',                     v_parent.id,
      'first_name',             v_parent.first_name,
      'last_name',              v_parent.last_name,
      'display_name',           v_parent.display_name,
      'safety_pool_limit',      v_parent.safety_pool_limit,
      'safety_pool_used',       v_parent.safety_pool_used,
      'safety_pool_reserved',   v_parent.safety_pool_reserved,
      'weekly_allowance',       v_parent.weekly_allowance,
      'allowance_frequency',    v_parent.allowance_frequency,
      'allowance_active',       v_parent.allowance_active,
      'allowance_next_payment', v_parent.allowance_next_payment,
      'passcode_created',       v_parent.passcode_created,
      'marketing_notifications',v_parent.marketing_notifications,
      'profile_image_url',      v_parent.profile_image_url
    ),
    'session_token',      v_raw_token,
    'session_expires_at', v_expires
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biometric_login_child(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.biometric_login_child(uuid, text, text) TO anon;


-- ─── 8. Availability checks ──────────────────────────────────────────────────
--
-- Rate-limited by caller IP (x-forwarded-for from PostgREST request headers).
-- In non-PostgREST contexts all calls share a single 'no-header-context' bucket
-- with the same 60-attempt limit — this prevents abuse through direct DB access.
-- Throttled calls raise 'rate_limit_exceeded'; client catch blocks in onboarding
-- screens swallow this gracefully (existing pattern), so onboarding is unaffected
-- for legitimate users who make 1–3 calls per session.
-- Return type (boolean) is preserved — no return-type change.

CREATE OR REPLACE FUNCTION public.check_username_exists(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_allowed boolean;
BEGIN
  v_allowed := _rl_attempt(
    'rl_check_avail', _rl_get_ip(),
    60, interval '5 minutes', interval '2 minutes'
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM children WHERE username = lower(trim(p_username))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_username_exists(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_username_exists(text) TO anon;
GRANT  EXECUTE ON FUNCTION public.check_username_exists(text) TO authenticated;


CREATE OR REPLACE FUNCTION public.check_email_exists(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_allowed boolean;
BEGIN
  v_allowed := _rl_attempt(
    'rl_check_avail', _rl_get_ip(),
    60, interval '5 minutes', interval '2 minutes'
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM parents WHERE email = lower(trim(p_email))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_email_exists(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_email_exists(text) TO anon;
GRANT  EXECUTE ON FUNCTION public.check_email_exists(text) TO authenticated;


CREATE OR REPLACE FUNCTION public.check_mobile_exists(p_mobile text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_allowed boolean;
BEGIN
  v_allowed := _rl_attempt(
    'rl_check_avail', _rl_get_ip(),
    60, interval '5 minutes', interval '2 minutes'
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM parents WHERE mobile = trim(p_mobile)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_mobile_exists(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_mobile_exists(text) TO anon;
GRANT  EXECUTE ON FUNCTION public.check_mobile_exists(text) TO authenticated;


-- ─── 9. Cleanup cron job ─────────────────────────────────────────────────────
--
-- Deletes rows not touched in 7 days, keeping the table bounded.
-- 'updated_at < now() - 7 days' catches: expired locks, cleared entries,
-- and stale rows from old window periods.

SELECT cron.schedule(
  'auth-rate-limit-cleanup',
  '0 */6 * * *',
  $$DELETE FROM public.auth_rate_limits WHERE updated_at < now() - interval '7 days'$$
);

NOTIFY pgrst, 'reload schema';

COMMIT;
