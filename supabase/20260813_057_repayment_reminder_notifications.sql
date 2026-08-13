-- M057: 24-hour repayment reminder notifications
--
-- Adds a reminder_24h_sent_at column to money_requests to prevent duplicate
-- reminders, a _send_repayment_reminders() function that fires a push
-- notification to the borrower for every funded request due tomorrow, and a
-- pg_cron schedule that runs it daily at 9am UTC.
--
-- Notification copy (Edge Function): "You have 24 hours to repay £10 to Maya"
-- Reminder fires once: the day before repay_by_date, at 9am UTC.

-- ── 1. Tracking column ────────────────────────────────────────────────────────
ALTER TABLE public.money_requests
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at timestamptz;

-- ── 2. Reminder function ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._send_repayment_reminders()
RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      mr.id,
      mr.from_id         AS borrower_id,
      mr.funded_by       AS lender_id,
      mr.amount,
      c.display_name     AS lender_name
    FROM  public.money_requests mr
    JOIN  public.children c ON c.id = mr.funded_by
    WHERE mr.status               = 'funded'
      AND mr.repay_by_date        = CURRENT_DATE + 1
      AND mr.repay_by_date        IS NOT NULL
      AND mr.reminder_24h_sent_at IS NULL
  LOOP
    PERFORM public._trigger_notification(
      'repayment_reminder',
      r.borrower_id,
      'child',
      r.lender_id,
      r.lender_name,
      jsonb_build_object('amount', r.amount, 'request_id', r.id)
    );

    UPDATE public.money_requests
      SET reminder_24h_sent_at = now()
    WHERE id = r.id;
  END LOOP;
END;
$$;

REVOKE ALL     ON FUNCTION public._send_repayment_reminders() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._send_repayment_reminders()
  TO postgres, service_role;

-- ── 3. pg_cron schedule — 9am UTC daily ──────────────────────────────────────
SELECT cron.unschedule('repayment-reminders-24h')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'repayment-reminders-24h');

SELECT cron.schedule(
  'repayment-reminders-24h',
  '0 9 * * *',
  $$ SELECT public._send_repayment_reminders(); $$
);

NOTIFY pgrst, 'reload schema';
