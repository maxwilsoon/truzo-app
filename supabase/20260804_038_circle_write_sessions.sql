-- Migration 038: Session enforcement + push-token removal for Circle write RPCs.
--
-- Problems fixed:
--   send_circle_request   — leaked recipient push_token to caller; no session check.
--   accept_circle_request — no actor check; no status='pending' guard; leaked from_push_token.
--   decline_circle_request— no actor check; no status='pending' guard; leaked from_push_token.
--   cancel_circle_request — no session check; no SET search_path.
--   remove_from_circle    — no session check; no SET search_path.
--
-- New signatures add (p_session_token text, p_device_id text).
-- accept/decline also add (p_acting_child_id uuid) so the caller's identity is
-- verified against the request's to_id before any session or data check.
--
-- Push-token removal: functions no longer SELECT, expose or return any push_token
-- field. Notification delivery remains server-side via _trigger_notification.
--
-- Grant matrix for all 5 new signatures:
--   anon, postgres, service_role — EXECUTE GRANTED
--   PUBLIC, authenticated        — REVOKED
--
-- SET search_path = public, pg_catalog on every function.
-- SECURITY DEFINER throughout.
--
-- Rollback: supabase/20260804_038_rollback.sql (fail-closed: DROPs only — old
-- unprotected signatures are NOT restored; features become temporarily unavailable).

BEGIN;

-- ─── 1. send_circle_request ───────────────────────────────────────────────────
-- Old: (uuid, uuid) — no session, returned push_token.
-- New: session validated for p_from_id; RETURNS void.

DROP FUNCTION IF EXISTS public.send_circle_request(uuid, uuid);

