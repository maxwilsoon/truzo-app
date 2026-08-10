-- M046: Actor-filter exception list for owner-event notifications
--
-- M043 introduced: suppress push when recipient_user_id = actor_user_id.
-- That rule is correct for social/financial events (you don't notify yourself
-- when you send money or create a friend request).
--
-- It is WRONG for owner-events where the actor IS the intended recipient:
--   • tier_unlocked / points_milestone  — child earns a reward; they should be told
--   • card_purchase                     — card spend alert sent to the card holder
--   • security_alert / login_alert      — login or security event on the user's own account
--
-- parent_transfer does NOT need an exception: the actor is always the parent
-- (p_user_id) and the recipient is always the child (p_child_id) — different
-- UUIDs — so the actor-filter never fires for that type.
--
-- This migration adds an explicit exemption list to both DB helpers and the
-- Edge Function (deployed separately via supabase functions deploy).
--
-- Rollback: 20260810_046_rollback.sql

-- ── 1. _trigger_notification: add exemption list ──────────────────────────────
CREATE OR REPLACE FUNCTION public._trigger_notification(
  p_type           text,
  p_recipient_id   uuid,
  p_recipient_type text,
  p_sender_id      uuid,
  p_sender_name    text,
  p_data           jsonb DEFAULT '{}'::jsonb
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions', 'net'
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  -- Actor filtering: suppress self-notifications for social/financial events.
  -- Exempt owner-events where the actor IS the intended recipient.
  IF p_recipient_id = p_sender_id
     AND p_type NOT IN (
       'tier_unlocked',
       'points_milestone',
       'card_purchase',
       'security_alert',
       'login_alert'
     )
  THEN RETURN; END IF;

  SELECT value INTO v_secret
  FROM public._notification_settings
  WHERE key = 'notification_secret';

  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := 'https://biilrksornvoqtalftty.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object(
      'Content-Type',          'application/json',
      'x-notification-secret', v_secret
    ),
    body := jsonb_build_object(
      'type',           p_type,
      'recipient_id',   p_recipient_id,
      'recipient_type', p_recipient_type,
      'sender_id',      p_sender_id,
      'sender_name',    p_sender_name,
      'actor_id',       p_sender_id,
      'data',           p_data
    )
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- ── 2. _trigger_notification_multi: add exemption list ───────────────────────
CREATE OR REPLACE FUNCTION public._trigger_notification_multi(
  p_type           text,
  p_recipient_ids  uuid[],
  p_recipient_type text,
  p_sender_id      uuid,
  p_sender_name    text,
  p_data           jsonb DEFAULT '{}'::jsonb
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions', 'net'
AS $$
DECLARE
  v_secret       TEXT;
  v_filtered_ids uuid[];
BEGIN
  IF p_recipient_ids IS NULL OR array_length(p_recipient_ids, 1) = 0 THEN
    RETURN;
  END IF;

  -- Actor filtering: remove event actor from recipient list.
  -- Skip removal for owner-events — the actor IS the intended recipient.
  IF p_type IN (
    'tier_unlocked',
    'points_milestone',
    'card_purchase',
    'security_alert',
    'login_alert'
  ) THEN
    v_filtered_ids := p_recipient_ids;
  ELSE
    v_filtered_ids := array_remove(p_recipient_ids, p_sender_id);
  END IF;

  IF v_filtered_ids IS NULL OR array_length(v_filtered_ids, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT value INTO v_secret
  FROM public._notification_settings
  WHERE key = 'notification_secret';

  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := 'https://biilrksornvoqtalftty.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object(
      'Content-Type',          'application/json',
      'x-notification-secret', v_secret
    ),
    body := jsonb_build_object(
      'type',            p_type,
      'recipient_ids',   to_jsonb(v_filtered_ids),
      'recipient_type',  p_recipient_type,
      'sender_id',       p_sender_id,
      'sender_name',     p_sender_name,
      'actor_id',        p_sender_id,
      'data',            p_data
    )
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- No grants changed — _trigger_notification and _trigger_notification_multi
-- remain callable only by postgres and service_role (set in M036/M039).
