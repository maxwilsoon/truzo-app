-- Rollback for Migration 038 — FAIL-CLOSED.
--
-- Drops the new session-protected Circle write signatures only.
-- The old unprotected signatures (uuid, uuid) and (uuid) are NOT restored.
-- All 5 Circle write RPCs become temporarily unavailable until the migration
-- is re-applied.
--
-- Do NOT use this rollback to restore the old insecure overloads.

BEGIN;

DROP FUNCTION IF EXISTS public.send_circle_request(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.accept_circle_request(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.decline_circle_request(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.cancel_circle_request(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.remove_from_circle(uuid, uuid, text, text);

NOTIFY pgrst, 'reload schema';

COMMIT;
