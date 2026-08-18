-- Migration 022: Biometric credential schema + login session issuance
--
-- Depends on: 20260803_021_child_session_table.sql
--
-- ── Problem addressed ─────────────────────────────────────────────────────────────────────
--
-- Current state (post-migration-020):
--   biometric_login_child(p_child_id uuid, p_device_id text)
--   verifies ONLY:
--     children WHERE id = p_child_id AND biometric_enabled = true AND last_device_id = p_device_id
--
--   breesh_bio_token_{childId} in SecureStore holds a Math.random() string that is NEVER
--   transmitted to the server. The DB has no knowledge of it. The server therefore issues
--   a session token based solely on child UUID + device ID — neither of which is a secret.
--
--   getDeviceId() in biometrics.ts uses Math.random() — not a CSPRNG.
--   saveBiometricForChild() uses Math.random() — not a CSPRNG.
--
-- ── Fix ───────────────────────────────────────────────────────────────────────────────────
--
--   1. Add children.biometric_token_hash (nullable text):
--        stores encode(digest(raw_biometric_token, 'sha256'), 'hex')
--        NULL for children who have not yet re-enrolled biometric after this migration.
--
--   2. Update enable_biometric to accept p_biometric_token_hash and store it.
--      Old overload (uuid, text) DROPPED — cannot enable biometric without the hash.
--
--   3. Update disable_biometric to clear biometric_token_hash AND revoke all child sessions.
--      Disabling biometric is a credential reset; any open session must be invalidated.
--
--   4. Update login_child: add required p_device_id parameter; issue session token.
--      Old overload (text, text) DROPPED — cannot login_child without a device ID.
--
--   5. Update biometric_login_child: add required p_biometric_token parameter.
--      Old overload (uuid, text) DROPPED — cannot biometric-login without the credential.
--      Verifies: child UUID + device ID + SHA-256(biometric_token) = biometric_token_hash.
--      Children with NULL biometric_token_hash are automatically rejected (legacy setup).
--
-- ── Client-side requirements (applied after DB approval) ─────────────────────────────────
--
--   getDeviceId():
--     Replace Math.random() with expo-crypto getRandomBytesAsync(24) → 48-char hex.
--     Remove __DEV__ console.log of device ID (M6 fix — never log device ID).
--
--   saveBiometricForChild(childId) → now returns raw token:
--     Replace Math.random() with getRandomBytesAsync(32) → 64-char hex.
--     Hash via expo-crypto digestStringAsync(SHA256, rawToken) → tokenHash.
--     Store rawToken in SecureStore. Return rawToken to caller.
--     Caller sends tokenHash to db.enableBiometric(childId, deviceId, tokenHash).
--
--   getBiometricTokenForChild(childId):
--     New helper — reads raw token from SecureStore breesh_bio_token_{childId}.
--
--   db.biometricLoginChild(childId, deviceId):
--     Reads rawToken = getBiometricTokenForChild(childId).
--     If null → no biometric enrolled, reject before RPC call.
--     Calls biometric_login_child(p_child_id, p_device_id, p_biometric_token = rawToken).
--
--   Existing biometric setups (breesh_bio_token_{childId} holds old Math.random token):
--     biometric_login_child will fail (biometric_token_hash IS NULL → no row found → RETURN NULL).
--     User is prompted to re-enroll biometric. This is correct and expected behaviour.
--
-- ── Token design notes (same as migration 021) ───────────────────────────────────────────
--
--   Biometric raw token: encode(gen_random_bytes(32), 'hex') — 256-bit CSPRNG, 64-char hex.
--   Stored hash:         encode(digest(raw_token, 'sha256'), 'hex') — SHA-256 only.
--   SHA-256 is appropriate because the token has 256 bits of entropy (see migration 021).
--   Raw token exists ONLY in device SecureStore (behind Face ID gate). Never in DB or logs.
--
-- Rollback: 20260803_022_rollback.sql

BEGIN;

-- ── 1. Add biometric_token_hash column ────────────────────────────────────────────────────
--
-- Nullable: NULL means biometric is not enrolled (or enrolled before this migration).
-- biometric_login_child rejects NULL automatically (equality check with NULL is FALSE).

ALTER TABLE children
  ADD COLUMN IF NOT EXISTS biometric_token_hash text;


-- ── 2. enable_biometric ───────────────────────────────────────────────────────────────────
--
-- Signature change: (uuid, text) → (uuid, text, text)
-- Old overload DROPPED so callers without p_biometric_token_hash cannot enable biometric.
-- This function is not yet session-protected (Phase 2); it is only callable after a
-- successful password login during the biometric setup flow.

-- DROP old overload first — CREATE OR REPLACE would create a separate overload
REVOKE ALL ON FUNCTION public.enable_biometric(uuid, text) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.enable_biometric(uuid, text);

