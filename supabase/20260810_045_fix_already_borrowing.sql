-- M045: Fix "already_borrowing" false positive for stale money_requests
--
-- Root cause identified (2026-08-10):
--   create_money_request checks `status IN ('pending', 'funded')` without confirming
--   that the pending row is still within its 24-hour acceptance window, or that the
--   funded row was actually funded via fund_money_request.
--
-- Blocking rows:
--   1. Daisy Corcut (ac504406): id=13085e21, status=pending
--      created_at=2026-08-09T10:20:15, expires_at=2026-08-10T10:20:15 ← EXPIRED
--      Created during M044 notification testing; client never called cancel_money_request.
--      get_active_requests already excludes it (expires_at > now() guard), but
--      create_money_request did not.
--
--   2. Maya Wilson (3de8d467): id=415c602b, status=funded
--      created_at=2026-08-03T10:31:16, expires_at=2026-08-04T10:31:16 ← EXPIRED
--      funded_at=NULL, funded_by=NULL, safety_pool_reserved_amount=NULL.
--      fund_money_request always sets all three atomically — their absence proves this
--      row was never funded via the function. This is a corrupted test artifact.
--
-- Active borrowing definition (corrected):
--   - status='pending' AND expires_at > now()   → request still open, accepting funders
--   - status='funded'  AND funded_at IS NOT NULL → real active loan, awaiting repayment
--
-- This matches the filter already applied by get_active_requests.
--
-- Rollback: 20260810_045_rollback.sql

-- ── 1. Cancel stale pending rows (past expires_at, never funded) ──────────────
UPDATE public.money_requests
  SET status = 'cancelled'
  WHERE status = 'pending' AND expires_at < now();

-- ── 2. Cancel corrupted funded rows (funded_at IS NULL = never actually funded) ─
UPDATE public.money_requests
  SET status = 'cancelled'
  WHERE status = 'funded' AND funded_at IS NULL;

-- ── 3. Fix create_money_request — narrow the already_borrowing check ──────────
CREATE OR REPLACE FUNCTION public.create_money_request(
  p_from_id       uuid,
  p_amount        numeric,
  p_deadline_days integer,
  p_session_token text,
  p_device_id     text,
  p_reason        text    DEFAULT '',
  p_reason_emoji  text    DEFAULT '💸',
  p_viewer_ids    uuid[]  DEFAULT NULL
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_req_id     uuid;
  v_trust      int;
  v_max_borrow numeric;
  v_frozen     boolean;
  v_from_name  text;
  v_viewer_ids uuid[];
BEGIN
  PERFORM public.require_valid_gbp_amount(p_amount, 'request amount');
  PERFORM require_valid_child_session(p_from_id, p_session_token, p_device_id);

  SELECT trust_score, COALESCE(account_frozen, false)
    INTO v_trust, v_frozen
    FROM children WHERE id = p_from_id;

  IF v_frozen THEN RAISE EXCEPTION 'account_frozen'; END IF;

  -- Active borrowing: pending within the 24-hour acceptance window,
  -- OR genuinely funded (fund_money_request always sets funded_at).
  -- Expired pending rows and corrupted funded rows (funded_at IS NULL) do not block.
  IF EXISTS (
    SELECT 1 FROM money_requests
    WHERE from_id = p_from_id
      AND (
        (status = 'pending' AND expires_at > now())
        OR
        (status = 'funded'  AND funded_at  IS NOT NULL)
      )
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

  SELECT array_agg(ci.friend_id) INTO v_viewer_ids
    FROM circles ci
    WHERE ci.child_id = p_from_id
      AND ci.status   = 'active'
      AND (p_viewer_ids IS NULL OR ci.friend_id = ANY(p_viewer_ids));

  SELECT display_name INTO v_from_name FROM children WHERE id = p_from_id;

  PERFORM _trigger_notification_multi(
    'money_request', v_viewer_ids, 'child', p_from_id, v_from_name,
    jsonb_build_object('amount', p_amount, 'request_id', v_req_id)
  );

  RETURN json_build_object('request_id', v_req_id);
END;
$$;
