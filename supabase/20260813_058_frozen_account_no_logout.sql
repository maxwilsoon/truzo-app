-- M058: Remove account_frozen check from require_valid_child_session
--
-- Bug: require_valid_child_session raised 'invalid_child_session' when
-- account_frozen=true. The client treats this as a session error and logs
-- the user out. The intent is for frozen users to stay logged in but be
-- blocked from financial actions.
--
-- Fix: remove the frozen check from the session validator entirely.
-- Financial RPCs (fund_money_request, create_money_request, repay_money_request)
-- already independently check account_frozen and raise 'borrower_frozen' — so
-- those actions remain blocked. Read-only RPCs (getChildStats, getActivityFeed,
-- getCircle, etc.) will now succeed for frozen accounts, which is what we want.

CREATE OR REPLACE FUNCTION public.require_valid_child_session(
  p_child_id      uuid,
  p_session_token text,
  p_device_id     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session child_sessions%ROWTYPE;
  v_hash    text;
  v_now     timestamptz := now();
BEGIN
  IF p_session_token IS NULL OR length(p_session_token) <> 64 THEN
    RAISE EXCEPTION 'invalid_child_session';
  END IF;
  IF p_device_id IS NULL OR p_device_id = '' THEN
    RAISE EXCEPTION 'invalid_child_session';
  END IF;
  IF p_child_id IS NULL THEN
    RAISE EXCEPTION 'invalid_child_session';
  END IF;

  v_hash := encode(digest(p_session_token, 'sha256'), 'hex');

  SELECT * INTO v_session
    FROM child_sessions
    WHERE token_hash = v_hash
      AND child_id   = p_child_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_child_session';
  END IF;

  IF v_session.device_id <> p_device_id THEN
    RAISE EXCEPTION 'invalid_child_session';
  END IF;

  IF v_session.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'child_session_revoked';
  END IF;

  IF v_session.expires_at < v_now THEN
    RAISE EXCEPTION 'child_session_expired';
  END IF;

  IF v_session.absolute_expires_at < v_now THEN
    RAISE EXCEPTION 'child_session_expired';
  END IF;

  -- NOTE: account_frozen check intentionally removed (M058).
  -- Frozen users stay logged in; financial RPCs block them independently.

  UPDATE child_sessions
    SET last_seen_at = v_now,
        expires_at   = LEAST(v_now + interval '1 hour', v_session.absolute_expires_at)
    WHERE id = v_session.id;
END;
$$;
-- No GRANT — internal helper only

NOTIFY pgrst, 'reload schema';
