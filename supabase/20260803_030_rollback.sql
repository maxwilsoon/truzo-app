-- Rollback for migration 030: cron schedule removal only
--
-- Unschedules the pg_cron job. Does NOT recreate process_loan_default(uuid)
-- or get_overdue_funded_loans(uuid) — restoring anonymous access to default
-- processing would reintroduce the security vulnerability that H3 was
-- designed to fix.
--
-- Effect: default processing is paused after this rollback. Re-apply 030 to
-- restore scheduling once the issue that required rollback is resolved.

BEGIN;

SELECT cron.unschedule('process-loan-defaults')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-loan-defaults');

NOTIFY pgrst, 'reload schema';

COMMIT;
