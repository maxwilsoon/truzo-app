-- M054: Restore 'net' in search_path for _trigger_notification functions
--
-- M049 (block_report) redefined both _trigger_notification and
-- _trigger_notification_multi with SET search_path TO 'public', 'extensions',
-- accidentally dropping 'net'. The functions call net.http_post(), which
-- throws "schema net does not exist" at runtime. The EXCEPTION WHEN OTHERS
-- THEN NULL handler swallows it silently, so every notification since M049
-- has been a no-op.

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
  IF p_recipient_id = p_sender_id
     AND p_type NOT IN (
       'tier_unlocked','points_milestone','card_purchase','security_alert','login_alert'
     )
  THEN RETURN; END IF;

  IF p_type IN ('friend_request','friend_accepted','friend_declined','money_request') THEN
    IF EXISTS (
      SELECT 1 FROM user_blocks
      WHERE blocker_id = p_recipient_id AND blocked_id = p_sender_id
    ) THEN
      RETURN;
    END IF;
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
  v_secret          TEXT;
  v_filtered_ids    uuid[];
  v_block_filtered  uuid[];
BEGIN
  IF p_recipient_ids IS NULL OR array_length(p_recipient_ids, 1) = 0 THEN
    RETURN;
  END IF;

  IF p_type IN (
    'tier_unlocked','points_milestone','card_purchase','security_alert','login_alert'
  ) THEN
    v_filtered_ids := p_recipient_ids;
  ELSE
    v_filtered_ids := array_remove(p_recipient_ids, p_sender_id);
  END IF;

  IF v_filtered_ids IS NULL OR array_length(v_filtered_ids, 1) = 0 THEN
    RETURN;
  END IF;

  IF p_type IN ('friend_request','friend_accepted','friend_declined','money_request') THEN
    SELECT array_agg(r) INTO v_block_filtered
    FROM unnest(v_filtered_ids) AS r
    WHERE NOT EXISTS (
      SELECT 1 FROM user_blocks
      WHERE blocker_id = r AND blocked_id = p_sender_id
    );
    v_filtered_ids := COALESCE(v_block_filtered, ARRAY[]::uuid[]);
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

NOTIFY pgrst, 'reload schema';
