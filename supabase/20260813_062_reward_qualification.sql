-- M062: Reward Qualification Layer
--
-- Adds a private qualification engine that gates children.points on top of the
-- financial RPCs. Financial transactions (loan amounts, wallet balances, loaned_out,
-- trust_score) complete and settle exactly as before — only children.points is now
-- conditionally awarded based on a set of anti-farming rules.
--
-- New tables:
--   reward_config          — configurable thresholds (key-value, no migration to retune)
--   reward_events          — idempotent per-event ledger (qualified or not, with reasons)
--   gift_card_catalog      — server-side catalog (replaces hardcoded client REWARDS array)
--   gift_card_redemptions  — atomic redemption records
--
-- New private function:
--   _evaluate_reward_qualification(child_id, request_id, event_type, counterparty_id)
--
-- Modified functions (surgical changes only — financial logic untouched):
--   fund_money_request   → removes "points = points + 2"; calls qualification engine
--   repay_money_request  → removes "points = points + 5"; calls qualification engine
--
-- New public RPCs:
--   redeem_gift_card(child_id, catalog_id, session_token, device_id)
--   get_gift_card_catalog(child_id, session_token, device_id)


-- ── 1. reward_config ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reward_config (
  key          text        PRIMARY KEY,
  value_num    numeric,
  value_text   text,
  description  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.reward_config FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON TABLE public.reward_config TO postgres, service_role;

INSERT INTO public.reward_config (key, value_num, description) VALUES
  ('min_reward_amount_gbp',           5.00, 'Minimum loan amount (GBP) for reward qualification'),
  ('min_reward_duration_hours',       24,   'Min hours between funded_at and repaid_at (borrower repay events only)'),
  ('new_account_lockout_days',        7,    'Min account age in days before reward eligibility begins'),
  ('max_same_pair_rewards_per_month', 3,    'Max qualifying events per lender-borrower pair per rolling 30 days'),
  ('max_reward_pts_day',              50,   'Max reward pts a single child can earn in a UTC calendar day'),
  ('max_reward_pts_month',            300,  'Max reward pts per child per rolling 30-day window'),
  ('circular_flag_threshold',         3,    'Qualifying circular-pair events before the pair is disqualified'),
  ('lender_pts_fund',                 2,    'Points awarded to lender on a qualifying fund event'),
  ('borrower_pts_repay',              5,    'Points awarded to borrower on a qualifying repay event')
ON CONFLICT (key) DO NOTHING;


-- ── 2. reward_events ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reward_events (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id                 uuid        NOT NULL REFERENCES public.children(id),
  money_request_id         uuid        NOT NULL REFERENCES public.money_requests(id),
  counterparty_id          uuid                 REFERENCES public.children(id),
  event_type               text        NOT NULL CHECK (event_type IN ('fund', 'repay')),
  points_awarded           int         NOT NULL DEFAULT 0,
  qualified                boolean     NOT NULL,
  disqualification_reasons text[]      NOT NULL DEFAULT '{}',
  risk_score               int         NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reward_events_idempotent
    UNIQUE (child_id, money_request_id, event_type)
);

CREATE INDEX IF NOT EXISTS reward_events_child_idx
  ON public.reward_events (child_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reward_events_pair_idx
  ON public.reward_events (child_id, counterparty_id, created_at DESC)
  WHERE qualified = true;

CREATE INDEX IF NOT EXISTS reward_events_request_idx
  ON public.reward_events (money_request_id);

REVOKE ALL ON TABLE public.reward_events FROM PUBLIC, anon, authenticated;
GRANT  SELECT, INSERT ON TABLE public.reward_events TO postgres, service_role;


-- ── 3. gift_card_catalog ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gift_card_catalog (
  id           text        PRIMARY KEY,
  name         text        NOT NULL,
  brand        text        NOT NULL,
  cost_pts     int         NOT NULL CHECK (cost_pts > 0),
  active       boolean     NOT NULL DEFAULT true,
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.gift_card_catalog (id, name, brand, cost_pts, sort_order) VALUES
  ('r5', 'Xbox £10',        'xbox',      500,  1),
  ('r6', 'McDonald''s £5',  'mcdonalds', 500,  2),
  ('r1', 'Amazon £10',      'amazon',   1000,  3),
  ('r2', 'Spotify Premium', 'spotify',  1000,  4),
  ('r3', 'Netflix £10',     'netflix',  1500,  5),
  ('r4', 'Nike £10',        'nike',     1500,  6)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL   ON TABLE public.gift_card_catalog FROM PUBLIC;
GRANT  SELECT ON TABLE public.gift_card_catalog TO anon, authenticated, postgres, service_role;


-- ── 4. gift_card_redemptions ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gift_card_redemptions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id        uuid        NOT NULL REFERENCES public.children(id),
  catalog_id      text        NOT NULL REFERENCES public.gift_card_catalog(id),
  reward_name     text        NOT NULL,
  points_spent    int         NOT NULL CHECK (points_spent > 0),
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'fulfilled', 'failed')),
  fulfillment_ref text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  fulfilled_at    timestamptz
);

