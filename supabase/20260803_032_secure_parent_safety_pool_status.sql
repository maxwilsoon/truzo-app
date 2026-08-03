-- Migration 032: Secure get_parent_safety_pool_status
--
-- Root cause (two issues found during H4 audit):
--
-- A. anon EXECUTE grant survived migration 028.
--    Postgres "REVOKE ALL FROM PUBLIC" removes the PUBLIC pseudo-role grant but
--    does not touch explicit per-role grants. Supabase creates explicit grants
--    for both anon and authenticated when a function is first created; revoking
--    PUBLIC left the anon grant intact. Any unauthenticated caller could supply
--    any p_parent_id and read that parent's Safety Pool financial data.
--
-- B. No caller-identity check inside the function body.
--    The function is SECURITY DEFINER — it runs as its owner (postgres),
--    bypassing ALL table-level RLS policies. Even authenticated users from other
--    families could call the function with a different family's UUID and receive
--    their pool_limit / pool_used / pool_reserved / pool_available.
--
-- Fix:
--   1. Add auth.uid() = p_parent_id guard inside the function. Raises
--      'unauthorized' for anonymous callers and for any authenticated caller
--      whose Supabase Auth UID does not match p_parent_id.
--   2. Explicitly REVOKE EXECUTE from anon (and PUBLIC as belt-and-suspenders).
--   3. GRANT EXECUTE to authenticated only.
--      postgres and service_role retain superuser access implicitly.
--
-- Rollback: 20260803_032_rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.get_parent_safety_pool_status(p_parent_id uuid)
RETURNS TABLE(
  pool_limit     numeric,
  pool_used      numeric,
  pool_reserved  numeric,
  pool_available numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  -- Reject anonymous callers and cross-family access.
  -- Only the authenticated parent whose Supabase Auth UID = p_parent_id may call this.
  IF auth.uid() IS NULL OR auth.uid() <> p_parent_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
    SELECT
      COALESCE(p.safety_pool_limit,    0::numeric) AS pool_limit,
      COALESCE(p.safety_pool_used,     0::numeric) AS pool_used,
      COALESCE(p.safety_pool_reserved, 0::numeric) AS pool_reserved,
      GREATEST(0::numeric,
        COALESCE(p.safety_pool_limit,    0)
        - COALESCE(p.safety_pool_used,   0)
        - COALESCE(p.safety_pool_reserved, 0)
      )                                             AS pool_available
    FROM parents p
    WHERE p.id = p_parent_id;
END;
$$;

REVOKE ALL     ON FUNCTION public.get_parent_safety_pool_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_parent_safety_pool_status(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_parent_safety_pool_status(uuid) TO authenticated;

COMMIT;
