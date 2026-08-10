-- M044 rollback: restore legacy children.push_token sync in registration functions.
-- Note: children.push_token data that was NULLed cannot be automatically restored;
-- tokens will repopulate when children next log in.

-- Restore register_child_device_token with legacy sync
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

  UPDATE children SET push_token = p_expo_push_token WHERE id = p_child_id;
END;
$$;

-- Restore register_device_token with legacy sync
CREATE OR REPLACE FUNCTION public.register_device_token(
  p_user_id         uuid,
  p_user_type       text,
  p_expo_push_token text,
  p_device_id       text DEFAULT NULL,
  p_platform        text DEFAULT NULL,
  p_app_version     text DEFAULT NULL
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

  IF p_user_type = 'child' THEN
    UPDATE children SET push_token = p_expo_push_token WHERE id = p_user_id;
  END IF;
END;
$$;

-- Restore deregister_child_device_token with legacy column clear
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

  UPDATE children
    SET push_token = NULL
    WHERE id = p_child_id
      AND push_token = p_expo_push_token;
END;
$$;