CREATE INDEX IF NOT EXISTS gift_card_redemptions_child_idx
  ON public.gift_card_redemptions (child_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gift_card_redemptions_pending_idx
  ON public.gift_card_redemptions (status)
  WHERE status = 'pending';

REVOKE ALL ON TABLE public.gift_card_redemptions FROM PUBLIC, anon, authenticated;
GRANT  SELECT, INSERT, UPDATE ON TABLE public.gift_card_redemptions TO postgres, service_role;


-- ── 5. _evaluate_reward_qualification ────────────────────────────────────────
--
-- Private qualification engine. Called by fund_money_request and repay_money_request
-- after the financial transaction has already committed its wallet/trust changes.
-- Never callable from the client — revoked from PUBLIC, anon, authenticated.
--
-- Returns: points awarded (0 if disqualified or duplicate call).

CREATE OR REPLACE FUNCTION public._evaluate_reward_qualification(
  p_child_id        uuid,
  p_request_id      uuid,
  p_event_type      text,   -- 'fund' | 'repay'
  p_counterparty_id uuid
) RETURNS int
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  -- Config
  v_min_amount      numeric;
  v_min_dur_h       numeric;
  v_lockout_days    numeric;
  v_max_pair_mo     numeric;
  v_max_pts_day     numeric;
  v_max_pts_mo      numeric;
  v_circ_thresh     numeric;
  v_pts_fund        int;
  v_pts_repay       int;

  -- Loan data
  v_loan_amount     numeric;
  v_loan_funded_at  timestamptz;
  v_loan_repaid_at  timestamptz;

  -- Child account age
  v_child_created   timestamptz;

  -- Evaluation state
  v_qualified       boolean := true;
  v_reasons         text[]  := '{}';
  v_risk_score      int     := 0;
  v_pts_to_award    int     := 0;

  -- Counts
  v_pair_count      bigint;
  v_day_pts         bigint;
  v_month_pts       bigint;
  v_circ_count      bigint;

  -- Insertion result
  v_row_count       bigint;
BEGIN
  -- ── 0. Idempotency guard ──────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM reward_events
    WHERE child_id        = p_child_id
      AND money_request_id = p_request_id
      AND event_type       = p_event_type
  ) THEN
    RETURN 0;
  END IF;

  -- ── 1. Load config (with safe defaults) ───────────────────────────────────
  SELECT COALESCE(value_num, 5)   INTO v_min_amount   FROM reward_config WHERE key = 'min_reward_amount_gbp';
  SELECT COALESCE(value_num, 24)  INTO v_min_dur_h    FROM reward_config WHERE key = 'min_reward_duration_hours';
  SELECT COALESCE(value_num, 7)   INTO v_lockout_days FROM reward_config WHERE key = 'new_account_lockout_days';
  SELECT COALESCE(value_num, 3)   INTO v_max_pair_mo  FROM reward_config WHERE key = 'max_same_pair_rewards_per_month';
  SELECT COALESCE(value_num, 50)  INTO v_max_pts_day  FROM reward_config WHERE key = 'max_reward_pts_day';
  SELECT COALESCE(value_num, 300) INTO v_max_pts_mo   FROM reward_config WHERE key = 'max_reward_pts_month';
  SELECT COALESCE(value_num, 3)   INTO v_circ_thresh  FROM reward_config WHERE key = 'circular_flag_threshold';
  SELECT COALESCE(value_num, 2)::int INTO v_pts_fund  FROM reward_config WHERE key = 'lender_pts_fund';
  SELECT COALESCE(value_num, 5)::int INTO v_pts_repay FROM reward_config WHERE key = 'borrower_pts_repay';

  -- Apply defaults if config row is missing entirely
  v_min_amount   := COALESCE(v_min_amount, 5);
  v_min_dur_h    := COALESCE(v_min_dur_h, 24);
  v_lockout_days := COALESCE(v_lockout_days, 7);
  v_max_pair_mo  := COALESCE(v_max_pair_mo, 3);
  v_max_pts_day  := COALESCE(v_max_pts_day, 50);
  v_max_pts_mo   := COALESCE(v_max_pts_mo, 300);
  v_circ_thresh  := COALESCE(v_circ_thresh, 3);
  v_pts_fund     := COALESCE(v_pts_fund, 2);
  v_pts_repay    := COALESCE(v_pts_repay, 5);

  -- ── 2. Load loan data ─────────────────────────────────────────────────────
  SELECT amount, funded_at, repaid_at
    INTO v_loan_amount, v_loan_funded_at, v_loan_repaid_at
    FROM money_requests
    WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- ── 3. Load child account age ─────────────────────────────────────────────
  SELECT created_at INTO v_child_created FROM children WHERE id = p_child_id;

  -- ── Rule 1: Minimum loan amount ───────────────────────────────────────────
  IF v_loan_amount < v_min_amount THEN
    v_qualified := false;
    v_reasons   := v_reasons || ARRAY['amount_below_minimum'];
  END IF;

  -- ── Rule 7: Minimum duration (borrower repay events only) ─────────────────
  IF p_event_type = 'repay'
    AND v_loan_funded_at IS NOT NULL
    AND v_loan_repaid_at IS NOT NULL
    AND EXTRACT(epoch FROM (v_loan_repaid_at - v_loan_funded_at)) / 3600.0 < v_min_dur_h
  THEN
    v_qualified := false;
    v_reasons   := v_reasons || ARRAY['duration_below_minimum'];
  END IF;

  -- ── Rule 2: Account age ───────────────────────────────────────────────────
  IF v_child_created IS NULL
    OR EXTRACT(epoch FROM (now() - v_child_created)) / 86400.0 < v_lockout_days
  THEN
    v_qualified := false;
    v_reasons   := v_reasons || ARRAY['account_too_new'];
  END IF;

  -- ── Rule 3: Same-pair monthly limit ──────────────────────────────────────
  SELECT COUNT(*) INTO v_pair_count
    FROM reward_events
    WHERE qualified = true
      AND created_at > now() - interval '30 days'
      AND (
        (child_id = p_child_id        AND counterparty_id = p_counterparty_id)
        OR
        (child_id = p_counterparty_id AND counterparty_id = p_child_id)
      );

  IF v_pair_count >= v_max_pair_mo THEN
    v_qualified := false;
    v_reasons   := v_reasons || ARRAY['same_pair_limit_reached'];
  END IF;

  -- ── Rule 4: Blocked counterparty ─────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = p_child_id        AND blocked_id = p_counterparty_id)
       OR (blocker_id = p_counterparty_id AND blocked_id = p_child_id)
  ) THEN
    v_qualified := false;
    v_reasons   := v_reasons || ARRAY['counterparty_blocked'];
  END IF;

  -- ── Rule 5: Daily cap (UTC calendar day) ─────────────────────────────────
  SELECT COALESCE(SUM(points_awarded), 0) INTO v_day_pts
    FROM reward_events
    WHERE child_id  = p_child_id
      AND qualified = true
      AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  IF v_day_pts >= v_max_pts_day THEN
    v_qualified := false;
    v_reasons   := v_reasons || ARRAY['daily_cap_reached'];
  END IF;

  -- ── Rule 6: Monthly cap (rolling 30 days) ────────────────────────────────
  SELECT COALESCE(SUM(points_awarded), 0) INTO v_month_pts
    FROM reward_events
    WHERE child_id  = p_child_id
      AND qualified = true
      AND created_at > now() - interval '30 days';

  IF v_month_pts >= v_max_pts_mo THEN
    v_qualified := false;
    v_reasons   := v_reasons || ARRAY['monthly_cap_reached'];
  END IF;

  -- ── Circular lending detection ────────────────────────────────────────────
  -- Count qualifying events where the counterparty transacted with this child
  -- (either direction) in the past 30 days.
  SELECT COUNT(*) INTO v_circ_count
    FROM reward_events
    WHERE child_id        = p_counterparty_id
      AND counterparty_id = p_child_id
      AND qualified       = true
      AND created_at      > now() - interval '30 days';

  IF v_circ_count > 0 THEN
    v_risk_score := LEAST(100, v_risk_score + 30);
    v_reasons    := v_reasons || ARRAY['circular_pair_signal'];
    IF v_circ_count >= v_circ_thresh THEN
      v_qualified := false;
      v_reasons   := v_reasons || ARRAY['circular_pair_disqualified'];
    END IF;
  END IF;

  -- ── Determine points to award ─────────────────────────────────────────────
  IF NOT v_qualified THEN
    v_pts_to_award := 0;
  ELSIF p_event_type = 'fund' THEN
    v_pts_to_award := v_pts_fund;
  ELSIF p_event_type = 'repay' THEN
    v_pts_to_award := v_pts_repay;
  END IF;

  -- ── Insert reward event (idempotent) ──────────────────────────────────────
  INSERT INTO reward_events (
    child_id, money_request_id, counterparty_id, event_type,
    points_awarded, qualified, disqualification_reasons, risk_score
  ) VALUES (
    p_child_id, p_request_id, p_counterparty_id, p_event_type,
    v_pts_to_award, v_qualified, v_reasons, v_risk_score
  )
  ON CONFLICT ON CONSTRAINT reward_events_idempotent DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  -- ── Award points only if qualified AND this is a fresh insert ────────────
  IF v_qualified AND v_row_count > 0 THEN
    UPDATE children
      SET points = points + v_pts_to_award
      WHERE id = p_child_id;
  END IF;

  RETURN CASE WHEN v_qualified AND v_row_count > 0 THEN v_pts_to_award ELSE 0 END;
