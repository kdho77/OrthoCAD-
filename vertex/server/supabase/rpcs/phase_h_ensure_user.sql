-- =============================================================================
-- Phase H: ensure-user.ts — vertex_ensure_app_user
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vertex_ensure_app_user
-- Mirror a Supabase-authenticated user into app `users` on first request.
-- Matches ensureAppUser() upsert with empty update (insert-if-missing only).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vertex_ensure_app_user(
    p_user_id uuid,
    p_email text,
    p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO users (
        id,
        email,
        role,
        "createdAt",
        "updatedAt"
    )
    VALUES (
        p_user_id,
        p_email,
        p_role::"Role",
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;
END;
$$;
