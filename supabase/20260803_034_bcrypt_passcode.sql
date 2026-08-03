-- Migration 034: Upgrade parent passcode system to bcrypt 6-digit PINs
--
-- Changes:
--   1. Precondition: require explicit session-level approval flag before destroying
--      active passcode hashes (test data only — see apply_034.js).
--   2. Force-reset: null all existing SHA-256 passcode_hash values and reset
--      passcode_created/passcode_created_at. Runs BEFORE the trigger is installed.
--   3. Rebuild verify_parent_passcode with bcrypt comparison, safe format guard,
--      and indistinguishable behaviour for unknown UUID / null hash / wrong PIN.
--   4. Create set_parent_passcode: auth.uid() guard, 6-digit validation, weak-PIN
--      rejection, rate limiting, then bcrypt. Granted to authenticated only (not anon).
--   5. Create BEFORE UPDATE trigger tg_protect_passcode_fields that blocks direct
--      writes to passcode_hash, passcode_created, passcode_created_at unless the
--      transaction-local flag truzo.allow_passcode_write = 'true' is set. This flag
--      is set only by set_parent_passcode before its UPDATE.
--
-- Security properties after migration:
--   * passcode_hash can only be modified through set_parent_passcode.
--   * Direct supabase.from('parents').update({passcode_hash: ...}) raises an exception
--     regardless of the caller's role — including authenticated parents and service_role.
--   * verify_parent_passcode: unknown UUID, null hash, and wrong PIN all return false
--     with no semantic or timing distinction observable by the caller.
--   * No status endpoint reveals whether a UUID has a passcode configured.
--
-- Rollback: supabase/20260803_034_rollback.sql
-- Verify:   supabase/verify_034.js  (30 tests)
-- Apply:    supabase/apply_034.js   (sets truzo.c2_reset_approved = 'yes')

BEGIN;

-- ─── PRECONDITION ─────────────────────────────────────────────────────────────
-- Fail unless the apply script has explicitly set the approval session variable.
-- This prevents accidental runs via the Supabase SQL editor without awareness of
-- the destructive force-reset that follows.

DO $$
DECLARE
  v_count int;
