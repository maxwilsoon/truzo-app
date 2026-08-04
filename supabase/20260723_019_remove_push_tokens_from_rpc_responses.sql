-- Migration 019: Fix H8 — remove Expo push tokens from all RPC return values
--
-- Vulnerability confirmed (migration 014):
--   Six RPCs return raw Expo push tokens to calling clients:
--     send_circle_request    → 'push_token'
--     accept_circle_request  → 'from_push_token'
--     decline_circle_request → 'from_push_token'
--     create_money_request   → 'push_tokens' (array of all circle members' tokens)
--     fund_money_request     → 'borrower_push_token'
--     repay_money_request    → 'funder_push_token'
--
--   Expo push tokens are stable device identifiers. Exposing them allows:
--     • An attacker intercepting traffic to harvest circle members' tokens
--     • Spoofed push notifications sent directly via Expo's public API
--       (no auth required: https://exp.host/--/api/v2/push/send)
--
--   The tokens were returned to support client-side push (pre-migration 014).
--   Migration 014 switched to server-side delivery via _trigger_notification().
--   Client code already ignores these return fields in all call sites.
--   Confirmed via grep: no screen reads push_token, from_push_token, push_tokens,
--   borrower_push_token, or funder_push_token for any purpose.
--
--   Exception: repay_money_request returns 'amount' which CircleScreen.tsx DOES
--   use (const { amount: paidAmount } = ...). That field is preserved.
--
-- Fix: remove the push_token SELECT queries that exist only to populate return
--   values, and remove the token fields from every RETURN json_build_object.
--   All notification delivery continues via _trigger_notification (server-side).

-- ── 1. send_circle_request ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.send_circle_request(p_from_id uuid, p_to_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_from_name text;
BEGIN
  IF p_from_id = p_to_id THEN
    RAISE EXCEPTION 'cannot_add_self';
  END IF;

  IF EXISTS (
    SELECT 1 FROM circles
    WHERE status = 'active'
      AND ((child_id = p_from_id AND friend_id = p_to_id)
        OR (child_id = p_to_id   AND friend_id = p_from_id))
  ) THEN
    RAISE EXCEPTION 'already_friends';
  END IF;

  IF EXISTS (
    SELECT 1 FROM circle_requests
    WHERE status = 'pending'
      AND ((from_id = p_from_id AND to_id = p_to_id)
        OR (from_id = p_to_id   AND to_id = p_from_id))
  ) THEN
    RAISE EXCEPTION 'already_pending';
  END IF;

  DELETE FROM circle_requests WHERE from_id = p_from_id AND to_id = p_to_id;

  INSERT INTO circle_requests(from_id, to_id, status, created_at)
  VALUES (p_from_id, p_to_id, 'pending', now());

  SELECT display_name INTO v_from_name FROM children WHERE id = p_from_id;

  PERFORM _trigger_notification(
    'friend_request', p_to_id, 'child', p_from_id, v_from_name, '{}'::jsonb
  );

  -- push_token field removed: no longer returned. Client receives empty object.
  RETURN '{}'::json;
END;
$$;

-- ── 2. accept_circle_request ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_circle_request(p_request_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_from_id uuid;
  v_to_id   uuid;
  v_to_name text;
BEGIN
  UPDATE circle_requests
  SET status = 'accepted'
  WHERE id = p_request_id
  RETURNING from_id, to_id INTO v_from_id, v_to_id;

  IF v_from_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  INSERT INTO circles(child_id, friend_id, status)
  VALUES (v_from_id, v_to_id, 'active')
  ON CONFLICT (child_id, friend_id) DO UPDATE
    SET status = 'active', removed_at = NULL, removed_by = NULL;

  INSERT INTO circles(child_id, friend_id, status)
  VALUES (v_to_id, v_from_id, 'active')
  ON CONFLICT (child_id, friend_id) DO UPDATE
    SET status = 'active', removed_at = NULL, removed_by = NULL;

  SELECT display_name INTO v_to_name FROM children WHERE id = v_to_id;

  PERFORM _trigger_notification(
    'friend_accepted', v_from_id, 'child', v_to_id, v_to_name, '{}'::jsonb
  );

  -- from_push_token removed. from_id and to_id kept for caller convenience.
  RETURN json_build_object('from_id', v_from_id, 'to_id', v_to_id);
END;
$$;

-- ── 3. decline_circle_request ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.decline_circle_request(p_request_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_from_id uuid;
  v_to_id   uuid;
  v_to_name text;
BEGIN
  UPDATE circle_requests SET status = 'declined'
  WHERE id = p_request_id
  RETURNING from_id, to_id INTO v_from_id, v_to_id;

  SELECT display_name INTO v_to_name FROM children WHERE id = v_to_id;

  PERFORM _trigger_notification(
    'friend_declined', v_from_id, 'child', v_to_id, v_to_name, '{}'::jsonb
  );

  -- from_push_token removed.
  RETURN '{}'::json;
END;
$$;

-- ── 4. create_money_request ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_money_request(
  p_from_id       uuid,
  p_amount        numeric,
  p_deadline_days integer,
  p_reason        text    DEFAULT '',
  p_reason_emoji  text    DEFAULT '💸',
  p_viewer_ids    uuid[]  DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_req_id      uuid;
  v_trust       int;
  v_max_borrow  numeric;
  v_frozen      boolean;
  v_from_name   text;
  v_viewer_ids  uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM children WHERE id = p_from_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT trust_score, COALESCE(account_frozen, false)
    INTO v_trust, v_frozen
    FROM children WHERE id = p_from_id;

  IF v_frozen THEN RAISE EXCEPTION 'account_frozen'; END IF;

  IF EXISTS (
    SELECT 1 FROM money_requests
    WHERE from_id = p_from_id AND status IN ('pending', 'funded')
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

  -- push_tokens array removed. Only request_id is needed by the client.
  RETURN json_build_object('request_id', v_req_id);
END;
$$;

-- ── 5. fund_money_request ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fund_money_request(
  p_request_id uuid,
  p_funder_id  uuid,
  p_amount     numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_borrower_id    uuid;
  v_funder_user    text;
  v_funder_name    text;
  v_borrower_name  text;
  v_borrower_user  text;
  v_amt_str        text;
  v_frozen         boolean;
  v_pool_avail     numeric;
  v_funder_balance numeric;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: p_amount must be positive';
  END IF;

  SELECT from_id INTO v_borrower_id
  FROM money_requests
  WHERE id = p_request_id AND status = 'pending';
  IF v_borrower_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or already funded';
  END IF;

  SELECT COALESCE(account_frozen, false) INTO v_frozen
  FROM children WHERE id = v_borrower_id;
  IF v_frozen THEN RAISE EXCEPTION 'borrower_frozen'; END IF;

  SELECT (p.safety_pool_limit - COALESCE(p.safety_pool_used, 0))
  INTO v_pool_avail
  FROM parents p JOIN children c ON c.parent_id = p.id
  WHERE c.id = v_borrower_id;
  IF COALESCE(v_pool_avail, 0) < p_amount THEN
    RAISE EXCEPTION 'safety_pool_insufficient';
  END IF;

  SELECT wallet_balance INTO v_funder_balance
  FROM children WHERE id = p_funder_id FOR UPDATE;
  IF COALESCE(v_funder_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance to fund this request';
  END IF;

  UPDATE money_requests
  SET status    = 'funded',
      funded_by = p_funder_id,
      funded_at = now()
  WHERE id = p_request_id AND status = 'pending'
  RETURNING from_id INTO v_borrower_id;

  IF v_borrower_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or already funded';
  END IF;

  SELECT username,    display_name INTO v_funder_user,   v_funder_name   FROM children WHERE id = p_funder_id;
  SELECT display_name, username    INTO v_borrower_name, v_borrower_user FROM children WHERE id = v_borrower_id;

  v_amt_str := '£' || to_char(p_amount, 'FM999990.00');

  UPDATE children SET
    wallet_balance = wallet_balance - p_amount,
    loaned_out     = loaned_out     + p_amount,
    total_lent     = total_lent     + p_amount,
    times_lent     = times_lent     + 1,
    trust_score    = LEAST(100, trust_score + 2),
    points         = points         + 2
  WHERE id = p_funder_id;

  PERFORM _update_weekly_streak(p_funder_id);

  UPDATE children SET
    wallet_balance = wallet_balance + p_amount,
    borrowed       = borrowed       + p_amount,
    total_borrowed = total_borrowed + p_amount,
    times_borrowed = times_borrowed + 1
  WHERE id = v_borrower_id;

  INSERT INTO transactions (child_id, type, amount, description, counterparty) VALUES
    (p_funder_id,   'lend',   -p_amount,
     v_amt_str || ' lent to @'       || v_borrower_user, v_borrower_name),
    (v_borrower_id, 'borrow',  p_amount,
     v_amt_str || ' borrowed from @' || v_funder_user,   NULL);

  PERFORM _trigger_notification(
    'money_funded', v_borrower_id, 'child', p_funder_id, v_funder_name,
    jsonb_build_object('amount', p_amount, 'request_id', p_request_id)
  );

  -- borrower_push_token removed. borrower_id kept for caller reference.
  RETURN json_build_object('borrower_id', v_borrower_id);
END;
$$;

-- ── 6. repay_money_request ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.repay_money_request(
  p_request_id  uuid,
  p_borrower_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_funder_id        uuid;
  v_amount           numeric;
  v_borrower_user    text;
  v_borrower_name    text;
  v_funder_name      text;
  v_funder_user      text;
  v_amt_str          text;
  v_act_id           text;
  v_borrower_balance numeric;
BEGIN
  SELECT wallet_balance INTO v_borrower_balance
  FROM children WHERE id = p_borrower_id FOR UPDATE;

  SELECT funded_by, amount INTO v_funder_id, v_amount
  FROM money_requests
  WHERE id = p_request_id
    AND from_id  = p_borrower_id
    AND status   = 'funded'
  FOR UPDATE;

  IF v_funder_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or not in funded state';
  END IF;

  IF COALESCE(v_borrower_balance, 0) < v_amount THEN
    RAISE EXCEPTION 'Insufficient balance to repay this loan';
  END IF;

  SELECT username,    display_name INTO v_borrower_user, v_borrower_name FROM children WHERE id = p_borrower_id;
  SELECT display_name, username    INTO v_funder_name,   v_funder_user   FROM children WHERE id = v_funder_id;

  v_amt_str := '£' || to_char(v_amount, 'FM999990.00');
  v_act_id  := 'recv_' || p_request_id::text;

  UPDATE money_requests SET status = 'repaid', repaid_at = now() WHERE id = p_request_id;

  UPDATE children SET
    wallet_balance = wallet_balance - v_amount,
    borrowed       = GREATEST(0, borrowed - v_amount),
    repaid         = repaid         + 1,
    trust_score    = LEAST(100, trust_score + 5),
    points         = points         + 5
  WHERE id = p_borrower_id;

  PERFORM _update_weekly_streak(p_borrower_id);

  UPDATE children SET
    wallet_balance = wallet_balance + v_amount,
    loaned_out     = GREATEST(0, loaned_out - v_amount)
  WHERE id = v_funder_id;

  INSERT INTO transactions (child_id, type, amount, description, counterparty) VALUES
    (p_borrower_id, 'repay',   -v_amount,
     'Repaid '   || v_amt_str || ' to @'   || v_funder_user,   v_funder_name),
    (v_funder_id,   'receive',  v_amount,
     'Received ' || v_amt_str || ' from @' || v_borrower_user, NULL);

  INSERT INTO activity_feed (child_id, id, emoji, text, type)
  VALUES (v_funder_id, v_act_id, '✅',
          '@' || v_borrower_user || ' repaid you ' || v_amt_str, 'repaid')
  ON CONFLICT (id) DO NOTHING;

  PERFORM _trigger_notification(
    'money_repaid', v_funder_id, 'child', p_borrower_id, v_borrower_name,
    jsonb_build_object('amount', v_amount, 'request_id', p_request_id)
  );

  -- funder_push_token removed. funder_id and amount kept — CircleScreen uses amount.
  RETURN json_build_object('funder_id', v_funder_id, 'amount', v_amount);
END;
$$;

NOTIFY pgrst, 'reload schema';