END;
$$;

REVOKE ALL     ON FUNCTION public._evaluate_reward_qualification(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._evaluate_reward_qualification(uuid, uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._evaluate_reward_qualification(uuid, uuid, text, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._evaluate_reward_qualification(uuid, uuid, text, uuid) TO postgres, service_role;


-- ── 6. fund_money_request (surgical change: remove inline points, add qualification) ──
--
-- Only change from M053:
--   - Removed `points = points + 2` from the funder's UPDATE children SET
--   - Added PERFORM _evaluate_reward_qualification(..., 'fund', ...) after streak update

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
  PERFORM public.require_valid_gbp_amount(p_amount, 'funding amount');

  PERFORM require_valid_child_session(p_funder_id, p_session_token, p_device_id);

  SELECT from_id, amount INTO v_borrower_id, v_request_amount
    FROM money_requests
    WHERE id = p_request_id AND status = 'pending';
  IF v_borrower_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or already funded';
  END IF;

  IF p_funder_id = v_borrower_id THEN
    RAISE EXCEPTION 'cannot_fund_own_request';
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
    trust_score    = LEAST(100, trust_score + 2)
  WHERE id = p_funder_id;

  PERFORM _update_weekly_streak(p_funder_id);
  PERFORM _evaluate_reward_qualification(p_funder_id, p_request_id, 'fund', v_borrower_id);

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


-- ── 7. repay_money_request (surgical change: remove inline points, add qualification) ──
--
-- Only change from M061:
--   - Removed `points = points + 5` from the borrower's UPDATE children SET
--   - Added PERFORM _evaluate_reward_qualification(..., 'repay', ...) after streak update

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
  PERFORM require_valid_child_session(p_borrower_id, p_session_token, p_device_id);

  SELECT parent_id INTO v_parent_id
    FROM children WHERE id = p_borrower_id;
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'Borrower not found';
  END IF;

  PERFORM 1 FROM parents WHERE id = v_parent_id FOR UPDATE;

  SELECT wallet_balance INTO v_borrower_balance
    FROM children WHERE id = p_borrower_id FOR UPDATE;

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

  UPDATE money_requests
    SET status                              = 'repaid',
        repaid_at                           = now(),
        safety_pool_reservation_released_at = now()
    WHERE id = p_request_id;

  UPDATE children SET
    wallet_balance = wallet_balance - v_amount,
    borrowed       = GREATEST(0, borrowed - v_amount),
    repaid         = repaid         + 1,
    trust_score    = LEAST(100, trust_score + 5)
  WHERE id = p_borrower_id;

  PERFORM _update_weekly_streak(p_borrower_id);
  PERFORM _evaluate_reward_qualification(p_borrower_id, p_request_id, 'repay', v_funder_id);

  UPDATE children SET
    wallet_balance = wallet_balance + v_amount,
    loaned_out     = GREATEST(0, loaned_out - v_amount)
  WHERE id = v_funder_id;

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
            v_borrower_name || ' repaid you ' || v_amt_str, 'repaid')
    ON CONFLICT (id) DO NOTHING;

  PERFORM _trigger_notification(
    'money_repaid', v_funder_id, 'child', p_borrower_id, v_borrower_name,
    jsonb_build_object('amount', v_amount, 'request_id', p_request_id)
  );

  RETURN json_build_object('funder_id', v_funder_id, 'amount', v_amount);
END;
$$;


-- ── 8. redeem_gift_card ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.redeem_gift_card(
  p_child_id      uuid,
  p_catalog_id    text,
  p_session_token text,
  p_device_id     text
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_catalog       RECORD;
  v_child_points  int;
  v_frozen        boolean;
  v_redemption_id uuid;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  SELECT id, name, cost_pts INTO v_catalog
    FROM gift_card_catalog
    WHERE id = p_catalog_id AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog_item_not_found';
  END IF;

  SELECT points, COALESCE(account_frozen, false)
    INTO v_child_points, v_frozen
    FROM children WHERE id = p_child_id FOR UPDATE;

  IF v_frozen THEN
    RAISE EXCEPTION 'account_frozen';
  END IF;

  IF v_child_points < v_catalog.cost_pts THEN
    RAISE EXCEPTION 'insufficient_points';
  END IF;

  INSERT INTO gift_card_redemptions (child_id, catalog_id, reward_name, points_spent)
    VALUES (p_child_id, p_catalog_id, v_catalog.name, v_catalog.cost_pts)
    RETURNING id INTO v_redemption_id;

  UPDATE children
    SET points = points - v_catalog.cost_pts
    WHERE id = p_child_id;

  RETURN json_build_object(
    'redemption_id', v_redemption_id,
    'reward_name',   v_catalog.name,
    'points_spent',  v_catalog.cost_pts
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.redeem_gift_card(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_gift_card(uuid, text, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.redeem_gift_card(uuid, text, text, text) TO anon, postgres, service_role;


-- ── 9. get_gift_card_catalog ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_gift_card_catalog(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  RETURN (
    SELECT json_agg(row_to_json(c) ORDER BY c.sort_order ASC)
    FROM (
      SELECT id, name, brand, cost_pts, sort_order
      FROM gift_card_catalog
      WHERE active = true
      ORDER BY sort_order ASC
    ) c
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.get_gift_card_catalog(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_gift_card_catalog(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_gift_card_catalog(uuid, text, text) TO anon, postgres, service_role;


NOTIFY pgrst, 'reload schema';
