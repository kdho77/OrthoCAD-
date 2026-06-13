-- =============================================================================
-- Phase H: admin.ts — vertex_grant_admin_tokens
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vertex_grant_admin_tokens
-- Atomic admin token grant/removal: balance increment, token_transaction,
-- audit_log. Pre-checks (non-zero amount, target exists, underflow) remain in
-- application code before calling this RPC.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vertex_grant_admin_tokens(
    p_actor_user_id uuid,
    p_target_user_id uuid,
    p_amount int,
    p_reason text,
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
    UPDATE users
    SET
        "tokenBalance" = "tokenBalance" + p_amount,
        "updatedAt" = NOW()
    WHERE id = p_target_user_id
    RETURNING "tokenBalance" INTO v_balance;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND';
    END IF;

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
        p_target_user_id,
        CASE WHEN p_amount >= 0 THEN 'grant'::"TokenTxnType" ELSE 'adjustment'::"TokenTxnType" END,
        p_amount,
        v_balance,
        COALESCE(p_reason, 'admin grant'),
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
        p_actor_user_id,
        'tokens_granted',
        p_target_user_id,
        jsonb_build_object('amount', p_amount, 'balance', v_balance),
        p_ip,
        NOW()
    );

    RETURN jsonb_build_object('ok', true, 'balance', v_balance);
END;
$$;
