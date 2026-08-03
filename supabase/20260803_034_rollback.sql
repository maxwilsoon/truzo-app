-- Rollback for migration 034: disable PIN login without restoring the insecure
-- SHA-256 architecture.
--
-- After this rollback:
--   * verify_parent_passcode returns false for every input (PIN login disabled).
--     SHA-256 comparison is NOT restored.  H6 rate limiting is preserved so
--     brute-force protection still applies.
--   * set_parent_passcode is dropped.  No trusted write path to passcode_hash exists.
--   * The column-protection trigger (tg_protect_passcode_fields) and its function
--     (prevent_direct_passcode_write) are intentionally retained.  Dropping them
--     would re-open the direct-write vector closed by this migration.
--     The column is locked until a new forward migration restores a trusted write path.
--   * All parents must authenticate via email/password until a new secure passcode
--     migration is applied.
--
-- Client changes (6-digit UI, removal of hashPasscode) are safe to leave in place;
-- the "Sign in with email" footer link provides the fallback path.

BEGIN;

-- Disable PIN login: always return false, preserving rate limiting.
CREATE OR REPLACE FUNCTION public.verify_parent_passcode(p_parent_id uuid, p_pin text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_allowed boolean;
BEGIN
  -- Rate check preserved from H6 (migration 033) — brute-force protection still runs.
  v_allowed := _rl_attempt(
    'rl_parent_passcode', p_parent_id::text,
    5, interval '5 minutes', interval '5 minutes'
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;
  -- PIN login disabled post-rollback.  SHA-256 comparison is NOT restored.
  RETURN false;
END;
$$;

-- Remove the trusted write path.  passcode_hash is locked by the trigger.
DROP FUNCTION IF EXISTS public.set_parent_passcode(uuid, text);

COMMIT;

-- NOTE: tg_protect_passcode_fields and prevent_direct_passcode_write are kept.
-- Dropping them would reopen C2 (direct passcode_hash writes).
-- To restore passcode login, apply a new forward migration that re-creates
-- set_parent_passcode and sets the session flag correctly.
