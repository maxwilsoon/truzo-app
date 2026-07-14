-- Migration 008: Fix search_path on login_child so crypt() resolves at runtime
--
-- Audit of all functions that call pgcrypto functions:
--
--   insert_child         crypt() + gen_salt()   SET search_path = public   FIXED in migration 007
--   login_child          crypt() × 2            SET search_path = public   FIXED HERE
--   biometric_login_child  (no pgcrypto calls)                             NOT AFFECTED
--
-- Root cause (same as migration 007):
--   Supabase installs pgcrypto into the 'extensions' schema.
--   SECURITY DEFINER functions with SET search_path = public cannot see
--   'extensions', so crypt() and gen_salt() produce error 42883 at call time.
--   Session-level SQL (e.g. the migration 006 backfill UPDATE) uses the full
--   session search path and finds pgcrypto fine; function bodies do not.
--
-- Fix:
--   Recreate login_child with SET search_path = public, extensions.
--   All logic, arguments, return type, column list and SECURITY DEFINER
--   are preserved exactly.
--
-- ROLLBACK: see 20260714_008_fix_pgcrypto_search_paths_rollback.sql

-- ── Fix login_child ───────────────────────────────────────────────────────────
-- Only change from migration 006: SET search_path = public, extensions
-- Logic, return type, column list and SECURITY DEFINER are unchanged.

CREATE OR REPLACE FUNCTION public.login_child(p_username text, p_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions  -- 'extensions' added so crypt() resolves
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

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- ── Verification queries (run after applying) ─────────────────────────────────

-- 1. Confirm pgcrypto is installed
-- SELECT extname, extversion FROM pg_extension WHERE extname = 'pgcrypto';

-- 2. Confirm gen_salt and crypt live in the extensions schema
-- SELECT proname, pronamespace::regnamespace AS schema, oidvectortypes(proargtypes) AS args
-- FROM pg_proc WHERE proname IN ('gen_salt', 'crypt') ORDER BY proname, args;

-- 3. Confirm insert_child has the corrected search_path (fixed in migration 007)
-- SELECT prosrc FROM pg_proc
-- WHERE proname = 'insert_child' AND pronamespace = 'public'::regnamespace;
-- Expected: search_path contains 'extensions'

-- 4. Confirm login_child has the corrected search_path (fixed in this migration)
-- SELECT prosrc FROM pg_proc
-- WHERE proname = 'login_child' AND pronamespace = 'public'::regnamespace;
-- Expected: search_path contains 'extensions'

-- 5. Smoke-test: bcrypt hash/verify round-trip using fully-qualified names
-- SELECT length(extensions.crypt(
--   'testpassword',
--   extensions.gen_salt('bf', 10)
-- )) AS hash_length;
-- Expected: 60

-- 6. Confirm search_path for all three auth RPCs in one query
-- SELECT proname, proconfig
-- FROM pg_proc
-- WHERE proname IN ('insert_child', 'login_child', 'biometric_login_child')
--   AND pronamespace = 'public'::regnamespace
-- ORDER BY proname;
-- Expected: insert_child and login_child show search_path=public, extensions
--           biometric_login_child shows search_path=public (no pgcrypto needed)
