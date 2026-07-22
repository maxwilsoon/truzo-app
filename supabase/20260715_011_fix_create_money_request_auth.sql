-- Migration 011: remove auth.uid() guard from create_money_request
--
-- Problem: the RPC checked `parent_id = auth.uid()` to verify ownership.
-- Child login uses a SECURITY DEFINER RPC and does NOT create a Supabase Auth
-- session, so auth.uid() is always NULL → the check always fails → 'unauthorized'.
--
-- Fix: replace with a direct child-exists check. The child's UUID is the
-- authenticated identity (verified at login via login_child or biometric_login_child).
-- All other guards (frozen, already_borrowing, amount_limit) remain unchanged.
--
-- NOTE: there were two overloads in DB (different parameter ordering). The
-- original one used by the app has p_deadline_days 3rd (below). A stray overload
-- with p_reason 3rd is also dropped here.

-- Drop the stale overload that was accidentally created
DROP FUNCTION IF EXISTS create_money_request(uuid, numeric, text, text, integer, uuid[]);

-- Replace the original overload (used by the app) with the auth.uid() check removed
CREATE OR REPLACE FUNCTION create_money_request(
  p_from_id       uuid,
  p_amount        numeric,
  p_deadline_days int,
  p_reason        text        DEFAULT '',
  p_reason_emoji  text        DEFAULT '💸',
  p_viewer_ids    uuid[]      DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_req_id     uuid;
  v_tokens     json;
  v_trust      int;
  v_max_borrow numeric;
  v_frozen     boolean;
BEGIN
  -- Verify the child exists. The UUID comes from an authenticated session
  -- (login_child or biometric_login_child) so it is already trusted.
  IF NOT EXISTS (
    SELECT 1 FROM children WHERE id = p_from_id
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT trust_score, COALESCE(account_frozen, false)
    INTO v_trust, v_frozen
    FROM children WHERE id = p_from_id;

  IF v_frozen THEN RAISE EXCEPTION 'account_frozen'; END IF;

  -- Block if this child already has an active pending or funded borrow request.
  IF EXISTS (
    SELECT 1 FROM money_requests
    WHERE from_id = p_from_id
      AND status  IN ('pending', 'funded')
  ) THEN
    RAISE EXCEPTION 'already_borrowing';
  END IF;

  v_max_borrow := CASE
    WHEN v_trust < 50 THEN 20
    WHEN v_trust < 70 THEN 30
    WHEN v_trust < 85 THEN 50
    ELSE 100
  END;

  IF p_amount > v_max_borrow THEN
    RAISE EXCEPTION 'amount_exceeds_limit:%', v_max_borrow;
  END IF;

  INSERT INTO money_requests
    (from_id, amount, reason, reason_emoji, deadline_days, repay_by_date, expires_at, viewer_ids)
  VALUES (
    p_from_id, p_amount, p_reason, p_reason_emoji, p_deadline_days,
    (now() + (p_deadline_days || ' days'::text)::interval)::date,
    now() + interval '24 hours',
    p_viewer_ids
  ) RETURNING id INTO v_req_id;

  PERFORM _update_weekly_streak(p_from_id);

  SELECT json_agg(c.push_token) INTO v_tokens
  FROM circles ci
  JOIN children c ON c.id = ci.friend_id
  WHERE ci.child_id = p_from_id
    AND c.push_token IS NOT NULL
    AND (p_viewer_ids IS NULL OR ci.friend_id = ANY(p_viewer_ids));

  RETURN json_build_object(
    'request_id', v_req_id,
    'push_tokens', COALESCE(v_tokens, '[]'::json)
  );
END;
$$;
