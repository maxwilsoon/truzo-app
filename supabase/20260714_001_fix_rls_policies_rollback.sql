-- ============================================================
-- Rollback:   20260714_001_fix_rls_policies_rollback.sql
-- Reverts:    20260714_001_fix_rls_policies.sql
--
-- Run this ONLY if the migration must be undone.
-- This restores the original (insecure) policies exactly.
-- ============================================================

BEGIN;

-- ── 1. circles: restore realtime_read ─────────────────────────────────────────

DROP POLICY IF EXISTS circles_participant_select ON public.circles;

CREATE POLICY realtime_read ON public.circles
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- ── 2. circle_requests: restore realtime_read ─────────────────────────────────

DROP POLICY IF EXISTS circle_requests_participant_select ON public.circle_requests;

CREATE POLICY realtime_read ON public.circle_requests
  FOR SELECT
  TO authenticated, anon
  USING (true);


-- ── 3. children: restore parent_own_child ─────────────────────────────────────

DROP POLICY IF EXISTS children_parent_delete ON public.children;

-- NOTE: original policy had no role restriction (applies to all roles)
--       and no explicit WITH CHECK (USING expression used as fallback).
CREATE POLICY parent_own_child ON public.children
  FOR ALL
  USING (auth.uid() = parent_id);


-- ── 4. parents: restore parent_own_row ────────────────────────────────────────

DROP POLICY IF EXISTS parents_own_row_delete ON public.parents;

-- NOTE: same — no role restriction, no explicit WITH CHECK.
CREATE POLICY parent_own_row ON public.parents
  FOR ALL
  USING (auth.uid() = id);


COMMIT;
