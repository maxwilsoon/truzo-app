-- ============================================================
-- Truzo RLS Migration
-- Run this in Supabase → SQL Editor.
-- Enables Row Level Security on every table and creates scoped
-- policies so only authenticated parents can access their data.
-- Three helper RPCs replace direct queries that run before a
-- parent auth session exists (onboarding email/mobile checks
-- and child-side transaction inserts).
-- ============================================================


-- ─── 1. Enable RLS on known tables ───────────────────────────

ALTER TABLE parents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE children      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;

-- Enable on any additional tables that may exist in your schema.
-- SECURITY DEFINER RPCs bypass RLS so no policies are needed for
-- tables that are only ever touched through those functions.
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'circle_members')   THEN EXECUTE 'ALTER TABLE circle_members   ENABLE ROW LEVEL SECURITY'; END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'circle_requests')  THEN EXECUTE 'ALTER TABLE circle_requests  ENABLE ROW LEVEL SECURITY'; END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'friend_requests')  THEN EXECUTE 'ALTER TABLE friend_requests  ENABLE ROW LEVEL SECURITY'; END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'money_requests')   THEN EXECUTE 'ALTER TABLE money_requests   ENABLE ROW LEVEL SECURITY'; END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'push_tokens')      THEN EXECUTE 'ALTER TABLE push_tokens      ENABLE ROW LEVEL SECURITY'; END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lending_requests') THEN EXECUTE 'ALTER TABLE lending_requests ENABLE ROW LEVEL SECURITY'; END IF;
END $$;


-- ─── 2. Drop any existing policies (idempotent) ──────────────

DROP POLICY IF EXISTS "parents_own_row_select" ON parents;
DROP POLICY IF EXISTS "parents_own_row_insert" ON parents;
DROP POLICY IF EXISTS "parents_own_row_update" ON parents;
DROP POLICY IF EXISTS "children_parent_select" ON children;
DROP POLICY IF EXISTS "children_parent_insert" ON children;
DROP POLICY IF EXISTS "children_parent_update" ON children;
DROP POLICY IF EXISTS "transactions_parent_select" ON transactions;
DROP POLICY IF EXISTS "activity_feed_parent_select" ON activity_feed;


-- ─── 3. parents table ─────────────────────────────────────────
-- A parent may only read or update their own row.
-- INSERT is permitted so that saveOnboarding() can create the row
-- immediately after signUp() (auth.uid() matches the new user id).

CREATE POLICY "parents_own_row_select" ON parents
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "parents_own_row_insert" ON parents
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "parents_own_row_update" ON parents
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- ─── 4. children table ────────────────────────────────────────
-- Only the linked parent may read or write a child's row.
-- Children do not have Supabase Auth accounts; all child-side
-- writes go through SECURITY DEFINER RPCs which bypass RLS.

CREATE POLICY "children_parent_select" ON children
  FOR SELECT TO authenticated
  USING (parent_id = auth.uid());

CREATE POLICY "children_parent_insert" ON children
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

CREATE POLICY "children_parent_update" ON children
  FOR UPDATE TO authenticated
  USING (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());


-- ─── 5. transactions table ────────────────────────────────────
-- A parent may read the transactions belonging to their child.
-- Inserts are handled exclusively through SECURITY DEFINER RPCs
-- (parent_send_to_child, fund_money_request, repay_money_request,
-- and the new persist_transaction RPC below).

CREATE POLICY "transactions_parent_select" ON transactions
  FOR SELECT TO authenticated
  USING (
    child_id IN (
      SELECT id FROM children WHERE parent_id = auth.uid()
    )
  );


-- ─── 6. activity_feed table ───────────────────────────────────
-- A parent may read their child's activity feed.
-- All inserts go through SECURITY DEFINER RPCs.

CREATE POLICY "activity_feed_parent_select" ON activity_feed
  FOR SELECT TO authenticated
  USING (
    child_id IN (
      SELECT id FROM children WHERE parent_id = auth.uid()
    )
  );


-- ─── 7. Helper SECURITY DEFINER RPCs ─────────────────────────
-- These replace the three direct table queries in database.ts
-- that run before a parent Supabase Auth session exists.


-- 7a. check_email_exists
-- Called during onboarding (no auth session yet).
CREATE OR REPLACE FUNCTION check_email_exists(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM parents WHERE email = lower(trim(p_email))
  );
$$;


-- 7b. check_mobile_exists
-- Called during onboarding (no auth session yet).
CREATE OR REPLACE FUNCTION check_mobile_exists(p_mobile text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM parents WHERE mobile = trim(p_mobile)
  );
$$;


-- 7c. persist_transaction
-- Replaces the direct INSERT in db.persistTransaction().
-- Children have no Supabase Auth session so the direct insert
-- would be blocked by RLS; the SECURITY DEFINER function
-- bypasses it safely.
CREATE OR REPLACE FUNCTION persist_transaction(
  p_child_id     uuid,
  p_type         text,
  p_amount       numeric,
  p_description  text,
  p_counterparty text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO transactions (child_id, type, amount, description, counterparty)
  VALUES (p_child_id, p_type, p_amount, p_description, p_counterparty);
END;
$$;
