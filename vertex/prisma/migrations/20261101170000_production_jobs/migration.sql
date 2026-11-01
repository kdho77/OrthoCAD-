-- Production queue, printer shell, and stored G-code.
-- G-code is the exact text for a job (sha256 in job_gcode.sha256). It is not a
-- customer record. The design row is not dropped when this text expires.
-- Existing `productions` rows (slice settings) are left unchanged.
--
-- Do not apply this file to production. The Founder approves production migrations.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'job_queued';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'job_assigned';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'job_held';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'job_cancelled';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'job_retried';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'job_completed';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'job_requeued';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShopProcess') THEN
        CREATE TYPE "ShopProcess" AS ENUM ('print', 'mill');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShopJobStatus') THEN
        CREATE TYPE "ShopJobStatus" AS ENUM ('waiting', 'assigned', 'running', 'paused', 'held', 'failed', 'done', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PrinterState') THEN
        CREATE TYPE "PrinterState" AS ENUM ('idle', 'running', 'paused', 'error', 'offline');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "shop_printers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "state" "PrinterState" NOT NULL DEFAULT 'idle',
    "ownerId" UUID NOT NULL,
    "tenantId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shop_printers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shop_jobs" (
    "id" UUID NOT NULL,
    "designId" UUID NOT NULL,
    "designName" TEXT NOT NULL,
    "designKind" "DesignKind" NOT NULL DEFAULT 'insole',
    "clientId" UUID NOT NULL,
    "clientLabel" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "tenantId" UUID,
    "process" "ShopProcess" NOT NULL,
    "status" "ShopJobStatus" NOT NULL DEFAULT 'waiting',
    "orderNumber" TEXT,
    "orderUrl" TEXT,
    "orderOpen" BOOLEAN NOT NULL DEFAULT false,
    "printerId" UUID,
    "printerName" TEXT,
    "dueAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "operatorName" TEXT,
    "failureReason" TEXT,
    "progress" INTEGER,
    "gcodeSha256" TEXT,
    "gcodeStoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shop_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "job_gcode" (
    "jobId" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "storedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "job_gcode_pkey" PRIMARY KEY ("jobId")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_printers_ownerId_fkey') THEN
        ALTER TABLE "shop_printers"
            ADD CONSTRAINT "shop_printers_ownerId_fkey"
            FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_printers_tenantId_fkey') THEN
        ALTER TABLE "shop_printers"
            ADD CONSTRAINT "shop_printers_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_jobs_designId_fkey') THEN
        ALTER TABLE "shop_jobs"
            ADD CONSTRAINT "shop_jobs_designId_fkey"
            FOREIGN KEY ("designId") REFERENCES "designs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_jobs_clientId_fkey') THEN
        ALTER TABLE "shop_jobs"
            ADD CONSTRAINT "shop_jobs_clientId_fkey"
            FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_jobs_ownerId_fkey') THEN
        ALTER TABLE "shop_jobs"
            ADD CONSTRAINT "shop_jobs_ownerId_fkey"
            FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_jobs_tenantId_fkey') THEN
        ALTER TABLE "shop_jobs"
            ADD CONSTRAINT "shop_jobs_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_gcode_jobId_fkey') THEN
        ALTER TABLE "job_gcode"
            ADD CONSTRAINT "job_gcode_jobId_fkey"
            FOREIGN KEY ("jobId") REFERENCES "shop_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "shop_printers_tenantId_idx" ON "shop_printers"("tenantId");
CREATE INDEX IF NOT EXISTS "shop_jobs_tenantId_idx" ON "shop_jobs"("tenantId");
CREATE INDEX IF NOT EXISTS "shop_jobs_status_idx" ON "shop_jobs"("status");
CREATE INDEX IF NOT EXISTS "shop_jobs_dueAt_idx" ON "shop_jobs"("dueAt");
CREATE INDEX IF NOT EXISTS "shop_jobs_designId_idx" ON "shop_jobs"("designId");
