-- Rollback for migration 029: Secure loan default processor
--
-- Removes the processor function, notification_queue table, and index.
-- Does NOT recreate process_loan_default(uuid) or get_overdue_funded_loans(uuid).
-- Rolling back this migration pauses default processing entirely until
-- migration 029 is reapplied and pg_cron reschedules it.
--
-- WARNING: If there are pending rows in notification_queue, they will be
-- lost when the table is dropped. Drain them first if needed.

BEGIN;

DROP FUNCTION  IF EXISTS public.process_due_loan_defaults();
DROP TABLE     IF EXISTS public.notification_queue;
DROP INDEX     IF EXISTS idx_money_requests_funded_overdue;

NOTIFY pgrst, 'reload schema';

COMMIT;