CREATE OR REPLACE FUNCTION public.send_circle_request(
  p_from_id       uuid,
  p_to_id         uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_from_name text;
BEGIN
  PERFORM require_valid_child_session(p_from_id, p_session_token, p_device_id);

  IF p_from_id = p_to_id THEN
    RAISE EXCEPTION 'cannot_add_self';
  END IF;

  IF EXISTS (
    SELECT 1 FROM circles
    WHERE status = 'active'
      AND ((child_id = p_from_id AND friend_id = p_to_id)
        OR (child_id = p_to_id   AND friend_id = p_from_id))
  ) THEN
    RAISE EXCEPTION 'already_friends';
  END IF;

  IF EXISTS (
    SELECT 1 FROM circle_requests
    WHERE status = 'pending'
      AND ((from_id = p_from_id AND to_id = p_to_id)
        OR (from_id = p_to_id   AND to_id = p_from_id))
  ) THEN
    RAISE EXCEPTION 'already_pending';
  END IF;

  -- Remove any prior stale (non-pending) request so re-add flows work.
  DELETE FROM circle_requests WHERE from_id = p_from_id AND to_id = p_to_id;

  INSERT INTO circle_requests(from_id, to_id, status, created_at)
  VALUES (p_from_id, p_to_id, 'pending', now());

  SELECT display_name INTO v_from_name FROM children WHERE id = p_from_id;

  PERFORM _trigger_notification(
    'friend_request', p_to_id, 'child', p_from_id, v_from_name, '{}'::jsonb
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.send_circle_request(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_circle_request(uuid, uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.send_circle_request(uuid, uuid, text, text) TO anon, postgres, service_role;


-- ─── 2. accept_circle_request ────────────────────────────────────────────────
-- Old: (uuid) — no actor check, no status guard, leaked from_push_token.
-- New: locks row FOR UPDATE; requires status='pending'; verifies
--      p_acting_child_id = to_id; validates session for recipient.

DROP FUNCTION IF EXISTS public.accept_circle_request(uuid);

CREATE OR REPLACE FUNCTION public.accept_circle_request(
  p_request_id      uuid,
  p_acting_child_id uuid,
  p_session_token   text,
  p_device_id       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_from_id uuid;
  v_to_id   uuid;
  v_status  text;
  v_to_name text;
BEGIN
  SELECT from_id, to_id, status
    INTO v_from_id, v_to_id, v_status
    FROM circle_requests WHERE id = p_request_id FOR UPDATE;

  IF v_from_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;
  IF p_acting_child_id <> v_to_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  PERFORM require_valid_child_session(v_to_id, p_session_token, p_device_id);

  UPDATE circle_requests SET status = 'accepted' WHERE id = p_request_id;

  INSERT INTO circles(child_id, friend_id, status)
  VALUES (v_from_id, v_to_id, 'active')
  ON CONFLICT (child_id, friend_id) DO UPDATE
    SET status = 'active', removed_at = NULL, removed_by = NULL;

  INSERT INTO circles(child_id, friend_id, status)
  VALUES (v_to_id, v_from_id, 'active')
  ON CONFLICT (child_id, friend_id) DO UPDATE
    SET status = 'active', removed_at = NULL, removed_by = NULL;

  SELECT display_name INTO v_to_name FROM children WHERE id = v_to_id;

  PERFORM _trigger_notification(
    'friend_accepted', v_from_id, 'child', v_to_id, v_to_name, '{}'::jsonb
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.accept_circle_request(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_circle_request(uuid, uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.accept_circle_request(uuid, uuid, text, text) TO anon, postgres, service_role;


-- ─── 3. decline_circle_request ───────────────────────────────────────────────
-- Old: (uuid) — no actor check, no status guard, leaked from_push_token.
-- New: same pattern as accept; only pending requests can be declined.

DROP FUNCTION IF EXISTS public.decline_circle_request(uuid);

CREATE OR REPLACE FUNCTION public.decline_circle_request(
  p_request_id      uuid,
  p_acting_child_id uuid,
  p_session_token   text,
  p_device_id       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_from_id uuid;
  v_to_id   uuid;
  v_status  text;
  v_to_name text;
BEGIN
  SELECT from_id, to_id, status
    INTO v_from_id, v_to_id, v_status
    FROM circle_requests WHERE id = p_request_id FOR UPDATE;

  IF v_from_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;
  IF p_acting_child_id <> v_to_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  PERFORM require_valid_child_session(v_to_id, p_session_token, p_device_id);

  UPDATE circle_requests SET status = 'declined' WHERE id = p_request_id;

  SELECT display_name INTO v_to_name FROM children WHERE id = v_to_id;

  PERFORM _trigger_notification(
    'friend_declined', v_from_id, 'child', v_to_id, v_to_name, '{}'::jsonb
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.decline_circle_request(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decline_circle_request(uuid, uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.decline_circle_request(uuid, uuid, text, text) TO anon, postgres, service_role;


-- ─── 4. cancel_circle_request ────────────────────────────────────────────────
-- Old: (uuid, uuid) — no session validation, no SET search_path.
-- New: session validated for p_from_id (only sender can cancel).

DROP FUNCTION IF EXISTS public.cancel_circle_request(uuid, uuid);

CREATE OR REPLACE FUNCTION public.cancel_circle_request(
  p_from_id       uuid,
  p_to_id         uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM require_valid_child_session(p_from_id, p_session_token, p_device_id);
  DELETE FROM circle_requests
  WHERE from_id = p_from_id AND to_id = p_to_id AND status = 'pending';
END;
$$;

REVOKE ALL     ON FUNCTION public.cancel_circle_request(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_circle_request(uuid, uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.cancel_circle_request(uuid, uuid, text, text) TO anon, postgres, service_role;


-- ─── 5. remove_from_circle ───────────────────────────────────────────────────
-- Old: (uuid, uuid) — no session validation, no SET search_path.
-- New: session validated for p_child_id; loan-block and re-add behavior preserved.

DROP FUNCTION IF EXISTS public.remove_from_circle(uuid, uuid);

CREATE OR REPLACE FUNCTION public.remove_from_circle(
  p_child_id      uuid,
  p_friend_id     uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_active int;
BEGIN
  PERFORM require_valid_child_session(p_child_id, p_session_token, p_device_id);

  IF NOT EXISTS (
    SELECT 1 FROM circles
    WHERE (child_id = p_child_id AND friend_id = p_friend_id)
       OR (child_id = p_friend_id AND friend_id = p_child_id)
  ) THEN
    RAISE EXCEPTION 'not_in_circle';
  END IF;

  SELECT COUNT(*) INTO v_active
  FROM money_requests
  WHERE status = 'funded'
    AND (
      (from_id = p_child_id AND funded_by = p_friend_id) OR
      (from_id = p_friend_id AND funded_by = p_child_id)
    );

  IF v_active > 0 THEN
    RAISE EXCEPTION 'active_loan:outstanding_money';
  END IF;

  UPDATE circles
  SET status     = 'removed',
      removed_at = now(),
      removed_by = p_child_id
  WHERE (child_id = p_child_id AND friend_id = p_friend_id)
     OR (child_id = p_friend_id AND friend_id = p_child_id);

  UPDATE money_requests
  SET viewer_ids = array_remove(viewer_ids, p_friend_id)
  WHERE status = 'pending'
    AND from_id = p_child_id
    AND viewer_ids IS NOT NULL
    AND p_friend_id = ANY(viewer_ids);

  UPDATE money_requests
  SET viewer_ids = array_remove(viewer_ids, p_child_id)
  WHERE status = 'pending'
    AND from_id = p_friend_id
    AND viewer_ids IS NOT NULL
    AND p_child_id = ANY(viewer_ids);
END;
$$;

REVOKE ALL     ON FUNCTION public.remove_from_circle(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.remove_from_circle(uuid, uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.remove_from_circle(uuid, uuid, text, text) TO anon, postgres, service_role;


NOTIFY pgrst, 'reload schema';

COMMIT;
