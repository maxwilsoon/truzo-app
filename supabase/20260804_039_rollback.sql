-- Migration 039 ROLLBACK — fail-closed
--
-- What stays locked after rollback (non-negotiable):
--   - Token reassignment: register_device_token is NOT restored to anon
--   - deregister_device_token(text): NOT restored — old 1-param overload permanently removed
--   - PUBLIC grants on all internal helpers, financial RPCs, and utility functions
--   - Auth guards on set_allowance_schedule, update_marketing_preference,
--     update_profile_image, update_parent_avatar, get_child_*_for_parent
--
-- What becomes unavailable:
--   - register_parent_device_token, register_child_device_token
--   - deregister_parent_device_token, deregister_child_device_token
--   - Push token registration is temporarily unavailable (honest consequence)
--   - Logout still works; login still works
--
-- Do NOT run this unless apply_039 has been confirmed to fail and needs rollback.

BEGIN;

DROP FUNCTION IF EXISTS public.register_parent_device_token(text, text, text, text);
DROP FUNCTION IF EXISTS public.register_child_device_token(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.deregister_parent_device_token(text);
DROP FUNCTION IF EXISTS public.deregister_child_device_token(text, uuid, text, text);

-- Reload schema so PostgREST reflects the drops
NOTIFY pgrst, 'reload schema';

COMMIT;
