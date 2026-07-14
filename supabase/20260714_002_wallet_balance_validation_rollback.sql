-- ============================================================
-- Rollback:   20260714_002_wallet_balance_validation_rollback.sql
-- Restores:   fund_money_request, repay_money_request,
--             confirm_parent_repayment to their pre-migration bodies.
-- ============================================================

BEGIN;

-- ── fund_money_request (original) ────────────────────────────────────────────

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
BEGIN
  -- Resolve borrower from pending request
  SELECT from_id INTO v_borrower_id FROM money_requests WHERE id = p_request_id AND status = 'pending';
  IF v_borrower_id IS NULL THEN RAISE EXCEPTION 'Request not found or already funded'; END IF;

  -- Borrower must not be frozen
  SELECT COALESCE(account_frozen, false) INTO v_frozen FROM children WHERE id = v_borrower_id;
  IF v_frozen THEN RAISE EXCEPTION 'borrower_frozen'; END IF;

  -- Safety pool must cover the full loan amount
  SELECT (p.safety_pool_limit - COALESCE(p.safety_pool_used, 0))
  INTO v_pool_avail
  FROM parents p JOIN children c ON c.parent_id = p.id WHERE c.id = v_borrower_id;
  IF COALESCE(v_pool_avail, 0) < p_amount THEN RAISE EXCEPTION 'safety_pool_insufficient'; END IF;

  -- All checks passed — fund the request
  UPDATE money_requests
  SET status = 'funded', funded_by = p_funder_id, funded_at = now()
  WHERE id = p_request_id AND status = 'pending'
  RETURNING from_id INTO v_borrower_id;

  SELECT username INTO v_funder_user FROM children WHERE id = p_funder_id;
  SELECT display_name, username INTO v_borrower_name, v_borrower_user FROM children WHERE id = v_borrower_id;
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
    (p_funder_id,   'lend',   -p_amount, v_amt_str || ' lent to @'       || v_borrower_user, v_borrower_name),
    (v_borrower_id, 'borrow',  p_amount, v_amt_str || ' borrowed from @' || v_funder_user,   NULL);

  SELECT push_token INTO v_borrower_token FROM children WHERE id = v_borrower_id;
  RETURN json_build_object('borrower_id', v_borrower_id, 'borrower_push_token', v_borrower_token);
END;
$$;


-- ── repay_money_request (original) ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.repay_money_request(
  p_request_id  uuid,
  p_borrower_id uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_funder_id      uuid;
  v_amount         numeric;
  v_funder_token   text;
  v_borrower_user  text;
  v_funder_name    text;
  v_funder_user    text;
  v_amt_str        text;
  v_act_id         text;
BEGIN
  UPDATE money_requests
  SET status = 'repaid', repaid_at = now()
  WHERE id = p_request_id AND from_id = p_borrower_id AND status = 'funded'
  RETURNING funded_by, amount INTO v_funder_id, v_amount;

  IF v_funder_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or not in funded state';
  END IF;

  SELECT username INTO v_borrower_user FROM children WHERE id = p_borrower_id;
  SELECT display_name, username INTO v_funder_name, v_funder_user FROM children WHERE id = v_funder_id;

  v_amt_str := '£' || to_char(v_amount, 'FM999990.00');
  v_act_id  := 'recv_' || p_request_id::text;

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
    (p_borrower_id, 'repay',   -v_amount, 'Repaid '   || v_amt_str || ' to @'   || v_funder_user,   v_funder_name),
    (v_funder_id,   'receive',  v_amount, 'Received ' || v_amt_str || ' from @' || v_borrower_user, NULL);

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


-- ── confirm_parent_repayment (original) ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirm_parent_repayment(
  p_child_id  uuid,
  p_parent_id uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_debt numeric;
BEGIN
  SELECT COALESCE(parent_debt, 0) INTO v_debt
  FROM children WHERE id = p_child_id AND parent_id = p_parent_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_parent'); END IF;

  UPDATE children SET
    wallet_balance = GREATEST(0, wallet_balance - v_debt),
    parent_debt    = 0,
    account_frozen = false
  WHERE id = p_child_id;

  UPDATE parents SET safety_pool_used = GREATEST(0, COALESCE(safety_pool_used, 0) - v_debt)
  WHERE id = p_parent_id;

  RETURN json_build_object('repaid', v_debt);
END;
$$;

COMMIT;
