-- Rollback for 20260803_021_child_session_table.sql
--
-- Removes the child_sessions table and all three helper functions.
-- CASCADE on DROP TABLE removes all rows; REVOKE+DROP on functions cleans up grants.
--
-- Run this ONLY if migration 021, 022, and 023 have all been rolled back first.
-- Running 021_rollback while 023 is still active will break financial RPCs.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.revoke_child_session(text) FROM anon;

DROP FUNCTION IF EXISTS public.revoke_all_child_sessions(uuid, text);
DROP FUNCTION IF EXISTS public.revoke_child_session(text);
DROP FUNCTION IF EXISTS public.require_valid_child_session(uuid, text, text);

-- CASCADE drops all rows (child_sessions has no dependents other than the functions above)
DROP TABLE IF EXISTS public.child_sessions CASCADE;

NOTIFY pgrst, 'reload schema';

COMMIT;
