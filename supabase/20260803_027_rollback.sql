-- Rollback for migration 027: Safety Pool reservation schema
--
-- Removes the reservation columns, new check constraints, and backfill markers.
-- Run this BEFORE rolling back migration 028; both should be rolled back together
-- if either needs to be reverted.
--
-- WARNING: After rollback, parents.safety_pool_reserved no longer exists.
-- Migration 028 RPCs must also be rolled back (20260803_028_rollback.sql)
-- because they reference this column.
--
-- Safe to apply: all new columns and constraints were added by 027;
-- removing them leaves the table in its pre-027 state.

BEGIN;

-- Drop new constraints before dropping columns (constraints reference columns)
ALTER TABLE public.parents
  DROP CONSTRAINT IF EXISTS chk_parents_sp_invariant,
  DROP CONSTRAINT IF EXISTS chk_parents_sp_used_nonneg,
  DROP CONSTRAINT IF EXISTS chk_parents_sp_reserved_nonneg;

ALTER TABLE public.money_requests
  DROP CONSTRAINT IF EXISTS chk_mr_sp_reserved_nonneg;

-- Remove new columns
ALTER TABLE public.parents
  DROP COLUMN IF EXISTS safety_pool_reserved;

ALTER TABLE public.money_requests
  DROP COLUMN IF EXISTS safety_pool_reserved_amount,
  DROP COLUMN IF EXISTS safety_pool_reservation_released_at;

NOTIFY pgrst, 'reload schema';

COMMIT;
