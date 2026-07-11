-- ============================================================
-- Truzo Admin Views
-- Run these in the Supabase SQL Editor (Dashboard → SQL Editor)
-- They will appear as tables in the Table Editor for easy browsing.
-- ============================================================


-- ─── 1. family_accounts ──────────────────────────────────────
-- One row per family. Shows parent + their linked child side by side.
-- Use this as your primary admin view to see who belongs to whom.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW family_accounts AS
SELECT
  -- Parent details
  p.id                                                          AS parent_id,
  TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,''))
                                                                AS parent_name,
  p.email                                                       AS parent_email,
  p.mobile                                                      AS parent_mobile,
  p.address                                                     AS parent_address,
  p.safety_pool_limit,
  p.weekly_allowance,
  p.passcode IS NOT NULL AND p.passcode <> ''                   AS parent_has_pin,
  p.created_at                                                  AS parent_joined,

  -- Child details (NULL if no child yet)
  c.id                                                          AS child_id,
  c.display_name                                                AS child_name,
  c.username                                                    AS child_username,
  c.age                                                         AS child_age,
  c.mobile                                                      AS child_mobile,
  c.wallet_balance                                              AS child_balance,
  c.trust_score                                                 AS child_trust_score,
  c.streak                                                      AS child_streak,
  c.repaid                                                      AS child_repaid,
  c.missed                                                      AS child_missed,
  c.total_borrowed                                              AS child_total_borrowed,
  c.total_lent                                                  AS child_total_lent,
  c.biometric_enabled                                           AS child_face_id,
  c.created_at                                                  AS child_joined

FROM parents p
LEFT JOIN children c ON c.parent_id = p.id
ORDER BY p.last_name, p.first_name;


-- ─── 2. family_summary ───────────────────────────────────────
-- Compact one-liner per family. Good for a quick headcount.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW family_summary AS
SELECT
  TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,''))
                        AS parent_name,
  p.email               AS parent_email,
  c.display_name        AS child_name,
  c.username            AS child_username,
  c.wallet_balance      AS child_balance,
  c.trust_score         AS child_trust_score,
  p.created_at::date    AS joined
FROM parents p
LEFT JOIN children c ON c.parent_id = p.id
ORDER BY p.last_name, p.first_name;


-- ─── 3. child_with_parent ────────────────────────────────────
-- Child-first view. When looking at a child record, instantly
-- shows their linked parent without needing to look up the UUID.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW child_with_parent AS
SELECT
  -- Child
  c.id                  AS child_id,
  c.display_name        AS child_name,
  c.username,
  c.age,
  c.wallet_balance,
  c.trust_score,
  c.streak,

  -- Their parent
  c.parent_id,
  TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,''))
                        AS parent_name,
  p.email               AS parent_email,
  p.mobile              AS parent_mobile

FROM children c
JOIN parents p ON p.id = c.parent_id
ORDER BY c.display_name;
