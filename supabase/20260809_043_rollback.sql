-- M043 rollback: remove actor filtering, restore original _trigger_notification functions,
-- and remove push notification from parent_send_to_child.

-- 1. Restore _trigger_notification (no actor filter, no actor_id in body)
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
      'data',           p_data
    )
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- 2. Restore _trigger_notification_multi (no actor filter)
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
  v_secret TEXT;
BEGIN
  IF p_recipient_ids IS NULL OR array_length(p_recipient_ids, 1) = 0 THEN
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
      'recipient_ids',   to_jsonb(p_recipient_ids),
      'recipient_type',  p_recipient_type,
      'sender_id',       p_sender_id,
      'sender_name',     p_sender_name,
      'data',            p_data
    )
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- 3. Restore parent_send_to_child (no notification)
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
END;
$$;
