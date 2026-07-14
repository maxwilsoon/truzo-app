-- Rollback for Migration 006: Restore plain-text child password authentication.
--
-- !! WARNING !!
-- This rollback restores the RPCs to their migration-005 state (plain-text comparison).
-- However, children.password was set to NULL in step 6 of the forward migration.
-- After running this rollback:
--   • The old login_child RPC will look for children.password = <input>
--   • All existing children.password values are NULL → NO CHILD CAN LOG IN
--   • To restore login functionality you MUST either:
--       (a) Re-apply migration 006 (recommended), or
--       (b) Restore the database from a pre-migration-006 backup.
--
-- This rollback is safe only in the window between steps 1–5 and step 6
-- of the forward migration (i.e. before passwords were NULLed).

-- ── Restore login_child (migration 005 version — plain-text compare) ─────────

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
    AND  parent_id = auth.uid();

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;

  RETURN json_build_object(
    'child',  row_to_json(v_child),
    'parent', row_to_json(v_parent)
  );
END;
$$;

-- ── Restore biometric_login_child (migration 005 version) ────────────────────

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
    AND  parent_id        = auth.uid()
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

-- ── Drop insert_child RPC ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.insert_child(text, text, text, text, int, text);

-- ── Drop password_hash column ─────────────────────────────────────────────────
-- Only safe if migration step 6 (NULL-out) has NOT yet been run.
-- If passwords were NULLed, dropping this column also removes the hashes,
-- and a DB restore is needed.

ALTER TABLE children DROP COLUMN IF EXISTS password_hash;

NOTIFY pgrst, 'reload schema';
