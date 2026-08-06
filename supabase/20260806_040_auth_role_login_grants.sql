-- Migration 040: Grant login_child and biometric_login_child to authenticated role
--
-- Problem: When a parent Supabase Auth session is active on a device (authenticated
-- role), attempts to call login_child or biometric_login_child for a child-login
-- flow fail with [42501] permission denied. Both functions were granted only to anon.
-- On devices where no parent JWT is held (iPhone in practice, new installs), the
-- call succeeds because it goes through as anon. On Android — or any device that
-- retains a parent Auth session while the child tries to log in — the RPC runs as
-- authenticated and is denied.
--
-- Fix: add EXECUTE to authenticated for both functions. These are SECURITY DEFINER
-- functions (run as postgres owner); granting authenticated EXECUTE changes only who
-- may call them, not what they can read. All internal guards remain:
--   • Two-layer rate limiting (device + account for login_child; device for biometric)
--   • bcrypt/bcrypt-hash-format guard (login_child / verify_parent_passcode)
--   • SHA-256 token verification (biometric_login_child)
--   • CSPRNG session issuance
--   • revoke_all_child_sessions() on every successful login
--   • No auth.uid() dependency — deliberate; child auth is credential-based
--
-- PUBLIC is NOT granted. anon is unchanged.

GRANT EXECUTE ON FUNCTION public.login_child(text, text, text)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.biometric_login_child(uuid, text, text)
  TO authenticated;
