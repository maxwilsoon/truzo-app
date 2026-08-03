-- Rollback for migration 028: Safety Pool reservation RPCs
--
-- Restores the exact pre-028 function bodies.
-- Run this BEFORE rolling back migration 027 if you need to revert both.
--
-- NOTE: Rolling back 028 but NOT 027 leaves the reservation columns on
-- the tables. The pre-028 functions simply ignore them (they don't read
-- safety_pool_reserved_amount or safety_pool_reservation_released_at).
-- The reservation column on parents will no longer be incremented by
-- fund_money_request, but existing data integrity is preserved.
--
-- NOTE: get_parent_safety_pool_status will be restored to its 2-column
-- return type. Any clients using the new pool_reserved / pool_available
-- columns should be rolled back to the prior client build first.

BEGIN;

-- ─── 1. fund_money_request (pre-028: snapshot check, no reservation) ──────────

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

-- ─── 2. repay_money_request (pre-028: no parent lock, no reservation release) ──

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
  PERFORM require_valid_child_session(p_borrower_id, p_session_token, p_device_id);

  SELECT wallet_balance INTO v_borrower_balance
    FROM children WHERE id = p_borrower_id FOR UPDATE;

  SELECT funded_by, amount INTO v_funder_id, v_amount
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

  RETURN json_build_object('funder_id', v_funder_id, 'amount', v_amount);
END;
$$;

-- ─── 3. get_parent_safety_pool_status (pre-028: 2-column return) ──────────────
-- Must DROP first because return type is changing back.

DROP FUNCTION IF EXISTS public.get_parent_safety_pool_status(uuid);

CREATE FUNCTION public.get_parent_safety_pool_status(p_parent_id uuid)
  RETURNS TABLE(pool_limit numeric, pool_used numeric)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
    SELECT
      COALESCE(p.safety_pool_limit, 0::numeric) AS pool_limit,
      COALESCE(p.safety_pool_used,  0::numeric) AS pool_used
    FROM parents p
    WHERE p.id = p_parent_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_parent_safety_pool_status(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_parent_safety_pool_status(uuid) TO authenticated;

-- ─── 4. login_child (pre-028: no safety_pool_reserved in parent payload) ──────

CREATE OR REPLACE FUNCTION public.login_child(
  p_username  text,
  p_password  text,
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

  SELECT * INTO v_child FROM children
    WHERE username = lower(p_username) AND password_hash IS NOT NULL;

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
      'id', v_child.id, 'display_name', v_child.display_name,
      'username', v_child.username, 'avatar_emoji', v_child.avatar_emoji,
      'profile_image_url', v_child.profile_image_url, 'trust_score', v_child.trust_score,
      'wallet_balance', v_child.wallet_balance, 'loaned_out', v_child.loaned_out,
      'borrowed', v_child.borrowed, 'streak', v_child.streak, 'repaid', v_child.repaid,
      'missed', v_child.missed, 'total_borrowed', v_child.total_borrowed,
      'total_lent', v_child.total_lent, 'times_borrowed', v_child.times_borrowed,
      'times_lent', v_child.times_lent, 'points', v_child.points, 'age', v_child.age,
      'mobile', v_child.mobile, 'biometric_enabled', v_child.biometric_enabled,
      'last_device_id', v_child.last_device_id, 'account_frozen', v_child.account_frozen,
      'parent_debt', v_child.parent_debt
    ),
    'parent', json_build_object(
      'id', v_parent.id, 'first_name', v_parent.first_name, 'last_name', v_parent.last_name,
      'display_name', v_parent.display_name,
      'safety_pool_limit', v_parent.safety_pool_limit,
      'safety_pool_used', v_parent.safety_pool_used,
      'weekly_allowance', v_parent.weekly_allowance,
      'allowance_frequency', v_parent.allowance_frequency,
      'allowance_active', v_parent.allowance_active,
      'allowance_next_payment', v_parent.allowance_next_payment,
      'passcode_created', v_parent.passcode_created,
      'marketing_notifications', v_parent.marketing_notifications,
      'profile_image_url', v_parent.profile_image_url
    ),
    'session_token', v_raw_token,
    'session_expires_at', v_expires
  );
END;
$$;

-- ─── 5. biometric_login_child (pre-028: no safety_pool_reserved) ──────────────

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
  IF p_biometric_token IS NULL OR length(p_biometric_token) <> 64 THEN RETURN NULL; END IF;
  IF p_device_id IS NULL OR p_device_id = '' THEN RETURN NULL; END IF;

  SELECT * INTO v_child FROM children
    WHERE id = p_child_id AND biometric_enabled = true AND last_device_id = p_device_id
      AND biometric_token_hash = encode(digest(p_biometric_token, 'sha256'), 'hex');

  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE children SET last_biometric_login = now() WHERE id = p_child_id;
  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_hash      := encode(digest(v_raw_token, 'sha256'), 'hex');

  PERFORM revoke_all_child_sessions(v_child.id, 'superseded_by_new_login');
  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_child.id, v_hash, p_device_id, v_expires, v_abs_exp);

  RETURN json_build_object(
    'child', json_build_object(
      'id', v_child.id, 'display_name', v_child.display_name,
      'username', v_child.username, 'avatar_emoji', v_child.avatar_emoji,
      'profile_image_url', v_child.profile_image_url, 'trust_score', v_child.trust_score,
      'wallet_balance', v_child.wallet_balance, 'loaned_out', v_child.loaned_out,
      'borrowed', v_child.borrowed, 'streak', v_child.streak, 'repaid', v_child.repaid,
      'missed', v_child.missed, 'total_borrowed', v_child.total_borrowed,
      'total_lent', v_child.total_lent, 'times_borrowed', v_child.times_borrowed,
      'times_lent', v_child.times_lent, 'points', v_child.points, 'age', v_child.age,
      'mobile', v_child.mobile, 'biometric_enabled', v_child.biometric_enabled,
      'last_device_id', v_child.last_device_id, 'account_frozen', v_child.account_frozen,
      'parent_debt', v_child.parent_debt
    ),
    'parent', json_build_object(
      'id', v_parent.id, 'first_name', v_parent.first_name, 'last_name', v_parent.last_name,
      'display_name', v_parent.display_name,
      'safety_pool_limit', v_parent.safety_pool_limit,
      'safety_pool_used', v_parent.safety_pool_used,
      'weekly_allowance', v_parent.weekly_allowance,
      'allowance_frequency', v_parent.allowance_frequency,
      'allowance_active', v_parent.allowance_active,
      'allowance_next_payment', v_parent.allowance_next_payment,
      'passcode_created', v_parent.passcode_created,
      'marketing_notifications', v_parent.marketing_notifications,
      'profile_image_url', v_parent.profile_image_url
    ),
    'session_token', v_raw_token,
    'session_expires_at', v_expires
  );
END;
$$;

-- ─── 6. update_safety_pool (pre-028: no limit-reduction guard) ────────────────

CREATE OR REPLACE FUNCTION public.update_safety_pool(
  p_parent_id uuid,
  p_new_limit  numeric
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  UPDATE parents
    SET safety_pool_limit        = p_new_limit,
        safety_pool_last_updated = now()
    WHERE id = p_parent_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
