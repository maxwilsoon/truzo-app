-- M044: Remove legacy children.push_token — proven root cause of wrong-recipient notifications
--
-- Root cause:
--   register_child_device_token and register_device_token both write the new token to
--   children.push_token. The device_tokens table's ON CONFLICT clause (unique on
--   expo_push_token) correctly transfers token ownership when a different user registers
--   the same hardware token (e.g. parent registers after child). But children.push_token
--   is NEVER cleared for the previous owner — so Maya Wilson's row still holds Mum's
--   iOS token after Mum re-registered on the same device.
--
--   The Edge Function's legacy fallback then delivers push notifications to the wrong
--   device: a notification meant for Maya was sent to Mum's iPhone (token G085HkG]).
--   This appeared as "User X receives a notification about their own request" because
--   Mum's device also hosts the actor's account.
--
-- Fix:
--   1. NULL out children.push_token for every child (removes stale data immediately).
--   2. Remove the push_token sync from register_child_device_token and
--      register_device_token — device_tokens is the sole authoritative source.
--   3. Simplify deregister_child_device_token (no longer needs to touch push_token).
--   (Edge Function fallback removal is in the concurrent send-notification deployment.)
--
-- Rollback: 20260809_044_rollback.sql

-- ── 1. Clear all stale children.push_token data ───────────────────────────────
UPDATE public.children SET push_token = NULL WHERE push_token IS NOT NULL;

-- ── 2. register_child_device_token — remove legacy sync ──────────────────────
CREATE OR REPLACE FUNCTION public.register_child_device_token(
  p_child_id       uuid,
  p_session_token  text,
  p_device_id      text,
  p_expo_push_token text,
  p_platform       text DEFAULT NULL,
  p_app_version    text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_rows int;
BEGIN
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
  WHERE device_tokens.user_id = p_child_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'token_owned_by_another_user';
  END IF;
  -- Legacy children.push_token sync removed: device_tokens is authoritative (M044)
END;
$$;

-- ── 3. register_device_token — remove legacy sync ────────────────────────────
CREATE OR REPLACE FUNCTION public.register_device_token(
  p_user_id        uuid,
  p_user_type      text,
  p_expo_push_token text,
  p_device_id      text DEFAULT NULL,
  p_platform       text DEFAULT NULL,
  p_app_version    text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
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
  -- Legacy children.push_token sync removed: device_tokens is authoritative (M044)
END;
$$;

-- ── 4. deregister_child_device_token — remove legacy column reference ─────────
CREATE OR REPLACE FUNCTION public.deregister_child_device_token(
  p_expo_push_token text,
  p_child_id        uuid,
  p_session_token   text,
  p_device_id       text
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  UPDATE device_tokens
    SET active = false, updated_at = now()
    WHERE expo_push_token = p_expo_push_token
      AND user_id = p_child_id;
  -- Legacy children.push_token clear removed (M044)
END;
$$;
