-- Migration 024: Drop insecure admin views
--
-- Root cause
-- ──────────
-- Three views (family_accounts, family_overview, admin_families) were created
-- as developer convenience tools via the Supabase SQL Editor. They perform an
-- unfiltered SELECT across the parents and children tables. Because PostgreSQL
-- regular views run as the view owner (SECURITY DEFINER behaviour by default),
-- and the owner is the postgres superuser, RLS on the underlying tables is
-- bypassed. With SELECT granted to the `anon` role, any bearer of the Supabase
-- anon key — which is bundled in the mobile app — could retrieve every family's
-- PII (parent name / email / mobile / address, child name / username / mobile /
-- age / wallet balance / biometric status) with a single SELECT statement.
--
-- None of the three views are referenced anywhere in application code.
-- They serve no runtime purpose and cannot be secured in place because the
-- entire definition is a full-table cross-family scan.
--
-- Remediation
-- ───────────
-- Drop all three views. If developer visibility into family data is needed in
-- the future, use the Supabase Dashboard's built-in table browser (which runs
-- under service_role) rather than views with anon/authenticated SELECT grants.
--
-- Rollback: 20260803_024_rollback.sql

BEGIN;

DROP VIEW IF EXISTS public.family_accounts;
DROP VIEW IF EXISTS public.family_overview;
DROP VIEW IF EXISTS public.admin_families;

NOTIFY pgrst, 'reload schema';

COMMIT;
