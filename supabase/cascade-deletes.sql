-- ============================================================
-- Cascade deletes: removing a parent row wipes everything
-- belonging to that family — child, transactions, activity,
-- circle connections, and the Supabase Auth user.
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to run more than once (all steps are idempotent).
-- ============================================================


-- ── 1. children.parent_id → parents.id ───────────────────────
-- When a parent row is deleted, their linked child is deleted too.

ALTER TABLE children
  DROP CONSTRAINT IF EXISTS children_parent_id_fkey;

ALTER TABLE children
  ADD CONSTRAINT children_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE;


-- ── 2. transactions.child_id → children.id ───────────────────
-- When a child is deleted, all of their transactions go with them.

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_child_id_fkey;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_child_id_fkey
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE;


-- ── 3. activity_feed.child_id → children.id ──────────────────
-- When a child is deleted, their activity feed is cleared too.

ALTER TABLE activity_feed
  DROP CONSTRAINT IF EXISTS activity_feed_child_id_fkey;

ALTER TABLE activity_feed
  ADD CONSTRAINT activity_feed_child_id_fkey
  FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE;


-- ── 4. circle_requests: both participant columns ──────────────
-- Deleting a child removes every request they sent or received.

ALTER TABLE circle_requests
  DROP CONSTRAINT IF EXISTS circle_requests_from_id_fkey;

ALTER TABLE circle_requests
  ADD CONSTRAINT circle_requests_from_id_fkey
  FOREIGN KEY (from_id) REFERENCES children(id) ON DELETE CASCADE;

ALTER TABLE circle_requests
  DROP CONSTRAINT IF EXISTS circle_requests_to_id_fkey;

ALTER TABLE circle_requests
  ADD CONSTRAINT circle_requests_to_id_fkey
  FOREIGN KEY (to_id) REFERENCES children(id) ON DELETE CASCADE;


-- ── 5. circle_members (accepted friendships) ─────────────────
-- Deleting a child removes them from every circle they joined.
-- Handles the most common column-naming patterns; adjust if yours differ.

DO $$
BEGIN
  -- child_id column
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'circle_members' AND column_name = 'child_id'
  ) THEN
    ALTER TABLE circle_members
      DROP CONSTRAINT IF EXISTS circle_members_child_id_fkey;
    ALTER TABLE circle_members
      ADD CONSTRAINT circle_members_child_id_fkey
      FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE;
  END IF;

  -- friend_id column
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'circle_members' AND column_name = 'friend_id'
  ) THEN
    ALTER TABLE circle_members
      DROP CONSTRAINT IF EXISTS circle_members_friend_id_fkey;
    ALTER TABLE circle_members
      ADD CONSTRAINT circle_members_friend_id_fkey
      FOREIGN KEY (friend_id) REFERENCES children(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ── 6. Trigger: delete Supabase Auth user when parent row is deleted ──
-- This keeps auth.users in sync so the deleted parent can't be left as
-- a ghost account that would block re-registration with the same email.

CREATE OR REPLACE FUNCTION fn_delete_auth_user_on_parent_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_auth_user ON parents;

CREATE TRIGGER trg_delete_auth_user
  AFTER DELETE ON parents
  FOR EACH ROW
  EXECUTE FUNCTION fn_delete_auth_user_on_parent_delete();
