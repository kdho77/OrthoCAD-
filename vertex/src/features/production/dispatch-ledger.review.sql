-- Dispatch ledger review SQL for the print-farm software seam.
--
-- DO NOT APPLY this file.
-- DO NOT copy it into vertex/prisma/migrations.
-- Render start runs `npx prisma migrate deploy` (render.yaml vertex-api startCommand).
-- A file under prisma/migrations would be applied on the next API start. This file is
-- outside that folder so this change does not apply it.
--
-- Dependency: vertex/prisma/migrations/20261101170000_production_jobs/migration.sql
-- must already have created "shop_jobs" and "shop_printers". This ledger does not
-- alter those tables and does not alter the foundation migration.
--
-- The endpoint column is an operator-recorded bridge address. It is not a secret.
-- credentialRef stores a name only. Do not put a token, password, or header value
-- in any column here.
--
-- Rollback, only with Founder approval, and only when these rows are disposable:
--   DROP TABLE IF EXISTS "shop_dispatch_events";
--   DROP TABLE IF EXISTS "shop_dispatch_records";
--   DROP TABLE IF EXISTS "shop_printer_configs";
-- Do not drop "shop_jobs", "shop_printers", or "job_gcode" as part of this rollback.
-- Apply the foundation migration's own rollback separately, and only if that queue
-- itself is being removed. Order: drop this ledger first, then the foundation tables
-- if and only if the Founder approves removing the queue.

CREATE TABLE IF NOT EXISTS "shop_printer_configs" (
    "printerId" UUID NOT NULL,
    "adapterMode" TEXT NOT NULL,
    "protocolId" TEXT,
    "endpoint" TEXT,
    "credentialRef" TEXT,
    "cancellation" TEXT NOT NULL DEFAULT 'unsupported',
    "lastSeenAt" TIMESTAMP(3),
    CONSTRAINT "shop_printer_configs_pkey" PRIMARY KEY ("printerId")
);

CREATE TABLE IF NOT EXISTS "shop_dispatch_records" (
    "jobId" UUID NOT NULL,
    "dispatchState" TEXT NOT NULL DEFAULT 'none',
    "controllerJobId" TEXT,
    "dispatchAttempt" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "dispatchError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shop_dispatch_records_pkey" PRIMARY KEY ("jobId")
);

CREATE TABLE IF NOT EXISTS "shop_dispatch_events" (
    "id" UUID NOT NULL,
    "jobId" UUID,
    "printerId" UUID,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shop_dispatch_events_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_printer_configs_printerId_fkey') THEN
        ALTER TABLE "shop_printer_configs"
            ADD CONSTRAINT "shop_printer_configs_printerId_fkey"
            FOREIGN KEY ("printerId") REFERENCES "shop_printers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_dispatch_records_jobId_fkey') THEN
        ALTER TABLE "shop_dispatch_records"
            ADD CONSTRAINT "shop_dispatch_records_jobId_fkey"
            FOREIGN KEY ("jobId") REFERENCES "shop_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_dispatch_events_jobId_fkey') THEN
        ALTER TABLE "shop_dispatch_events"
            ADD CONSTRAINT "shop_dispatch_events_jobId_fkey"
            FOREIGN KEY ("jobId") REFERENCES "shop_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "shop_dispatch_events_jobId_idx" ON "shop_dispatch_events"("jobId");
