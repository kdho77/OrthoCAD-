-- Additive CAD-operator production status.
-- Existing productions rows default to succeeded. The human charge RPC is unchanged.
-- Do not apply this file to production from the agent. Apply it before deploy.
-- productions has no RLS in prior migrations. This migration adds no policy and no grant
-- beyond the same PUBLIC execute default used by vertex_charge_manufacturing_hybrid.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CadProductionStatus') THEN
        CREATE TYPE "CadProductionStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');
    END IF;
END $$;

ALTER TABLE "productions" ADD COLUMN IF NOT EXISTS "status" "CadProductionStatus" NOT NULL DEFAULT 'succeeded';
ALTER TABLE "productions" ADD COLUMN IF NOT EXISTS "side" "Side";
ALTER TABLE "productions" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "productions" ADD COLUMN IF NOT EXISTS "settingsFingerprint" TEXT;
ALTER TABLE "productions" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE "productions" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "productions" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "productions" ADD COLUMN IF NOT EXISTS "chargedAt" TIMESTAMP(3);
ALTER TABLE "productions" ADD COLUMN IF NOT EXISTS "exportId" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "productions_idempotencyKey_key" ON "productions"("idempotencyKey");

-- Charge an existing CAD-operator production exactly once.
-- Same license check, token deduct, export, token_transaction, and audit_log as
-- vertex_charge_manufacturing_hybrid. Does not insert a second productions row.
-- A second call sees chargedAt and does not deduct again.
CREATE OR REPLACE FUNCTION vertex_charge_existing_production(
    p_user_id uuid,
    p_cost int,
    p_production_id uuid,
    p_design_id uuid,
    p_export_format text,
    p_side text,
    p_file_name text,
    p_preset_id text,
    p_belt_angle_deg double precision,
    p_layer_height_mm double precision,
    p_is_gcode boolean,
    p_storage_key text,
    p_job_id text,
    p_ip text,
    p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_balance int;
    v_export_id uuid;
    v_charged_at timestamp;
    v_existing_export uuid;
    v_design_id uuid;
BEGIN
    SELECT "designId", "chargedAt", "exportId"
      INTO v_design_id, v_charged_at, v_existing_export
      FROM productions
     WHERE id = p_production_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCTION_NOT_FOUND';
    END IF;

    IF v_design_id IS DISTINCT FROM p_design_id THEN
        RAISE EXCEPTION 'PRODUCTION_DESIGN_MISMATCH';
    END IF;

    IF v_charged_at IS NOT NULL THEN
        SELECT "tokenBalance" INTO v_balance FROM users WHERE id = p_user_id;
        RETURN jsonb_build_object(
            'productionId', p_production_id,
            'exportId', v_existing_export,
            'balance', v_balance,
            'jobId', p_job_id,
            'alreadyCharged', true
        );
    END IF;

    PERFORM vertex_assert_active_license(p_user_id);
    v_balance := vertex_deduct_user_tokens(p_user_id, p_cost);

    INSERT INTO exports (
        id,
        "designId",
        "userId",
        format,
        side,
        "tokenCost",
        "storageKey",
        "fileName",
        "createdAt"
    )
    VALUES (
        gen_random_uuid(),
        p_design_id,
        p_user_id,
        p_export_format::"ExportFormat",
        CASE WHEN p_side IS NULL THEN NULL ELSE p_side::"Side" END,
        p_cost,
        NULL,
        p_file_name,
        NOW()
    )
    RETURNING id INTO v_export_id;

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
        'manufacturing:hybrid_gcode',
        v_export_id,
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
        'export_generated',
        p_production_id,
        p_metadata,
        p_ip,
        NOW()
    );

    UPDATE productions
       SET "gcodeStorageKey" = CASE WHEN p_is_gcode THEN p_storage_key ELSE "gcodeStorageKey" END,
           "chargedAt" = NOW(),
           "exportId" = v_export_id,
           "updatedAt" = NOW(),
           "presetId" = p_preset_id,
           "beltAngleDeg" = p_belt_angle_deg,
           "layerHeightMm" = COALESCE(p_layer_height_mm, "layerHeightMm")
     WHERE id = p_production_id
       AND "chargedAt" IS NULL;

    RETURN jsonb_build_object(
        'productionId', p_production_id,
        'exportId', v_export_id,
        'balance', v_balance,
        'jobId', p_job_id,
        'alreadyCharged', false
    );
END;
$$;
