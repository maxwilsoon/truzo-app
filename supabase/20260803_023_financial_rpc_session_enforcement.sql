-- Migration 023: Enforce child session tokens on all financial write RPCs
--
-- Depends on: 20260803_021 (require_valid_child_session), 20260803_022 (sessions issued)
--
-- ── Live overloads before this migration (post-migrations-001-022) ────────────────────────
--
-- Run this query to confirm before applying:
--
--   SELECT proname, pg_get_function_arguments(oid) AS arguments
--   FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND proname IN ('create_money_request','fund_money_request',
--                     'repay_money_request','cancel_money_request')
--   ORDER BY proname;
--
-- Expected result:
--   create_money_request  | p_from_id uuid, p_amount numeric, p_deadline_days integer,
--                         |   p_reason text DEFAULT ''::text,
--                         |   p_reason_emoji text DEFAULT '💸'::text,
--                         |   p_viewer_ids uuid[] DEFAULT NULL::uuid[]
--   fund_money_request    | p_request_id uuid, p_funder_id uuid, p_amount numeric
--   repay_money_request   | p_request_id uuid, p_borrower_id uuid
--   cancel_money_request  | p_request_id uuid, p_child_id uuid
--
-- Each old overload is explicitly DROPPED before the new one is created.
-- After this migration exactly one overload exists per RPC, verified by the
-- post-migration query at the bottom of this file.
--
-- ── Session parameter design ─────────────────────────────────────────────────────────────
--
-- For fund_money_request, repay_money_request, cancel_money_request:
--   p_session_token and p_device_id are the LAST params with NO DEFAULT.
--   PostgreSQL therefore requires them — a call with fewer args is an error.
--
-- For create_money_request:
--   p_reason, p_reason_emoji, p_viewer_ids already carry DEFAULT values.
--   PostgreSQL does not allow required params after optional ones.
--   Solution: p_session_token and p_device_id are placed BEFORE the optional params
--   in the parameter list. The TypeScript client uses named params, so call-site
--   order is irrelevant. The old 6-param overload is still DROPPED explicitly.
--
-- ── Preserved unchanged ───────────────────────────────────────────────────────────────────
--   Wallet balance checks and FOR UPDATE row locking in fund/repay
--   Safety pool check in fund_money_request
--   Borrowing-limit calculations in create_money_request
--   All notification triggers and transaction inserts
--
-- Rollback: 20260803_023_rollback.sql

BEGIN;

-- ── 1. create_money_request ────────────────────────────────────────────────────────────────
--
-- OLD signature: (uuid, numeric, integer, text, text, uuid[])
-- NEW signature: (uuid, numeric, integer, text, text, text, text, uuid[])
--   session params placed BEFORE the optional params so they are required.

DROP FUNCTION IF EXISTS public.create_money_request(uuid, numeric, integer, text, text, uuid[]);

