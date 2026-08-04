-- Migration 015: Fix C1 — child login RPCs must not leak parent PII to child clients
--
-- Vulnerability confirmed (migration 009, lines 104 and 168):
--   Both login_child and biometric_login_child end with:
--     'parent', row_to_json(v_parent)
--   where v_parent is declared parents%ROWTYPE.
--
--   row_to_json() serialises EVERY column in the parents table, including:
--     passcode_hash  — SHA-256(userId:4-digit-PIN); brutable in <1 ms once extracted
--     passcode       — legacy plain-text passcode column (now NULL but column exists)
--     email          — parent's personal email address
--     mobile         — parent's UK phone number
--     address        — parent's home address
--
--   The child app (ChildLoginScreen.tsx:107) reads par.passcode_hash and stores it in
--   ParentProfile state, which is then serialised to unencrypted AsyncStorage
--   (AppContext.tsx:294 → cache.saveParent → AsyncStorage.setItem).
--   An attacker with device access can recover the 4-digit PIN in <1 ms.
--
-- Fix: replace row_to_json(v_parent) with an explicit json_build_object containing
--   only the columns the child app legitimately needs. Sensitive fields
--   (passcode_hash, passcode, email, mobile, address) are intentionally omitted.
--
-- Safe column list rationale:
--   id                  — needed so app can call setUserId / setLastParentForPasscode
--   first_name          — greeting on passcode entry screen
--   last_name           — display name composition
--   display_name        — shown in parent greeting
--   safety_pool_limit   — parent dashboard guard
--   safety_pool_used    — parent dashboard guard
--   weekly_allowance    — parent dashboard
--   allowance_frequency — parent dashboard
--   allowance_active    — parent dashboard
--   allowance_next_payment — parent dashboard
--   passcode_created    — boolean flag; tells app whether a passcode exists (no hash)
--   marketing_notifications — preference toggle visible to parent in child context
--   profile_image_url   — parent avatar
--
--   OMITTED (must never reach a child device):
--   passcode_hash, passcode, email, mobile, address, passcode_created_at,
--   marketing_preference_updated_at, profile_image_updated_at, created_at
--
-- Rollback: see 20260723_015_fix_child_login_parent_data_leak_rollback.sql

-- ── 1. Fix login_child ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.login_child(p_username text, p_password text)
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
  FROM   children
  WHERE  username      = lower(p_username)
    AND  password_hash IS NOT NULL;

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
    -- Explicit safe column list. passcode_hash, passcode, email, mobile, address
    -- are intentionally absent — they must never reach a child client device.
    'parent', json_build_object(
      'id',                    v_parent.id,
      'first_name',            v_parent.first_name,
      'last_name',             v_parent.last_name,
      'display_name',          v_parent.display_name,
      'safety_pool_limit',     v_parent.safety_pool_limit,
      'safety_pool_used',      v_parent.safety_pool_used,
      'weekly_allowance',      v_parent.weekly_allowance,
      'allowance_frequency',   v_parent.allowance_frequency,
      'allowance_active',      v_parent.allowance_active,
      'allowance_next_payment',v_parent.allowance_next_payment,
      'passcode_created',      v_parent.passcode_created,
      'marketing_notifications',v_parent.marketing_notifications,
      'profile_image_url',     v_parent.profile_image_url
    )
  );
END;
$$;

-- ── 2. Fix biometric_login_child ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.biometric_login_child(p_child_id uuid, p_device_id text)
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
  FROM   children
  WHERE  id               = p_child_id
    AND  biometric_enabled = true
    AND  last_device_id   = p_device_id;

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
    -- Same safe parent column list as login_child above.
    -- passcode_hash, passcode, email, mobile, address intentionally omitted.
    'parent', json_build_object(
      'id',                    v_parent.id,
      'first_name',            v_parent.first_name,
      'last_name',             v_parent.last_name,
      'display_name',          v_parent.display_name,
      'safety_pool_limit',     v_parent.safety_pool_limit,
      'safety_pool_used',      v_parent.safety_pool_used,
      'weekly_allowance',      v_parent.weekly_allowance,
      'allowance_frequency',   v_parent.allowance_frequency,
      'allowance_active',      v_parent.allowance_active,
      'allowance_next_payment',v_parent.allowance_next_payment,
      'passcode_created',      v_parent.passcode_created,
      'marketing_notifications',v_parent.marketing_notifications,
      'profile_image_url',     v_parent.profile_image_url
    )
  );
END;
$$;

-- Grants unchanged from migration 009.
GRANT EXECUTE ON FUNCTION public.login_child(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.biometric_login_child(uuid, text) TO anon;

NOTIFY pgrst, 'reload schema';
