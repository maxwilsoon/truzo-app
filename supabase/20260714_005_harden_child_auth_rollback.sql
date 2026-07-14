-- Rollback 005: Revert login_child and biometric_login_child to pre-005 state.
-- WARNING: This re-introduces the cross-family login vulnerability.
-- Use only as a temporary unblock; re-apply 005 as soon as possible.

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
  FROM children
  WHERE username = lower(p_username) AND password = p_password
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id LIMIT 1;

  RETURN json_build_object(
    'child',  row_to_json(v_child),
    'parent', row_to_json(v_parent)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.biometric_login_child(p_child_id uuid, p_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_child  children%ROWTYPE;
  v_parent parents%ROWTYPE;
BEGIN
  SELECT * INTO v_child
  FROM children
  WHERE id = p_child_id AND biometric_enabled = true AND last_device_id = p_device_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE children SET last_biometric_login = now() WHERE id = p_child_id;
  SELECT * INTO v_parent FROM parents WHERE id = v_child.parent_id;
  RETURN json_build_object('child', row_to_json(v_child), 'parent', row_to_json(v_parent));
END;
$$;

DROP FUNCTION IF EXISTS public.check_username_exists(text);

NOTIFY pgrst, 'reload schema';