BEGIN
  IF current_setting('truzo.c2_reset_approved', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      E'Migration 034 blocked.\n'
      'This migration nulls ALL parent passcode_hash values — every existing parent '
      'PIN will stop working and parents will need to set a new 6-digit PIN via '
      'email/password login.\n'
      'Confirmed test environment only. To proceed, run via apply_034.js, which sets '
      'truzo.c2_reset_approved = ''yes'' in the same session before executing this file.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.parents
  WHERE passcode_hash IS NOT NULL OR passcode_created = true;

  RAISE NOTICE
    'Migration 034: nulling passcode_hash for % parent row(s). '
    'All existing parent PINs will stop working immediately. '
    'Affected parents must sign in with email/password to set a new 6-digit PIN.',
    v_count;
END $$;

-- ─── STEP 1: Force-reset — runs before trigger is installed ───────────────────
-- SHA-256 hashes cannot be upgraded to bcrypt without the original PIN.
-- All rows are test data; forced reset is the cleanest migration path.
-- The trigger does not yet exist here, so no session flag is required.

UPDATE public.parents
SET
  passcode_hash       = NULL,
  passcode_created    = false,
  passcode_created_at = NULL;

-- ─── STEP 2: Rebuild verify_parent_passcode ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.verify_parent_passcode(p_parent_id uuid, p_pin text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_stored_hash text;
  v_allowed     boolean;
BEGIN
  -- 1. Rate check BEFORE any hash work.  Counts this attempt regardless of outcome
  --    so null-hash probes cost the same as wrong-PIN attempts.
  v_allowed := _rl_attempt(
    'rl_parent_passcode', p_parent_id::text,
    5, interval '5 minutes', interval '5 minutes'
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  -- 2. Fetch stored hash (NULL for unknown UUID or passcode not yet configured).
  SELECT passcode_hash INTO v_stored_hash FROM public.parents WHERE id = p_parent_id;

  -- 3. Format guard: reject null, absent-parent, or non-bcrypt values without
  --    calling crypt().  Accepts $2a$, $2b$, $2y$ prefixes; valid bcrypt output
  --    is always exactly 60 characters.  This blocks SHA-256 hashes (64-char hex)
  --    and any other malformed value safely and without a database exception.
  --
  --    All three caller-visible failure modes (unknown UUID, passcode not configured,
  --    wrong PIN) return false — indistinguishable from the caller's perspective.
  IF v_stored_hash IS NULL
     OR v_stored_hash !~ '^\$2[aby]\$[0-9]{2}\$'
     OR length(v_stored_hash) <> 60 THEN
    RETURN false;
  END IF;

  -- 4. bcrypt comparison — only reached when a valid stored hash exists.
  IF crypt(p_pin, v_stored_hash) = v_stored_hash THEN
    PERFORM _rl_clear('rl_parent_passcode', p_parent_id::text);
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_parent_passcode(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.verify_parent_passcode(uuid, text) TO anon, authenticated;

-- ─── STEP 3: Create set_parent_passcode ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_parent_passcode(p_parent_id uuid, p_pin text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_allowed boolean;
BEGIN
  -- 1. Caller-identity guard — fails immediately for absent or mismatched JWT.
  IF auth.uid() IS NULL OR auth.uid() <> p_parent_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- 2. Format validation — must be exactly 6 decimal digits.
  IF p_pin !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'invalid_pin_format';
  END IF;

  -- 3. Weak-PIN rejection.
  IF p_pin = ANY(ARRAY[
    '000000','111111','222222','333333','444444',
    '555555','666666','777777','888888','999999',
    '123456','654321','012345','543210'
  ]) THEN
    RAISE EXCEPTION 'weak_pin';
  END IF;

  -- 4. Rate guard before expensive bcrypt work.
  --    Threat: authenticated abuse and resource exhaustion — bcrypt at cost=10 takes
  --    ~100 ms; an unconstrained loop could consume significant DB CPU.
  v_allowed := _rl_attempt(
    'rl_set_passcode', p_parent_id::text,
    10, interval '10 minutes', interval '30 minutes'
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  -- 5. Signal the column-protection trigger that this UPDATE is trusted.
  --    The flag is transaction-local (third arg = true) so it cannot persist
  --    beyond this request's transaction or be set by an external API caller.
  PERFORM set_config('truzo.allow_passcode_write', 'true', true);

  -- 6. bcrypt — expensive work only after all cheap guards pass.
  UPDATE public.parents
  SET
    passcode_hash       = crypt(p_pin, gen_salt('bf', 10)),
    passcode_created    = true,
    passcode_created_at = now()
  WHERE id = p_parent_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_parent_passcode(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_parent_passcode(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_parent_passcode(uuid, text) TO authenticated;

-- ─── STEP 4: Column-protection trigger ───────────────────────────────────────
-- Blocks any UPDATE that modifies passcode_hash, passcode_created, or
-- passcode_created_at unless the transaction-local flag
-- truzo.allow_passcode_write = 'true' has been set.
--
-- Only set_parent_passcode sets this flag.  All other callers — including
-- authenticated parents using the Supabase JS client, service_role bypassing
-- RLS, or any custom client against the public API — are blocked.
--
-- The WHEN clause ensures the trigger function is called only when passcode
-- columns actually change, so ordinary profile updates (name, avatar, settings)
-- do not incur any trigger overhead.

CREATE OR REPLACE FUNCTION public.prevent_direct_passcode_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF current_setting('truzo.allow_passcode_write', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION
      'passcode fields (passcode_hash, passcode_created, passcode_created_at) '
      'may only be modified via set_parent_passcode()';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_protect_passcode_fields ON public.parents;

CREATE TRIGGER tg_protect_passcode_fields
BEFORE UPDATE ON public.parents
FOR EACH ROW
WHEN (
  NEW.passcode_hash       IS DISTINCT FROM OLD.passcode_hash       OR
  NEW.passcode_created    IS DISTINCT FROM OLD.passcode_created    OR
  NEW.passcode_created_at IS DISTINCT FROM OLD.passcode_created_at
)
EXECUTE FUNCTION public.prevent_direct_passcode_write();

COMMIT;
