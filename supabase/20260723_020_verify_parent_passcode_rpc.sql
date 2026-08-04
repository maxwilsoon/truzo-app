-- Migration 020: Fix C2 complement — server-side passcode verification
--
-- C2 root cause (passcode.ts):
--   hashPasscode() computes SHA-256(userId + ':' + pin).
--   SHA-256 is not a password-hardening function — a modern CPU can compute
--   billions of SHA-256 digests per second. With only 10,000 possible 4-digit
--   PINs the entire keyspace is exhausted in <1 ms.
--
--   The vulnerability compounds C1: once passcode_hash reaches the client
--   (fixed by migration 015), offline brute-force requires zero server interaction.
--
-- C2 fix strategy:
--   Phase 1 (this migration): keep SHA-256 storage mechanism (changing it would
--   log out all existing users who'd need to reset their PIN). Move the comparison
--   server-side via a new verify_parent_passcode RPC that:
--     • Never returns the hash to the client
--     • Is the only path to perform a passcode check
--     • Can be rate-limited at the Supabase API gateway (future work — H6)
--   The client submits only the plain PIN; the DB computes and compares server-side.
--
--   Phase 2 (future migration, requires coordinated rollout):
--   Migrate to bcrypt at cost 12 via a new set_parent_passcode_bcrypt() RPC
--   that rehashes on first verify. PIN minimum length should increase to 6 digits
--   simultaneously.
--
-- Also updates getParentPasscodeHash to return only the boolean created flag —
--   the raw hash is no longer needed by any client code.

-- ── 1. verify_parent_passcode ──────────────────────────────────────────────────
-- Accepts the plain PIN; computes SHA-256 server-side; returns boolean.
-- Never exposes the stored hash value to the caller.
-- Callable by anon: needed for the parent passcode entry screen which may run
-- without an active Supabase Auth session (child context, cold restart).

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
BEGIN
  SELECT passcode_hash INTO v_stored_hash FROM parents WHERE id = p_parent_id;
  IF v_stored_hash IS NULL THEN
    RETURN false;
  END IF;

  -- Replicate the client-side hash: SHA-256(parentId::text || ':' || pin)
  -- encode(...,'hex') produces a lowercase hex string matching expo-crypto's output.
  RETURN encode(digest(p_parent_id::text || ':' || p_pin, 'sha256'), 'hex') = v_stored_hash;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_parent_passcode(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_parent_passcode(uuid, text) TO authenticated;

-- ── 2. get_parent_passcode_status ─────────────────────────────────────────────
-- Replaces the pattern used in getParentPasscodeHash: returns only the boolean
-- flag indicating whether a passcode has been set. Never returns the hash itself.
-- Clients that previously called getParentPasscodeHash to obtain the hash for
-- local comparison should switch to verify_parent_passcode instead.

CREATE OR REPLACE FUNCTION public.get_parent_passcode_status(
  p_parent_id uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(passcode_created, false) FROM parents WHERE id = p_parent_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_parent_passcode_status(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_parent_passcode_status(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
