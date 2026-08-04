-- Migration 039: Final grant cleanup, device-token ownership, parent auth guards,
--               allowance/marketing authorization, internal helper lockdown.
--
-- Concurrency model for device tokens:
--   INSERT ... ON CONFLICT (expo_push_token) DO UPDATE acquires a row-level lock on
--   the conflicting row before evaluating the DO UPDATE clause. The WHERE filter
--   (device_tokens.user_id = caller_id) is evaluated atomically under that lock.
--   GET DIAGNOSTICS detects zero-row updates (= ownership mismatch) and raises
--   token_owned_by_another_user. No window exists where two concurrent transactions
--   can both succeed for the same token with different user_ids.
--
-- Serialization guarantee:
--   Provided by: ON CONFLICT row-lock + WHERE ownership filter + GET DIAGNOSTICS check.
--   There is no path where concurrent transactions can transfer token ownership.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Device token RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a. register_parent_device_token
--     Caller identity derived from auth.uid() — no trusted p_user_id parameter.
--     Token ownership is immutable: ON CONFLICT never updates user_id.
DROP FUNCTION IF EXISTS public.register_parent_device_token(text, text, text, text);
CREATE OR REPLACE FUNCTION public.register_parent_device_token(
  p_expo_push_token text,
  p_device_id       text DEFAULT NULL,
  p_platform        text DEFAULT NULL,
  p_app_version     text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_parent_id uuid := auth.uid();
  v_rows      int;
BEGIN
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_expo_push_token IS NULL OR length(trim(p_expo_push_token)) = 0 THEN
    RAISE EXCEPTION 'invalid_push_token';
  END IF;

  INSERT INTO device_tokens (
    user_id, user_type, expo_push_token, device_id, platform, app_version,
    active, last_seen, updated_at
  ) VALUES (
    v_parent_id, 'parent', p_expo_push_token,
    p_device_id, p_platform, p_app_version,
    true, now(), now()
  )
  ON CONFLICT (expo_push_token) DO UPDATE SET
    -- user_id intentionally omitted — ownership is immutable after first registration
    device_id   = COALESCE(EXCLUDED.device_id,   device_tokens.device_id),
    platform    = COALESCE(EXCLUDED.platform,    device_tokens.platform),
    app_version = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
    active      = true,
    last_seen   = now(),
    updated_at  = now()
  WHERE device_tokens.user_id = v_parent_id;   -- ownership filter (atomic with lock)

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- The token exists but the WHERE filter rejected the update → owned by another user
    RAISE EXCEPTION 'token_owned_by_another_user';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.register_parent_device_token(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_parent_device_token(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_parent_device_token(text, text, text, text)
  TO authenticated, postgres, service_role;

-- 1b. register_child_device_token
--     Requires valid child session before any write. Ownership immutable.
DROP FUNCTION IF EXISTS public.register_child_device_token(uuid, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.register_child_device_token(
  p_child_id        uuid,
  p_session_token   text,
  p_device_id       text,
  p_expo_push_token text,
  p_platform        text DEFAULT NULL,
  p_app_version     text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_rows int;
BEGIN
  -- Session validation is the first gate — before any DB write
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  IF p_expo_push_token IS NULL OR length(trim(p_expo_push_token)) = 0 THEN
    RAISE EXCEPTION 'invalid_push_token';
  END IF;

  INSERT INTO device_tokens (
    user_id, user_type, expo_push_token, device_id, platform, app_version,
    active, last_seen, updated_at
  ) VALUES (
    p_child_id, 'child', p_expo_push_token,
    p_device_id, p_platform, p_app_version,
    true, now(), now()
  )
  ON CONFLICT (expo_push_token) DO UPDATE SET
    device_id   = COALESCE(EXCLUDED.device_id,   device_tokens.device_id),
    platform    = COALESCE(EXCLUDED.platform,    device_tokens.platform),
    app_version = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
    active      = true,
    last_seen   = now(),
    updated_at  = now()
  WHERE device_tokens.user_id = p_child_id;   -- ownership filter (atomic with lock)

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'token_owned_by_another_user';
  END IF;

  -- Keep legacy children.push_token in sync for notification delivery
  UPDATE children SET push_token = p_expo_push_token WHERE id = p_child_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_child_device_token(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_child_device_token(uuid, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.register_child_device_token(uuid, text, text, text, text, text)
  TO anon, postgres, service_role;

-- 1c. deregister_parent_device_token
--     Ownership verified via auth.uid() — no caller-supplied user_id accepted.
DROP FUNCTION IF EXISTS public.deregister_parent_device_token(text);
CREATE OR REPLACE FUNCTION public.deregister_parent_device_token(
  p_expo_push_token text
) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_parent_id uuid := auth.uid();
BEGIN
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  UPDATE device_tokens
    SET active = false, updated_at = now()
    WHERE expo_push_token = p_expo_push_token
      AND user_id = v_parent_id;   -- owner must match JWT identity
END;
$$;
REVOKE ALL ON FUNCTION public.deregister_parent_device_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deregister_parent_device_token(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.deregister_parent_device_token(text)
  TO authenticated, postgres, service_role;

-- 1d. deregister_child_device_token
--     Requires valid child session before any write.
--     Ownership verified: WHERE user_id = p_child_id (double-checked by session validation).
DROP FUNCTION IF EXISTS public.deregister_child_device_token(text, uuid, text, text);
CREATE OR REPLACE FUNCTION public.deregister_child_device_token(
  p_expo_push_token text,
  p_child_id        uuid,
  p_session_token   text,
  p_device_id       text
) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  UPDATE device_tokens
    SET active = false, updated_at = now()
    WHERE expo_push_token = p_expo_push_token
      AND user_id = p_child_id;

  -- Clear legacy column only if this child owns it
  UPDATE children
    SET push_token = NULL
    WHERE id = p_child_id
      AND push_token = p_expo_push_token;
END;
$$;
REVOKE ALL ON FUNCTION public.deregister_child_device_token(text, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deregister_child_device_token(text, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.deregister_child_device_token(text, uuid, text, text)
  TO anon, postgres, service_role;

-- 1e. Lock old register_device_token to service/internal only (remove anon)
REVOKE EXECUTE ON FUNCTION
  public.register_device_token(uuid, text, text, text, text, text) FROM anon;

-- 1f. Drop the single-parameter deregister overload entirely — not restored by rollback
DROP FUNCTION IF EXISTS public.deregister_device_token(text);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — insert_child: explicit defensive REVOKE (body already correct)
-- ═══════════════════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION
  public.insert_child(text, text, text, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.insert_child(text, text, text, text, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION
  public.insert_child(text, text, text, text, integer, text)
  TO authenticated, postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 — set_allowance_schedule: add auth.uid() guard + GBP validation
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_allowance_schedule(
  p_parent_id uuid,
  p_amount    numeric,
  p_day       integer,
  p_time      text,
  p_frequency text    DEFAULT 'weekly',
  p_active    boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer;
  v_next timestamptz;
BEGIN
  -- Caller must be the parent being modified
  IF auth.uid() IS NULL OR auth.uid() <> p_parent_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  PERFORM public.require_valid_gbp_amount(p_amount, 'allowance amount');

  v_days := ((p_day - EXTRACT(DOW FROM NOW())::integer) + 7) % 7;
  IF v_days = 0 THEN v_days := 7; END IF;
  v_next := date_trunc('day', NOW())
    + (v_days || ' days')::interval
    + p_time::TIME WITHOUT TIME ZONE;

  UPDATE parents SET
    weekly_allowance      = p_amount,
    allowance_day         = p_day,
    allowance_time        = p_time,
    allowance_frequency   = p_frequency,
    allowance_next_payment = v_next,
    allowance_active      = p_active
  WHERE id = p_parent_id;
END;
$$;
REVOKE ALL ON FUNCTION
  public.set_allowance_schedule(uuid, numeric, integer, text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.set_allowance_schedule(uuid, numeric, integer, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION
  public.set_allowance_schedule(uuid, numeric, integer, text, text, boolean)
  TO authenticated, postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4 — update_marketing_preference: add auth.uid() guard + search_path
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_marketing_preference(
  p_parent_id uuid,
  p_enabled   boolean
) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_parent_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE parents SET
    marketing_notifications         = p_enabled,
    marketing_preference_updated_at = NOW()
  WHERE id = p_parent_id;
END;
$$;
REVOKE ALL ON FUNCTION public.update_marketing_preference(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_marketing_preference(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_marketing_preference(uuid, boolean)
  TO authenticated, postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5 — update_profile_image: replace 2-param with session-validated 4-param
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.update_profile_image(uuid, text);
CREATE OR REPLACE FUNCTION public.update_profile_image(
  p_child_id      uuid,
  p_image_url     text,
  p_session_token text,
  p_device_id     text
) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);
  UPDATE children SET
    avatar_url       = p_image_url,
    profile_image_url = p_image_url
  WHERE id = p_child_id;
END;
$$;
REVOKE ALL ON FUNCTION public.update_profile_image(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_profile_image(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_profile_image(uuid, text, text, text)
  TO anon, postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 6 — update_parent_avatar: add auth.uid() guard
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_parent_avatar(
  p_parent_id  uuid,
  p_avatar_url text
) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_parent_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE parents SET
    profile_image_url        = p_avatar_url,
    profile_image_updated_at = CASE WHEN p_avatar_url IS NOT NULL THEN NOW()
                                    ELSE profile_image_updated_at END
  WHERE id = p_parent_id;
END;
$$;
REVOKE ALL ON FUNCTION public.update_parent_avatar(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_parent_avatar(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_parent_avatar(uuid, text)
  TO authenticated, postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 7 — get_child_activity_for_parent: add auth.uid() guard
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_child_activity_for_parent(
  p_parent_id uuid,
  p_limit     integer DEFAULT 20
) RETURNS json LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_child_id uuid;
  v_result   json;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_parent_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT id INTO v_child_id FROM children WHERE parent_id = p_parent_id;
  IF v_child_id IS NULL THEN RETURN '[]'::json; END IF;
  SELECT json_agg(row_to_json(r)) INTO v_result
    FROM (SELECT id, emoji, text, type, created_at
          FROM activity_feed WHERE child_id = v_child_id
          ORDER BY created_at DESC LIMIT p_limit) r;
  RETURN COALESCE(v_result, '[]'::json);
END;
$$;
REVOKE ALL ON FUNCTION public.get_child_activity_for_parent(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_child_activity_for_parent(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_child_activity_for_parent(uuid, integer)
  TO authenticated, postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 8 — get_child_stats_for_parent: add auth.uid() guard
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_child_stats_for_parent(
  p_parent_id uuid
) RETURNS json LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result json;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_parent_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT json_build_object(
    'wallet_balance', wallet_balance, 'loaned_out',  loaned_out,
    'borrowed',       borrowed,       'trust_score', trust_score,
    'points',         points,         'streak',      streak,
    'repaid',         repaid,         'missed',      missed,
    'total_borrowed', total_borrowed, 'total_lent',  total_lent,
    'times_borrowed', times_borrowed, 'times_lent',  times_lent
  ) INTO v_result FROM children WHERE parent_id = p_parent_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_child_stats_for_parent(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_child_stats_for_parent(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_child_stats_for_parent(uuid)
  TO authenticated, postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 9 — accept_circle_request: add _update_weekly_streak for acceptor
--             (client's explicit recordWeeklyStreak call on accept becomes a no-op
--              since record_weekly_streak is locked to service_role in Section 13)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.accept_circle_request(
  p_request_id      uuid,
  p_acting_child_id uuid,
  p_session_token   text,
  p_device_id       text
) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_from_id uuid;
  v_to_id   uuid;
  v_status  text;
  v_to_name text;
BEGIN
  SELECT from_id, to_id, status
    INTO v_from_id, v_to_id, v_status
    FROM circle_requests WHERE id = p_request_id FOR UPDATE;

  IF v_from_id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF p_acting_child_id <> v_to_id THEN RAISE EXCEPTION 'not_authorized'; END IF;

  PERFORM require_valid_child_session(v_to_id, p_session_token, p_device_id);

  UPDATE circle_requests SET status = 'accepted' WHERE id = p_request_id;

  INSERT INTO circles(child_id, friend_id, status) VALUES (v_from_id, v_to_id, 'active')
    ON CONFLICT (child_id, friend_id) DO UPDATE
      SET status = 'active', removed_at = NULL, removed_by = NULL;
  INSERT INTO circles(child_id, friend_id, status) VALUES (v_to_id, v_from_id, 'active')
    ON CONFLICT (child_id, friend_id) DO UPDATE
      SET status = 'active', removed_at = NULL, removed_by = NULL;

  -- Update streak for the acceptor (server-side; client's recordWeeklyStreak no-ops)
  PERFORM _update_weekly_streak(v_to_id);

  SELECT display_name INTO v_to_name FROM children WHERE id = v_to_id;
  PERFORM _trigger_notification('friend_accepted', v_from_id, 'child', v_to_id, v_to_name, '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_circle_request(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_circle_request(uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.accept_circle_request(uuid, uuid, text, text)
  TO anon, postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 10 — get_child_stats: embed streak expiry logic
--              (client's checkStreakExpiry call becomes a harmless no-op since
--               check_streak_expiry is locked to service_role in Section 13)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_child_stats(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
) RETURNS json LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_result     json;
  v_streak     int;
  v_last_week  date;
  v_curr_week  date := date_trunc('week', now())::date;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  -- Expire streak to 0 if the child missed an entire ISO week with no qualifying activity
  SELECT streak, last_active_week INTO v_streak, v_last_week
    FROM children WHERE id = p_child_id;
  IF COALESCE(v_streak, 0) > 0
     AND (v_last_week IS NULL
          OR v_last_week < (v_curr_week - interval '7 days')::date) THEN
    UPDATE children SET streak = 0 WHERE id = p_child_id;
  END IF;

  SELECT json_build_object(
    'wallet_balance',     wallet_balance,
    'loaned_out',         loaned_out,
    'borrowed',           borrowed,
    'trust_score',        trust_score,
    'points',             points,
    'streak',             streak,
    'repaid',             repaid,
    'missed',             missed,
    'total_borrowed',     total_borrowed,
    'total_lent',         total_lent,
    'times_borrowed',     times_borrowed,
    'times_lent',         times_lent,
    'profile_image_url',  COALESCE(profile_image_url, avatar_url),
    'account_frozen',     COALESCE(account_frozen, false),
    'parent_debt',        COALESCE(parent_debt, 0)
  ) INTO v_result FROM children WHERE id = p_child_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_child_stats(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_child_stats(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_child_stats(uuid, text, text)
  TO anon, postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 11 — Financial RPCs: remove PUBLIC and authenticated grants
-- ═══════════════════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION public.revoke_child_session(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_child_session(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_child_session(text) TO anon, postgres, service_role;

REVOKE ALL ON FUNCTION
  public.create_money_request(uuid,numeric,integer,text,text,text,text,uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.create_money_request(uuid,numeric,integer,text,text,text,text,uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION
  public.create_money_request(uuid,numeric,integer,text,text,text,text,uuid[])
  TO anon, postgres, service_role;

REVOKE ALL ON FUNCTION
  public.fund_money_request(uuid,uuid,numeric,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.fund_money_request(uuid,uuid,numeric,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION
  public.fund_money_request(uuid,uuid,numeric,text,text) TO anon, postgres, service_role;

REVOKE ALL ON FUNCTION
  public.repay_money_request(uuid,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.repay_money_request(uuid,uuid,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION
  public.repay_money_request(uuid,uuid,text,text) TO anon, postgres, service_role;

REVOKE ALL ON FUNCTION
  public.cancel_money_request(uuid,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.cancel_money_request(uuid,uuid,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION
  public.cancel_money_request(uuid,uuid,text,text) TO anon, postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 12 — Internal helpers: re-assert service_role only (defense in depth)
-- ═══════════════════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION
  public.persist_transaction(uuid,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.persist_transaction(uuid,text,numeric,text,text) TO postgres, service_role;

REVOKE ALL ON FUNCTION
  public.add_activity_item(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.add_activity_item(uuid,text,text,text,text) TO postgres, service_role;

REVOKE ALL ON FUNCTION
  public._trigger_notification(text,uuid,text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public._trigger_notification(text,uuid,text,uuid,text,jsonb) TO postgres, service_role;

REVOKE ALL ON FUNCTION
  public._trigger_notification_multi(text,uuid[],text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public._trigger_notification_multi(text,uuid[],text,uuid,text,jsonb) TO postgres, service_role;

REVOKE ALL ON FUNCTION
  public._update_weekly_streak(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public._update_weekly_streak(uuid) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.process_due_allowances() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_allowances() TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 13 — Discovered PUBLIC grants: lock all down
-- ═══════════════════════════════════════════════════════════════════════════

-- add_to_circle — superseded by M038 send/accept RPCs
REVOKE ALL ON FUNCTION public.add_to_circle(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_to_circle(uuid, uuid) TO postgres, service_role;

-- check_streak_expiry — logic now embedded in get_child_stats
REVOKE ALL ON FUNCTION public.check_streak_expiry(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_streak_expiry(uuid) TO postgres, service_role;

-- record_weekly_streak — streak updated server-side in accept_circle_request + financial RPCs
REVOKE ALL ON FUNCTION public.record_weekly_streak(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_weekly_streak(uuid) TO postgres, service_role;

-- disable_child_biometric — replaced by disable_biometric (session-protected)
REVOKE ALL ON FUNCTION public.disable_child_biometric(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disable_child_biometric(uuid) TO postgres, service_role;

-- enable_child_biometric — replaced by enable_biometric (session-protected)
REVOKE ALL ON FUNCTION public.enable_child_biometric(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enable_child_biometric(uuid, text) TO postgres, service_role;

-- save_push_token — replaced by register_child_device_token
REVOKE ALL ON FUNCTION public.save_push_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_push_token(uuid, text) TO postgres, service_role;

-- save_onboarding_data — legacy, stores plaintext password, unused by current client
REVOKE ALL ON FUNCTION public.save_onboarding_data(
  uuid,text,text,text,text,numeric,numeric,text,text,text,text,integer,text,
  integer,numeric,numeric,numeric,integer,integer,integer,numeric,numeric,integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_onboarding_data(
  uuid,text,text,text,text,numeric,numeric,text,text,text,text,integer,text,
  integer,numeric,numeric,numeric,integer,integer,integer,numeric,numeric,integer
) TO postgres, service_role;

-- update_child_avatar — client uses update_profile_image instead
REVOKE ALL ON FUNCTION public.update_child_avatar(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_child_avatar(uuid, text) TO postgres, service_role;

-- Trigger functions — PUBLIC grant is harmless for triggers but clean it up anyway
REVOKE ALL ON FUNCTION public.delete_auth_user_on_parent_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_auth_user_on_parent_delete() TO postgres, service_role;

REVOKE ALL ON FUNCTION public.fn_delete_auth_user_on_parent_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_delete_auth_user_on_parent_delete() TO postgres, service_role;

-- Event trigger — same rationale
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

COMMIT;
