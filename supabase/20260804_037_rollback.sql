-- Rollback for migration 037 — FAIL-CLOSED
--
-- SECURITY CONSTRAINT: This rollback does NOT restore any UUID-only (sessionless)
-- function signatures. Per project policy, rollbacks must never restore:
--   - UUID-only authorization (no session validation)
--   - PUBLIC grants on any function
--
-- Post-rollback state for all 11 RPCs:
--   UNAVAILABLE — new session-enforced signatures are dropped; old UUID-only
--   signatures are NOT restored. All 11 read RPCs return "function does not exist"
--   until migration 037 is re-applied.
--
-- Functions not touched by 037 (write RPCs, auth RPCs, helpers) are unaffected.
--
-- Apply:
--   psql $DATABASE_URL -f supabase/20260804_037_rollback.sql

BEGIN;

DROP FUNCTION IF EXISTS public.search_children(text, uuid, text, text);
DROP FUNCTION IF EXISTS public.get_pending_requests(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_circle(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_active_requests(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_outgoing_pending_requests(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_resolved_sent_requests(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_activity_feed(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.get_child_transactions(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.get_child_stats(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_loan_history(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_circle_history(uuid, text, text);

NOTIFY pgrst, 'reload schema';

COMMIT;
