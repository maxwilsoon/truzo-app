-- Migration 018: Fix C4 — revoke persist_transaction from PUBLIC
--
-- Vulnerability confirmed (rls-migration.sql lines 149-165):
--   CREATE OR REPLACE FUNCTION persist_transaction(...)
--   LANGUAGE plpgsql SECURITY DEFINER
--   -- No REVOKE; PostgreSQL grants EXECUTE to PUBLIC by default.
--   -- No authentication check inside the function body.
--
--   Any anonymous caller can INSERT fabricated transaction records for any child UUID,
--   injecting false top-ups, borrows, or repayments into the transaction history.
--
--   Audit of current codebase confirms db.persistTransaction() is defined in
--   database.ts but is NOT called from any screen, context, or hook. All
--   transaction inserts are handled server-side by the authoritative financial RPCs
--   (fund_money_request, repay_money_request, parent_send_to_child). The client-side
--   wrapper is dead code — it can be locked down without breaking any live path.
--
-- Fix: revoke EXECUTE from PUBLIC (the PostgreSQL default). Only service_role
--   (Supabase admin / Edge Functions) retains the ability to call it directly.
--   Explicit grants to anon and authenticated are also revoked for clarity.

REVOKE EXECUTE ON FUNCTION public.persist_transaction(uuid, text, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.persist_transaction(uuid, text, numeric, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.persist_transaction(uuid, text, numeric, text, text) FROM authenticated;

-- service_role (used by Supabase Edge Functions and admin tooling) retains access.
GRANT  EXECUTE ON FUNCTION public.persist_transaction(uuid, text, numeric, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
