-- Migration 040 ROLLBACK
--
-- Removes the authenticated grant added by 040. Restores anon-only state.
-- Effect: child login from a device with an active parent JWT will fail again.
-- Run this only if rolling back 040; do not run standalone.

REVOKE EXECUTE ON FUNCTION public.login_child(text, text, text)
  FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.biometric_login_child(uuid, text, text)
  FROM authenticated;
