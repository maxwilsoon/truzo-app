-- Migration 035: Server-side financial amount validation (M7)
--
-- Closes: five financial RPCs accept any numeric amount from the client —
-- including null, negative, zero, sub-minimum, and more than 2 decimal places.
-- Three parent-facing RPCs have no explicit GRANT/REVOKE (callable by everyone).
-- Three parent-facing RPCs have no auth.uid() identity check.
--
-- Changes:
--   1. require_valid_gbp_amount(p_amount, p_label) — private validation helper.
--        Validates: not null, positive, >= £0.50, max 2 dp. No business cap.
--        Revoked from PUBLIC / anon / authenticated — only callable from within
--        other SECURITY DEFINER functions running as postgres (the owner).
--   2. Grant hardening — top_up_safety_pool, update_safety_pool,
--        parent_send_to_child: restrict to authenticated; revoke from PUBLIC/anon.
--   3. Auth guards — auth.uid() = p_parent_id / p_user_id added to
--        top_up_safety_pool, update_safety_pool, parent_send_to_child.
--   4. Amount validation added to:
--        top_up_safety_pool     (via helper)
--        parent_send_to_child   (via helper)
--        create_money_request   (via helper, fires before session check)
--        fund_money_request     (via helper, fires before session check)
--   5. update_safety_pool — inline checks: null, < 0, precision. Zero allowed
--        iff used + reserved == 0 (limit is configuration, not a transaction).
--        No business cap — the existing p_new_limit < v_combined guard is sufficient.
--   6. CHECK constraints on children — wallet_balance, borrowed, loaned_out,
--        parent_debt: all must be >= 0. Precondition block fails migration if
--        any existing row violates, rather than silently failing the constraint add.
--
-- Rollback: 20260803_035_rollback.sql

BEGIN;

