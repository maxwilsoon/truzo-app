-- Rollback migration 032: revert get_parent_safety_pool_status to pre-032 state.
--
-- WARNING: this removes the caller-identity guard and re-grants anon EXECUTE.
-- The function reverts to SECURITY DEFINER with no auth.uid() check — any
-- unauthenticated caller can read any parent's Safety Pool data.
-- Apply only in a break-glass rollback situation, never to production.

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

-- Restore pre-032 grants (anon had explicit EXECUTE; PUBLIC revoke from 028 left it intact)
REVOKE ALL     ON FUNCTION public.get_parent_safety_pool_status(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_parent_safety_pool_status(uuid) TO anon;
GRANT  EXECUTE ON FUNCTION public.get_parent_safety_pool_status(uuid) TO authenticated;

COMMIT;
