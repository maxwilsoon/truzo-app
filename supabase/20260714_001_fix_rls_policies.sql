-- ============================================================
-- Migration:  20260714_001_fix_rls_policies.sql
-- Purpose:    Fix four insecure RLS policies identified in the
--             production-readiness audit.
--
-- Changes:
--   1. circles        — DROP realtime_read (anon + authenticated, USING true)
--                       ADD  circles_participant_select (authenticated, row-filtered)
--   2. circle_requests — DROP realtime_read (anon + authenticated, USING true)
--                        ADD  circle_requests_participant_select (authenticated, row-filtered)
--   3. children       — DROP parent_own_child (all roles, ALL commands, no WITH CHECK)
--                       ADD  children_parent_delete (authenticated, DELETE, row-filtered)
--   4. parents        — DROP parent_own_row (all roles, ALL commands, no WITH CHECK)
--                       ADD  parents_own_row_delete (authenticated, DELETE, row-filtered)
--
-- Safety:
--   - All 30 child-facing RPCs are SECURITY DEFINER and bypass RLS entirely.
--     Removing anon SELECT on circles/circle_requests does NOT affect the app.
--   - Direct table calls in database.ts are all made by authenticated parents;
--     the existing SELECT/INSERT/UPDATE policies for authenticated parents remain
--     unchanged and continue to work.
--   - The one pre-existing issue (db.updateChildAvatarEmoji called from child
--     session as anon role, currently silently failing) is not changed.
--   - No application code, schema, business logic or data is modified.
--
-- Rollback:   See 20260714_001_fix_rls_policies_rollback.sql
-- ============================================================

BEGIN;

-- ── 1. circles ────────────────────────────────────────────────────────────────
-- PROBLEM: realtime_read policy grants SELECT to anon + authenticated with
--          USING: true — every row is readable by any unauthenticated caller.
--
-- FIX: Drop the permissive any-role policy. Replace with an authenticated-only
--      policy that restricts each parent to rows where their child appears as
--      either the circle owner (child_id) or a circle member (friend_id).
--
-- IMPACT: The dead `useRealtimeCircle.ts` hook (never imported anywhere) was the
--         only consumer of direct table SELECT. All live code paths go through
--         the get_circle / get_pending_requests SECURITY DEFINER RPCs.

DROP POLICY IF EXISTS realtime_read ON public.circles;

CREATE POLICY circles_participant_select ON public.circles
  FOR SELECT
  TO authenticated
  USING (
    child_id  IN (SELECT id FROM public.children WHERE parent_id = auth.uid())
    OR
    friend_id IN (SELECT id FROM public.children WHERE parent_id = auth.uid())
  );


-- ── 2. circle_requests ────────────────────────────────────────────────────────
-- PROBLEM: Same as circles — realtime_read grants SELECT to anon with USING: true.
--
-- FIX: Drop the permissive policy. Replace with an authenticated-only policy
--      that restricts each parent to requests where their child sent (from_id)
--      or received (to_id) the request.
--
-- IMPACT: None. All live code uses get_pending_requests, send_circle_request,
--         accept_circle_request, decline_circle_request, cancel_circle_request —
--         all SECURITY DEFINER.

DROP POLICY IF EXISTS realtime_read ON public.circle_requests;

CREATE POLICY circle_requests_participant_select ON public.circle_requests
  FOR SELECT
  TO authenticated
  USING (
    from_id IN (SELECT id FROM public.children WHERE parent_id = auth.uid())
    OR
    to_id   IN (SELECT id FROM public.children WHERE parent_id = auth.uid())
  );


-- ── 3. children ───────────────────────────────────────────────────────────────
-- PROBLEM: parent_own_child is an ALL policy applied to all roles (polroles = {}).
--          While auth.uid()=NULL makes it ineffective for anon callers today,
--          the policy:
--            (a) has no WITH CHECK, relying on USING as the insert/update guard
--            (b) applies to roles beyond 'authenticated' — unsafe by design
--            (c) is the only policy covering DELETE on this table
--
-- FIX: Drop parent_own_child. Replace with an explicit DELETE policy for
--      authenticated users only. The existing children_parent_select/insert/update
--      policies (all correctly scoped to authenticated) remain unchanged.
--
-- IMPACT: None. No app code directly DELETEs from children. Any future child
--         deletion must go through an authenticated parent session or a
--         SECURITY DEFINER admin function.

DROP POLICY IF EXISTS parent_own_child ON public.children;

CREATE POLICY children_parent_delete ON public.children
  FOR DELETE
  TO authenticated
  USING (parent_id = auth.uid());


-- ── 4. parents ────────────────────────────────────────────────────────────────
-- PROBLEM: parent_own_row is an ALL policy applied to all roles (polroles = {}).
--          Same structural issues as parent_own_child:
--            (a) no explicit WITH CHECK for INSERT/UPDATE
--            (b) applied to all roles, not just authenticated
--            (c) is the only policy covering DELETE on this table
--
-- FIX: Drop parent_own_row. Replace with an explicit DELETE policy for
--      authenticated users only. The existing parents_own_row_select/insert/update
--      policies remain unchanged.
--
-- IMPACT: None. No app code directly DELETEs from parents. The auth trigger
--         (trg_delete_auth_user) runs on parents DELETE and fires as a
--         SECURITY DEFINER trigger function, so it is unaffected.

DROP POLICY IF EXISTS parent_own_row ON public.parents;

CREATE POLICY parents_own_row_delete ON public.parents
  FOR DELETE
  TO authenticated
  USING (id = auth.uid());


COMMIT;
