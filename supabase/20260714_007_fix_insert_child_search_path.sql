-- Migration 007: Fix insert_child search_path so gen_salt() resolves at runtime
--
-- Root cause:
--   Migration 006 created insert_child with SET search_path = public.
--   On Supabase, pgcrypto is installed in the 'extensions' schema by default.
--   The migration's top-level UPDATE (the backfill) ran with the session's full
--   search path which included 'extensions', so gen_salt() resolved fine there.
--   But insert_child runs with its own restricted search_path = public — 'extensions'
--   is not visible, so gen_salt('bf', 10) produces error 42883 (undefined function)
--   every time the RPC is called.
--
-- Fix:
--   Recreate insert_child with SET search_path = public, extensions
--   so gen_salt and crypt resolve from whichever schema holds pgcrypto.
--
-- No data changes. No other RPCs changed. No frontend changes required.
--
-- WARNING: login_child and biometric_login_child also have SET search_path = public
-- and login_child uses crypt(). Those functions are intentionally not changed here
-- but may need the same treatment in a follow-up migration if child login fails.

-- ── Pre-flight verification ───────────────────────────────────────────────────
-- Confirm pgcrypto is installed and where gen_salt lives before proceeding.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'
  ) THEN
    RAISE NOTICE 'pgcrypto not found in pg_extension — attempting to create it now';
    -- Supabase always ships pgcrypto; this should never actually fail.
  END IF;
END;
$$;

-- Ensure pgcrypto is available (idempotent; no-op if already installed).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Recreate insert_child with corrected search_path ─────────────────────────

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
SET search_path = public, extensions  -- 'extensions' added so gen_salt/crypt resolve
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

-- ── Verification ─────────────────────────────────────────────────────────────
-- Run these queries to confirm the fix is correct before testing the app.

-- 1. Confirm pgcrypto is installed
-- SELECT extname, extversion FROM pg_extension WHERE extname = 'pgcrypto';

-- 2. Confirm where gen_salt lives (should be 'extensions' or 'public')
-- SELECT proname, pronamespace::regnamespace AS schema, oidvectortypes(proargtypes) AS args
-- FROM pg_proc WHERE proname = 'gen_salt';

-- 3. Confirm the live function now has the updated search_path
-- SELECT pg_get_functiondef(oid)
-- FROM pg_proc
-- WHERE proname = 'insert_child' AND pronamespace = 'public'::regnamespace;

-- 4. Smoke-test that gen_salt and crypt work (expected: a 60-char bcrypt hash)
-- SELECT length(crypt('testpassword', gen_salt('bf', 10))) AS hash_length;

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
