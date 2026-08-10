-- M047: Fix register_child_device_token to allow token re-assignment on conflict
--
-- Root cause: ON CONFLICT ... WHERE device_tokens.user_id = p_child_id raised
-- token_owned_by_another_user when the same Expo push token existed for a
-- different user_id (e.g. after a DB reset that recreated children with new UUIDs
-- but left orphaned rows in device_tokens).  The exception was caught silently by
-- registerPushToken() on the client, so device_tokens remained empty and every
-- notification attempt returned no_tokens from the Edge Function.
--
-- Fix: allow user_id re-assignment on conflict.  The session guard
-- (require_valid_child_session) already ensures the caller is authenticated; whoever
-- presents a valid session on a device legitimately owns the push token for that device.
--
-- Also applied live on 2026-08-10 (separate node script before this file was written).
-- Rollback: 20260810_047_rollback.sql

CREATE OR REPLACE FUNCTION public.register_child_device_token(
  p_child_id        uuid,
  p_session_token   text,
  p_device_id       text,
  p_expo_push_token text,
  p_platform        text DEFAULT NULL,
  p_app_version     text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
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
    user_id     = EXCLUDED.user_id,
    user_type   = EXCLUDED.user_type,
    device_id   = COALESCE(EXCLUDED.device_id,   device_tokens.device_id),
    platform    = COALESCE(EXCLUDED.platform,    device_tokens.platform),
    app_version = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
    active      = true,
    last_seen   = now(),
    updated_at  = now();
  -- No v_rows check: any authenticated insert/update registers the token.
END;
$$;
