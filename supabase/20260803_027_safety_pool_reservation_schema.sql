-- Migration 027: Safety Pool reservation schema (Option C)
--
-- Problem
-- ───────
-- fund_money_request previously checked pool availability with a snapshot read
-- (safety_pool_limit - safety_pool_used). This is not a reservation: multiple
-- concurrent fundings could each pass the check before any committed, allowing
-- total funded exposure to exceed the parent's limit.
--
-- This migration adds the schema support for explicit reservations:
--
--   parents.safety_pool_reserved   — running total of uncommitted reservations
--   money_requests.safety_pool_reserved_amount     — amount reserved for each funded loan
--   money_requests.safety_pool_reservation_released_at — when released (repaid or defaulted)
--
-- Invariant enforced after this migration
-- ────────────────────────────────────────
--   safety_pool_used + safety_pool_reserved <= safety_pool_limit  (per parent)
--
-- Where:
--   safety_pool_used     = cumulative paid-out defaults (released when parent debt repaid)
--   safety_pool_reserved = sum of reservations for currently-funded unpaid loans
--   safety_pool_limit    = total coverage the parent has committed
--
-- Lifecycle of a reservation
-- ──────────────────────────
--   1. Loan funded    →  safety_pool_reserved += amount
--                        money_requests.safety_pool_reserved_amount = amount
--   2a. Loan repaid   →  safety_pool_reserved -= amount
--                        money_requests.safety_pool_reservation_released_at = now()
--                        (safety_pool_used unchanged)
--   2b. Loan defaulted→  safety_pool_reserved -= amount
--                        safety_pool_used += amount
--                        money_requests.safety_pool_reservation_released_at = now()
--   3. Parent confirms child repaid debt (existing confirm_parent_repayment)
--                     →  safety_pool_used -= debt (no change to reserved)
--
-- Backfill status
-- ───────────────
-- Live DB at time of writing: 0 funded loans, 0 non-terminal requests,
-- all safety_pool_used = 0. Backfill is therefore a no-op. The migration
-- will hard-fail if any funded loans are found without a corresponding
-- reservation, forcing manual review before proceeding.
--
-- Rollback: 20260803_027_rollback.sql

BEGIN;

-- ─── 1. Add safety_pool_reserved to parents ───────────────────────────────────

ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS safety_pool_reserved numeric NOT NULL DEFAULT 0
    CONSTRAINT chk_parents_sp_reserved_nonneg CHECK (safety_pool_reserved >= 0);

-- Guard: current safety_pool_used values must also satisfy >= 0.
-- These columns are nullable; coalesce handles legacy NULL rows.
DO $$
DECLARE v_neg int;
BEGIN
  SELECT COUNT(*) INTO v_neg FROM parents
    WHERE COALESCE(safety_pool_used, 0) < 0;
  IF v_neg > 0 THEN
    RAISE EXCEPTION 'Pre-condition failed: % parent row(s) have safety_pool_used < 0. '
      'Inspect and repair before applying this migration.', v_neg;
  END IF;
END $$;

-- ─── 2. Add reservation columns to money_requests ────────────────────────────

ALTER TABLE public.money_requests
  ADD COLUMN IF NOT EXISTS safety_pool_reserved_amount numeric
    CONSTRAINT chk_mr_sp_reserved_nonneg CHECK (safety_pool_reserved_amount >= 0),
  ADD COLUMN IF NOT EXISTS safety_pool_reservation_released_at timestamptz;

-- ─── 3. Backfill verification ─────────────────────────────────────────────────
-- Hard-fail if any funded loans exist without a reservation already applied.
-- (With 0 funded loans this block always passes. If you are running this
--  migration in a future environment with funded loans, fix the backfill
--  and re-run before applying migrations 028+.)

DO $$
DECLARE
  v_funded_count  int;
  v_conflict_rows text;
BEGIN
  SELECT COUNT(*) INTO v_funded_count
    FROM money_requests
    WHERE status = 'funded'
      AND safety_pool_reserved_amount IS NULL;

  IF v_funded_count > 0 THEN
    SELECT string_agg(id::text, ', ') INTO v_conflict_rows
      FROM money_requests
      WHERE status = 'funded'
        AND safety_pool_reserved_amount IS NULL;

    RAISE EXCEPTION
      'Backfill required: % funded loan(s) have no reservation amount recorded. '
      'Request IDs: %. '
      'Manually set safety_pool_reserved_amount and update parents.safety_pool_reserved '
      'for each loan, then re-run this migration.',
      v_funded_count, v_conflict_rows;
  END IF;

  RAISE NOTICE 'Backfill check passed: 0 funded loans require reservation backfill.';
END $$;

-- For any requests in terminal states (repaid, defaulted, cancelled), set
-- reservation_released_at to now() as a historical marker. These had no
-- reservation to release (pre-reservation system), but marking them prevents
-- them from being treated as pending by future tooling.
UPDATE public.money_requests
  SET safety_pool_reservation_released_at = COALESCE(repaid_at, funded_at, created_at, now())
  WHERE status IN ('repaid', 'defaulted', 'cancelled')
    AND safety_pool_reservation_released_at IS NULL;

-- ─── 4. Combined invariant constraint ────────────────────────────────────────
-- Verify no parent currently violates the invariant before adding the constraint.

DO $$
DECLARE
  v_violations int;
  v_detail     text;
BEGIN
  SELECT COUNT(*) INTO v_violations FROM parents
    WHERE COALESCE(safety_pool_used, 0) + safety_pool_reserved
          > COALESCE(safety_pool_limit, 0);

  IF v_violations > 0 THEN
    SELECT string_agg(
      'parent_id=' || id::text ||
      ' used=' || COALESCE(safety_pool_used,0)::text ||
      ' reserved=' || safety_pool_reserved::text ||
      ' limit=' || COALESCE(safety_pool_limit,0)::text,
      '; '
    ) INTO v_detail FROM parents
      WHERE COALESCE(safety_pool_used, 0) + safety_pool_reserved
            > COALESCE(safety_pool_limit, 0);

    RAISE EXCEPTION
      'Cannot add combined Safety Pool constraint: % parent(s) already violate '
      'used + reserved <= limit. Details: %. '
      'Repair these rows before applying this migration.',
      v_violations, v_detail;
  END IF;

  RAISE NOTICE 'Invariant check passed: all parents satisfy used + reserved <= limit.';
END $$;

ALTER TABLE public.parents
  ADD CONSTRAINT chk_parents_sp_invariant
    CHECK (
      COALESCE(safety_pool_used, 0) + safety_pool_reserved
      <= COALESCE(safety_pool_limit, 0)
    );

-- Individual non-negative constraints (belt-and-suspenders)
ALTER TABLE public.parents
  ADD CONSTRAINT chk_parents_sp_used_nonneg
    CHECK (COALESCE(safety_pool_used, 0) >= 0);

-- ─── 5. Update the partial index hint (adding new column to tracked schema) ──
-- The existing PK is the only index. The hot-path index for the default
-- processor is created in migration 029. Nothing to do here.

NOTIFY pgrst, 'reload schema';

COMMIT;
