-- M049: Block and Report
--
-- Creates user_blocks and user_reports tables and all associated RPCs.
-- Adds server-side block checks to: send_circle_request, fund_money_request,
-- search_children, get_pending_requests, get_active_requests,
-- _trigger_notification, _trigger_notification_multi.
--
-- Security model:
--   • All child operations are SECURITY DEFINER — block rules cannot be bypassed
--     by calling underlying RPCs directly.
--   • RLS is enabled on both new tables with no permissive client policies,
--     so direct table reads from the client return zero rows.
--   • moderation_notes in user_reports is never returned by child-facing RPCs.
--   • Blocking does NOT cancel/delete/modify existing funded loans.
--   • repay_money_request is intentionally exempt from block checks.
--
-- Notification suppression (block-aware types):
--   Suppressed when recipient has blocked sender:
--     friend_request, friend_accepted, friend_declined, money_request
--   Block-exempt (financial / own-account):
--     money_funded, money_repaid, loan_defaulted_lender, loan_defaulted_borrower,
--     parent_transfer, security_alert, login_alert, tier_unlocked,
--     points_milestone, card_purchase
--
-- Deduplication note for user_reports:
--   UNIQUE (reporter_id, reported_id, reason) prevents re-submission of the exact
--   same report. A different reason from the same reporter against the same target
--   creates a new row (separate incident). To support unrestricted re-reporting
--   in the future, drop the UNIQUE constraint and remove ON CONFLICT DO NOTHING
--   from the report_user RPC — no other code changes are needed.

