-- M053: Prevent self-funding + clean up any existing self-funded requests
--
-- Bug: fund_money_request has no guard against p_funder_id = from_id.
-- If a child funds their own request (possible via direct API call or a session
-- mix-up), the DB ends up with from_id = funded_by = same child UUID.
-- This creates a circular repayment loop shown in the UI as "User X owes User X".
-- The actor-filter in _trigger_notification also silently drops notifications
-- for these requests (p_recipient_id = p_sender_id → RETURN early).
--
-- Fix:
--   1. Cancel any self-funded requests currently in the DB.
--   2. Add IF p_funder_id = v_borrower_id check to fund_money_request.

-- ── 1. Clean up self-funded requests ─────────────────────────────────────────
-- Cancel any money_request where from_id = funded_by (child funded themselves).
-- Refund the wallet balances and reverse the safety pool reservation.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT mr.id, mr.from_id AS child_id, mr.amount,
           COALESCE(mr.safety_pool_reserved_amount, 0) AS reserved
    FROM   money_requests mr
    WHERE  mr.status    = 'funded'
      AND  mr.from_id   = mr.funded_by
  LOOP
    -- Reverse the wallet changes (child was both lender and borrower, so net = 0,
    -- but the individual columns are wrong).
    UPDATE children SET
      wallet_balance = wallet_balance + r.amount + r.amount,  -- refund both lend and borrow deductions
      loaned_out     = GREATEST(0, loaned_out  - r.amount),
      borrowed       = GREATEST(0, borrowed    - r.amount),
      total_lent     = GREATEST(0, total_lent  - r.amount),
      total_borrowed = GREATEST(0, total_borrowed - r.amount),
      times_lent     = GREATEST(0, times_lent  - 1),
      times_borrowed = GREATEST(0, times_borrowed - 1)
    WHERE id = r.child_id;

    -- Release safety pool reservation.
    UPDATE parents SET
      safety_pool_reserved = GREATEST(0, COALESCE(safety_pool_reserved, 0) - r.reserved)
    WHERE id = (SELECT parent_id FROM children WHERE id = r.child_id);

    -- Cancel the request.
    UPDATE money_requests SET status = 'cancelled' WHERE id = r.id;

    RAISE NOTICE 'M053: cancelled self-funded request % for child %', r.id, r.child_id;
  END LOOP;
END;
$$;

-- ── 2. Add self-funding guard to fund_money_request ──────────────────────────
CREATE OR REPLACE FUNCTION public.fund_money_request(
  p_request_id  uuid,
  p_funder_id   uuid,
  p_amount      numeric,
  p_session_token text,
  p_device_id   text
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
  -- Amount validation first — before session check or any DB read.
  PERFORM public.require_valid_gbp_amount(p_amount, 'funding amount');

  PERFORM require_valid_child_session(p_funder_id, p_session_token, p_device_id);

  -- Read the pending request (no lock — just confirming it exists and is pending).
  SELECT from_id, amount INTO v_borrower_id, v_request_amount
    FROM money_requests
    WHERE id = p_request_id AND status = 'pending';
  IF v_borrower_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or already funded';
  END IF;

  -- Self-funding guard: a child cannot fund their own request.
  IF p_funder_id = v_borrower_id THEN
    RAISE EXCEPTION 'cannot_fund_own_request';
  END IF;

  -- Validate the client-supplied amount matches the stored request amount.
  IF p_amount <> v_request_amount THEN
    RAISE EXCEPTION 'Amount mismatch: request is for %, client sent %',
      v_request_amount, p_amount;
  END IF;

  SELECT COALESCE(account_frozen, false) INTO v_frozen
    FROM children WHERE id = v_borrower_id;
  IF v_frozen THEN RAISE EXCEPTION 'borrower_frozen'; END IF;

  -- Lock the borrower's parent FIRST (consistent lock ordering).
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

  -- Lock funder child AFTER parent (consistent ordering: parent before child).
  SELECT wallet_balance INTO v_funder_balance
    FROM children WHERE id = p_funder_id FOR UPDATE;
  IF COALESCE(v_funder_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance to fund this request';
  END IF;

  -- Fund the request and record the reservation amount atomically.
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

  -- Reserve coverage in the parent.
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

NOTIFY pgrst, 'reload schema';
