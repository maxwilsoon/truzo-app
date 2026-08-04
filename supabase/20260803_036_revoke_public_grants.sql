-- Migration 036: Resolve all Critical and High RPC authorization findings
--
-- ── Findings addressed ────────────────────────────────────────────────────────────────────
--
-- C-01  enable_biometric has no auth guard — full child account takeover
--         Fix: add p_session_token param; call require_valid_child_session() first.
--              BREAKING CHANGE: client must pass session_token (4th arg).
--              Old 3-param overload dropped.
--
-- H-01  disable_biometric has no auth guard — forced session revocation
--         Fix: add p_session_token + p_device_id params; call require_valid_child_session().
--              BREAKING CHANGE: client must pass (child_id, session_token, device_id).
--              Old 1-param overload dropped.
--
-- H-02  confirm_parent_repayment is anon-callable — frozen child can self-unfreeze
--         Fix: add auth.uid() = p_parent_id guard; revoke anon; grant authenticated only.
--
-- H-03  persist_transaction PUBLIC/anon regression — migration 018 did not hold in live DB
--         Fix: re-issue the REVOKE. Idempotent — safe to run even if already revoked.
--
-- H-04  parent_send_money is anon-callable with no auth guard
--         Fix: DROP the legacy function (dead code; superseded by parent_send_to_child).
--              Uses signature discovery to handle any overload variant.
--
-- H-05  Broad PUBLIC grants on internal helper functions
--         Fix: REVOKE PUBLIC + anon from all functions that are internal-call-only:
--              _trigger_notification, _trigger_notification_multi, add_activity_item,
--              _update_weekly_streak, process_due_allowances, set_allowance_schedule,
--              update_marketing_preference, insert_child (already has auth.uid() guard,
--              just needs PUBLIC/anon revoked), plus belt-and-suspenders REVOKEs on all
--              other known internal helpers.
--         Partial fix: data-read RPCs (get_activity_feed, get_child_stats, etc.) lose
--              their PUBLIC grant but keep their anon grant (children call these without
--              a Supabase Auth JWT). Full fix (session validation) requires follow-up
--              migration with client changes.
--
-- ── Client changes required before applying ──────────────────────────────────────────────
--
--   src/lib/database.ts :: enableBiometric(childId, deviceId, tokenHash)
--     → enableBiometric(childId, deviceId, tokenHash, sessionToken)
--     Calls RPC: enable_biometric($1, $2, $3, $4)
--
--   src/lib/database.ts :: disableBiometric(childId)
--     → disableBiometric(childId, sessionToken, deviceId)
--     Calls RPC: disable_biometric($1, $2, $3)
--
-- ── Rollback ─────────────────────────────────────────────────────────────────────────────
--   20260803_036_rollback.sql  (restores old signatures; does NOT restore C-01/H-01 vulns)
--
-- ── Verification ──────────────────────────────────────────────────────────────────────────
--   node supabase/verify_036.js
--
-- Rollback: 20260803_036_rollback.sql

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 1: C-01 — enable_biometric (account takeover via credential hijack)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Old: enable_biometric(uuid, text, text) — no auth guard, anon-callable.
-- New: enable_biometric(uuid, text, text, text) — session-protected.
--
-- The 4th parameter (p_session_token) is required. The old 3-param overload is
-- dropped so callers without a session token cannot call the function at all.

