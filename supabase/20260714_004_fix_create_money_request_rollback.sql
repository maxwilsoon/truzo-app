-- Rollback 004: Restore create_money_request to pre-004 state (migration 003 state)
-- Removes: parameter defaults, caller-authorization check.
-- NOTE: The DROP below uses the 6-param type signature; PostgreSQL matches by types
--       regardless of whether defaults are present, so this correctly drops the 004 version.

DROP FUNCTION IF EXISTS public.create_money_request(uuid, numeric, integer, text, text, uuid[]);

CREATE FUNCTION public.create_money_request(
  p_from_id       uuid,
  p_amount        numeric,
  p_deadline_days integer,
  p_reason        text,
  p_reason_emoji  text,
  p_viewer_ids    uuid[]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req_id     uuid;
  v_tokens     json;
  v_trust      int;
  v_max_borrow numeric;
  v_frozen     boolean;
BEGIN
  SELECT trust_score, COALESCE(account_frozen, false)
    INTO v_trust, v_frozen
    FROM children WHERE id = p_from_id;

  IF v_frozen THEN RAISE EXCEPTION 'account_frozen'; END IF;

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

NOTIFY pgrst, 'reload schema';
