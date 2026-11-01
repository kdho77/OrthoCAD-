-- Slice jobs: one row per (user, idempotency key). Token deduct happens only
-- in vertex_settle_slice_success, in the same transaction as the succeeded mark.
-- Failure, timeout, and cancellation leave tokenCost at 0.

CREATE TYPE "SliceJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

CREATE TABLE "slice_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "SliceJobStatus" NOT NULL DEFAULT 'queued',
    "designId" UUID,
    "stlUrl" TEXT,
    "stlStorageKey" TEXT,
    "profileId" TEXT NOT NULL,
    "material" TEXT,
    "side" TEXT,
    "process" TEXT,
    "error" TEXT,
    "gcodeStorageKey" TEXT,
    "productionId" UUID,
    "exportId" UUID,
    "tokenCost" INTEGER NOT NULL DEFAULT 0,
    "charged" BOOLEAN NOT NULL DEFAULT false,
    "balanceAfter" INTEGER,
    "fileName" TEXT,
    "request" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "slice_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "slice_jobs_userId_idempotencyKey_key" ON "slice_jobs"("userId", "idempotencyKey");
CREATE INDEX "slice_jobs_userId_createdAt_idx" ON "slice_jobs"("userId", "createdAt");

ALTER TABLE "slice_jobs"
    ADD CONSTRAINT "slice_jobs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Claim queued work, or reclaim a running job whose heartbeat is older than 30s.
CREATE OR REPLACE FUNCTION vertex_claim_slice_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    UPDATE slice_jobs
    SET status = 'running',
        "updatedAt" = NOW()
    WHERE id = p_job_id
      AND charged = false
      AND (
          status = 'queued'
          OR (status = 'running' AND "updatedAt" < NOW() - INTERVAL '30 seconds')
      )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('claimed', v_id IS NOT NULL);
END;
$$;

