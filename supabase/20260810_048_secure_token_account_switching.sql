-- M048: Secure push-token account switching
--
-- Replaces M047's unconditional user_id re-assignment with a guarded transfer.
-- Security model (M039 preserved):
--
--   ACTIVE   token owned by User A → User B: BLOCKED  (token_owned_by_another_user)
--   INACTIVE token (A logged out)  → User B: ALLOWED  (legitimate account switch)
--   Any      token owned by User A → User A: ALLOWED  (same-user re-register)
--
-- Logout flow sets active = false via deregister_child_device_token.
-- Only then can a different user on the same physical device claim the token.
--
-- Race safety: INSERT … ON CONFLICT DO UPDATE acquires a row-level lock on the
-- conflicting tuple before evaluating the WHERE clause, so two concurrent callers
-- competing to claim the same inactive token are serialised by the DB — only one
-- will match the WHERE and update; the other gets 0 rows → token_owned_by_another_user.

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
DECLARE
  v_rows integer;
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
    updated_at  = now()
  -- Allow claim only when:
  --   (a) same user re-registering their own token, OR
  --   (b) previous owner released the token via authenticated logout (active = false)
  WHERE device_tokens.user_id = p_child_id   -- (a) same user
     OR device_tokens.active  = false;        -- (b) released token

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- 0 rows means the conflict row is ACTIVE and owned by a different user.
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'token_owned_by_another_user';
  END IF;
END;
$$;
