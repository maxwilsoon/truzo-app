-- Migration 005: Harden child authentication — prevent cross-family login
--
-- Vulnerabilities fixed:
--
-- 1. login_child had no parent_id = auth.uid() check.  Any authenticated parent
--    could call it with another family's child credentials (username + password)
--    and receive that child's full profile, wallet balance, and parent data.
--    (The function is SECURITY DEFINER / BYPASSRLS so RLS did not protect it.)
--
-- 2. biometric_login_child had the same omission.  A stale childId from Family A
--    stored in AsyncStorage, combined with a Family B parent session, would let
--    Family B's device log in as Family A's child if biometrics were enrolled.
--
-- 3. No check_username_exists RPC.  The children.username UNIQUE constraint already
--    exists (children_username_key), but duplicate attempts surfaced as a raw
--    Postgres error rather than a user-friendly "username taken" message.
--
-- No changes to: borrowing rules, Safety Pool, Trust Score, wallet logic, RLS policies,
-- parent authentication, parent passcode, Circle permissions, Stripe.

-- ── Fix 1: Harden login_child ────────────────────────────────────────────────
-- Add AND parent_id = auth.uid() so a child can only be authenticated within
-- their own family's Supabase Auth session.
-- Remove LIMIT 1 — the UNIQUE constraint on username guarantees at most one match;
-- LIMIT 1 was misleading and masked any future ambiguity.
CREATE OR REPLACE FUNCTION public.login_child(p_username text, p_password text)
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
  WHERE  username  = lower(p_username)
    AND  password  = p_password
    AND  parent_id = auth.uid();  -- caller must be this child's parent

  IF NOT FOUND THEN
    RETURN NULL;  -- never reveal whether the username exists
  END IF;

  SELECT * INTO v_parent
  FROM   parents
  WHERE  id = v_child.parent_id;

  RETURN json_build_object(
    'child',  row_to_json(v_child),
    'parent', row_to_json(v_parent)
  );
END;
$$;

-- ── Fix 2: Harden biometric_login_child ──────────────────────────────────────
-- Add AND parent_id = auth.uid() so a cached childId from a different family
-- cannot be used to biometrically log in as the wrong child.
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
    AND  parent_id        = auth.uid()  -- caller must be this child's parent
    AND  biometric_enabled = true
    AND  last_device_id   = p_device_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE children SET last_biometric_login = now() WHERE id = p_child_id;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

  RETURN json_build_object(
    'child',  row_to_json(v_child),
    'parent', row_to_json(v_parent)
  );
END;
$$;

-- ── Fix 3: Add check_username_exists ─────────────────────────────────────────
-- Mirrors check_email_exists and check_mobile_exists.
-- Called before onboarding commit so the UI can show "username already taken"
-- without waiting for the full children INSERT to fail.
-- The UNIQUE constraint (children_username_key) is the authoritative guard against
-- race conditions; this function provides an early-exit UX improvement only.
CREATE OR REPLACE FUNCTION public.check_username_exists(p_username text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM children WHERE username = lower(trim(p_username))
  );
$$;

-- Force PostgREST to recognise the new function immediately
NOTIFY pgrst, 'reload schema';
