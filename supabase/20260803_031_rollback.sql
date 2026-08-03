-- Rollback 031: Restore pre-031 cancel_money_request and remove_request_activities
--
-- Restores cancel_money_request to status-update only (no activity cleanup).
-- Recreates the standalone remove_request_activities RPC.

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
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  UPDATE money_requests
    SET status = 'cancelled'
    WHERE id      = p_request_id
      AND from_id = p_child_id
      AND status  = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_request_activities(p_request_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM activity_feed
    WHERE id = 'a_req_' || p_request_id
       OR id = 'moneyreq_' || p_request_id;
END;
$$;
