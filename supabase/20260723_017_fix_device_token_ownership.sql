-- Migration 017: Fix C5 — deregister_device_token has no ownership check
--
-- Vulnerability confirmed (migration 014, lines 90-104):
--   CREATE OR REPLACE FUNCTION public.deregister_device_token(p_expo_push_token TEXT)
--   ...
--   UPDATE device_tokens SET active = false WHERE expo_push_token = p_expo_push_token;
--
--   No user_id verification. Any anonymous caller who knows a victim's Expo push
--   token can call this RPC and silence their notifications indefinitely.
--   Expo push tokens are harvested from RPC responses (H8) and are stable per device.
--
--   Additionally, register_device_token's ON CONFLICT clause sets
--   user_id = EXCLUDED.user_id, allowing any caller to re-assign a known token
--   to a different user_id, hijacking the victim's push notifications.
--
-- Fixes:
--   1. deregister_device_token: add p_user_id parameter; only deactivate when
--      the token belongs to that user_id. Caller must know both the token AND the
--      user_id that owns it — unrelated devices cannot silence each other.
--
--   2. register_device_token: change ON CONFLICT to only update the token's own
--      metadata (device_id, platform, version, last_seen) — never reassign user_id.
--      A token registered to User A cannot be stolen by a call claiming User B.
--
-- Client changes required (see notifications.ts, database.ts):
--   deregisterDeviceToken(token, userId) — pass userId alongside token.

-- ── 1. Fix deregister_device_token ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.deregister_device_token(
  p_expo_push_token TEXT,
  p_user_id         UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Only deactivate when the token belongs to the claiming user.
  -- Silently succeeds (no error) when the token doesn't exist or belongs to
  -- a different user — this prevents cross-user oracle attacks.
  UPDATE device_tokens
  SET    active = false, updated_at = now()
  WHERE  expo_push_token = p_expo_push_token
    AND  user_id         = p_user_id;

  -- Clear the legacy column only when the token+user match.
  UPDATE children
  SET    push_token = NULL
  WHERE  push_token = p_expo_push_token
    AND  id         = p_user_id;
END;
$$;

-- ── 2. Fix register_device_token ──────────────────────────────────────────────
-- Prevent token hijack: on conflict only update metadata, never reassign user_id.

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
    -- user_id intentionally NOT updated: a token cannot be reassigned to a new owner.
    -- A new registration for the same physical device generates a new Expo token anyway.
    device_id   = COALESCE(EXCLUDED.device_id,   device_tokens.device_id),
    platform    = COALESCE(EXCLUDED.platform,    device_tokens.platform),
    app_version = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
    active      = true,
    last_seen   = now(),
    updated_at  = now();

  IF p_user_type = 'child' THEN
    UPDATE children SET push_token = p_expo_push_token WHERE id = p_user_id;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
