-- M052: Fix register_parent_push_token_passcode ON CONFLICT ownership bug
--
-- Bug in M051: the ON CONFLICT UPDATE set `user_id = p_parent_id` unconditionally,
-- which means a parent's PIN login would silently steal any existing token — including
-- the child's — and change its user_id and user_type to the parent's.  In practice
-- this happened when a parent did a PIN login on the same physical device as the child.
--
-- Fix: mirror the pattern used by register_parent_device_token and
-- register_child_device_token:
--   • Drop `user_id` and `user_type` from the UPDATE SET (ownership is immutable).
--   • Add `WHERE device_tokens.user_id = p_parent_id` so the update only fires
--     when this parent already owns the token.
--   • If the token belongs to another user (v_rows = 0), swallow silently — the PIN
--     is still correct, so we return true.  The caller treats push registration as
--     best-effort; failing to register the token must not block login.

CREATE OR REPLACE FUNCTION public.register_parent_push_token_passcode(
  p_parent_id       uuid,
  p_pin             text,
  p_expo_push_token text,
  p_platform        text DEFAULT NULL,
  p_app_version     text DEFAULT NULL
) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions
AS $$
DECLARE
  v_stored_hash text;
  v_allowed     boolean;
  v_rows        int;
BEGIN
  -- 1. Rate-limit — shared bucket with verify_parent_passcode.
  v_allowed := _rl_attempt(
    'rl_parent_passcode', p_parent_id::text,
    5, interval '5 minutes', interval '5 minutes'
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  -- 2. Validate push-token format early (before bcrypt work).
  IF p_expo_push_token IS NULL OR length(trim(p_expo_push_token)) = 0 THEN
    RAISE EXCEPTION 'invalid_push_token';
  END IF;

  -- 3. Fetch stored bcrypt hash.
  SELECT passcode_hash INTO v_stored_hash FROM public.parents WHERE id = p_parent_id;

  -- 4. Format guard — all failure modes (unknown UUID, no passcode, wrong PIN) return false.
  IF v_stored_hash IS NULL
     OR v_stored_hash !~ '^\$2[aby]\$[0-9]{2}\$'
     OR length(v_stored_hash) <> 60 THEN
    RETURN false;
  END IF;

  -- 5. bcrypt comparison.
  IF crypt(p_pin, v_stored_hash) <> v_stored_hash THEN
    RETURN false;
  END IF;

  -- 6. PIN correct — clear rate-limit bucket then register push token.
  PERFORM _rl_clear('rl_parent_passcode', p_parent_id::text);

  INSERT INTO device_tokens (
    user_id, user_type, expo_push_token, device_id, platform, app_version,
    active, last_seen, updated_at
  ) VALUES (
    p_parent_id, 'parent', p_expo_push_token,
    NULL, p_platform, p_app_version,
    true, now(), now()
  )
  ON CONFLICT (expo_push_token) DO UPDATE SET
    -- user_id and user_type intentionally omitted: ownership is immutable.
    platform    = COALESCE(EXCLUDED.platform,    device_tokens.platform),
    app_version = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
    active      = true,
    last_seen   = now(),
    updated_at  = now()
  WHERE device_tokens.user_id = p_parent_id;  -- ownership guard (mirrors M039)

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- v_rows = 0 means the token exists but is owned by another user.
  -- Push registration silently skipped; PIN was correct so we still return true.

  RETURN true;
END;
$$;

-- Grants unchanged from M051.
REVOKE ALL ON FUNCTION public.register_parent_push_token_passcode(uuid, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.register_parent_push_token_passcode(uuid, text, text, text, text)
  TO anon, authenticated, postgres, service_role;

NOTIFY pgrst, 'reload schema';
