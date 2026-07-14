-- Migration: Fix borrow eligibility
-- Problem 1: children.borrowed is a denormalized counter that can drift out of sync
--            with money_requests. When the counter is stale (> 0 but no active funded
--            request as borrower), the frontend blocks the user from creating a new
--            borrow request indefinitely — even after they have fully repaid.
-- Problem 2: create_money_request has no server-side guard preventing a user from
--            creating a second borrow request while one is already pending or funded.
--
-- Fix 1: Resync children.borrowed to match actual funded money_requests rows.
-- Fix 2: Add a duplicate-borrow guard to create_money_request.

-- ── Fix 1: Resync borrowed counter ───────────────────────────────────────────
-- Set borrowed = sum of active funded loans where this child is the borrower.
-- Children with no active funded loans as borrower get borrowed = 0.

UPDATE children
SET borrowed = COALESCE((
  SELECT SUM(mr.amount)
  FROM money_requests mr
  WHERE mr.from_id = children.id
    AND mr.status  = 'funded'
), 0);

-- ── Fix 2: Add duplicate-borrow guard to create_money_request ─────────────────
-- Must drop first: existing function has default parameter values, which
-- CREATE OR REPLACE cannot remove (Postgres error 42P13).
DROP FUNCTION IF EXISTS create_money_request(uuid, numeric, integer, text, text, uuid[]);

-- The existing RPC checks frozen status and amount limits but does not prevent
-- a child from creating a second request while one is already pending or funded.
-- Only the borrower role (from_id) is checked — lending does not block borrowing.

CREATE OR REPLACE FUNCTION create_money_request(
  p_from_id      uuid,
  p_amount       numeric,
  p_deadline_days integer,
  p_reason       text,
  p_reason_emoji text,
  p_viewer_ids   uuid[]
) RETURNS json
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

  -- Guard: block if this child already has an active pending or funded borrow request.
  -- Only checks from_id (borrower role); having funded_by = p_from_id (lender role)
  -- does not block this user from borrowing.
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
