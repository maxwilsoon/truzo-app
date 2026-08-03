-- Rollback 035: Undo server-side financial amount validation (M7)
--
-- Reverses:
--   - Drops require_valid_gbp_amount helper
--   - Restores top_up_safety_pool, update_safety_pool, parent_send_to_child
--     to pre-035 bodies (no auth guards, no amount validation)
--   - Restores grant exposure to PUBLIC on those three RPCs
--   - Restores create_money_request to migration 023 body (no amount validation)
--   - Restores fund_money_request to migration 028 body (old <= 0 guard only)
--   - Drops non-negative CHECK constraints on children

BEGIN;

-- ── Drop helper ───────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.require_valid_gbp_amount(numeric, text);

-- ── Restore grants to PUBLIC ──────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.top_up_safety_pool(uuid, numeric)           TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_safety_pool(uuid, numeric)           TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.parent_send_to_child(uuid, uuid, numeric, text) TO PUBLIC;

-- ── Restore top_up_safety_pool (migration 016 body — no auth guard) ───────────

CREATE OR REPLACE FUNCTION public.top_up_safety_pool(p_parent_id UUID, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_limit NUMERIC;
BEGIN
  UPDATE parents
    SET safety_pool_limit = COALESCE(safety_pool_limit, 0) + p_amount
  WHERE id = p_parent_id
  RETURNING safety_pool_limit INTO v_new_limit;
  RETURN v_new_limit;
END;
$$;

-- ── Restore update_safety_pool (migration 028 body — no auth guard) ───────────

CREATE OR REPLACE FUNCTION public.update_safety_pool(
  p_parent_id uuid,
  p_new_limit  numeric
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_used     numeric;
  v_reserved numeric;
  v_combined numeric;
BEGIN
  IF p_new_limit < 0 THEN
    RAISE EXCEPTION 'Safety pool limit cannot be negative';
  END IF;

  SELECT COALESCE(safety_pool_used, 0),
         COALESCE(safety_pool_reserved, 0)
    INTO v_used, v_reserved
    FROM parents WHERE id = p_parent_id
    FOR UPDATE;

  v_combined := v_used + v_reserved;

  IF p_new_limit < v_combined THEN
    RAISE EXCEPTION
      'Cannot reduce Safety Pool limit to % — current used (%) + reserved (%) = % exceeds the new limit',
      p_new_limit, v_used, v_reserved, v_combined;
  END IF;

  UPDATE parents
    SET safety_pool_limit        = p_new_limit,
        safety_pool_last_updated = now()
    WHERE id = p_parent_id;
END;
$$;

-- ── Restore parent_send_to_child (parent-transfer-migration body — no auth guard)

CREATE OR REPLACE FUNCTION public.parent_send_to_child(
  p_user_id    uuid,
  p_child_id   uuid,
  p_amount     numeric,
  p_parent_name text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tx_id      text := 'ps_' || floor(extract(epoch from now()))::bigint;
  v_amount_str text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM children WHERE id = p_child_id AND parent_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'not_parent';
  END IF;

  v_amount_str := CASE
    WHEN p_amount = floor(p_amount) THEN floor(p_amount)::integer::text
    ELSE round(p_amount, 2)::text
  END;

  UPDATE children
    SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_child_id;

  INSERT INTO transactions (child_id, type, amount, description, counterparty)
    VALUES (
      p_child_id,
      'parent_transfer',
      p_amount,
      p_parent_name || ' sent you £' || v_amount_str,
      p_parent_name
    );

  INSERT INTO activity_feed (child_id, id, emoji, text, type)
    VALUES (
      p_child_id,
      'act_' || v_tx_id,
      '💚',
      p_parent_name || ' sent you £' || v_amount_str,
      'topup'
    );
END; $$;

-- ── Restore create_money_request (migration 023 body — no amount validation) ──

CREATE OR REPLACE FUNCTION public.create_money_request(
  p_from_id       uuid,
  p_amount        numeric,
  p_deadline_days integer,
  p_session_token text,
  p_device_id     text,
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
  v_req_id     uuid;
  v_trust      int;
  v_max_borrow numeric;
  v_frozen     boolean;
  v_from_name  text;
  v_viewer_ids uuid[];
BEGIN
  PERFORM require_valid_child_session(p_from_id, p_session_token, p_device_id);

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

  RETURN json_build_object('request_id', v_req_id);
END;
$$;

-- ── Restore fund_money_request (migration 028 body — manual <= 0 guard only) ──

CREATE OR REPLACE FUNCTION public.fund_money_request(
  p_request_id    uuid,
  p_funder_id     uuid,
  p_amount        numeric,
  p_session_token text,
  p_device_id     text
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_borrower_id    uuid;
  v_request_amount numeric;
  v_parent_id      uuid;
  v_funder_user    text;
  v_funder_name    text;
  v_borrower_name  text;
  v_borrower_user  text;
  v_amt_str        text;
  v_frozen         boolean;
  v_pool_avail     numeric;
  v_funder_balance numeric;
BEGIN
  PERFORM require_valid_child_session(p_funder_id, p_session_token, p_device_id);

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: p_amount must be positive';
  END IF;

  SELECT from_id, amount INTO v_borrower_id, v_request_amount
    FROM money_requests
    WHERE id = p_request_id AND status = 'pending';
  IF v_borrower_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or already funded';
  END IF;

  IF p_amount <> v_request_amount THEN
    RAISE EXCEPTION 'Amount mismatch: request is for %, client sent %',
      v_request_amount, p_amount;
  END IF;

  SELECT COALESCE(account_frozen, false) INTO v_frozen
    FROM children WHERE id = v_borrower_id;
  IF v_frozen THEN RAISE EXCEPTION 'borrower_frozen'; END IF;

  SELECT p.id,
         (COALESCE(p.safety_pool_limit,    0)
          - COALESCE(p.safety_pool_used,   0)
          - COALESCE(p.safety_pool_reserved, 0))
    INTO v_parent_id, v_pool_avail
    FROM parents p
    JOIN children c ON c.parent_id = p.id
    WHERE c.id = v_borrower_id
    FOR UPDATE;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'Parent not found for borrower';
  END IF;

  IF COALESCE(v_pool_avail, 0) < p_amount THEN
    RAISE EXCEPTION 'safety_pool_insufficient';
  END IF;

  SELECT wallet_balance INTO v_funder_balance
    FROM children WHERE id = p_funder_id FOR UPDATE;
  IF COALESCE(v_funder_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance to fund this request';
  END IF;

  UPDATE money_requests
    SET status                      = 'funded',
        funded_by                   = p_funder_id,
        funded_at                   = now(),
        safety_pool_reserved_amount = p_amount
    WHERE id = p_request_id AND status = 'pending'
    RETURNING from_id INTO v_borrower_id;

  IF v_borrower_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or already funded';
  END IF;

  UPDATE parents
    SET safety_pool_reserved = COALESCE(safety_pool_reserved, 0) + p_amount
    WHERE id = v_parent_id;

  SELECT username,     display_name INTO v_funder_user,   v_funder_name   FROM children WHERE id = p_funder_id;
  SELECT display_name, username     INTO v_borrower_name, v_borrower_user FROM children WHERE id = v_borrower_id;

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

  RETURN json_build_object('borrower_id', v_borrower_id);
END;
$$;

-- ── Drop CHECK constraints on children ───────────────────────────────────────

ALTER TABLE children
  DROP CONSTRAINT IF EXISTS chk_children_wallet_nonneg,
  DROP CONSTRAINT IF EXISTS chk_children_borrowed_nonneg,
  DROP CONSTRAINT IF EXISTS chk_children_loaned_nonneg,
  DROP CONSTRAINT IF EXISTS chk_children_debt_nonneg;

NOTIFY pgrst, 'reload schema';

COMMIT;
