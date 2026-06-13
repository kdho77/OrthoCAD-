-- =============================================================================
-- Phase D: manufacturing.ts — vertex_charge_manufacturing_hybrid
-- Deploy this file first (contains shared helpers used by later phases).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared helper: assert user has an active license (owner or seat).
-- Raises NO_VALID_LICENSE on failure.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vertex_assert_active_license(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM licenses l
        WHERE l.status = 'active'
          AND (
              l."ownerId" = p_user_id
              OR EXISTS (
                  SELECT 1
                  FROM license_seats ls
                  WHERE ls."licenseId" = l.id
                    AND ls."userId" = p_user_id
              )
          )
          AND (l."expiresAt" IS NULL OR l."expiresAt" > NOW())
    ) THEN
        RAISE EXCEPTION 'NO_VALID_LICENSE';
    END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Shared helper: atomic check-and-deduct token balance.
-- Returns new balance. Raises INSUFFICIENT_TOKENS on failure.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vertex_deduct_user_tokens(p_user_id uuid, p_cost int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_balance int;
BEGIN
    UPDATE users
    SET "tokenBalance" = "tokenBalance" - p_cost,
        "updatedAt" = NOW()
    WHERE id = p_user_id
      AND "tokenBalance" >= p_cost
    RETURNING "tokenBalance" INTO v_balance;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INSUFFICIENT_TOKENS';
    END IF;

    RETURN v_balance;
END;
$$;

-- -----------------------------------------------------------------------------
-- vertex_charge_manufacturing_hybrid
-- Atomic manufacturing charge: license check, token deduct, production record
-- (when design_id present), export record, token_transaction, audit_log.
-- Called after Python slicer returns output, before storage upload.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vertex_charge_manufacturing_hybrid(
    p_user_id uuid,
    p_cost int,
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
    v_production_id uuid;
    v_export_id uuid;
BEGIN
    PERFORM vertex_assert_active_license(p_user_id);
    v_balance := vertex_deduct_user_tokens(p_user_id, p_cost);

    IF p_design_id IS NOT NULL THEN
        INSERT INTO productions (
            id,
            "designId",
            method,
            "presetId",
            "beltAngleDeg",
            "layerHeightMm",
            material,
            "gcodeStorageKey",
            "createdAt"
        )
        VALUES (
            gen_random_uuid(),
            p_design_id,
            'printing_solid',
            p_preset_id,
            p_belt_angle_deg,
            COALESCE(p_layer_height_mm, 0.3),
            'TPU',
            CASE WHEN p_is_gcode THEN p_storage_key ELSE NULL END,
            NOW()
        )
        RETURNING id INTO v_production_id;
    END IF;

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
        COALESCE(v_production_id, v_export_id),
        p_metadata,
        p_ip,
        NOW()
    );

    RETURN jsonb_build_object(
        'productionId', v_production_id,
        'exportId', v_export_id,
        'balance', v_balance,
        'jobId', p_job_id
    );
END;
$$;
