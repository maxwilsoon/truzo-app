-- Migration 016: Fix H7 — top_up_safety_pool missing SET search_path
--
-- Vulnerability confirmed (money-management-migration.sql line 11):
--   CREATE OR REPLACE FUNCTION top_up_safety_pool(p_parent_id UUID, p_amount NUMERIC)
--   RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
--
--   SECURITY DEFINER functions run as the owner (postgres superuser) but without
--   a pinned search_path the function resolves table names against whatever
--   search_path the calling session has configured. A session that sets
--   search_path = attacker_schema, public could shadow the 'parents' table
--   with a malicious one, redirecting the UPDATE to attacker-controlled rows.
--
-- Fix: add SET search_path = public so the function always resolves 'parents'
--   against the public schema regardless of the calling session's search_path.
--
-- No functional change — all other logic is identical to the original.

CREATE OR REPLACE FUNCTION public.top_up_safety_pool(p_parent_id UUID, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_limit NUMERIC;
BEGIN
  UPDATE parents
    SET safety_pool_limit = COALESCE(safety_pool_limit, 0) + p_amount
  WHERE id = p_parent_id
  RETURNING safety_pool_limit INTO v_new_limit;
  RETURN v_new_limit;
END;
$$;

NOTIFY pgrst, 'reload schema';
