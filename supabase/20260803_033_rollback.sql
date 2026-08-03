-- Rollback migration 033: remove rate limiting.
--
-- WARNING: this restores all login and availability-check endpoints to their
-- pre-033 state — no throttling on any endpoint. Do not apply in production
-- without an immediate remediation plan.

BEGIN;

-- Remove cron job
SELECT cron.unschedule('auth-rate-limit-cleanup');

-- Restore login_child (no rate limiting)
CREATE OR REPLACE FUNCTION public.login_child(
  p_username  text,
  p_password  text,
  p_device_id text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_child     children%ROWTYPE;
  v_parent    parents%ROWTYPE;
  v_raw_token text;
  v_hash      text;
  v_expires   timestamptz := now() + interval '1 hour';
  v_abs_exp   timestamptz := now() + interval '30 days';
  c_dummy CONSTANT text :=
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
BEGIN
  IF p_device_id IS NULL OR p_device_id = '' THEN
    RAISE EXCEPTION 'device_id_required';
  END IF;

  SELECT * INTO v_child
    FROM children
    WHERE username = lower(p_username) AND password_hash IS NOT NULL;

  IF NOT FOUND THEN
    PERFORM crypt(p_password, c_dummy);
    RETURN NULL;
  END IF;

  IF crypt(p_password, v_child.password_hash) <> v_child.password_hash THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;
  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_hash      := encode(digest(v_raw_token, 'sha256'), 'hex');
  PERFORM revoke_all_child_sessions(v_child.id, 'superseded_by_new_login');
  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_child.id, v_hash, p_device_id, v_expires, v_abs_exp);

  RETURN json_build_object(
    'child', json_build_object(
      'id',                v_child.id, 'display_name', v_child.display_name,
      'username',          v_child.username, 'avatar_emoji', v_child.avatar_emoji,
      'profile_image_url', v_child.profile_image_url, 'trust_score', v_child.trust_score,
      'wallet_balance',    v_child.wallet_balance, 'loaned_out', v_child.loaned_out,
      'borrowed',          v_child.borrowed, 'streak', v_child.streak,
      'repaid',            v_child.repaid, 'missed', v_child.missed,
      'total_borrowed',    v_child.total_borrowed, 'total_lent', v_child.total_lent,
      'times_borrowed',    v_child.times_borrowed, 'times_lent', v_child.times_lent,
      'points',            v_child.points, 'age', v_child.age, 'mobile', v_child.mobile,
      'biometric_enabled', v_child.biometric_enabled, 'last_device_id', v_child.last_device_id,
      'account_frozen',    v_child.account_frozen, 'parent_debt', v_child.parent_debt
    ),
    'parent', json_build_object(
      'id', v_parent.id, 'first_name', v_parent.first_name, 'last_name', v_parent.last_name,
      'display_name', v_parent.display_name, 'safety_pool_limit', v_parent.safety_pool_limit,
      'safety_pool_used', v_parent.safety_pool_used, 'safety_pool_reserved', v_parent.safety_pool_reserved,
      'weekly_allowance', v_parent.weekly_allowance, 'allowance_frequency', v_parent.allowance_frequency,
      'allowance_active', v_parent.allowance_active, 'allowance_next_payment', v_parent.allowance_next_payment,
      'passcode_created', v_parent.passcode_created, 'marketing_notifications', v_parent.marketing_notifications,
      'profile_image_url', v_parent.profile_image_url
    ),
    'session_token', v_raw_token, 'session_expires_at', v_expires
  );