REVOKE ALL ON FUNCTION public.enable_biometric(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.enable_biometric(uuid, text, text);

CREATE FUNCTION public.enable_biometric(
  p_child_id             uuid,
  p_device_id            text,
  p_biometric_token_hash text,
  p_session_token        text     -- required: child must hold a valid session
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Session validation FIRST — the caller must already be authenticated as this
  -- child (i.e., they just completed a password login during the setup flow).
  -- This closes the "Phase 2" note left in migration 022.
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  IF p_biometric_token_hash IS NULL OR length(p_biometric_token_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid_biometric_token_hash';
  END IF;
  IF p_device_id IS NULL OR p_device_id = '' THEN
    RAISE EXCEPTION 'invalid_device_id';
  END IF;

  UPDATE children
    SET biometric_enabled    = true,
        last_device_id       = p_device_id,
        biometric_token_hash = p_biometric_token_hash
    WHERE id = p_child_id;
END;
$$;

REVOKE ALL     ON FUNCTION public.enable_biometric(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enable_biometric(uuid, text, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.enable_biometric(uuid, text, text, text) TO anon, postgres, service_role;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 2: H-01 — disable_biometric (forced credential/session revocation)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Old: disable_biometric(uuid) — no auth guard, anon-callable.
-- New: disable_biometric(uuid, text, text) — session-protected.
--
-- NOTE: Session check fires before revoke_all_child_sessions so the calling
-- session can authenticate first, then gets revoked along with all others.
-- This is the intended behaviour: the requesting device explicitly disables
-- biometric, losing its own session in the process (like a password reset).

REVOKE ALL ON FUNCTION public.disable_biometric(uuid)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.disable_biometric(uuid);

CREATE FUNCTION public.disable_biometric(
  p_child_id      uuid,
  p_session_token text,     -- required: child must hold a valid session
  p_device_id     text      -- required: must match the session's device_id
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Session check: proves the caller owns this child account.
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  UPDATE children
    SET biometric_enabled    = false,
        last_device_id       = NULL,
        biometric_token_hash = NULL
    WHERE id = p_child_id;

  -- Revoke ALL sessions (including the one that just authenticated above).
  -- Biometric disable is a credential reset; all open sessions are now invalid.
  PERFORM revoke_all_child_sessions(p_child_id, 'biometric_disabled');
END;
$$;

REVOKE ALL     ON FUNCTION public.disable_biometric(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.disable_biometric(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.disable_biometric(uuid, text, text) TO anon, postgres, service_role;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 3: H-02 — confirm_parent_repayment (self-unfreeze by frozen child)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Adds auth.uid() = p_parent_id guard. Restricts to authenticated parents only.
-- Function body otherwise unchanged from migration 002.

CREATE OR REPLACE FUNCTION public.confirm_parent_repayment(
  p_child_id  uuid,
  p_parent_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_debt          numeric;
  v_child_balance numeric;
BEGIN
  -- Caller-identity guard: the parent's Supabase Auth JWT must match p_parent_id.
  -- Rejects all anon callers and any authenticated caller acting for another family.
  IF auth.uid() IS NULL OR auth.uid() <> p_parent_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT COALESCE(parent_debt, 0), wallet_balance
  INTO   v_debt, v_child_balance
  FROM   children
  WHERE  id = p_child_id AND parent_id = p_parent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_parent');
  END IF;

  IF v_debt = 0 THEN
    RETURN json_build_object('repaid', 0);
  END IF;

  IF COALESCE(v_child_balance, 0) < v_debt THEN
    RAISE EXCEPTION 'Insufficient balance: child has £% but owes £%',
      to_char(COALESCE(v_child_balance, 0), 'FM999990.00'),
      to_char(v_debt, 'FM999990.00');
  END IF;

  UPDATE children SET
    wallet_balance = wallet_balance - v_debt,
    parent_debt    = 0,
    account_frozen = false
  WHERE id = p_child_id;

  UPDATE parents
    SET safety_pool_used = GREATEST(0, COALESCE(safety_pool_used, 0) - v_debt)
    WHERE id = p_parent_id;

  RETURN json_build_object('repaid', v_debt);
END;
$$;

REVOKE ALL     ON FUNCTION public.confirm_parent_repayment(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_parent_repayment(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.confirm_parent_repayment(uuid, uuid) TO authenticated, postgres, service_role;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 4: H-03 — persist_transaction PUBLIC/anon regression
-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 018 issued these REVOKEs but the live DB still shows PUBLIC + anon.
-- Re-issuing here is idempotent and safe.

REVOKE ALL     ON FUNCTION public.persist_transaction(uuid, text, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.persist_transaction(uuid, text, numeric, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.persist_transaction(uuid, text, numeric, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.persist_transaction(uuid, text, numeric, text, text) TO postgres, service_role;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 5: H-04 — parent_send_money (legacy function, no auth guard)
-- ═══════════════════════════════════════════════════════════════════════════════
-- This function is dead code (all parent→child transfers use parent_send_to_child).
-- DROP all overloads. Uses signature discovery because the function exists only in
-- the live DB (not in any migration file) and its exact signature is unknown.

DO $$
DECLARE
  v_fn record;
  v_dropped int := 0;
BEGIN
  FOR v_fn IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname          = 'parent_send_money'
      AND  pronamespace     = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || v_fn.sig;
    RAISE NOTICE 'Dropped legacy function: %', v_fn.sig;
    v_dropped := v_dropped + 1;
  END LOOP;
  IF v_dropped = 0 THEN
    RAISE NOTICE 'parent_send_money: not found — nothing to drop.';
  END IF;
END
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 6: H-05 — Internal-call-only helpers (should never be externally callable)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── _trigger_notification ─────────────────────────────────────────────────────
REVOKE ALL     ON FUNCTION public._trigger_notification(text, uuid, text, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ── _trigger_notification_multi ───────────────────────────────────────────────
REVOKE ALL     ON FUNCTION public._trigger_notification_multi(text, uuid[], text, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ── add_activity_item ─────────────────────────────────────────────────────────
REVOKE ALL     ON FUNCTION public.add_activity_item(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

-- ── _update_weekly_streak ─────────────────────────────────────────────────────
-- Signature unknown (function predates numbered migrations). Use discovery.
DO $$
DECLARE v_fn record;
BEGIN
  FOR v_fn IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname      = '_update_weekly_streak'
      AND  pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_fn.sig || ' FROM PUBLIC, anon, authenticated';
    RAISE NOTICE 'REVOKED _update_weekly_streak: %', v_fn.sig;
  END LOOP;
END
$$;

-- ── process_due_allowances ────────────────────────────────────────────────────
-- pg_cron / service_role only. External callers must not be able to trigger early.
DO $$
DECLARE v_fn record;
BEGIN
  FOR v_fn IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname      = 'process_due_allowances'
      AND  pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_fn.sig || ' FROM PUBLIC, anon, authenticated';
    RAISE NOTICE 'REVOKED process_due_allowances: %', v_fn.sig;
  END LOOP;
END
$$;

-- ── process_due_loan_defaults ─────────────────────────────────────────────────
-- Already REVOKEd by migration 029. Belt-and-suspenders: re-issue idempotently.
REVOKE ALL ON FUNCTION public.process_due_loan_defaults() FROM PUBLIC, anon, authenticated;

-- ── Rate-limiting helpers (already REVOKEd by migration 033 — belt-and-suspenders) ──
REVOKE ALL ON FUNCTION public._rl_attempt(text, text, integer, interval, interval)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rl_clear(text, text)
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public._rl_get_ip() FROM PUBLIC, anon, authenticated';
EXCEPTION WHEN undefined_function THEN NULL;
END
$$;

-- ── Internal session helpers (no grant was ever added, but explicit is safer) ──
REVOKE ALL ON FUNCTION public.require_valid_child_session(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_all_child_sessions(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ── Amount validation helper (already REVOKEd by migration 035) ──────────────
REVOKE ALL ON FUNCTION public.require_valid_gbp_amount(numeric, text)
  FROM PUBLIC, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 7: H-05 — Parent-write functions with no or insufficient auth guard
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── set_allowance_schedule ────────────────────────────────────────────────────
-- REVOKE anon (cannot add auth guard without reading live body; auth guard is a
-- follow-up once body is confirmed). Authenticated callers can still call it —
-- parent owns their row via RLS. Function not in any migration file; use discovery.
DO $$
DECLARE v_fn record;
BEGIN
  FOR v_fn IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname      = 'set_allowance_schedule'
      AND  pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_fn.sig || ' FROM PUBLIC, anon';
    RAISE NOTICE 'REVOKED set_allowance_schedule from PUBLIC/anon: %', v_fn.sig;
  END LOOP;
END
$$;

-- ── update_marketing_preference ───────────────────────────────────────────────
DO $$
DECLARE v_fn record;
BEGIN
  FOR v_fn IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname      = 'update_marketing_preference'
      AND  pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_fn.sig || ' FROM PUBLIC, anon';
    RAISE NOTICE 'REVOKED update_marketing_preference from PUBLIC/anon: %', v_fn.sig;
  END LOOP;
END
$$;

-- ── insert_child ──────────────────────────────────────────────────────────────
-- Has auth.uid() guard (raises 'not_authenticated' for NULL). REVOKE anon anyway
-- so the function is unreachable without a Supabase Auth JWT.
REVOKE ALL     ON FUNCTION public.insert_child(text, text, text, text, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.insert_child(text, text, text, text, integer, text) TO authenticated;

-- ── prevent_direct_passcode_write ─────────────────────────────────────────────
-- Trigger function. No external caller should ever invoke this directly.
REVOKE ALL ON FUNCTION public.prevent_direct_passcode_write()
  FROM PUBLIC, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 8: H-05 — REVOKE PUBLIC from all child-callable anon functions
-- ═══════════════════════════════════════════════════════════════════════════════
-- For functions that children legitimately call (anon role), strip the default
-- PUBLIC grant and replace with an explicit anon-only grant. This means future
-- CREATE OR REPLACE rebuilds won't silently re-expose them to authenticated parents
-- or service_role calling via client API.

-- Circle RPCs (no session validation yet — follow-up migration):
REVOKE ALL     ON FUNCTION public.send_circle_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.send_circle_request(uuid, uuid) TO anon;

REVOKE ALL     ON FUNCTION public.accept_circle_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.accept_circle_request(uuid) TO anon;

REVOKE ALL     ON FUNCTION public.decline_circle_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.decline_circle_request(uuid) TO anon;

-- Device token registration (called right after child login while still anon):
REVOKE ALL     ON FUNCTION public.register_device_token(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.register_device_token(uuid, text, text, text, text, text) TO anon;

-- Deregister device token at logout (child is anon).
-- Live DB has 1-param overload only; 2-param (text, uuid) is added in migration 039.
REVOKE ALL     ON FUNCTION public.deregister_device_token(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.deregister_device_token(text) TO anon;

-- 2-param overload does not exist yet — guard with exception so this migration
-- remains idempotent once M039 creates it.
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.deregister_device_token(text, uuid) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.deregister_device_token(text, uuid) TO anon';
EXCEPTION WHEN undefined_function THEN NULL;
END
$$;

-- Activity feed read (children call this; session validation needed as follow-up):
REVOKE ALL     ON FUNCTION public.get_activity_feed(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_activity_feed(uuid, integer) TO anon;

-- Data-read RPCs from original schema (live-DB only): REVOKE PUBLIC, keep anon.
-- These contain financial data visible to any caller who knows a child UUID.
-- Proper fix is session validation (follow-up); immediate fix strips PUBLIC super-grant.
DO $$
DECLARE v_fn record;
BEGIN
  FOR v_fn IN
    SELECT oid::regprocedure::text AS sig, proname
    FROM   pg_proc
    WHERE  proname IN (
      'get_child_stats', 'get_child_transactions', 'get_loan_history',
      'get_active_requests', 'get_circle', 'get_circle_history',
      'get_pending_requests'
    )
    AND pronamespace = 'public'::regnamespace
  LOOP
    -- Revoke PUBLIC (the postgres default) but keep any explicit anon grant.
    -- Children call these RPCs and they use the anon role.
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_fn.sig || ' FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_fn.sig || ' TO anon';
    RAISE NOTICE 'REVOKED PUBLIC, kept anon: %', v_fn.sig;
  END LOOP;
END
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 9: Re-confirm all grants that SHOULD be anon-accessible are explicit
-- ═══════════════════════════════════════════════════════════════════════════════
-- These functions must remain anon-callable. Belt-and-suspenders re-grant after
-- the mass-revoke sections above to ensure no legitimate function lost access.

GRANT EXECUTE ON FUNCTION public.login_child(text, text, text)              TO anon;
GRANT EXECUTE ON FUNCTION public.biometric_login_child(uuid, text, text)    TO anon;
GRANT EXECUTE ON FUNCTION public.revoke_child_session(text)                 TO anon;
GRANT EXECUTE ON FUNCTION public.verify_parent_passcode(uuid, text)         TO anon, authenticated;
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_parent_passcode_status(uuid) TO anon, authenticated';
EXCEPTION WHEN undefined_function THEN NULL;
END
$$; -- function not present in all environments
GRANT EXECUTE ON FUNCTION public.check_username_exists(text)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_email_exists(text)                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_mobile_exists(text)                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_money_request(uuid, numeric, integer, text, text, text, text, uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.fund_money_request(uuid, uuid, numeric, text, text)    TO anon;
GRANT EXECUTE ON FUNCTION public.repay_money_request(uuid, uuid, text, text)            TO anon;
GRANT EXECUTE ON FUNCTION public.cancel_money_request(uuid, uuid, text, text)           TO anon;

-- Parent-only authenticated grants:
GRANT EXECUTE ON FUNCTION public.top_up_safety_pool(uuid, numeric)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_safety_pool(uuid, numeric)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_send_to_child(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_parent_safety_pool_status(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_parent_passcode(uuid, text)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_parent_repayment(uuid, uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_child(text, text, text, text, integer, text) TO authenticated;


NOTIFY pgrst, 'reload schema';

COMMIT;
