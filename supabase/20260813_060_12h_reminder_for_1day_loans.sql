-- M060: 12-hour repayment reminder for 1-day loans
--
-- Loans with deadline_days = 1 only have 24 hours total, so a "24 hours
-- before" reminder (M057) would fire at the moment of funding — useless.
-- Instead they get a 12-hour reminder at noon UTC on the due date.
--
-- Changes:
--   1. Add reminder_12h_sent_at column to money_requests.
--   2. Update _send_repayment_reminders() to skip 1-day loans.
--   3. Add _send_12h_repayment_reminders() for 1-day loans only.
--   4. Schedule it at 12:00 UTC daily.
--
-- Notification type: 'repayment_reminder_12h'
-- Edge Function copy: "⏰ Repayment due today — You have 12 hours to repay £X to Maya"

-- ── 1. Tracking column ────────────────────────────────────────────────────────
ALTER TABLE public.money_requests
  ADD COLUMN IF NOT EXISTS reminder_12h_sent_at timestamptz;

-- ── 2. Update 24h reminder to skip 1-day loans ───────────────────────────────
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
      AND COALESCE(mr.deadline_days, 0) > 1   -- 1-day loans handled by _send_12h_repayment_reminders
  LOOP
    PERFORM public._trigger_notification(
      'repayment_reminder',
      r.borrower_id,
      'child',
      r.lender_id,
      r.lender_name,
      jsonb_build_object('amount', r.amount, 'request_id', r.id)
    );
    UPDATE public.money_requests SET reminder_24h_sent_at = now() WHERE id = r.id;
  END LOOP;
END;
$$;

REVOKE ALL     ON FUNCTION public._send_repayment_reminders() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._send_repayment_reminders()
  TO postgres, service_role;

-- ── 3. 12h reminder function for 1-day loans ─────────────────────────────────
-- Runs at noon UTC. Loans with deadline_days=1 and repay_by_date=today have
-- roughly 12 hours left (until midnight / start of next day when the default
-- processor fires). Sends once per loan via reminder_12h_sent_at guard.

CREATE OR REPLACE FUNCTION public._send_12h_repayment_reminders()
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
    WHERE mr.status                = 'funded'
      AND mr.deadline_days         = 1
      AND mr.repay_by_date         = CURRENT_DATE
      AND mr.repay_by_date         IS NOT NULL
      AND mr.reminder_12h_sent_at  IS NULL
  LOOP
    PERFORM public._trigger_notification(
      'repayment_reminder_12h',
      r.borrower_id,
      'child',
      r.lender_id,
      r.lender_name,
      jsonb_build_object('amount', r.amount, 'request_id', r.id)
    );
    UPDATE public.money_requests SET reminder_12h_sent_at = now() WHERE id = r.id;
  END LOOP;
END;
$$;

REVOKE ALL     ON FUNCTION public._send_12h_repayment_reminders() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._send_12h_repayment_reminders()
  TO postgres, service_role;

-- ── 4. Schedule at noon UTC daily ────────────────────────────────────────────
SELECT cron.unschedule('repayment-reminders-12h')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'repayment-reminders-12h');

SELECT cron.schedule(
  'repayment-reminders-12h',
  '0 12 * * *',
  $$ SELECT public._send_12h_repayment_reminders(); $$
);

NOTIFY pgrst, 'reload schema';
