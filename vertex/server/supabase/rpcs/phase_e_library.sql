-- =============================================================================
-- Phase E: library.ts — vertex_charge_library_save
-- Requires phase_d shared helpers (vertex_deduct_user_tokens) deployed first.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vertex_charge_library_save
-- Atomic token deduct + token_transaction + audit_log after library item
-- row is created. Matches deductSaveTokens() transaction in library.ts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vertex_charge_library_save(
    p_user_id uuid,
    p_cost int,
    p_reason text,
    p_target_id uuid,
    p_metadata jsonb,
    p_ip text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_balance int;
BEGIN
    v_balance := vertex_deduct_user_tokens(p_user_id, p_cost);

    INSERT INTO token_transactions (
        id,
        "userId",
        type,
        amount,
        balance,
        reason,
        "exportId",
        "createdAt"
    )
    VALUES (
        gen_random_uuid(),
        p_user_id,
        'deduct',
        -p_cost,
        v_balance,
        p_reason,
        NULL,
        NOW()
    );

    INSERT INTO audit_logs (
        id,
        "userId",
        action,
        "targetId",
        metadata,
        "ipAddress",
        "createdAt"
    )
    VALUES (
        gen_random_uuid(),
        p_user_id,
        'custom_library_saved',
        p_target_id,
        p_metadata,
        p_ip,
        NOW()
    );

    RETURN jsonb_build_object('balance', v_balance);
END;
$$;
