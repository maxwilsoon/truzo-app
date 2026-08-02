-- Rollback 024: Recreate admin views (without anon/authenticated grants)
--
-- WARNING: These views are cross-family data dumps that bypass RLS.
-- They are recreated here for rollback completeness only.
-- DO NOT grant SELECT to anon or authenticated — the original grants
-- were the vulnerability. Use the Supabase Dashboard table browser
-- for admin access instead.

BEGIN;

CREATE OR REPLACE VIEW public.family_accounts AS
SELECT
  p.id              AS parent_id,
  p.first_name,
  p.last_name,
  p.display_name    AS parent_display_name,
  p.email           AS parent_email,
  p.mobile          AS parent_mobile,
  p.address         AS parent_address,
  c.id              AS child_id,
  c.display_name    AS child_display_name,
  c.username        AS child_username,
  c.mobile          AS child_mobile,
  c.age             AS child_age,
  c.wallet_balance,
  c.trust_score,
  c.biometric_enabled
FROM parents p
LEFT JOIN children c ON c.parent_id = p.id;

CREATE OR REPLACE VIEW public.family_overview AS
SELECT
  p.id              AS parent_id,
  p.display_name    AS parent_name,
  p.email,
  COUNT(c.id)       AS child_count,
  SUM(c.wallet_balance) AS total_balance
FROM parents p
LEFT JOIN children c ON c.parent_id = p.id
GROUP BY p.id, p.display_name, p.email;

CREATE OR REPLACE VIEW public.admin_families AS
SELECT
  p.id              AS parent_id,
  p.first_name,
  p.last_name,
  p.email           AS parent_email,
  p.mobile          AS parent_mobile,
  c.id              AS child_id,
  c.display_name    AS child_name,
  c.username,
  c.wallet_balance,
  c.trust_score
FROM parents p
LEFT JOIN children c ON c.parent_id = p.id;

-- Grant to service_role only — explicitly revoke anon/authenticated
REVOKE ALL ON public.family_accounts    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.family_overview    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.admin_families     FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.family_accounts  TO service_role;
GRANT SELECT ON public.family_overview  TO service_role;
GRANT SELECT ON public.admin_families   TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