-- ── 1. require_valid_gbp_amount ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.require_valid_gbp_amount(
  p_amount numeric,
  p_label  text DEFAULT 'amount'
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'invalid_amount: % must not be null', p_label;
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: % must be positive', p_label;
  END IF;
  IF p_amount < 0.50 THEN
    RAISE EXCEPTION 'amount_below_minimum: % must be at least £0.50', p_label;
  END IF;
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'amount_precision_invalid: % must have at most 2 decimal places', p_label;
  END IF;
END;
$$;

REVOKE ALL     ON FUNCTION public.require_valid_gbp_amount(numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.require_valid_gbp_amount(numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.require_valid_gbp_amount(numeric, text) FROM authenticated;

-- ── 2. Grant hardening ────────────────────────────────────────────────────────

REVOKE ALL     ON FUNCTION public.top_up_safety_pool(uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.top_up_safety_pool(uuid, numeric) FROM anon;
GRANT  EXECUTE ON FUNCTION public.top_up_safety_pool(uuid, numeric) TO authenticated;

REVOKE ALL     ON FUNCTION public.update_safety_pool(uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_safety_pool(uuid, numeric) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_safety_pool(uuid, numeric) TO authenticated;

REVOKE ALL     ON FUNCTION public.parent_send_to_child(uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.parent_send_to_child(uuid, uuid, numeric, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.parent_send_to_child(uuid, uuid, numeric, text) TO authenticated;

-- ── 3. top_up_safety_pool ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.top_up_safety_pool(p_parent_id uuid, p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_limit numeric;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_parent_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  PERFORM public.require_valid_gbp_amount(p_amount, 'top-up amount');
  UPDATE parents
    SET safety_pool_limit = COALESCE(safety_pool_limit, 0) + p_amount
  WHERE id = p_parent_id
  RETURNING safety_pool_limit INTO v_new_limit;
  RETURN v_new_limit;
END;
$$;

-- ── 4. update_safety_pool ─────────────────────────────────────────────────────
-- Inline checks (not via helper) because this sets a limit, not a transaction
-- amount: zero is valid iff used + reserved == 0 (the p_new_limit < v_combined
-- guard enforces this automatically). No business cap on the limit value.

CREATE OR REPLACE FUNCTION public.update_safety_pool(
  p_parent_id uuid,
  p_new_limit  numeric
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_used     numeric;
  v_reserved numeric;
  v_combined numeric;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_parent_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_new_limit IS NULL THEN
    RAISE EXCEPTION 'invalid_amount: limit must not be null';
  END IF;
  IF p_new_limit < 0 THEN
    RAISE EXCEPTION 'invalid_amount: limit cannot be negative';
  END IF;
  IF p_new_limit <> round(p_new_limit, 2) THEN
    RAISE EXCEPTION 'amount_precision_invalid: limit must have at most 2 decimal places';
  END IF;

  SELECT COALESCE(safety_pool_used, 0), COALESCE(safety_pool_reserved, 0)
    INTO v_used, v_reserved
    FROM parents WHERE id = p_parent_id
    FOR UPDATE;

  v_combined := v_used + v_reserved;

  IF p_new_limit < v_combined THEN
    RAISE EXCEPTION
      'Cannot reduce Safety Pool limit to % — used (%) + reserved (%) = % exceeds new limit',
      p_new_limit, v_used, v_reserved, v_combined;
  END IF;

  UPDATE parents
    SET safety_pool_limit        = p_new_limit,
        safety_pool_last_updated = now()
    WHERE id = p_parent_id;
END;
$$;

-- ── 5. parent_send_to_child ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.parent_send_to_child(
  p_user_id     uuid,
  p_child_id    uuid,
  p_amount      numeric,
  p_parent_name text
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tx_id      text := 'ps_' || floor(extract(epoch from now()))::bigint;
  v_amount_str text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  PERFORM public.require_valid_gbp_amount(p_amount, 'transfer amount');

  IF NOT EXISTS (
    SELECT 1 FROM children WHERE id = p_child_id AND parent_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'not_parent';
  END IF;

  v_amount_str := CASE
    WHEN p_amount = floor(p_amount) THEN floor(p_amount)::integer::text
    ELSE round(p_amount, 2)::text
  END;

  UPDATE children SET wallet_balance = wallet_balance + p_amount WHERE id = p_child_id;

  INSERT INTO transactions (child_id, type, amount, description, counterparty)
    VALUES (p_child_id, 'parent_transfer', p_amount,
            p_parent_name || ' sent you £' || v_amount_str, p_parent_name);

  INSERT INTO activity_feed (child_id, id, emoji, text, type)
    VALUES (p_child_id, 'act_' || v_tx_id, '💚',
            p_parent_name || ' sent you £' || v_amount_str, 'topup');
END;
$$;

-- ── 6. create_money_request ───────────────────────────────────────────────────
-- Adds require_valid_gbp_amount as the very first operation — before session
-- check and any DB access — so malformed amounts are rejected immediately.
-- All other logic is unchanged from migration 023.

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
  -- Amount validation first — before session check or any DB read
  PERFORM public.require_valid_gbp_amount(p_amount, 'request amount');

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
-- Grant unchanged from migration 023: anon

-- ── 7. fund_money_request ─────────────────────────────────────────────────────
-- Adds require_valid_gbp_amount as the very first operation (before session
-- check and DB reads). Removes the old manual `p_amount <= 0` guard (superseded
-- by the helper). All other logic unchanged from migration 028.

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
  -- Amount validation first — before session check or any DB read
  PERFORM public.require_valid_gbp_amount(p_amount, 'funding amount');

  PERFORM require_valid_child_session(p_funder_id, p_session_token, p_device_id);

  -- Read the pending request (no lock — just confirming it exists and is pending)
  SELECT from_id, amount INTO v_borrower_id, v_request_amount
    FROM money_requests
    WHERE id = p_request_id AND status = 'pending';
  IF v_borrower_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or already funded';
  END IF;

  -- Validate the client-supplied amount matches the stored request amount
  IF p_amount <> v_request_amount THEN
    RAISE EXCEPTION 'Amount mismatch: request is for %, client sent %',
      v_request_amount, p_amount;
  END IF;

  SELECT COALESCE(account_frozen, false) INTO v_frozen
    FROM children WHERE id = v_borrower_id;
  IF v_frozen THEN RAISE EXCEPTION 'borrower_frozen'; END IF;

  -- Lock the borrower's parent FOR UPDATE FIRST (consistent lock ordering).
  -- This makes the availability check + reservation increment atomic.
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

  -- Lock funder child AFTER parent (consistent ordering: parent before child)
  SELECT wallet_balance INTO v_funder_balance
    FROM children WHERE id = p_funder_id FOR UPDATE;
  IF COALESCE(v_funder_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance to fund this request';
  END IF;

  -- Fund the request and record the reservation amount atomically
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

  -- Reserve coverage in the parent (parent row still locked from above)
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
-- Grant unchanged from migration 028: anon

-- ── 8. CHECK constraints on children ─────────────────────────────────────────

DO $$
DECLARE v_violations int;
BEGIN
  SELECT count(*) INTO v_violations
    FROM children
    WHERE wallet_balance < 0 OR borrowed < 0 OR loaned_out < 0 OR parent_debt < 0;
  IF v_violations > 0 THEN
    RAISE EXCEPTION
      'M7 precondition failed: % children row(s) have negative monetary values — fix data before applying constraint',
      v_violations;
  END IF;
END;
$$;

ALTER TABLE children
  ADD CONSTRAINT chk_children_wallet_nonneg   CHECK (wallet_balance >= 0),
  ADD CONSTRAINT chk_children_borrowed_nonneg CHECK (borrowed       >= 0),
  ADD CONSTRAINT chk_children_loaned_nonneg   CHECK (loaned_out     >= 0),
  ADD CONSTRAINT chk_children_debt_nonneg     CHECK (parent_debt    >= 0);

NOTIFY pgrst, 'reload schema';

COMMIT;
