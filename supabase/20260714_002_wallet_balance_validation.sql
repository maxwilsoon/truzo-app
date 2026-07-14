-- ============================================================
-- Migration:  20260714_002_wallet_balance_validation.sql
-- Purpose:    Enforce wallet balance checks inside financial RPCs.
--
-- Problems fixed:
--   1. fund_money_request   — no check that funder wallet_balance >= p_amount.
--                             Funder could have £0 and still transfer money,
--                             driving wallet_balance negative.
--                             Also: concurrent-caller race could execute past a
--                             NULL v_borrower_id without raising.
--
--   2. repay_money_request  — no check that borrower wallet_balance >= loan amount.
--                             Borrower could repay with £0, driving balance negative.
--                             Rewrites to lock the borrower row BEFORE touching
--                             money_requests so the balance check happens atomically.
--
--   3. confirm_parent_repayment — used GREATEST(0, wallet_balance - v_debt) which
--                             silently caps at 0 and zeroes the debt regardless of
--                             whether the child could actually pay it.
--
-- Guarantees after this migration:
--   • wallet_balance can never go below 0 via these RPCs.
--   • Insufficient balance raises a descriptive exception before any row is mutated.
--   • Trust score, points, activity feed, and transactions are untouched on failure.
--   • Every financial update is inside a single transaction (each RPC is one txn).
--
-- Rollback: see 20260714_002_wallet_balance_validation_rollback.sql
-- ============================================================

BEGIN;

-- ================================================================
-- 1. fund_money_request
-- ================================================================
-- New:
--   • Guards p_amount > 0.
--   • SELECT wallet_balance … FOR UPDATE on funder before any writes;
--     raises 'Insufficient balance to fund this request' if short.
--   • Adds explicit NULL guard after UPDATE money_requests RETURNING …
--     to surface the concurrent-race case cleanly.
-- ================================================================

