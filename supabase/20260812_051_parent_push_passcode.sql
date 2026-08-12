-- M051: register_parent_push_token_passcode
--
-- Root cause of "permission denied for function register_parent_device_token":
--   register_parent_device_token uses auth.uid() and is granted only to the
--   'authenticated' role.  When a returning parent logs in via their 6-digit PIN
--   after an app restart, the Supabase Auth JWT is gone (persistSession:false;
--   in-memory storage only).  PostgREST treats the request as 'anon', which has
--   no EXECUTE grant → 42501 permission denied, before the function body runs.
--
-- Fix: a new SECURITY DEFINER RPC that combines bcrypt PIN verification with
-- push-token registration in one atomic operation.  The PIN proves identity
-- without requiring a Supabase Auth session.  Granted to 'anon' and 'authenticated'
-- so it works on cold launch (no session) and post-email-login alike.
--
-- The original register_parent_device_token is unchanged and remains the preferred
-- path in the email-login flow (session exists, auth.uid() resolves).
--
-- Rate limiting: shares the same 'rl_parent_passcode' bucket as verify_parent_passcode
-- so alternating between the two RPCs cannot double the attempt quota.

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
BEGIN
  -- 1. Rate-limit — same bucket as verify_parent_passcode.
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

  -- 4. Format guard — same rules as verify_parent_passcode.
  --    All failure modes (unknown UUID, no passcode, wrong PIN) return false.
  IF v_stored_hash IS NULL
     OR v_stored_hash !~ '^\$2[aby]\$[0-9]{2}\$'
     OR length(v_stored_hash) <> 60 THEN
    RETURN false;
  END IF;

  -- 5. bcrypt comparison — only reached when a valid stored hash exists.
  IF crypt(p_pin, v_stored_hash) <> v_stored_hash THEN
    RETURN false;
  END IF;

  -- 6. PIN correct — clear rate-limit bucket and register push token.
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
    user_id     = p_parent_id,
    platform    = COALESCE(EXCLUDED.platform,    device_tokens.platform),
    app_version = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
    active      = true,
    last_seen   = now(),
    updated_at  = now();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.register_parent_push_token_passcode(uuid, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.register_parent_push_token_passcode(uuid, text, text, text, text)
  TO anon, authenticated, postgres, service_role;
