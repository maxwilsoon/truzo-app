-- M042: notification_secret configuration + trigger function fix
--
-- ROOT CAUSE: _trigger_notification reads the secret via current_setting(), which requires
-- a database-level GUC (ALTER DATABASE SET app.notification_secret = '...'). The Supabase
-- pooler user cannot execute ALTER DATABASE, so the secret was never set and
-- _trigger_notification returned silently on every call — no notification was ever sent.
--
-- FIX: Replace the GUC-based secret lookup with a read from a locked-down config table.
-- The same secret value must be set as NOTIFICATION_SECRET in the Edge Function:
--
--   Dashboard → Edge Functions → send-notification → Environment Variables
--   NOTIFICATION_SECRET = f490fb11cf23733f430d99ab3c3f31baca9113680287654b1ce997c42d67bfde
--
-- ── 1. Config table ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public._notification_settings (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
);
-- RLS on, no public policies — only SECURITY DEFINER functions can access this table
ALTER TABLE public._notification_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._notification_settings FROM anon;
REVOKE ALL ON public._notification_settings FROM authenticated;

-- ── 2. Insert the shared secret ─────────────────────────────────────────────────────────
-- This value must match NOTIFICATION_SECRET in the Edge Function environment variables.
INSERT INTO public._notification_settings (key, value)
VALUES ('notification_secret', 'f490fb11cf23733f430d99ab3c3f31baca9113680287654b1ce997c42d67bfde')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ── 3. _trigger_notification (single recipient) ────────────────────────────────────────
-- Reads secret from _notification_settings instead of current_setting().
CREATE OR REPLACE FUNCTION public._trigger_notification(
  p_type           TEXT,
  p_recipient_id   UUID,
  p_recipient_type TEXT,
  p_sender_id      UUID,
  p_sender_name    TEXT,
  p_data           JSONB DEFAULT '{}'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT value INTO v_secret
  FROM public._notification_settings
  WHERE key = 'notification_secret';

  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN; -- Secret not configured — skip silently
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
  -- Never propagate notification errors to the calling transaction
  NULL;
END; $$;

-- ── 4. _trigger_notification_multi (multiple recipients) ───────────────────────────────
CREATE OR REPLACE FUNCTION public._trigger_notification_multi(
  p_type           TEXT,
  p_recipient_ids  UUID[],
  p_recipient_type TEXT,
  p_sender_id      UUID,
  p_sender_name    TEXT,
  p_data           JSONB DEFAULT '{}'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
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
END; $$;

-- ── 5. Grants — internal helpers remain locked down ──────────────────────────────────
-- _trigger_notification and _trigger_notification_multi are called only by SECURITY DEFINER
-- RPCs (fund_money_request, send_circle_request, etc.) — no direct client access needed.
REVOKE ALL ON FUNCTION public._trigger_notification(text, uuid, text, uuid, text, jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._trigger_notification_multi(text, uuid[], text, uuid, text, jsonb) FROM anon, authenticated;
