-- Migration 009: Allow child login without a prior parent Supabase Auth session
--
-- Root cause:
--   Both login_child and biometric_login_child included:
--     AND parent_id = auth.uid()
--   in their child-lookup WHERE clause.
--
--   Children do not have Supabase Auth accounts. auth.uid() returns the ID of the
--   currently authenticated Supabase Auth user. On a cold app restart (no parent
--   session), auth.uid() is NULL, so the WHERE clause matches zero rows and the
--   RPC returns NULL — identical to a wrong-password result.
--
--   After a parent logs in, auth.uid() = parent UUID, so the child lookup
--   succeeds — explaining why child login worked only after parent login.
--
--   Additionally, unauthenticated clients call Supabase as the 'anon' role.
--   Explicit EXECUTE grants ensure the two login RPCs are callable before
--   any Supabase Auth session is established.
--
-- Security rationale for removing parent_id = auth.uid():
--   • children.username has a UNIQUE constraint — no two accounts share one.
--   • bcrypt verification (crypt + timing dummy) authenticates the caller.
--   • biometric_login_child is scoped to id + biometric_enabled + last_device_id.
--   • Both RPCs are SECURITY DEFINER — they bypass RLS and run as the DB owner,
--     but return only a fixed safe column list (no password_hash in responses).
--   • Normal tables remain fully protected by RLS for all other callers.
--
-- Changes:
--   1. login_child          — remove AND parent_id = auth.uid()
--   2. biometric_login_child — remove AND parent_id = auth.uid()
--   3. GRANT EXECUTE TO anon on both RPCs
--
-- ROLLBACK: see 20260715_009_fix_child_login_without_parent_session_rollback.sql

-- ── 1. Fix login_child ────────────────────────────────────────────────────────
-- Inherits SET search_path = public, extensions from migration 008 (pgcrypto fix).
-- Only change from migration 008: removes AND parent_id = auth.uid() from the
-- child lookup. All other logic, return columns and SECURITY DEFINER unchanged.

CREATE OR REPLACE FUNCTION public.login_child(p_username text, p_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
  -- Look up by globally-unique username only.
  -- Removed: AND parent_id = auth.uid() — children have no Supabase Auth account;
  -- auth.uid() is NULL on a cold restart, causing all child logins to fail.
  SELECT * INTO v_child
  FROM   children
  WHERE  username      = lower(p_username)
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

-- ── 2. Fix biometric_login_child ──────────────────────────────────────────────
-- Only change from migration 006: removes AND parent_id = auth.uid().
-- Security is maintained by the combination of:
--   id = p_child_id           (specific child UUID from device SecureStore)
--   biometric_enabled = true  (flag must have been explicitly enabled)
--   last_device_id = p_device_id (scoped to the exact device that enabled it)
-- All other logic, return columns and SECURITY DEFINER unchanged.

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
  -- Removed: AND parent_id = auth.uid() — same reason as login_child above.
  SELECT * INTO v_child
  FROM   children
  WHERE  id               = p_child_id
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

-- ── 3. Grant EXECUTE to anon ──────────────────────────────────────────────────
-- On a cold app restart there is no Supabase Auth session. The JS client calls
-- as the 'anon' role. PostgreSQL grants EXECUTE to PUBLIC by default, but
-- explicit grants make the intent clear and survive any future policy changes.

GRANT EXECUTE ON FUNCTION public.login_child(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.biometric_login_child(uuid, text) TO anon;

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
