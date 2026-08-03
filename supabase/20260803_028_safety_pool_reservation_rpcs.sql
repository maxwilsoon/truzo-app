-- Migration 028: Safety Pool reservation RPCs (Option C)
--
-- Prerequisite: migration 027 must already be applied (adds safety_pool_reserved
-- column to parents and reservation columns to money_requests).
--
-- Functions updated
-- ─────────────────
-- 1. fund_money_request       — reserve coverage atomically at funding time
-- 2. repay_money_request      — release reservation at repayment
-- 3. get_parent_safety_pool_status — return pool_reserved + pool_available
-- 4. login_child              — include safety_pool_reserved in parent payload
-- 5. biometric_login_child    — include safety_pool_reserved in parent payload
-- 6. update_safety_pool       — guard against reducing limit below used + reserved
--
-- Lock ordering (fund and repay)
-- ──────────────────────────────
-- All mutations on rows that could be concurrently modified follow the order:
--   parents (borrower's) → children → money_requests
--
-- fund_money_request:  parents(FOR UPDATE) → funder child(FOR UPDATE) → money_requests(implicit UPDATE)
-- repay_money_request: parents(FOR UPDATE) → borrower child(FOR UPDATE) → money_requests(FOR UPDATE)
--
-- This order is globally consistent across both functions and the default
-- processor (migration 029), which also acquires the parent lock before
-- touching money_requests. No deadlock is possible between any combination
-- of concurrent fund / repay / default operations because a lock cycle
-- requires one transaction to hold a resource another is waiting for while
-- also waiting for a resource the other holds — that cannot occur when the
-- parent lock is acquired first in all paths.
--
-- Rollback: 20260803_028_rollback.sql

BEGIN;

-- ─── 1. fund_money_request (with atomic reservation) ─────────────────────────
-- Changes vs current:
--   a. Lock parent row FOR UPDATE BEFORE checking available capacity.
--      Available = limit - used - reserved (includes reserved from prior loans).
--   b. Record safety_pool_reserved_amount on the money_requests row.
--   c. Increment parents.safety_pool_reserved by p_amount after the fund update.
--   d. Validate that p_amount matches money_requests.amount (amount sanity check).

CREATE OR REPLACE FUNCTION public.fund_money_request(
  p_request_id   uuid,
  p_funder_id    uuid,
  p_amount       numeric,
  p_session_token text,
  p_device_id    text
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
  -- Session validation is the first operation — before any read or write
  PERFORM require_valid_child_session(p_funder_id, p_session_token, p_device_id);

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: p_amount must be positive';
  END IF;

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
  -- This makes the availability check + reservation increment atomic:
  -- no concurrent funding can read the same available capacity until we commit.
  SELECT p.id,
         (COALESCE(p.safety_pool_limit, 0)
          - COALESCE(p.safety_pool_used,  0)
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
    SET status                     = 'funded',
        funded_by                  = p_funder_id,
        funded_at                  = now(),
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

-- ─── 2. repay_money_request (with reservation release) ───────────────────────
-- Changes vs current:
--   a. Get parent_id from children before any locking.
--   b. Lock parent FOR UPDATE FIRST (consistent ordering: parent before child).
--   c. Read safety_pool_reserved_amount from money_requests.
--   d. After all balance updates, release reservation in parents and mark
--      safety_pool_reservation_released_at on the request.

CREATE OR REPLACE FUNCTION public.repay_money_request(
  p_request_id    uuid,
  p_borrower_id   uuid,
  p_session_token text,
  p_device_id     text
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_parent_id        uuid;
  v_funder_id        uuid;
  v_amount           numeric;
  v_reserved_amount  numeric;
  v_borrower_user    text;
  v_borrower_name    text;
  v_funder_name      text;
  v_funder_user      text;
  v_amt_str          text;
  v_act_id           text;
  v_borrower_balance numeric;
BEGIN
  -- Session validation is the first operation — before any read or write
  PERFORM require_valid_child_session(p_borrower_id, p_session_token, p_device_id);

  -- Get parent_id without locking (needed to establish lock ordering)
  SELECT parent_id INTO v_parent_id
    FROM children WHERE id = p_borrower_id;
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'Borrower not found';
  END IF;

  -- Lock parent FIRST (consistent ordering: parent before child before money_requests).
  -- This prevents deadlocks with fund_money_request and process_due_loan_defaults,
  -- both of which also acquire the parent lock before other row locks.
  PERFORM 1 FROM parents WHERE id = v_parent_id FOR UPDATE;

  -- Lock borrower child AFTER parent
  SELECT wallet_balance INTO v_borrower_balance
    FROM children WHERE id = p_borrower_id FOR UPDATE;

  -- Lock money_requests AFTER child
  SELECT funded_by, amount, safety_pool_reserved_amount
    INTO v_funder_id, v_amount, v_reserved_amount
    FROM money_requests
    WHERE id      = p_request_id
      AND from_id = p_borrower_id
      AND status  = 'funded'
    FOR UPDATE;

  IF v_funder_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or not in funded state';
  END IF;

  IF COALESCE(v_borrower_balance, 0) < v_amount THEN
    RAISE EXCEPTION 'Insufficient balance to repay this loan';
  END IF;

  SELECT username,     display_name INTO v_borrower_user, v_borrower_name FROM children WHERE id = p_borrower_id;
  SELECT display_name, username     INTO v_funder_name,   v_funder_user   FROM children WHERE id = v_funder_id;

  v_amt_str := '£' || to_char(v_amount, 'FM999990.00');
  v_act_id  := 'recv_' || p_request_id::text;

  -- Mark as repaid and stamp reservation release time
  UPDATE money_requests
    SET status                            = 'repaid',
        repaid_at                         = now(),
        safety_pool_reservation_released_at = now()
    WHERE id = p_request_id;

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

  -- Release Safety Pool reservation (parent row still locked from above)
  IF v_reserved_amount IS NOT NULL AND v_reserved_amount > 0 THEN
    UPDATE parents
      SET safety_pool_reserved = GREATEST(0, COALESCE(safety_pool_reserved, 0) - v_reserved_amount)
      WHERE id = v_parent_id;
  END IF;

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

  RETURN json_build_object('funder_id', v_funder_id, 'amount', v_amount);
END;
$$;

-- ─── 3. get_parent_safety_pool_status (new return columns) ───────────────────
-- Return type changes from (pool_limit, pool_used) to
-- (pool_limit, pool_used, pool_reserved, pool_available).
-- CREATE OR REPLACE cannot change return type; must DROP first.

DROP FUNCTION IF EXISTS public.get_parent_safety_pool_status(uuid);

CREATE FUNCTION public.get_parent_safety_pool_status(p_parent_id uuid)
  RETURNS TABLE(
    pool_limit     numeric,
    pool_used      numeric,
    pool_reserved  numeric,
    pool_available numeric
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
    SELECT
      COALESCE(p.safety_pool_limit,    0::numeric) AS pool_limit,
      COALESCE(p.safety_pool_used,     0::numeric) AS pool_used,
      COALESCE(p.safety_pool_reserved, 0::numeric) AS pool_reserved,
      GREATEST(0::numeric,
        COALESCE(p.safety_pool_limit,    0)
        - COALESCE(p.safety_pool_used,   0)
        - COALESCE(p.safety_pool_reserved, 0)
      )                                             AS pool_available
    FROM parents p
    WHERE p.id = p_parent_id;
END;
$$;

-- Restrict access: only authenticated parents call this via RLS-verified context
REVOKE ALL ON FUNCTION public.get_parent_safety_pool_status(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_parent_safety_pool_status(uuid) TO authenticated;

-- ─── 4. login_child (add safety_pool_reserved to parent payload) ──────────────
-- Additive change: new field in the 'parent' JSON object.
-- Existing clients ignore unknown fields; no breaking change.

CREATE OR REPLACE FUNCTION public.login_child(
  p_username text,
  p_password text,
  p_device_id text
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_child     children%ROWTYPE;
  v_parent    parents%ROWTYPE;
  v_raw_token text;
  v_hash      text;
  v_expires   timestamptz := now() + interval '1 hour';
  v_abs_exp   timestamptz := now() + interval '30 days';
  c_dummy CONSTANT text :=
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
BEGIN
  IF p_device_id IS NULL OR p_device_id = '' THEN
    RAISE EXCEPTION 'device_id_required';
  END IF;

  SELECT * INTO v_child
    FROM children
    WHERE username      = lower(p_username)
      AND password_hash IS NOT NULL;

  IF NOT FOUND THEN
    PERFORM crypt(p_password, c_dummy);
    RETURN NULL;
  END IF;

  IF crypt(p_password, v_child.password_hash) <> v_child.password_hash THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_hash      := encode(digest(v_raw_token, 'sha256'), 'hex');

  PERFORM revoke_all_child_sessions(v_child.id, 'superseded_by_new_login');

  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_child.id, v_hash, p_device_id, v_expires, v_abs_exp);

  RETURN json_build_object(
    'child', json_build_object(
      'id',                v_child.id,
      'display_name',      v_child.display_name,
      'username',          v_child.username,
      'avatar_emoji',      v_child.avatar_emoji,
      'profile_image_url', v_child.profile_image_url,
      'trust_score',       v_child.trust_score,
      'wallet_balance',    v_child.wallet_balance,
      'loaned_out',        v_child.loaned_out,
      'borrowed',          v_child.borrowed,
      'streak',            v_child.streak,
      'repaid',            v_child.repaid,
      'missed',            v_child.missed,
      'total_borrowed',    v_child.total_borrowed,
      'total_lent',        v_child.total_lent,
      'times_borrowed',    v_child.times_borrowed,
      'times_lent',        v_child.times_lent,
      'points',            v_child.points,
      'age',               v_child.age,
      'mobile',            v_child.mobile,
      'biometric_enabled', v_child.biometric_enabled,
      'last_device_id',    v_child.last_device_id,
      'account_frozen',    v_child.account_frozen,
      'parent_debt',       v_child.parent_debt
    ),
    'parent', json_build_object(
      'id',                     v_parent.id,
      'first_name',             v_parent.first_name,
      'last_name',              v_parent.last_name,
      'display_name',           v_parent.display_name,
      'safety_pool_limit',      v_parent.safety_pool_limit,
      'safety_pool_used',       v_parent.safety_pool_used,
      'safety_pool_reserved',   v_parent.safety_pool_reserved,
      'weekly_allowance',       v_parent.weekly_allowance,
      'allowance_frequency',    v_parent.allowance_frequency,
      'allowance_active',       v_parent.allowance_active,
      'allowance_next_payment', v_parent.allowance_next_payment,
      'passcode_created',       v_parent.passcode_created,
      'marketing_notifications',v_parent.marketing_notifications,
      'profile_image_url',      v_parent.profile_image_url
    ),
    'session_token',      v_raw_token,
    'session_expires_at', v_expires
  );
END;
$$;

-- ─── 5. biometric_login_child (add safety_pool_reserved to parent payload) ───

CREATE OR REPLACE FUNCTION public.biometric_login_child(
  p_child_id        uuid,
  p_device_id       text,
  p_biometric_token text
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_child     children%ROWTYPE;
  v_parent    parents%ROWTYPE;
  v_raw_token text;
  v_hash      text;
  v_expires   timestamptz := now() + interval '1 hour';
  v_abs_exp   timestamptz := now() + interval '30 days';
BEGIN
  IF p_biometric_token IS NULL OR length(p_biometric_token) <> 64 THEN
    RETURN NULL;
  END IF;
  IF p_device_id IS NULL OR p_device_id = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_child
    FROM children
    WHERE id                   = p_child_id
      AND biometric_enabled    = true
      AND last_device_id       = p_device_id
      AND biometric_token_hash = encode(digest(p_biometric_token, 'sha256'), 'hex');

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE children SET last_biometric_login = now() WHERE id = p_child_id;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_hash      := encode(digest(v_raw_token, 'sha256'), 'hex');

  PERFORM revoke_all_child_sessions(v_child.id, 'superseded_by_new_login');

  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_child.id, v_hash, p_device_id, v_expires, v_abs_exp);

  RETURN json_build_object(
    'child', json_build_object(
      'id',                v_child.id,
      'display_name',      v_child.display_name,
      'username',          v_child.username,
      'avatar_emoji',      v_child.avatar_emoji,
      'profile_image_url', v_child.profile_image_url,
      'trust_score',       v_child.trust_score,
      'wallet_balance',    v_child.wallet_balance,
      'loaned_out',        v_child.loaned_out,
      'borrowed',          v_child.borrowed,
      'streak',            v_child.streak,
      'repaid',            v_child.repaid,
      'missed',            v_child.missed,
      'total_borrowed',    v_child.total_borrowed,
      'total_lent',        v_child.total_lent,
      'times_borrowed',    v_child.times_borrowed,
      'times_lent',        v_child.times_lent,
      'points',            v_child.points,
      'age',               v_child.age,
      'mobile',            v_child.mobile,
      'biometric_enabled', v_child.biometric_enabled,
      'last_device_id',    v_child.last_device_id,
      'account_frozen',    v_child.account_frozen,
      'parent_debt',       v_child.parent_debt
    ),
    'parent', json_build_object(
      'id',                     v_parent.id,
      'first_name',             v_parent.first_name,
      'last_name',              v_parent.last_name,
      'display_name',           v_parent.display_name,
      'safety_pool_limit',      v_parent.safety_pool_limit,
      'safety_pool_used',       v_parent.safety_pool_used,
      'safety_pool_reserved',   v_parent.safety_pool_reserved,
      'weekly_allowance',       v_parent.weekly_allowance,
      'allowance_frequency',    v_parent.allowance_frequency,
      'allowance_active',       v_parent.allowance_active,
      'allowance_next_payment', v_parent.allowance_next_payment,
      'passcode_created',       v_parent.passcode_created,
      'marketing_notifications',v_parent.marketing_notifications,
      'profile_image_url',      v_parent.profile_image_url
    ),
    'session_token',      v_raw_token,
    'session_expires_at', v_expires
  );
END;
$$;

-- ─── 6. update_safety_pool (guard against reducing below used + reserved) ─────
-- Original was a one-liner with no guard. A parent reducing the limit below
-- current used + reserved would cause future fundings to fail or the DB
-- constraint to fire. Better to catch it early with a clear message.

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

  -- Lock parent row while we check and update
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

NOTIFY pgrst, 'reload schema';

COMMIT;