-- Terminal failure. Never refunds and never overwrites a succeeded charge.
CREATE OR REPLACE FUNCTION vertex_fail_slice_job(p_job_id uuid, p_error text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job slice_jobs%ROWTYPE;
BEGIN
    SELECT * INTO v_job FROM slice_jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND';
    END IF;
    IF v_job.status = 'succeeded' OR v_job.charged OR v_job.status = 'failed' THEN
        RETURN jsonb_build_object('status', v_job.status, 'charged', v_job.charged);
    END IF;

    UPDATE slice_jobs
    SET status = 'failed',
        error = left(COALESCE(p_error, 'failed'), 500),
        "tokenCost" = 0,
        charged = false,
        "updatedAt" = NOW()
    WHERE id = p_job_id;

    RETURN jsonb_build_object('status', 'failed', 'charged', false);
END;
$$;

-- Mark succeeded and deduct exactly 1 token. A second caller sees charged=true
-- and does not deduct. Timeout and insufficient balance fail the job with no deduct.
CREATE OR REPLACE FUNCTION vertex_settle_slice_success(
    p_job_id uuid,
    p_gcode_storage_key text,
    p_file_name text,
    p_timeout_seconds int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job slice_jobs%ROWTYPE;
    v_balance int;
    v_production_id uuid;
    v_export_id uuid;
    v_timeout int;
BEGIN
    v_timeout := COALESCE(p_timeout_seconds, 600);

    SELECT * INTO v_job FROM slice_jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND';
    END IF;

    SELECT "tokenBalance" INTO v_balance FROM users WHERE id = v_job."userId";

    IF v_job.status = 'succeeded' OR v_job.charged THEN
        RETURN jsonb_build_object(
            'charged', false,
            'balance', COALESCE(v_job."balanceAfter", v_balance),
            'status', v_job.status,
            'jobId', v_job.id,
            'productionId', v_job."productionId",
            'exportId', v_job."exportId",
            'gcodeStorageKey', v_job."gcodeStorageKey",
            'tokenCost', v_job."tokenCost"
        );
    END IF;

    IF v_job.status = 'failed' THEN
        RETURN jsonb_build_object(
            'charged', false,
            'balance', v_balance,
            'status', 'failed',
            'error', v_job.error,
            'jobId', v_job.id,
            'tokenCost', 0
        );
    END IF;

    IF v_job."createdAt" < NOW() - make_interval(secs => v_timeout) THEN
        UPDATE slice_jobs
        SET status = 'failed',
            error = 'timeout',
            "tokenCost" = 0,
            charged = false,
            "updatedAt" = NOW()
        WHERE id = p_job_id;
        RETURN jsonb_build_object(
            'charged', false,
            'balance', v_balance,
            'status', 'failed',
            'error', 'timeout',
            'jobId', v_job.id,
            'tokenCost', 0
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM licenses l
        WHERE l.status = 'active'
          AND (
              l."ownerId" = v_job."userId"
              OR EXISTS (
                  SELECT 1 FROM license_seats ls
                  WHERE ls."licenseId" = l.id AND ls."userId" = v_job."userId"
              )
          )
          AND (l."expiresAt" IS NULL OR l."expiresAt" > NOW())
    ) THEN
        UPDATE slice_jobs
        SET status = 'failed',
            error = 'NO_VALID_LICENSE',
            "tokenCost" = 0,
            charged = false,
            "updatedAt" = NOW()
        WHERE id = p_job_id;
        RETURN jsonb_build_object(
            'charged', false,
            'balance', v_balance,
            'status', 'failed',
            'error', 'NO_VALID_LICENSE',
            'jobId', v_job.id,
            'tokenCost', 0
        );
    END IF;

    UPDATE users
    SET "tokenBalance" = "tokenBalance" - 1,
        "updatedAt" = NOW()
    WHERE id = v_job."userId"
      AND "tokenBalance" >= 1
    RETURNING "tokenBalance" INTO v_balance;

    IF NOT FOUND THEN
        UPDATE slice_jobs
        SET status = 'failed',
            error = 'INSUFFICIENT_TOKENS',
            "tokenCost" = 0,
            charged = false,
            "updatedAt" = NOW()
        WHERE id = p_job_id;
        SELECT "tokenBalance" INTO v_balance FROM users WHERE id = v_job."userId";
        RETURN jsonb_build_object(
            'charged', false,
            'balance', v_balance,
            'status', 'failed',
            'error', 'INSUFFICIENT_TOKENS',
            'jobId', v_job.id,
            'tokenCost', 0
        );
    END IF;

    IF v_job."designId" IS NOT NULL THEN
        INSERT INTO productions (
            id, "designId", method, "presetId", "beltAngleDeg", "layerHeightMm",
            material, "gcodeStorageKey", "createdAt"
        )
        VALUES (
            gen_random_uuid(),
            v_job."designId",
            'printing_solid',
            v_job."profileId",
            COALESCE((v_job.request->>'beltAngleDeg')::double precision, 45),
            COALESCE((v_job.request->>'layerHeightMm')::double precision, 0.3),
            'TPU',
            p_gcode_storage_key,
            NOW()
        )
        RETURNING id INTO v_production_id;
    END IF;

    INSERT INTO exports (
        id, "designId", "userId", format, side, "tokenCost", "fileName", "storageKey", "createdAt"
    )
    VALUES (
        gen_random_uuid(),
        v_job."designId",
        v_job."userId",
        'gcode'::"ExportFormat",
        CASE
            WHEN v_job.side IN ('left', 'right') THEN v_job.side::"Side"
            ELSE NULL
        END,
        1,
        COALESCE(p_file_name, v_job."fileName"),
        p_gcode_storage_key,
        NOW()
    )
    RETURNING id INTO v_export_id;

    INSERT INTO token_transactions (
        id, "userId", type, amount, balance, reason, "exportId", "createdAt"
    )
    VALUES (
        gen_random_uuid(),
        v_job."userId",
        'deduct',
        -1,
        v_balance,
        'manufacturing:slice',
        v_export_id,
        NOW()
    );

    INSERT INTO audit_logs (
        id, "userId", action, "targetId", metadata, "createdAt"
    )
    VALUES (
        gen_random_uuid(),
        v_job."userId",
        'export_generated',
        COALESCE(v_production_id, v_export_id),
        jsonb_build_object(
            'kind', 'slice',
            'tokenCost', 1,
            'idempotencyKey', v_job."idempotencyKey",
            'profileId', v_job."profileId",
            'material', v_job.material
        ),
        NOW()
    );

    UPDATE slice_jobs
    SET status = 'succeeded',
        charged = true,
        "tokenCost" = 1,
        "balanceAfter" = v_balance,
        "gcodeStorageKey" = p_gcode_storage_key,
        "productionId" = v_production_id,
        "exportId" = v_export_id,
        "fileName" = COALESCE(p_file_name, "fileName"),
        error = NULL,
        "updatedAt" = NOW()
    WHERE id = p_job_id;

    RETURN jsonb_build_object(
        'charged', true,
        'balance', v_balance,
        'status', 'succeeded',
        'jobId', v_job.id,
        'productionId', v_production_id,
        'exportId', v_export_id,
        'gcodeStorageKey', p_gcode_storage_key,
        'tokenCost', 1
    );
END;
$$;
