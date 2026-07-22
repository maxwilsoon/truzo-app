-- Migration 014: Server-side push notifications
--
-- Replaces client-side direct Expo API calls with a server-driven pipeline:
--   DB RPC  →  _trigger_notification()  →  pg_net HTTP POST  →  Edge Function  →  Expo API
--
-- SETUP REQUIRED (run once, not part of this migration):
--   1. Pick a random secret string (e.g. openssl rand -hex 32) and set it in two places:
--
--      a. In the database:
--         ALTER DATABASE postgres SET app.notification_secret = 'your-secret-here';
--
--      b. In Supabase Edge Function secrets (Dashboard → Edge Functions → Secrets, or via CLI):
--         NOTIFICATION_SECRET = same-value-as-above
--
--   2. Deploy the Edge Function (from project root):
--         supabase functions deploy send-notification --no-verify-jwt
--
-- The _trigger_notification() helper returns silently if the secret is not configured,
-- so existing functionality is unaffected until setup is complete.

-- ── 1. Enable pg_net (available but not yet installed on this project) ──────────
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 2. device_tokens table ───────────────────────────────────────────────────────
-- Supports multiple devices per parent, single-device policy for children is
-- enforced at app layer (a new registration overwrites the previous token).
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL,
  user_type       TEXT        NOT NULL CHECK (user_type IN ('child', 'parent')),
  expo_push_token TEXT        NOT NULL,
  device_id       TEXT,
  platform        TEXT,
  app_version     TEXT,
  active          BOOLEAN     NOT NULL DEFAULT true,
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX  IF NOT EXISTS device_tokens_user_idx    ON public.device_tokens(user_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS device_tokens_token_idx ON public.device_tokens(expo_push_token);

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
-- No client RLS policies needed: all access is via SECURITY DEFINER RPCs.

-- ── 3. register_device_token RPC ────────────────────────────────────────────────
-- Called after login (child or parent). Upserts on token so a reinstall or
-- token refresh updates the existing row rather than creating a duplicate.
CREATE OR REPLACE FUNCTION public.register_device_token(
  p_user_id         UUID,
  p_user_type       TEXT,
  p_expo_push_token TEXT,
  p_device_id       TEXT    DEFAULT NULL,
  p_platform        TEXT    DEFAULT NULL,
  p_app_version     TEXT    DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO device_tokens (
    user_id, user_type, expo_push_token, device_id, platform, app_version,
    active, last_seen, updated_at
  )
  VALUES (
    p_user_id, p_user_type, p_expo_push_token, p_device_id, p_platform, p_app_version,
    true, now(), now()
  )
  ON CONFLICT (expo_push_token) DO UPDATE SET
    user_id     = EXCLUDED.user_id,
    user_type   = EXCLUDED.user_type,
    device_id   = COALESCE(EXCLUDED.device_id,   device_tokens.device_id),
    platform    = COALESCE(EXCLUDED.platform,    device_tokens.platform),
    app_version = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
    active      = true,
    last_seen   = now(),
    updated_at  = now();

  -- Keep the legacy single-token column in sync for backward compatibility
  IF p_user_type = 'child' THEN
    UPDATE children SET push_token = p_expo_push_token WHERE id = p_user_id;
  END IF;
END; $$;

-- ── 4. deregister_device_token RPC ──────────────────────────────────────────────
-- Called on logout. Deactivates the token so the device no longer receives
-- notifications while logged out.
CREATE OR REPLACE FUNCTION public.deregister_device_token(
  p_expo_push_token TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE device_tokens
  SET active = false, updated_at = now()
  WHERE expo_push_token = p_expo_push_token;

  -- Clear the legacy column too
  UPDATE children SET push_token = NULL WHERE push_token = p_expo_push_token;
END; $$;

-- ── 5. _trigger_notification  (single recipient) ─────────────────────────────────
-- Internal helper called by RPCs to deliver a notification via the Edge Function.
-- Uses pg_net for fire-and-forget async HTTP — the caller's transaction is never
-- blocked and never rolled back due to a notification failure.
CREATE OR REPLACE FUNCTION public._trigger_notification(
  p_type           TEXT,
  p_recipient_id   UUID,
  p_recipient_type TEXT,
  p_sender_id      UUID,
  p_sender_name    TEXT,
  p_data           JSONB DEFAULT '{}'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  v_secret := current_setting('app.notification_secret', true);
  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN; -- Not yet configured — skip silently
  END IF;

  PERFORM net.http_post(
    url     := 'https://biilrksornvoqtalftty.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object(
      'Content-Type',          'application/json',
      'x-notification-secret', v_secret
    ),
    body := jsonb_build_object(
      'type',           p_type,
      'recipient_id',   p_recipient_id,
      'recipient_type', p_recipient_type,
      'sender_id',      p_sender_id,
      'sender_name',    p_sender_name,
      'data',           p_data
    )
  );
EXCEPTION WHEN OTHERS THEN
  -- Never propagate notification errors to the calling transaction
  NULL;
END; $$;

-- ── 6. _trigger_notification_multi  (multiple recipients) ────────────────────────
-- Used by create_money_request to notify all circle members at once.
CREATE OR REPLACE FUNCTION public._trigger_notification_multi(
  p_type           TEXT,
  p_recipient_ids  UUID[],
  p_recipient_type TEXT,
  p_sender_id      UUID,
  p_sender_name    TEXT,
  p_data           JSONB DEFAULT '{}'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  IF p_recipient_ids IS NULL OR array_length(p_recipient_ids, 1) = 0 THEN
    RETURN;
  END IF;

  v_secret := current_setting('app.notification_secret', true);
  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := 'https://biilrksornvoqtalftty.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object(
      'Content-Type',          'application/json',
      'x-notification-secret', v_secret
    ),
    body := jsonb_build_object(
      'type',            p_type,
      'recipient_ids',   to_jsonb(p_recipient_ids),
      'recipient_type',  p_recipient_type,
      'sender_id',       p_sender_id,
      'sender_name',     p_sender_name,
      'data',            p_data
    )
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END; $$;

-- ── 7. Updated RPCs ──────────────────────────────────────────────────────────────
-- Each updated RPC keeps its original return structure (backward compat) and
-- adds a _trigger_notification call after the core work succeeds.

-- send_circle_request: notify recipient that someone wants to join their circle
CREATE OR REPLACE FUNCTION public.send_circle_request(p_from_id uuid, p_to_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_to_token  text;
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

  SELECT push_token    INTO v_to_token  FROM children WHERE id = p_to_id;
  SELECT display_name  INTO v_from_name FROM children WHERE id = p_from_id;

  PERFORM _trigger_notification(
    'friend_request', p_to_id, 'child', p_from_id, v_from_name, '{}'::jsonb
  );

  RETURN json_build_object('push_token', v_to_token);
END; $$;

-- accept_circle_request: notify the original requester that they were accepted
CREATE OR REPLACE FUNCTION public.accept_circle_request(p_request_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_from_id    uuid;
  v_to_id      uuid;
  v_from_token text;
  v_to_name    text;
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

  SELECT push_token   INTO v_from_token FROM children WHERE id = v_from_id;
  SELECT display_name INTO v_to_name    FROM children WHERE id = v_to_id;

  PERFORM _trigger_notification(
    'friend_accepted', v_from_id, 'child', v_to_id, v_to_name, '{}'::jsonb
  );

  RETURN json_build_object(
    'from_id',         v_from_id,
    'to_id',           v_to_id,
    'from_push_token', v_from_token
  );
END; $$;

-- decline_circle_request: notify the requester their request was declined
CREATE OR REPLACE FUNCTION public.decline_circle_request(p_request_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_from_token text;
  v_from_id    uuid;
  v_to_id      uuid;
  v_to_name    text;
BEGIN
  UPDATE circle_requests SET status = 'declined'
  WHERE id = p_request_id
  RETURNING from_id, to_id INTO v_from_id, v_to_id;

  SELECT push_token   INTO v_from_token FROM children WHERE id = v_from_id;
  SELECT display_name INTO v_to_name    FROM children WHERE id = v_to_id;

  PERFORM _trigger_notification(
    'friend_declined', v_from_id, 'child', v_to_id, v_to_name, '{}'::jsonb
  );

  RETURN json_build_object('from_push_token', v_from_token);
END; $$;

-- create_money_request: notify all circle members who can see the request
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
  v_tokens      json;
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

  -- Collect tokens for backward compat return value
  SELECT json_agg(c.push_token) INTO v_tokens
  FROM circles ci
  JOIN children c ON c.id = ci.friend_id
  WHERE ci.child_id = p_from_id
    AND c.push_token IS NOT NULL
    AND (p_viewer_ids IS NULL OR ci.friend_id = ANY(p_viewer_ids));

  -- Collect recipient IDs for server-side notification
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

  RETURN json_build_object(
    'request_id', v_req_id,
    'push_tokens', COALESCE(v_tokens, '[]'::json)
  );
END; $$;

-- fund_money_request: notify the borrower they've been funded
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
  v_borrower_token text;
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

  SELECT push_token INTO v_borrower_token FROM children WHERE id = v_borrower_id;

  PERFORM _trigger_notification(
    'money_funded', v_borrower_id, 'child', p_funder_id, v_funder_name,
    jsonb_build_object('amount', p_amount, 'request_id', p_request_id)
  );

  RETURN json_build_object(
    'borrower_id',         v_borrower_id,
    'borrower_push_token', v_borrower_token
  );
END; $$;

-- repay_money_request: notify the lender they've been repaid
CREATE OR REPLACE FUNCTION public.repay_money_request(
  p_request_id uuid,
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
  v_funder_token     text;
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

  SELECT push_token INTO v_funder_token FROM children WHERE id = v_funder_id;

  PERFORM _trigger_notification(
    'money_repaid', v_funder_id, 'child', p_borrower_id, v_borrower_name,
    jsonb_build_object('amount', v_amount, 'request_id', p_request_id)
  );

  RETURN json_build_object(
    'funder_id',         v_funder_id,
    'funder_push_token', v_funder_token,
    'amount',            v_amount
  );
END; $$;
