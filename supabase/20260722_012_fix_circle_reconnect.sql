-- Migration 012: fix Circle reconnect after removal
--
-- Root cause: accept_circle_request used ON CONFLICT DO NOTHING when inserting
-- into circles. After remove_from_circle soft-deletes rows (status='removed'),
-- the unique index circles_child_id_friend_id_key blocks a fresh INSERT and
-- DO NOTHING silently skips it — leaving both rows in status='removed'.
-- get_circle filters status='active', so re-accepted friends never reappeared.
--
-- Fix A (accept_circle_request): replace DO NOTHING with DO UPDATE so existing
--   removed rows are reactivated instead of silently skipped.
--
-- Fix B (send_circle_request): add guards for already_friends and
--   already_pending (both directions) before the upsert, so the server
--   correctly rejects duplicates regardless of client-side state.

-- ─── A. accept_circle_request ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION accept_circle_request(p_request_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_from_id    uuid;
  v_to_id      uuid;
  v_from_token text;
BEGIN
  UPDATE circle_requests
  SET status = 'accepted'
  WHERE id = p_request_id
  RETURNING from_id, to_id INTO v_from_id, v_to_id;

  IF v_from_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  -- Upsert both directions so a previously removed friendship is reactivated.
  -- ON CONFLICT DO NOTHING would silently leave removed rows unchanged.
  INSERT INTO circles(child_id, friend_id, status)
  VALUES (v_from_id, v_to_id, 'active')
  ON CONFLICT (child_id, friend_id) DO UPDATE
    SET status = 'active', removed_at = NULL, removed_by = NULL;

  INSERT INTO circles(child_id, friend_id, status)
  VALUES (v_to_id, v_from_id, 'active')
  ON CONFLICT (child_id, friend_id) DO UPDATE
    SET status = 'active', removed_at = NULL, removed_by = NULL;

  SELECT push_token INTO v_from_token FROM children WHERE id = v_from_id;

  RETURN json_build_object(
    'from_id',         v_from_id,
    'to_id',           v_to_id,
    'from_push_token', v_from_token
  );
END;
$$;

-- ─── B. send_circle_request ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION send_circle_request(p_from_id uuid, p_to_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_to_token text;
BEGIN
  -- Reject self-add
  IF p_from_id = p_to_id THEN
    RAISE EXCEPTION 'cannot_add_self';
  END IF;

  -- Reject if both users are currently active friends (either direction)
  IF EXISTS (
    SELECT 1 FROM circles
    WHERE status = 'active'
      AND ((child_id = p_from_id AND friend_id = p_to_id)
        OR (child_id = p_to_id   AND friend_id = p_from_id))
  ) THEN
    RAISE EXCEPTION 'already_friends';
  END IF;

  -- Reject if a pending request already exists in either direction.
  -- Only status='pending' blocks re-adds; removed/declined/accepted do not.
  IF EXISTS (
    SELECT 1 FROM circle_requests
    WHERE status = 'pending'
      AND ((from_id = p_from_id AND to_id = p_to_id)
        OR (from_id = p_to_id   AND to_id = p_from_id))
  ) THEN
    RAISE EXCEPTION 'already_pending';
  END IF;

  -- Insert new request, or reset a previously declined/accepted-then-removed one.
  -- ON CONFLICT covers the case where the same sender re-submits after a decline
  -- or after a friendship was removed (the directional row still exists).
  INSERT INTO circle_requests(from_id, to_id, status, created_at)
  VALUES (p_from_id, p_to_id, 'pending', now())
  ON CONFLICT (from_id, to_id) DO UPDATE
    SET status = 'pending', created_at = now();

  SELECT push_token INTO v_to_token FROM children WHERE id = p_to_id;

  RETURN json_build_object('push_token', v_to_token);
END;
$$;
