-- Migration 031: Atomic cancel + activity cleanup
--
-- Problem: cancel_money_request only updated the request status.
-- Activity-row deletion was a separate non-atomic client call to
-- remove_request_activities(), which could fail independently.
-- The client's merge logic also treated deleted rows as "optimistic"
-- items, so they would reappear after the next poll.
--
-- This migration:
--   1. Rebuilds cancel_money_request to DELETE activity rows in the
--      same transaction — atomicity guaranteed, no partial state.
--   2. Drops the standalone remove_request_activities() RPC — its
--      logic is now inside cancel_money_request, and the standalone
--      version had no session validation (security gap).
--
-- Rollback: 20260803_031_rollback.sql

-- ─── 1. Rebuild cancel_money_request ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_money_request(
  p_request_id    uuid,
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_rows int;
BEGIN
  -- Session validation is the first operation — before any read or write.
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  UPDATE money_requests
    SET    status = 'cancelled'
    WHERE  id      = p_request_id
      AND  from_id = p_child_id
      AND  status  = 'pending';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Only delete activity rows when we actually cancelled something.
  -- A no-op UPDATE (already cancelled, funded, or wrong owner) is safe — no cleanup needed.
  IF v_rows > 0 THEN
    DELETE FROM activity_feed
      WHERE id IN (
        'a_req_'    || p_request_id::text,   -- borrower's "You requested £X"
        'moneyreq_' || p_request_id::text    -- circle viewers' "X requested £Y"
      );
  END IF;
END;
$$;

-- ─── 2. Drop standalone remove_request_activities ─────────────────────────────
-- This RPC is no longer called by the client (activity cleanup is now inside
-- cancel_money_request). Dropping it removes the unauthenticated surface area.

DROP FUNCTION IF EXISTS public.remove_request_activities(text);