CREATE FUNCTION public.enable_biometric(
  p_child_id            uuid,
  p_device_id           text,
  p_biometric_token_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_biometric_token_hash IS NULL OR length(p_biometric_token_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid_biometric_token_hash';
  END IF;
  IF p_device_id IS NULL OR p_device_id = '' THEN
    RAISE EXCEPTION 'invalid_device_id';
  END IF;

  UPDATE children
    SET biometric_enabled     = true,
        last_device_id        = p_device_id,
        biometric_token_hash  = p_biometric_token_hash
    WHERE id = p_child_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.enable_biometric(uuid, text, text) TO anon;


-- ── 3. disable_biometric ─────────────────────────────────────────────────────────────────
--
-- Signature unchanged: (uuid). Body gains: clear biometric_token_hash + revoke sessions.
-- Disabling biometric is a credential reset: all open sessions must be revoked.
-- Phase 2 will add session-token protection to this RPC.

CREATE OR REPLACE FUNCTION public.disable_biometric(
  p_child_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE children
    SET biometric_enabled    = false,
        last_device_id       = NULL,
        biometric_token_hash = NULL
    WHERE id = p_child_id;

  -- Revoke all active sessions: the biometric credential has been cleared.
  -- Any session issued via biometric_login_child is now invalid.
  PERFORM revoke_all_child_sessions(p_child_id, 'biometric_disabled');
END;
$$;
GRANT EXECUTE ON FUNCTION public.disable_biometric(uuid) TO anon;


-- ── 4. login_child ────────────────────────────────────────────────────────────────────────
--
-- Signature change: (text, text) → (text, text, text) adds required p_device_id.
-- Old overload DROPPED — callers without p_device_id cannot login.

REVOKE EXECUTE ON FUNCTION public.login_child(text, text) FROM anon;
DROP FUNCTION IF EXISTS public.login_child(text, text);

CREATE FUNCTION public.login_child(
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
  c_dummy CONSTANT text :=
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
BEGIN
  IF p_device_id IS NULL OR p_device_id = '' THEN
    RAISE EXCEPTION 'device_id_required';
  END IF;

  SELECT * INTO v_child
    FROM children
    WHERE username      = lower(p_username)
      AND password_hash IS NOT NULL;

  IF NOT FOUND THEN
    PERFORM crypt(p_password, c_dummy);
    RETURN NULL;
  END IF;

  IF crypt(p_password, v_child.password_hash) <> v_child.password_hash THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

  -- Issue session token ──────────────────────────────────────────────────────────────────
  -- raw_token: 32 bytes CSPRNG, hex-encoded → 64 chars (256-bit entropy)
  v_raw_token := encode(gen_random_bytes(32), 'hex');
  -- token_hash: SHA-256 of raw_token. ONLY this is stored. raw_token is never written to DB.
  v_hash      := encode(digest(v_raw_token, 'sha256'), 'hex');

  -- Single-active-session policy: revoke all prior sessions for this child
  PERFORM revoke_all_child_sessions(v_child.id, 'superseded_by_new_login');

  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_child.id, v_hash, p_device_id, v_expires, v_abs_exp);
  -- End session issuance ─────────────────────────────────────────────────────────────────

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
      'weekly_allowance',       v_parent.weekly_allowance,
      'allowance_frequency',    v_parent.allowance_frequency,
      'allowance_active',       v_parent.allowance_active,
      'allowance_next_payment', v_parent.allowance_next_payment,
      'passcode_created',       v_parent.passcode_created,
      'marketing_notifications',v_parent.marketing_notifications,
      'profile_image_url',      v_parent.profile_image_url
    ),
    -- Session token returned exactly ONCE. Client stores in SecureStore only.
    -- Not logged, not cached in AsyncStorage, not included in any notification payload.
    'session_token',      v_raw_token,
    'session_expires_at', v_expires
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.login_child(text, text, text) TO anon;


-- ── 5. biometric_login_child ──────────────────────────────────────────────────────────────
--
-- Signature change: (uuid, text) → (uuid, text, text) adds required p_biometric_token.
-- Old overload DROPPED — callers without biometric credential are rejected.
--
-- Verification:
--   encode(digest(p_biometric_token, 'sha256'), 'hex') must match children.biometric_token_hash
--   AND biometric_enabled = true
--   AND last_device_id = p_device_id
--
-- Children with NULL biometric_token_hash (enrolled before this migration) are automatically
-- rejected — biometric_token_hash = <hash> is FALSE when biometric_token_hash IS NULL.
-- These users must re-enroll biometric (which generates a CSPRNG token and stores its hash).
--
-- Security guarantee:
--   The raw biometric token lives only in device SecureStore (which requires Face ID to read).
--   Knowing child UUID + device ID alone is insufficient to pass this check.
--   A copied or guessed device ID without the SecureStore credential → no match → RETURN NULL.

REVOKE ALL ON FUNCTION public.biometric_login_child(uuid, text) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.biometric_login_child(uuid, text);

CREATE FUNCTION public.biometric_login_child(
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
BEGIN
  -- Fast-fail on obviously invalid input before any DB access
  IF p_biometric_token IS NULL OR length(p_biometric_token) <> 64 THEN
    RETURN NULL;
  END IF;
  IF p_device_id IS NULL OR p_device_id = '' THEN
    RETURN NULL;
  END IF;

  -- Verify: child exists AND biometric is enabled AND device matches AND token hash matches.
  -- biometric_token_hash IS NULL (legacy) → biometric_token_hash = <anything> is FALSE → no row.
  SELECT * INTO v_child
    FROM children
    WHERE id                  = p_child_id
      AND biometric_enabled   = true
      AND last_device_id      = p_device_id
      AND biometric_token_hash = encode(digest(p_biometric_token, 'sha256'), 'hex');

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE children SET last_biometric_login = now() WHERE id = p_child_id;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

  -- Issue session token ──────────────────────────────────────────────────────────────────
  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_hash      := encode(digest(v_raw_token, 'sha256'), 'hex');

  PERFORM revoke_all_child_sessions(v_child.id, 'superseded_by_new_login');

  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_child.id, v_hash, p_device_id, v_expires, v_abs_exp);
  -- End session issuance ─────────────────────────────────────────────────────────────────

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
GRANT EXECUTE ON FUNCTION public.biometric_login_child(uuid, text, text) TO anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
