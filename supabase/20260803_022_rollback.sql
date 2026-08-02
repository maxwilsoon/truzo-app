-- Rollback for 20260803_022_child_session_login_issuance.sql
--
-- Reversal order (run AFTER 023_rollback, BEFORE 021_rollback):
--   1. Remove biometric_token_hash column from children
--   2. Restore enable_biometric(uuid, text) — drop 3-param version
--   3. Restore disable_biometric(uuid) — remove session revocation
--   4. Restore login_child(text, text) — drop 3-param version
--   5. Restore biometric_login_child(uuid, text) — drop 3-param version
--
-- WARNING: After this rollback, biometric_login_child verifies ONLY child UUID +
-- device ID (no biometric credential). This re-opens the biometric security gap.

BEGIN;

-- ── 1. enable_biometric: restore 2-param version ────────────────────────────────────────

REVOKE ALL ON FUNCTION public.enable_biometric(uuid, text, text) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.enable_biometric(uuid, text, text);

CREATE FUNCTION public.enable_biometric(p_child_id uuid, p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE children
    SET biometric_enabled = true,
        last_device_id    = p_device_id
    WHERE id = p_child_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.enable_biometric(uuid, text) TO anon;


-- ── 2. disable_biometric: restore without session revocation ────────────────────────────

CREATE OR REPLACE FUNCTION public.disable_biometric(p_child_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE children
    SET biometric_enabled = false,
        last_device_id    = NULL
    WHERE id = p_child_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.disable_biometric(uuid) TO anon;


-- ── 3. biometric_token_hash column: remove ─────────────────────────────────────────────

ALTER TABLE children DROP COLUMN IF EXISTS biometric_token_hash;


-- ── 4. login_child: restore 2-param version ─────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.login_child(text, text, text) FROM anon;
DROP FUNCTION IF EXISTS public.login_child(text, text, text);

CREATE FUNCTION public.login_child(p_username text, p_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_child  children%ROWTYPE;
  v_parent parents%ROWTYPE;
  c_dummy CONSTANT text :=
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
BEGIN
  SELECT * INTO v_child
    FROM children
    WHERE username      = lower(p_username)
      AND password_hash IS NOT NULL;

  IF NOT FOUND THEN
    PERFORM crypt(p_password, c_dummy);
    RETURN NULL;
  END IF;

  IF crypt(p_password, v_child.password_hash) <> v_child.password_hash THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

  RETURN json_build_object(
    'child', json_build_object(
      'id',                v_child.id,
      'display_name',      v_child.display_name,
      'username',          v_child.username,
      'avatar_emoji',      v_child.avatar_emoji,
      'profile_image_url', v_child.profile_image_url,
      'trust_score',       v_child.trust_score,
      'wallet_balance',    v_child.wallet_balance,
      'loaned_out',        v_child.loaned_out,
      'borrowed',          v_child.borrowed,
      'streak',            v_child.streak,
      'repaid',            v_child.repaid,
      'missed',            v_child.missed,
      'total_borrowed',    v_child.total_borrowed,
      'total_lent',        v_child.total_lent,
      'times_borrowed',    v_child.times_borrowed,
      'times_lent',        v_child.times_lent,
      'points',            v_child.points,
      'age',               v_child.age,
      'mobile',            v_child.mobile,
      'biometric_enabled', v_child.biometric_enabled,
      'last_device_id',    v_child.last_device_id,
      'account_frozen',    v_child.account_frozen,
      'parent_debt',       v_child.parent_debt
    ),
    'parent', json_build_object(
      'id',                     v_parent.id,
      'first_name',             v_parent.first_name,
      'last_name',              v_parent.last_name,
      'display_name',           v_parent.display_name,
      'safety_pool_limit',      v_parent.safety_pool_limit,
      'safety_pool_used',       v_parent.safety_pool_used,
      'weekly_allowance',       v_parent.weekly_allowance,
      'allowance_frequency',    v_parent.allowance_frequency,
      'allowance_active',       v_parent.allowance_active,
      'allowance_next_payment', v_parent.allowance_next_payment,
      'passcode_created',       v_parent.passcode_created,
      'marketing_notifications',v_parent.marketing_notifications,
      'profile_image_url',      v_parent.profile_image_url
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.login_child(text, text) TO anon;


-- ── 5. biometric_login_child: restore 2-param version ───────────────────────────────────

REVOKE ALL ON FUNCTION public.biometric_login_child(uuid, text, text) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.biometric_login_child(uuid, text, text);

CREATE FUNCTION public.biometric_login_child(p_child_id uuid, p_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child  children%ROWTYPE;
  v_parent parents%ROWTYPE;
BEGIN
  SELECT * INTO v_child
    FROM children
    WHERE id               = p_child_id
      AND biometric_enabled = true
      AND last_device_id   = p_device_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE children SET last_biometric_login = now() WHERE id = p_child_id;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

  RETURN json_build_object(
    'child', json_build_object(
      'id',                v_child.id,
      'display_name',      v_child.display_name,
      'username',          v_child.username,
      'avatar_emoji',      v_child.avatar_emoji,
      'profile_image_url', v_child.profile_image_url,
      'trust_score',       v_child.trust_score,
      'wallet_balance',    v_child.wallet_balance,
      'loaned_out',        v_child.loaned_out,
      'borrowed',          v_child.borrowed,
      'streak',            v_child.streak,
      'repaid',            v_child.repaid,
      'missed',            v_child.missed,
      'total_borrowed',    v_child.total_borrowed,
      'total_lent',        v_child.total_lent,
      'times_borrowed',    v_child.times_borrowed,
      'times_lent',        v_child.times_lent,
      'points',            v_child.points,
      'age',               v_child.age,
      'mobile',            v_child.mobile,
      'biometric_enabled', v_child.biometric_enabled,
      'last_device_id',    v_child.last_device_id,
      'account_frozen',    v_child.account_frozen,
      'parent_debt',       v_child.parent_debt
    ),
    'parent', json_build_object(
      'id',                     v_parent.id,
      'first_name',             v_parent.first_name,
      'last_name',              v_parent.last_name,
      'display_name',           v_parent.display_name,
      'safety_pool_limit',      v_parent.safety_pool_limit,
      'safety_pool_used',       v_parent.safety_pool_used,
      'weekly_allowance',       v_parent.weekly_allowance,
      'allowance_frequency',    v_parent.allowance_frequency,
      'allowance_active',       v_parent.allowance_active,
      'allowance_next_payment', v_parent.allowance_next_payment,
      'passcode_created',       v_parent.passcode_created,
      'marketing_notifications',v_parent.marketing_notifications,
      'profile_image_url',      v_parent.profile_image_url
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.biometric_login_child(uuid, text) TO anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