-- ─── TABLES ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_blocks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid        NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  blocked_id uuid        NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK  (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS public.user_reports (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid        NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  reported_id      uuid        NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  reason           text        NOT NULL CHECK (reason IN (
                                  'harassment_bullying','spam','scam_fraud',
                                  'inappropriate_content','threatening_behaviour',
                                  'impersonation','other')),
  description      text,
  status           text        NOT NULL DEFAULT 'open' CHECK (status IN (
                                  'open','investigating','resolved','dismissed')),
  moderation_notes text,
  resolved_by      uuid        REFERENCES public.parents(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  -- Deduplication: same person + same target + same reason = duplicate.
  -- Drop this constraint (and ON CONFLICT below) to allow unrestricted re-reporting.
  UNIQUE (reporter_id, reported_id, reason),
  CHECK  (reporter_id <> reported_id)
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.user_blocks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
-- No permissive client policies: direct queries return 0 rows.
-- All access is via SECURITY DEFINER RPCs which bypass RLS.
-- Admins use the service-role key (bypasses RLS entirely).

-- ─── NEW RPCs ─────────────────────────────────────────────────────────────────

-- block_user -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_user(
  p_blocker_id  uuid,
  p_session_token text,
  p_device_id   text,
  p_blocked_id  uuid
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  PERFORM require_valid_child_session(p_blocker_id, p_session_token, p_device_id);

  IF p_blocker_id = p_blocked_id THEN
    RAISE EXCEPTION 'cannot_block_self';
  END IF;

  -- Insert block row (ON CONFLICT DO NOTHING = safe to call again if already blocked)
  INSERT INTO user_blocks (blocker_id, blocked_id)
  VALUES (p_blocker_id, p_blocked_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  -- Silently decline any pending circle requests in either direction.
  -- No notification is sent to the blocked user.
  UPDATE circle_requests
  SET status = 'declined'
  WHERE status = 'pending'
    AND ((from_id = p_blocker_id AND to_id = p_blocked_id)
      OR (from_id = p_blocked_id AND to_id = p_blocker_id));

  -- Remove active friendship if it exists.
  -- Funded loans remain visible to both parties through the from_id / funded_by
  -- conditions in get_active_requests — no financial data is hidden.
  UPDATE circles
  SET status     = 'removed',
      removed_at = now(),
      removed_by = p_blocker_id
  WHERE (child_id = p_blocker_id AND friend_id = p_blocked_id)
     OR (child_id = p_blocked_id AND friend_id = p_blocker_id);
END;
$$;

-- unblock_user ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unblock_user(
  p_blocker_id    uuid,
  p_session_token text,
  p_device_id     text,
  p_blocked_id    uuid
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  PERFORM require_valid_child_session(p_blocker_id, p_session_token, p_device_id);

  DELETE FROM user_blocks
  WHERE blocker_id = p_blocker_id AND blocked_id = p_blocked_id;
END;
$$;

-- report_user -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_user(
  p_reporter_id   uuid,
  p_session_token text,
  p_device_id     text,
  p_reported_id   uuid,
  p_reason        text,
  p_description   text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  PERFORM require_valid_child_session(p_reporter_id, p_session_token, p_device_id);

  IF p_reporter_id = p_reported_id THEN
    RAISE EXCEPTION 'cannot_report_self';
  END IF;

  IF p_reason NOT IN (
    'harassment_bullying','spam','scam_fraud','inappropriate_content',
    'threatening_behaviour','impersonation','other'
  ) THEN
    RAISE EXCEPTION 'invalid_report_reason';
  END IF;

  -- ON CONFLICT DO NOTHING: same reporter + reported + reason = duplicate.
  -- A different reason from the same reporter creates a new row (separate incident).
  INSERT INTO user_reports (reporter_id, reported_id, reason, description, status)
  VALUES (p_reporter_id, p_reported_id, p_reason, p_description, 'open')
  ON CONFLICT (reporter_id, reported_id, reason) DO NOTHING;
END;
$$;

-- get_blocked_users -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_blocked_users(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_results json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  SELECT json_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT c.id, c.display_name, c.username, c.avatar_emoji
    FROM user_blocks ub
    JOIN children c ON c.id = ub.blocked_id
    WHERE ub.blocker_id = p_child_id
    ORDER BY ub.created_at DESC
  ) r;

  RETURN COALESCE(v_results, '[]'::json);
END;
$$;

-- ─── GRANT NEW RPCs ──────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.block_user        TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.unblock_user      TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.report_user       TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_blocked_users TO authenticated, anon;

-- ─── MODIFIED RPCs (block checks inserted) ───────────────────────────────────

-- send_circle_request ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_circle_request(
  p_from_id       uuid,
  p_to_id         uuid,
  p_session_token text,
  p_device_id     text
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_from_name text;
BEGIN
  PERFORM require_valid_child_session(p_from_id, p_session_token, p_device_id);

  IF p_from_id = p_to_id THEN
    RAISE EXCEPTION 'cannot_add_self';
  END IF;

  -- M049: reject if a block exists in either direction
  IF EXISTS (
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = p_from_id AND blocked_id = p_to_id)
       OR (blocker_id = p_to_id   AND blocked_id = p_from_id)
  ) THEN
    RAISE EXCEPTION 'user_blocked';
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

  -- Remove any prior stale (non-pending) request so re-add flows work.
  DELETE FROM circle_requests WHERE from_id = p_from_id AND to_id = p_to_id;

  INSERT INTO circle_requests(from_id, to_id, status, created_at)
  VALUES (p_from_id, p_to_id, 'pending', now());

  SELECT display_name INTO v_from_name FROM children WHERE id = p_from_id;

  PERFORM _trigger_notification(
    'friend_request', p_to_id, 'child', p_from_id, v_from_name, '{}'::jsonb
  );
END;
$$;

-- fund_money_request ----------------------------------------------------------
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

  -- M049: reject if a block exists in either direction between funder and borrower
  IF EXISTS (
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = p_funder_id  AND blocked_id = v_borrower_id)
       OR (blocker_id = v_borrower_id AND blocked_id = p_funder_id)
  ) THEN
    RAISE EXCEPTION 'user_blocked';
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

  -- money_funded is block-exempt (financial obligation now established)
  PERFORM _trigger_notification(
    'money_funded', v_borrower_id, 'child', p_funder_id, v_funder_name,
    jsonb_build_object('amount', p_amount, 'request_id', p_request_id)
  );

  RETURN json_build_object('borrower_id', v_borrower_id);
END;
$$;

-- search_children -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_children(
  p_query      text,
  p_exclude_id uuid,
  p_session_token text,
  p_device_id  text
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_results json;
BEGIN
  PERFORM require_valid_child_session(p_exclude_id, p_session_token, p_device_id);
  SELECT json_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT id, display_name, username, avatar_emoji, avatar_url, trust_score
    FROM children c
    WHERE (c.id != p_exclude_id OR p_exclude_id IS NULL)
      AND (
        lower(c.username)     LIKE '%' || lower(p_query) || '%'
        OR lower(c.display_name) LIKE '%' || lower(p_query) || '%'
      )
      -- M049: exclude users with a block relationship in either direction
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_id = p_exclude_id AND ub.blocked_id = c.id)
           OR (ub.blocker_id = c.id         AND ub.blocked_id = p_exclude_id)
      )
    LIMIT 20
  ) r;
  RETURN COALESCE(v_results, '[]'::json);
END;
$$;

-- get_pending_requests --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_requests(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_results json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
  SELECT json_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT cr.id AS request_id, c.id, c.display_name, c.username,
           c.avatar_emoji, c.avatar_url, c.trust_score, cr.created_at
    FROM circle_requests cr
    JOIN children c ON c.id = cr.from_id
    WHERE cr.to_id = p_child_id
      AND cr.status = 'pending'
      -- M049: hide requests from users the recipient has blocked (or who blocked them)
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_id = p_child_id AND ub.blocked_id = cr.from_id)
           OR (ub.blocker_id = cr.from_id AND ub.blocked_id = p_child_id)
      )
    ORDER BY cr.created_at DESC
  ) r;
  RETURN COALESCE(v_results, '[]'::json);
END;
$$;

-- get_active_requests ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_requests(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
) RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_results json;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  SELECT json_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT
      mr.id, mr.from_id,
      c.display_name  AS from_name,
      c.avatar_emoji  AS from_emoji,
      c.avatar_url    AS from_url,
      c.trust_score   AS from_trust,
      mr.amount, mr.reason, mr.reason_emoji, mr.deadline_days,
      TO_CHAR(mr.repay_by_date, 'DD Mon') AS repay_by_date,
      mr.expires_at, mr.status, mr.created_at,
      (mr.from_id = p_child_id) AS is_own,
      mr.funded_by,
      fc.display_name AS funded_by_name,
      fc.avatar_emoji AS funded_by_emoji,
      fc.avatar_url   AS funded_by_url
    FROM money_requests mr
    JOIN      children c  ON c.id  = mr.from_id
    LEFT JOIN children fc ON fc.id = mr.funded_by
    WHERE
      ((mr.status = 'pending' AND mr.expires_at > now()) OR mr.status = 'funded')
      AND (
        -- Own requests: always visible (financial visibility preserved)
        mr.from_id = p_child_id
        -- Funded loans where caller is lender: always visible (financial obligation)
        OR mr.funded_by = p_child_id
        -- Circle members' pending requests: block-filtered
        OR (
          mr.status = 'pending'
          AND mr.from_id IN (SELECT friend_id FROM circles WHERE child_id = p_child_id)
          AND (mr.viewer_ids IS NULL OR p_child_id = ANY(mr.viewer_ids))
          -- M049: hide pending requests from/to blocked users
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks ub
            WHERE (ub.blocker_id = p_child_id AND ub.blocked_id = mr.from_id)
               OR (ub.blocker_id = mr.from_id AND ub.blocked_id = p_child_id)
          )
        )
      )
    ORDER BY mr.created_at DESC
  ) r;

  RETURN COALESCE(v_results, '[]'::json);
