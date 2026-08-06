-- M042 rollback: restore GUC-based secret lookup (reverts to broken state for completeness)
CREATE OR REPLACE FUNCTION public._trigger_notification(
  p_type text, p_recipient_id uuid, p_recipient_type text,
  p_sender_id uuid, p_sender_name text, p_data jsonb DEFAULT '{}'
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, net AS $$
DECLARE v_secret TEXT;
BEGIN
  v_secret := current_setting('app.notification_secret', true);
  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;
  PERFORM net.http_post(
    url     := 'https://biilrksornvoqtalftty.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object('Content-Type','application/json','x-notification-secret',v_secret),
    body    := jsonb_build_object('type',p_type,'recipient_id',p_recipient_id,'recipient_type',p_recipient_type,'sender_id',p_sender_id,'sender_name',p_sender_name,'data',p_data)
  );
EXCEPTION WHEN OTHERS THEN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public._trigger_notification_multi(
  p_type text, p_recipient_ids uuid[], p_recipient_type text,
  p_sender_id uuid, p_sender_name text, p_data jsonb DEFAULT '{}'
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, net AS $$
DECLARE v_secret TEXT;
BEGIN
  IF p_recipient_ids IS NULL OR array_length(p_recipient_ids,1) = 0 THEN RETURN; END IF;
  v_secret := current_setting('app.notification_secret', true);
  IF v_secret IS NULL OR v_secret = '' THEN RETURN; END IF;
  PERFORM net.http_post(
    url     := 'https://biilrksornvoqtalftty.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object('Content-Type','application/json','x-notification-secret',v_secret),
    body    := jsonb_build_object('type',p_type,'recipient_ids',to_jsonb(p_recipient_ids),'recipient_type',p_recipient_type,'sender_id',p_sender_id,'sender_name',p_sender_name,'data',p_data)
  );
EXCEPTION WHEN OTHERS THEN NULL;
END; $$;

DROP TABLE IF EXISTS public._notification_settings;
