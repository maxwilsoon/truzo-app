-- M064 — fix stripe_topups status CHECK constraint
--
-- The original constraint only allowed 'pending' and 'failed'.
-- stripe_complete_topup sets status = 'completed', which violated it.

ALTER TABLE stripe_topups DROP CONSTRAINT stripe_topups_status_check;
ALTER TABLE stripe_topups ADD CONSTRAINT stripe_topups_status_check
  CHECK (status IN ('pending', 'completed', 'failed', 'cancelled'));
