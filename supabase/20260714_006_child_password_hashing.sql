-- Migration 006: Migrate child passwords from plain-text to bcrypt
--
-- Algorithm : bcrypt via pgcrypto, cost factor 10 (~100ms/hash on modern hardware).
--             Meets OWASP minimum (cost ≥ 10). pgcrypto is enabled on all Supabase instances.
--
-- Changes:
--   1. Add   children.password_hash TEXT column.
--   2. Backfill all existing plain-text passwords with bcrypt hashes.
--   3. Replace login_child RPC — bcrypt verification, explicit safe column list (no hash in response).
--   4. Replace biometric_login_child RPC — explicit safe column list (no hash in response).
--   5. Add    insert_child RPC — hashes password at account-creation time.
--   6. NULL   children.password — column is kept for rollback; values are cleared.
--
-- ROLLBACK: see 20260714_006_child_password_hashing_rollback.sql
-- WARNING:  After step 6 the plain-text column values are gone. Rollback restores
--           the old RPCs but users will be unable to log in until either:
--             (a) This migration is re-applied, or
--             (b) The database is restored from a pre-migration backup.
--
-- Requires pgcrypto (always available on Supabase):

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Step 1: Add password_hash column ─────────────────────────────────────────

ALTER TABLE children ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- ── Step 2: Backfill existing plain-text passwords ───────────────────────────
-- Each row gets its own random salt (bcrypt embeds the salt in the hash string).
-- Cost 10 ≈ 100ms per row; for a small user table (< 1000 rows) this completes
-- in seconds. For larger deployments, run during a maintenance window.

UPDATE children
SET    password_hash = crypt(password, gen_salt('bf', 10))
WHERE  password      IS NOT NULL
  AND  password_hash IS NULL;

-- Sanity check — any row that had a password must now also have a hash.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM children WHERE password IS NOT NULL AND password_hash IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration 006 aborted: some rows have password but no password_hash. Check for NULL passwords.';
  END IF;
END;
$$;

-- ── Step 3: Replace login_child ───────────────────────────────────────────────
-- Differences from migration 005 version:
--   • Verifies via crypt(input, stored_hash) = stored_hash  (bcrypt, constant-time).
--   • Dummy crypt() on unknown-username path equalises timing.
--   • Returns explicit column list — password and password_hash are NOT returned.

CREATE OR REPLACE FUNCTION public.login_child(p_username text, p_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child      children%ROWTYPE;
  v_parent     parents%ROWTYPE;
  -- Valid bcrypt hash (cost 10) used as a timing-equalisation dummy.
  -- When the username does not exist we still run crypt() so response time
  -- is indistinguishable from a wrong-password attempt on a real account.
  c_dummy CONSTANT text :=
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
BEGIN
  SELECT * INTO v_child
  FROM   children
  WHERE  username      = lower(p_username)
    AND  parent_id     = auth.uid()
    AND  password_hash IS NOT NULL;

  IF NOT FOUND THEN
    -- Run bcrypt on the dummy hash to equalise timing; result is discarded.
    PERFORM crypt(p_password, c_dummy);
    RETURN NULL;
  END IF;

  -- Constant-time bcrypt verification (pgcrypto extracts embedded salt).
  IF crypt(p_password, v_child.password_hash) <> v_child.password_hash THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

  -- Return only the columns the app needs. password and password_hash are
  -- internal and must never leave the database.
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
    'parent', row_to_json(v_parent)
  );
END;
$$;

-- ── Step 4: Replace biometric_login_child ─────────────────────────────────────
-- Same as migration 005 logic but returns an explicit safe column list
-- instead of row_to_json(v_child) which would include password_hash.

CREATE OR REPLACE FUNCTION public.biometric_login_child(p_child_id uuid, p_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child  children%ROWTYPE;
  v_parent parents%ROWTYPE;
BEGIN
  SELECT * INTO v_child
  FROM   children
  WHERE  id               = p_child_id
    AND  parent_id        = auth.uid()
    AND  biometric_enabled = true
    AND  last_device_id   = p_device_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE children SET last_biometric_login = now() WHERE id = p_child_id;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

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
    'parent', row_to_json(v_parent)
  );
END;
$$;

-- ── Step 5: Add insert_child RPC ──────────────────────────────────────────────
-- Used by the onboarding flow instead of a direct table INSERT so the password
-- is bcrypt-hashed inside the database before being stored. The plain-text
-- password travels over TLS to Supabase and is never written to any column.
-- All financial stats are hardcoded to 0 (new accounts always start clean).

CREATE OR REPLACE FUNCTION public.insert_child(
  p_display_name text,
  p_username     text,
  p_password     text,
  p_mobile       text,
  p_age          int,
  p_avatar_emoji text DEFAULT '😊'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_id uuid := auth.uid();
  v_child_id  uuid;
BEGIN
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  INSERT INTO children (
    parent_id,    display_name,   username,
    password_hash,
    mobile,       age,            avatar_emoji,
    trust_score,  wallet_balance, loaned_out,  borrowed,
    streak,       repaid,         missed,
    total_borrowed, total_lent,   points
  ) VALUES (
    v_parent_id,
    p_display_name,
    lower(p_username),
    crypt(p_password, gen_salt('bf', 10)),
    p_mobile,
    p_age,
    p_avatar_emoji,
    50, 0, 0, 0,
    0,  0, 0,
    0,  0, 0
  )
  RETURNING id INTO v_child_id;

  RETURN v_child_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'username_taken';
END;
$$;

-- ── Step 6: NULL out plain-text passwords ────────────────────────────────────
-- The column is kept (for schema rollback) but all values are cleared.
-- After verifying that login works correctly via password_hash, run the
-- separate cleanup migration to DROP the column entirely.

UPDATE children
SET    password = NULL
WHERE  password_hash IS NOT NULL;

-- Final verification: no row should have a non-NULL plain-text password.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM children WHERE password IS NOT NULL) THEN
    RAISE EXCEPTION 'Migration 006 error: children.password still contains plain-text values.';
  END IF;
END;
$$;

-- Reload PostgREST schema cache so new RPCs are immediately callable.
NOTIFY pgrst, 'reload schema';
