-- Migration 010: SECURITY DEFINER RPC for Safety Pool status
--
-- Problem: getSafetyPoolStatus in database.ts queries the parents table directly.
-- The parents SELECT RLS policy requires auth.uid() = id, but after a child login
-- (which uses a SECURITY DEFINER RPC and does NOT create a parent Supabase Auth
-- session) the Supabase client has no parent JWT. Supabase is also configured with
-- persistSession: false, so even a prior parent email-login JWT is gone on any cold
-- restart. Result: the query silently returns null → available = 0 → the Safety Pool
-- setup screen fires incorrectly for every funded parent after child logout.
--
-- Fix: a SECURITY DEFINER function readable by the anon role, exactly like the
-- existing biometric_login_child and login_child RPCs.

DROP FUNCTION IF EXISTS get_parent_safety_pool_status(uuid);

CREATE OR REPLACE FUNCTION get_parent_safety_pool_status(p_parent_id uuid)
RETURNS TABLE (pool_limit numeric, pool_used numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
    SELECT
      COALESCE(p.safety_pool_limit, 0::numeric) AS pool_limit,
      COALESCE(p.safety_pool_used,  0::numeric) AS pool_used
    FROM parents p
    WHERE p.id = p_parent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_parent_safety_pool_status(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_parent_safety_pool_status(uuid) TO authenticated;