CREATE FUNCTION public.create_money_request(
  p_from_id       uuid,
  p_amount        numeric,
  p_deadline_days integer,
  p_session_token text,                  -- required; no default
  p_device_id     text,                  -- required; no default
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
  -- Session validation is the first operation — before any read or write
  PERFORM require_valid_child_session(p_from_id, p_session_token, p_device_id);

  SELECT trust_score, COALESCE(account_frozen, false)
    INTO v_trust, v_frozen
    FROM children WHERE id = p_from_id;

  -- Belt-and-suspenders: require_valid_child_session already catches frozen accounts,
  -- but this raises the specific error code the client expects.
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
GRANT EXECUTE ON FUNCTION
  public.create_money_request(uuid, numeric, integer, text, text, text, text, uuid[])
  TO anon;


-- ── 2. fund_money_request ──────────────────────────────────────────────────────────────────
--
-- OLD signature: (uuid, uuid, numeric)
-- NEW signature: (uuid, uuid, numeric, text, text)  ← last two params have NO DEFAULT

DROP FUNCTION IF EXISTS public.fund_money_request(uuid, uuid, numeric);

CREATE FUNCTION public.fund_money_request(
  p_request_id    uuid,
  p_funder_id     uuid,
  p_amount        numeric,
  p_session_token text,     -- required; no default
  p_device_id     text      -- required; no default
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
  -- Session validation is the first operation — before any read or write
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

  -- Row lock on funder before any mutation (preserves existing concurrency safety)
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
GRANT EXECUTE ON FUNCTION public.fund_money_request(uuid, uuid, numeric, text, text) TO anon;


-- ── 3. repay_money_request ─────────────────────────────────────────────────────────────────
--
-- OLD signature: (uuid, uuid)
-- NEW signature: (uuid, uuid, text, text)  ← last two params have NO DEFAULT

DROP FUNCTION IF EXISTS public.repay_money_request(uuid, uuid);

CREATE FUNCTION public.repay_money_request(
  p_request_id    uuid,
  p_borrower_id   uuid,
  p_session_token text,     -- required; no default
  p_device_id     text      -- required; no default
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
  -- Session validation is the first operation — before any read or write
  PERFORM require_valid_child_session(p_borrower_id, p_session_token, p_device_id);

  -- Row lock on borrower before money_requests lock (preserves existing lock ordering)
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
GRANT EXECUTE ON FUNCTION public.repay_money_request(uuid, uuid, text, text) TO anon;


-- ── 4. cancel_money_request ────────────────────────────────────────────────────────────────
--
-- OLD signature: (uuid, uuid) — existed only in live DB, not in any versioned migration.
-- NEW signature: (uuid, uuid, text, text)  ← last two params have NO DEFAULT

DROP FUNCTION IF EXISTS public.cancel_money_request(uuid, uuid);

CREATE FUNCTION public.cancel_money_request(
  p_request_id    uuid,
  p_child_id      uuid,
  p_session_token text,     -- required; no default
  p_device_id     text      -- required; no default
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Session validation is the first operation — before any read or write
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  UPDATE money_requests
    SET status = 'cancelled'
    WHERE id      = p_request_id
      AND from_id = p_child_id
      AND status  = 'pending';
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_money_request(uuid, uuid, text, text) TO anon;


-- ── Post-migration verification ───────────────────────────────────────────────────────────
--
-- Run these queries after applying this migration to prove:
--   a) exactly one overload exists per function (old insecure signatures gone)
--   b) only anon has EXECUTE privilege (no residual grants to PUBLIC or authenticated)
--
-- ── (a) Overload count and signatures ────────────────────────────────────────────────────
--
-- SELECT proname, pg_get_function_arguments(oid) AS arguments
-- FROM pg_proc
-- WHERE pronamespace = 'public'::regnamespace
--   AND proname IN (
--     'create_money_request', 'fund_money_request',
--     'repay_money_request',  'cancel_money_request'
--   )
-- ORDER BY proname;
--
-- Expected — exactly 4 rows (one per function):
--
--   create_money_request
--     p_from_id uuid, p_amount numeric, p_deadline_days integer,
--     p_session_token text, p_device_id text,
--     p_reason text DEFAULT ''::text,
--     p_reason_emoji text DEFAULT '💸'::text,
--     p_viewer_ids uuid[] DEFAULT NULL::uuid[]
--
--   fund_money_request
--     p_request_id uuid, p_funder_id uuid, p_amount numeric,
--     p_session_token text, p_device_id text
--
--   repay_money_request
--     p_request_id uuid, p_borrower_id uuid,
--     p_session_token text, p_device_id text
--
--   cancel_money_request
--     p_request_id uuid, p_child_id uuid,
--     p_session_token text, p_device_id text
--
-- ── (b) Grant verification ────────────────────────────────────────────────────────────────
--
-- SELECT routine_name, grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'create_money_request', 'fund_money_request',
--     'repay_money_request',  'cancel_money_request'
--   )
-- ORDER BY routine_name, grantee;
--
-- Expected: only grantee = 'anon', privilege_type = 'EXECUTE' for each function.
-- No rows for PUBLIC, authenticated, or any other role.
--
-- ── (c) Login and biometric RPC overloads ─────────────────────────────────────────────────
--
-- SELECT proname, pg_get_function_arguments(oid) AS arguments
-- FROM pg_proc
-- WHERE pronamespace = 'public'::regnamespace
--   AND proname IN ('login_child', 'biometric_login_child', 'enable_biometric', 'disable_biometric')
-- ORDER BY proname;
--
-- Expected:
--   biometric_login_child  p_child_id uuid, p_device_id text, p_biometric_token text
--   disable_biometric      p_child_id uuid
--   enable_biometric       p_child_id uuid, p_device_id text, p_biometric_token_hash text
--   login_child            p_username text, p_password text, p_device_id text
--
-- Each must show exactly one row. Old 2-param login_child and old 2-param
-- biometric_login_child must not appear.

NOTIFY pgrst, 'reload schema';

COMMIT;
