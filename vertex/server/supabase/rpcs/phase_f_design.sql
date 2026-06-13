-- =============================================================================
-- Phase F: design.ts — vertex_save_design
-- =============================================================================
--
-- TRANSACTION COMPLEXITY ASSESSMENT:
--   1 transaction block in design.save
--   Operations (atomic):
--     - UPDATE designs header (name, pattern, method, thicknessMm, unit, linked)
--     - DELETE all corrections for design
--     - DELETE all elements for design
--     - INSERT corrections for left + right sides
--     - INSERT elements (0..N)
--     - INSERT audit_log (design_updated)
--   Data shape: relational corrections (per-side numeric fields) + elements array.
--   JSON fields: corrections/elements passed as jsonb; stored without transformation
--   beyond column mapping. trimlines in client state are NOT persisted (unchanged).
--   No nested transactions or conditional branches beyond elements.length > 0.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vertex_save_design
-- Atomic full design persist: header + replace corrections/elements + audit.
-- Ownership is verified in application code before calling this RPC.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vertex_save_design(
    p_user_id uuid,
    p_design_id uuid,
    p_name text,
    p_pattern text,
    p_method text,
    p_thickness_mm double precision,
    p_unit text,
    p_linked boolean,
    p_corrections jsonb,
    p_elements jsonb,
    p_ip text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_left jsonb;
    v_right jsonb;
    v_elem jsonb;
BEGIN
    UPDATE designs
    SET
        name = p_name,
        pattern = p_pattern::"ScanPattern",
        method = p_method::"ProductionMethod",
        "thicknessMm" = p_thickness_mm,
        unit = p_unit::"Unit",
        linked = p_linked,
        "updatedAt" = NOW()
    WHERE id = p_design_id;

    DELETE FROM corrections WHERE "designId" = p_design_id;
    DELETE FROM elements WHERE "designId" = p_design_id;

    v_left := p_corrections -> 'left';
    v_right := p_corrections -> 'right';

    INSERT INTO corrections (
        id,
        "designId",
        side,
        "forefootPostingDeg",
        "rearfootPostingDeg",
        "medialSkiveMm",
        "lateralSkiveMm",
        "archFillMm",
        "archHeightMm",
        "heelCupDepthMm",
        "heelCupHeightMm",
        "apexMoveMm",
        "medialFlangeMm",
        "lateralFlangeMm"
    )
    VALUES
        (
            gen_random_uuid(),
            p_design_id,
            'left',
            COALESCE((v_left ->> 'forefootPostingDeg')::double precision, 0),
            COALESCE((v_left ->> 'rearfootPostingDeg')::double precision, 0),
            COALESCE((v_left ->> 'medialSkiveMm')::double precision, 0),
            COALESCE((v_left ->> 'lateralSkiveMm')::double precision, 0),
            COALESCE((v_left ->> 'archFillMm')::double precision, 0),
            COALESCE((v_left ->> 'archHeightMm')::double precision, 0),
            COALESCE((v_left ->> 'heelCupDepthMm')::double precision, 0),
            COALESCE((v_left ->> 'heelCupHeightMm')::double precision, 0),
            COALESCE((v_left ->> 'apexMoveMm')::double precision, 0),
            COALESCE((v_left ->> 'medialFlangeMm')::double precision, 0),
            COALESCE((v_left ->> 'lateralFlangeMm')::double precision, 0)
        ),
        (
            gen_random_uuid(),
            p_design_id,
            'right',
            COALESCE((v_right ->> 'forefootPostingDeg')::double precision, 0),
            COALESCE((v_right ->> 'rearfootPostingDeg')::double precision, 0),
            COALESCE((v_right ->> 'medialSkiveMm')::double precision, 0),
            COALESCE((v_right ->> 'lateralSkiveMm')::double precision, 0),
            COALESCE((v_right ->> 'archFillMm')::double precision, 0),
            COALESCE((v_right ->> 'archHeightMm')::double precision, 0),
            COALESCE((v_right ->> 'heelCupDepthMm')::double precision, 0),
            COALESCE((v_right ->> 'heelCupHeightMm')::double precision, 0),
            COALESCE((v_right ->> 'apexMoveMm')::double precision, 0),
            COALESCE((v_right ->> 'medialFlangeMm')::double precision, 0),
            COALESCE((v_right ->> 'lateralFlangeMm')::double precision, 0)
        );

    IF p_elements IS NOT NULL AND jsonb_array_length(p_elements) > 0 THEN
        FOR v_elem IN SELECT value FROM jsonb_array_elements(p_elements)
        LOOP
            INSERT INTO elements (
                id,
                "designId",
                side,
                kind,
                "posX",
                "posY",
                "rotationDeg",
                "scaleX",
                "scaleY",
                "heightMm",
                "createdAt"
            )
            VALUES (
                gen_random_uuid(),
                p_design_id,
                (v_elem ->> 'side')::"Side",
                v_elem ->> 'kind',
                COALESCE((v_elem -> 'position' ->> 'x')::double precision, 0),
                COALESCE((v_elem -> 'position' ->> 'y')::double precision, 0),
                COALESCE((v_elem ->> 'rotationDeg')::double precision, 0),
                COALESCE((v_elem -> 'scale' ->> 'x')::double precision, 1),
                COALESCE((v_elem -> 'scale' ->> 'y')::double precision, 1),
                COALESCE((v_elem ->> 'heightMm')::double precision, 4),
                NOW()
            );
        END LOOP;
    END IF;

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
        'design_updated',
        p_design_id,
        NULL,
        p_ip,
        NOW()
    );

    RETURN jsonb_build_object('ok', true);
END;
$$;