END;
$$;

-- _trigger_notification -------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trigger_notification(
  p_type           text,
  p_recipient_id   uuid,
  p_recipient_type text,
  p_sender_id      uuid,
  p_sender_name    text,
  p_data           jsonb DEFAULT '{}'::jsonb
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  -- Actor filter: never push a notification to the person who caused it.
  IF p_recipient_id = p_sender_id
     AND p_type NOT IN (
       'tier_unlocked','points_milestone','card_purchase','security_alert','login_alert'
     )
  THEN RETURN; END IF;

  -- M049: suppress social notifications when recipient has blocked the sender.
  -- Financial/security notifications (money_funded, money_repaid, loan_defaulted_*,
  -- parent_transfer, security_alert, login_alert) are exempt — they inform users
  -- about their own account and must not be hidden.
  IF p_type IN ('friend_request','friend_accepted','friend_declined','money_request') THEN
    IF EXISTS (
      SELECT 1 FROM user_blocks
      WHERE blocker_id = p_recipient_id AND blocked_id = p_sender_id
    ) THEN
      RETURN;
    END IF;
  END IF;

  SELECT value INTO v_secret
  FROM public._notification_settings
  WHERE key = 'notification_secret';

  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN;
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
      'actor_id',       p_sender_id,
      'data',           p_data
    )
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- _trigger_notification_multi -------------------------------------------------
CREATE OR REPLACE FUNCTION public._trigger_notification_multi(
  p_type           text,
  p_recipient_ids  uuid[],
  p_recipient_type text,
  p_sender_id      uuid,
  p_sender_name    text,
  p_data           jsonb DEFAULT '{}'::jsonb
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_secret          TEXT;
  v_filtered_ids    uuid[];
  v_block_filtered  uuid[];
BEGIN
  IF p_recipient_ids IS NULL OR array_length(p_recipient_ids, 1) = 0 THEN
    RETURN;
  END IF;

  -- Actor filter: strip sender from recipient list for social notifications.
  IF p_type IN (
    'tier_unlocked','points_milestone','card_purchase','security_alert','login_alert'
  ) THEN
    v_filtered_ids := p_recipient_ids;
  ELSE
    v_filtered_ids := array_remove(p_recipient_ids, p_sender_id);
  END IF;

  IF v_filtered_ids IS NULL OR array_length(v_filtered_ids, 1) = 0 THEN
    RETURN;
  END IF;

  -- M049: for social notification types, strip recipients who have blocked the sender.
  IF p_type IN ('friend_request','friend_accepted','friend_declined','money_request') THEN
    SELECT array_agg(r) INTO v_block_filtered
    FROM unnest(v_filtered_ids) AS r
    WHERE NOT EXISTS (
      SELECT 1 FROM user_blocks
      WHERE blocker_id = r AND blocked_id = p_sender_id
    );
    v_filtered_ids := COALESCE(v_block_filtered, ARRAY[]::uuid[]);
  END IF;

  IF v_filtered_ids IS NULL OR array_length(v_filtered_ids, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT value INTO v_secret
  FROM public._notification_settings
  WHERE key = 'notification_secret';

  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := 'https://biilrksornvoqtalftty.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object(
      'Content-Type',          'application/json',
      'x-notification-secret', v_secret
    ),
    body := jsonb_build_object(
      'type',            p_type,
      'recipient_ids',   to_jsonb(v_filtered_ids),
      'recipient_type',  p_recipient_type,
      'sender_id',       p_sender_id,
      'sender_name',     p_sender_name,
      'actor_id',        p_sender_id,
      'data',            p_data
    )
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
