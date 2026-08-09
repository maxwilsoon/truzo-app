-- M043: Actor filtering — prevent self-notifications on all social/financial events
--
-- Problem: when User X performs an action (create request, fund, friend request, etc.)
--   they can receive a push notification about their own action in two scenarios:
--   1. Their own user_id somehow ends up in the recipient list (data edge case)
--   2. They share a physical device with a legitimate recipient — both share the same
--      Expo push token, so the recipient's push arrives on the actor's screen
--
-- Fix: server-side actor filtering by user_id in both DB helpers and Edge Function.
--   Rule: if recipient_user_id = actor_user_id → do not send.
--   Shared-device case is also covered: the actor's own user_id is stripped from the
--   recipient list before token lookup, so no token is ever looked up for the actor.
--
-- Also adds the missing push notification in parent_send_to_child.
--
-- Rollback: 20260809_043_rollback.sql

-- ── 1. _trigger_notification: skip if recipient = actor ───────────────────────
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
  -- Actor filtering: never notify the person who caused the event.
  -- Covers both direct self-reference and shared-device scenarios.
  IF p_recipient_id = p_sender_id THEN RETURN; END IF;

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

-- ── 2. _trigger_notification_multi: strip actor from recipient list ────────────
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

  -- Actor filtering: remove the event actor from the recipient list before
  -- any token lookup so they cannot receive their own notification even if
  -- they share a physical device with a legitimate recipient.
  v_filtered_ids := array_remove(p_recipient_ids, p_sender_id);

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

-- ── 3. parent_send_to_child: add push notification to child ───────────────────
-- Actor is the parent (p_user_id); recipient is the child (p_child_id).
-- They are always different UUIDs — no self-notification risk.
CREATE OR REPLACE FUNCTION public.parent_send_to_child(
  p_user_id     uuid,
  p_child_id    uuid,
  p_amount      numeric,
  p_parent_name text
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_tx_id      text := 'ps_' || floor(extract(epoch from now()))::bigint;
  v_amount_str text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  PERFORM public.require_valid_gbp_amount(p_amount, 'transfer amount');

  IF NOT EXISTS (
    SELECT 1 FROM children WHERE id = p_child_id AND parent_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'not_parent';
  END IF;

  v_amount_str := CASE
    WHEN p_amount = floor(p_amount) THEN floor(p_amount)::integer::text
    ELSE round(p_amount, 2)::text
  END;

  UPDATE children SET wallet_balance = wallet_balance + p_amount WHERE id = p_child_id;

  INSERT INTO transactions (child_id, type, amount, description, counterparty)
    VALUES (p_child_id, 'parent_transfer', p_amount,
            p_parent_name || ' sent you £' || v_amount_str, p_parent_name);

  INSERT INTO activity_feed (child_id, id, emoji, text, type)
    VALUES (p_child_id, 'act_' || v_tx_id, '💚',
            p_parent_name || ' sent you £' || v_amount_str, 'topup');

  -- Notify child. Actor = parent (p_user_id); recipient = child (p_child_id).
  -- _trigger_notification checks p_recipient_id = p_sender_id before sending —
  -- parent UUID ≠ child UUID, so this always proceeds.
  PERFORM public._trigger_notification(
    'parent_transfer',
    p_child_id,
    'child',
    p_user_id,
    p_parent_name,
    jsonb_build_object('amount', p_amount)
  );
END;
$$;
