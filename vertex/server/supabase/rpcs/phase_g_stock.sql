-- =============================================================================
-- Phase G: stock.ts — admin stock base mutations (4 transactions)
-- =============================================================================
--
-- TRANSACTION MAP:
--
-- Transaction 1: createStockBase
--   Operations: clear isDefault on all rows if new row is default; INSERT stock_bases
--   Atomicity reason: single-default invariant must not leave zero or multiple defaults
--   Inputs: name, glbPath, primarySide, isDefault, isActive, metadata
--   Outputs: created stock_bases row (all columns)
--
-- Transaction 2: updateStockBase
--   Operations: auto-promote replacement if turning off default; clear other defaults
--              if setting isDefault=true; UPDATE stock_bases with merged metadata
--   Atomicity reason: default promotion + update must be consistent
--   Inputs: id, optional name/primarySide/isDefault/isActive/metadata fields
--   Outputs: updated stock_bases row
--
-- Transaction 3: deleteStockBase
--   Operations: promote replacement if deleting default; DELETE stock_bases row
--   Atomicity reason: default must be reassigned before/at delete
--   Inputs: id
--   Outputs: { ok: true } — storage delete stays in application code (best-effort)
--
-- Transaction 4: ensureDefaultStockBase
--   Operations: clear all defaults; find by name or CREATE; set isDefault=true
--   Atomicity reason: single-default invariant during seed/upsert
--   Inputs: name, glbPath, primarySide, metadata
--   Outputs: stock_bases row
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vertex_create_stock_base
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vertex_create_stock_base(
    p_name text,
    p_glb_path text,
    p_primary_side text,
    p_is_default boolean,
    p_is_active boolean,
    p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row stock_bases%ROWTYPE;
BEGIN
    IF p_is_default AND NOT p_is_active THEN
        RAISE EXCEPTION 'CANNOT_DEFAULT_INACTIVE';
    END IF;

    IF p_is_default THEN
        UPDATE stock_bases SET "isDefault" = false, "updatedAt" = NOW() WHERE "isDefault" = true;
    END IF;

    INSERT INTO stock_bases (
        id,
        name,
        "glbPath",
        "primarySide",
        "isDefault",
        "isActive",
        metadata,
        "createdAt",
        "updatedAt"
    )
    VALUES (
        gen_random_uuid(),
        p_name,
        p_glb_path,
        p_primary_side,
        COALESCE(p_is_default, false),
        COALESCE(p_is_active, true),
        p_metadata,
        NOW(),
        NOW()
    )
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'name', v_row.name,
        'glbPath', v_row."glbPath",
        'primarySide', v_row."primarySide",
        'isDefault', v_row."isDefault",
        'isActive', v_row."isActive",
        'metadata', v_row.metadata,
        'createdAt', v_row."createdAt",
        'updatedAt', v_row."updatedAt"
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- vertex_update_stock_base
-- Pass existing snapshot fields so behavior matches pre-transaction read in TS.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vertex_update_stock_base(
    p_id uuid,
    p_existing_is_default boolean,
    p_existing_is_active boolean,
    p_existing_metadata jsonb,
    p_name text,
    p_primary_side text,
    p_is_default boolean,
    p_is_active boolean,
    p_metadata_patch jsonb,
    p_category text,
    p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row stock_bases%ROWTYPE;
    v_turning_off_default boolean;
    v_final_is_default boolean;
    v_final_is_active boolean;
    v_next_meta jsonb;
BEGIN
    v_final_is_default := COALESCE(p_is_default, p_existing_is_default);
    v_final_is_active := COALESCE(p_is_active, p_existing_is_active);

    IF p_is_default IS TRUE AND NOT v_final_is_active THEN
        RAISE EXCEPTION 'CANNOT_DEFAULT_INACTIVE';
    END IF;

    v_turning_off_default :=
        (p_existing_is_default AND p_is_active IS FALSE)
        OR (p_existing_is_default AND p_is_default IS FALSE);

    IF v_turning_off_default THEN
        UPDATE stock_bases sb
        SET "isDefault" = true, "updatedAt" = NOW()
        WHERE sb.id = (
            SELECT sb2.id
            FROM stock_bases sb2
            WHERE sb2."isActive" = true
              AND sb2.id <> p_id
            ORDER BY sb2."isDefault" DESC, sb2."createdAt" DESC
            LIMIT 1
        );
    END IF;

    IF p_is_default IS TRUE THEN
        UPDATE stock_bases SET "isDefault" = false, "updatedAt" = NOW()
        WHERE "isDefault" = true AND id <> p_id;
    END IF;

    v_next_meta := COALESCE(p_existing_metadata, '{}'::jsonb);
    IF p_metadata_patch IS NOT NULL THEN
        v_next_meta := v_next_meta || p_metadata_patch;
    END IF;
    IF p_category IS NOT NULL THEN
        v_next_meta := v_next_meta || jsonb_build_object('category', p_category);
    END IF;
    IF p_description IS NOT NULL THEN
        v_next_meta := v_next_meta || jsonb_build_object('description', p_description);
    END IF;

    UPDATE stock_bases
    SET
        name = COALESCE(p_name, name),
        "primarySide" = COALESCE(p_primary_side, "primarySide"),
        "isDefault" = CASE WHEN p_is_default IS NOT NULL THEN p_is_default ELSE "isDefault" END,
        "isActive" = CASE WHEN p_is_active IS NOT NULL THEN p_is_active ELSE "isActive" END,
        metadata = CASE
            WHEN p_metadata_patch IS NOT NULL OR p_category IS NOT NULL OR p_description IS NOT NULL
            THEN CASE WHEN v_next_meta = '{}'::jsonb THEN NULL ELSE v_next_meta END
            ELSE metadata
        END,
        "updatedAt" = NOW()
    WHERE id = p_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND';
    END IF;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'name', v_row.name,
        'glbPath', v_row."glbPath",
        'primarySide', v_row."primarySide",
        'isDefault', v_row."isDefault",
        'isActive', v_row."isActive",
        'metadata', v_row.metadata,
        'createdAt', v_row."createdAt",
        'updatedAt', v_row."updatedAt"
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- vertex_delete_stock_base
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vertex_delete_stock_base(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_was_default boolean;
BEGIN
    SELECT "isDefault" INTO v_was_default FROM stock_bases WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND';
    END IF;

    IF v_was_default THEN
        UPDATE stock_bases sb
        SET "isDefault" = true, "updatedAt" = NOW()
        WHERE sb.id = (
            SELECT sb2.id
            FROM stock_bases sb2
            WHERE sb2."isActive" = true
              AND sb2.id <> p_id
            ORDER BY sb2."isDefault" DESC, sb2."createdAt" DESC
            LIMIT 1
        );
    END IF;

    DELETE FROM stock_bases WHERE id = p_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;

-- -----------------------------------------------------------------------------
-- vertex_ensure_default_stock_base
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vertex_ensure_default_stock_base(
    p_name text,
    p_glb_path text,
    p_primary_side text,
    p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row stock_bases%ROWTYPE;
    v_existing_id uuid;
BEGIN
    UPDATE stock_bases SET "isDefault" = false, "updatedAt" = NOW() WHERE "isDefault" = true;

    SELECT id INTO v_existing_id FROM stock_bases WHERE name = p_name LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        UPDATE stock_bases
        SET
            "isDefault" = true,
            "isActive" = true,
            "glbPath" = p_glb_path,
            "primarySide" = COALESCE(p_primary_side, "primarySide"),
            metadata = p_metadata,
            "updatedAt" = NOW()
        WHERE id = v_existing_id
        RETURNING * INTO v_row;
    ELSE
        INSERT INTO stock_bases (
            id,
            name,
            "glbPath",
            "primarySide",
            "isDefault",
            "isActive",
            metadata,
            "createdAt",
            "updatedAt"
        )
        VALUES (
            gen_random_uuid(),
            p_name,
            p_glb_path,
            COALESCE(p_primary_side, 'right'),
            true,
            true,
            p_metadata,
            NOW(),
            NOW()
        )
        RETURNING * INTO v_row;
    END IF;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'name', v_row.name,
        'glbPath', v_row."glbPath",
        'primarySide', v_row."primarySide",
        'isDefault', v_row."isDefault",
        'isActive', v_row."isActive",
        'metadata', v_row.metadata,
        'createdAt', v_row."createdAt",
        'updatedAt', v_row."updatedAt"
    );
END;
$$;