CREATE OR REPLACE FUNCTION public.fund_money_request(
  p_request_id uuid,
  p_funder_id  uuid,
  p_amount     numeric
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_borrower_id    uuid;
  v_borrower_token text;
  v_funder_user    text;
  v_borrower_name  text;
  v_borrower_user  text;
  v_amt_str        text;
  v_frozen         boolean;
  v_pool_avail     numeric;
  v_funder_balance numeric;
BEGIN
  -- Amount sanity check
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: p_amount must be positive';
  END IF;

  -- Resolve borrower from a pending request
  SELECT from_id INTO v_borrower_id
  FROM money_requests
  WHERE id = p_request_id AND status = 'pending';
  IF v_borrower_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or already funded';
  END IF;

  -- Borrower must not be frozen
  SELECT COALESCE(account_frozen, false) INTO v_frozen
  FROM children WHERE id = v_borrower_id;
  IF v_frozen THEN
    RAISE EXCEPTION 'borrower_frozen';
  END IF;

  -- Borrower's parent safety pool must cover the full loan amount
  SELECT (p.safety_pool_limit - COALESCE(p.safety_pool_used, 0))
  INTO v_pool_avail
  FROM parents p
  JOIN children c ON c.parent_id = p.id
  WHERE c.id = v_borrower_id;
  IF COALESCE(v_pool_avail, 0) < p_amount THEN
    RAISE EXCEPTION 'safety_pool_insufficient';
  END IF;

  -- Lock funder row and verify they have sufficient wallet balance.
  -- FOR UPDATE held until commit prevents a concurrent call from spending
  -- the same funds between our check and our UPDATE.
  SELECT wallet_balance INTO v_funder_balance
  FROM children WHERE id = p_funder_id FOR UPDATE;

  IF COALESCE(v_funder_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance to fund this request';
  END IF;

  -- Atomically claim the request.
  -- If a concurrent caller won the race, this UPDATE matches 0 rows and
  -- RETURNING sets v_borrower_id to NULL — caught immediately below.
  UPDATE money_requests
  SET status    = 'funded',
      funded_by = p_funder_id,
      funded_at = now()
  WHERE id = p_request_id AND status = 'pending'
  RETURNING from_id INTO v_borrower_id;

  IF v_borrower_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or already funded';
  END IF;

  -- Resolve display names for transaction records
  SELECT username INTO v_funder_user
  FROM children WHERE id = p_funder_id;

  SELECT display_name, username INTO v_borrower_name, v_borrower_user
  FROM children WHERE id = v_borrower_id;

  v_amt_str := '£' || to_char(p_amount, 'FM999990.00');

  -- Deduct from funder (row already locked by FOR UPDATE above)
  UPDATE children SET
    wallet_balance = wallet_balance - p_amount,
    loaned_out     = loaned_out     + p_amount,
    total_lent     = total_lent     + p_amount,
    times_lent     = times_lent     + 1,
    trust_score    = LEAST(100, trust_score + 2),
    points         = points         + 2
  WHERE id = p_funder_id;

  PERFORM _update_weekly_streak(p_funder_id);

  -- Credit borrower
  UPDATE children SET
    wallet_balance = wallet_balance + p_amount,
    borrowed       = borrowed       + p_amount,
    total_borrowed = total_borrowed + p_amount,
    times_borrowed = times_borrowed + 1
  WHERE id = v_borrower_id;

  -- Record transactions for both sides
  INSERT INTO transactions (child_id, type, amount, description, counterparty) VALUES
    (p_funder_id,   'lend',   -p_amount,
     v_amt_str || ' lent to @'       || v_borrower_user, v_borrower_name),
    (v_borrower_id, 'borrow',  p_amount,
     v_amt_str || ' borrowed from @' || v_funder_user,   NULL);

  SELECT push_token INTO v_borrower_token FROM children WHERE id = v_borrower_id;

  RETURN json_build_object(
    'borrower_id',         v_borrower_id,
    'borrower_push_token', v_borrower_token
  );
END;
$$;


-- ================================================================
-- 2. repay_money_request
-- ================================================================
-- New:
--   • SELECT wallet_balance … FOR UPDATE on the borrower BEFORE touching
--     money_requests; raises 'Insufficient balance to repay this loan' if short.
--   • SELECT … FOR UPDATE on money_requests separates the lock-and-read from
--     the write, so the balance check can happen before any state changes.
--     If a concurrent caller repaid first, v_funder_id is NULL → exception.
--   • Trust score, points, streaks, and activity feed are never written on failure.
-- ================================================================

CREATE OR REPLACE FUNCTION public.repay_money_request(
  p_request_id  uuid,
  p_borrower_id uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_funder_id        uuid;
  v_amount           numeric;
  v_funder_token     text;
  v_borrower_user    text;
  v_funder_name      text;
  v_funder_user      text;
  v_amt_str          text;
  v_act_id           text;
  v_borrower_balance numeric;
BEGIN
  -- Lock borrower row early: prevents concurrent calls from spending the same
  -- balance and ensures our check and update are atomic within this transaction.
  SELECT wallet_balance INTO v_borrower_balance
  FROM children WHERE id = p_borrower_id FOR UPDATE;

  -- Lock and read the request. If already repaid (or defaulted), returns no rows.
  -- FOR UPDATE also prevents two concurrent callers from both seeing 'funded'.
  SELECT funded_by, amount INTO v_funder_id, v_amount
  FROM money_requests
  WHERE id = p_request_id
    AND from_id = p_borrower_id
    AND status  = 'funded'
  FOR UPDATE;

  IF v_funder_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or not in funded state';
  END IF;

  -- Balance check: all checks must pass before any row is modified.
  IF COALESCE(v_borrower_balance, 0) < v_amount THEN
    RAISE EXCEPTION 'Insufficient balance to repay this loan';
  END IF;

  -- Resolve display names
  SELECT username INTO v_borrower_user
  FROM children WHERE id = p_borrower_id;

  SELECT display_name, username INTO v_funder_name, v_funder_user
  FROM children WHERE id = v_funder_id;

  v_amt_str := '£' || to_char(v_amount, 'FM999990.00');
  v_act_id  := 'recv_' || p_request_id::text;

  -- Mark request repaid (row already locked by FOR UPDATE above)
  UPDATE money_requests
  SET status    = 'repaid',
      repaid_at = now()
  WHERE id = p_request_id;

  -- Deduct from borrower (row already locked)
  UPDATE children SET
    wallet_balance = wallet_balance - v_amount,
    borrowed       = GREATEST(0, borrowed - v_amount),
    repaid         = repaid         + 1,
    trust_score    = LEAST(100, trust_score + 5),
    points         = points         + 5
  WHERE id = p_borrower_id;

  PERFORM _update_weekly_streak(p_borrower_id);

  -- Credit funder
  UPDATE children SET
    wallet_balance = wallet_balance + v_amount,
    loaned_out     = GREATEST(0, loaned_out - v_amount)
  WHERE id = v_funder_id;

  -- Record transactions for both sides
  INSERT INTO transactions (child_id, type, amount, description, counterparty) VALUES
    (p_borrower_id, 'repay',   -v_amount,
     'Repaid '   || v_amt_str || ' to @'   || v_funder_user,   v_funder_name),
    (v_funder_id,   'receive',  v_amount,
     'Received ' || v_amt_str || ' from @' || v_borrower_user, NULL);

  -- Deterministic activity id: safe to call twice (ON CONFLICT DO NOTHING)
  INSERT INTO activity_feed (child_id, id, emoji, text, type)
  VALUES (v_funder_id, v_act_id, '✅',
          '@' || v_borrower_user || ' repaid you ' || v_amt_str, 'repaid')
  ON CONFLICT (id) DO NOTHING;

  SELECT push_token INTO v_funder_token FROM children WHERE id = v_funder_id;

  RETURN json_build_object(
    'funder_id',         v_funder_id,
    'funder_push_token', v_funder_token,
    'amount',            v_amount
  );
END;
$$;


-- ================================================================
-- 3. confirm_parent_repayment
-- ================================================================
-- New:
--   • Reads wallet_balance alongside parent_debt in a single SELECT FOR UPDATE.
--   • Raises 'Insufficient balance' if child cannot cover the full debt.
--   • Replaces the silent GREATEST(0, wallet_balance - v_debt) with an exact
--     deduction: wallet_balance = wallet_balance - v_debt.
--   • Short-circuits with zero-repayment if v_debt is already 0.
-- ================================================================

CREATE OR REPLACE FUNCTION public.confirm_parent_repayment(
  p_child_id  uuid,
  p_parent_id uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_debt          numeric;
  v_child_balance numeric;
BEGIN
  -- Lock child row and read both debt and current balance atomically.
  SELECT COALESCE(parent_debt, 0), wallet_balance
  INTO   v_debt, v_child_balance
  FROM   children
  WHERE  id = p_child_id AND parent_id = p_parent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_parent');
  END IF;

  -- Short-circuit: nothing to repay
  IF v_debt = 0 THEN
    RETURN json_build_object('repaid', 0);
  END IF;

  -- Balance check before any write
  IF COALESCE(v_child_balance, 0) < v_debt THEN
    RAISE EXCEPTION 'Insufficient balance: child has £% but owes £%',
      to_char(COALESCE(v_child_balance, 0), 'FM999990.00'),
      to_char(v_debt, 'FM999990.00');
  END IF;

  -- Exact deduction (balance check above guarantees this stays >= 0)
  UPDATE children SET
    wallet_balance = wallet_balance - v_debt,
    parent_debt    = 0,
    account_frozen = false
  WHERE id = p_child_id;

  UPDATE parents
  SET safety_pool_used = GREATEST(0, COALESCE(safety_pool_used, 0) - v_debt)
  WHERE id = p_parent_id;

  RETURN json_build_object('repaid', v_debt);
END;
$$;

COMMIT;
