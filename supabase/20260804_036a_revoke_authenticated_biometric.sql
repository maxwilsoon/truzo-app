-- Migration 036a: Supplementary fix — remove unintended authenticated grants
--                 from biometric functions created by migration 036.
--
-- Root cause: the Supabase project has ALTER DEFAULT PRIVILEGES configured to
-- grant EXECUTE on new public-schema functions to the authenticated role. When
-- migration 036 issued DROP + CREATE for enable_biometric and disable_biometric,
-- the default privilege attached before the explicit REVOKE/GRANT ran. The
-- migration's REVOKE ALL FROM PUBLIC removed the PUBLIC grant but did not
-- explicitly target the authenticated role, leaving it in place.
--
-- Both functions are child-facing RPCs (anon-callable). Parents (authenticated)
-- must not call them. The internal require_valid_child_session() check provides
-- defence-in-depth, but the grant principle requires authenticated to be absent.
--
-- Live-database fix was applied on 2026-08-04 before this migration file was
-- committed. This file documents and version-controls that change so a fresh
-- database reaches the same state. It is idempotent — safe to run even if
-- authenticated was never granted.
--
-- Rollback: not applicable — REVOKE authenticated is a security improvement and
-- must not be reversed.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.enable_biometric(uuid, text, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.disable_biometric(uuid, text, text)      FROM authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