END;
$$;
REVOKE ALL ON FUNCTION public.login_child(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.login_child(text, text, text) TO anon;

-- Restore verify_parent_passcode (no rate limiting)
CREATE OR REPLACE FUNCTION public.verify_parent_passcode(
  p_parent_id uuid,
  p_pin       text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_stored_hash text;
BEGIN
  SELECT passcode_hash INTO v_stored_hash FROM parents WHERE id = p_parent_id;
  IF v_stored_hash IS NULL THEN
    RETURN false;
  END IF;
  RETURN encode(digest(p_parent_id::text || ':' || p_pin, 'sha256'), 'hex') = v_stored_hash;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_parent_passcode(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_parent_passcode(uuid, text) TO anon;
GRANT  EXECUTE ON FUNCTION public.verify_parent_passcode(uuid, text) TO authenticated;

-- Restore biometric_login_child (no rate limiting)
CREATE OR REPLACE FUNCTION public.biometric_login_child(
  p_child_id        uuid,
  p_device_id       text,
  p_biometric_token text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_child     children%ROWTYPE;
  v_parent    parents%ROWTYPE;
  v_raw_token text;
  v_hash      text;
  v_expires   timestamptz := now() + interval '1 hour';
  v_abs_exp   timestamptz := now() + interval '30 days';
BEGIN
  IF p_biometric_token IS NULL OR length(p_biometric_token) <> 64 THEN RETURN NULL; END IF;
  IF p_device_id IS NULL OR p_device_id = '' THEN RETURN NULL; END IF;

  SELECT * INTO v_child FROM children
    WHERE id = p_child_id AND biometric_enabled = true
      AND last_device_id = p_device_id
      AND biometric_token_hash = encode(digest(p_biometric_token, 'sha256'), 'hex');
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE children SET last_biometric_login = now() WHERE id = p_child_id;
  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;
  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_hash      := encode(digest(v_raw_token, 'sha256'), 'hex');
  PERFORM revoke_all_child_sessions(v_child.id, 'superseded_by_new_login');
  INSERT INTO child_sessions (child_id, token_hash, device_id, expires_at, absolute_expires_at)
    VALUES (v_child.id, v_hash, p_device_id, v_expires, v_abs_exp);

  RETURN json_build_object(
    'child', json_build_object(
      'id', v_child.id, 'display_name', v_child.display_name, 'username', v_child.username,
      'avatar_emoji', v_child.avatar_emoji, 'profile_image_url', v_child.profile_image_url,
      'trust_score', v_child.trust_score, 'wallet_balance', v_child.wallet_balance,
      'loaned_out', v_child.loaned_out, 'borrowed', v_child.borrowed, 'streak', v_child.streak,
      'repaid', v_child.repaid, 'missed', v_child.missed, 'total_borrowed', v_child.total_borrowed,
      'total_lent', v_child.total_lent, 'times_borrowed', v_child.times_borrowed,
      'times_lent', v_child.times_lent, 'points', v_child.points, 'age', v_child.age,
      'mobile', v_child.mobile, 'biometric_enabled', v_child.biometric_enabled,
      'last_device_id', v_child.last_device_id, 'account_frozen', v_child.account_frozen,
      'parent_debt', v_child.parent_debt
    ),
    'parent', json_build_object(
      'id', v_parent.id, 'first_name', v_parent.first_name, 'last_name', v_parent.last_name,
      'display_name', v_parent.display_name, 'safety_pool_limit', v_parent.safety_pool_limit,
      'safety_pool_used', v_parent.safety_pool_used, 'safety_pool_reserved', v_parent.safety_pool_reserved,
      'weekly_allowance', v_parent.weekly_allowance, 'allowance_frequency', v_parent.allowance_frequency,
      'allowance_active', v_parent.allowance_active, 'allowance_next_payment', v_parent.allowance_next_payment,
      'passcode_created', v_parent.passcode_created, 'marketing_notifications', v_parent.marketing_notifications,
      'profile_image_url', v_parent.profile_image_url
    ),
    'session_token', v_raw_token, 'session_expires_at', v_expires
  );
END;
$$;
REVOKE ALL ON FUNCTION public.biometric_login_child(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.biometric_login_child(uuid, text, text) TO anon;

-- Restore availability checks (no rate limiting)
CREATE OR REPLACE FUNCTION public.check_username_exists(p_username text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM children WHERE username = lower(trim(p_username)));
$$;
REVOKE ALL ON FUNCTION public.check_username_exists(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_username_exists(text) TO anon;
GRANT  EXECUTE ON FUNCTION public.check_username_exists(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_email_exists(p_email text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM parents WHERE email = lower(trim(p_email)));
$$;
REVOKE ALL ON FUNCTION public.check_email_exists(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_email_exists(text) TO anon;
GRANT  EXECUTE ON FUNCTION public.check_email_exists(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_mobile_exists(p_mobile text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM parents WHERE mobile = trim(p_mobile));
$$;
REVOKE ALL ON FUNCTION public.check_mobile_exists(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_mobile_exists(text) TO anon;
GRANT  EXECUTE ON FUNCTION public.check_mobile_exists(text) TO authenticated;

-- Drop helper functions
DROP FUNCTION IF EXISTS public._rl_attempt(text, text, integer, interval, interval);
DROP FUNCTION IF EXISTS public._rl_clear(text, text);
DROP FUNCTION IF EXISTS public._rl_get_ip();

-- Drop table (data loss — only applies if rolling back)
DROP TABLE IF EXISTS public.auth_rate_limits;

NOTIFY pgrst, 'reload schema';

COMMIT;
