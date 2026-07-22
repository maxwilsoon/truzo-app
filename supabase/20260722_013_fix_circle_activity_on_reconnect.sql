-- Migration 013: fix activity feed and notifications on Circle reconnect
--
-- Root cause: send_circle_request used ON CONFLICT … DO UPDATE which kept the
-- same circle_requests.id across multiple sends to the same person. When the
-- request was re-accepted the resolved activity used id='resolved_{same_uuid}':
--   • in-memory: seenResolvedIds already contained the old UUID → skipped
--   • DB level: add_activity_item ON CONFLICT DO NOTHING → silently dropped
-- Result: the requester never saw "Alex accepted your friend request" on re-accept.
--
-- Fix: DELETE the old directional row before INSERTing a fresh one. Each
-- re-send now gets a brand-new UUID, so activity IDs never collide.
-- The already_friends / already_pending guards still run first (unchanged).

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

  -- Reject if already active friends (either direction)
  IF EXISTS (
    SELECT 1 FROM circles
    WHERE status = 'active'
      AND ((child_id = p_from_id AND friend_id = p_to_id)
        OR (child_id = p_to_id   AND friend_id = p_from_id))
  ) THEN
    RAISE EXCEPTION 'already_friends';
  END IF;

  -- Reject if a pending request already exists in either direction
  IF EXISTS (
    SELECT 1 FROM circle_requests
    WHERE status = 'pending'
      AND ((from_id = p_from_id AND to_id = p_to_id)
        OR (from_id = p_to_id   AND to_id = p_from_id))
  ) THEN
    RAISE EXCEPTION 'already_pending';
  END IF;

  -- Remove any stale request in this direction (declined, accepted, etc.) so the
  -- fresh INSERT below gets a new UUID. This is safe because:
  --   • The pending guard above ensures no 'pending' row exists in either direction.
  --   • circle_requests is not referenced by any other table's foreign key.
  --   • Financial history lives in money_requests / transactions, not here.
  DELETE FROM circle_requests WHERE from_id = p_from_id AND to_id = p_to_id;

  -- Fresh insert — new UUID every time so activity_feed entries never collide
  INSERT INTO circle_requests(from_id, to_id, status, created_at)
  VALUES (p_from_id, p_to_id, 'pending', now());

  SELECT push_token INTO v_to_token FROM children WHERE id = p_to_id;

  RETURN json_build_object('push_token', v_to_token);
END;
$$;
