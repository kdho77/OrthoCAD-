-- Review SQL for bridge enrollment and Moonraker printer config.
-- DO NOT APPLY this file.
-- DO NOT copy it into vertex/prisma/migrations.
-- Render start runs `npx prisma migrate deploy`. A file in that folder would apply on the next API start.
--
-- Apply order, only after Founder approval:
--   1. vertex/prisma/migrations/20261101170000_production_jobs
--   2. vertex/src/features/production/dispatch-ledger.review.sql
--   3. this file
--
-- credentialHash and proofHash are hashes. Do not store enrollment proofs, bridge credentials,
-- or Moonraker API keys in these tables.
--
-- Rollback, only if these rows are disposable:
--   ALTER TABLE "shop_printer_configs" DROP COLUMN IF EXISTS "enabled";
--   ALTER TABLE "shop_printer_configs" DROP COLUMN IF EXISTS "bridgeId";
--   ALTER TABLE "shop_printer_configs" DROP COLUMN IF EXISTS "configVersion";
--   DROP TABLE IF EXISTS "shop_enrollments";
--   DROP TABLE IF EXISTS "shop_bridges";
-- Do not drop shop_jobs, shop_printers, or job_gcode as part of this rollback.

CREATE TABLE IF NOT EXISTS "shop_bridges" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credentialHash" TEXT,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shop_bridges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shop_enrollments" (
    "id" UUID NOT NULL,
    "proofHash" TEXT NOT NULL,
    "tenantId" UUID,
    "shopId" TEXT NOT NULL,
    "bridgeId" UUID NOT NULL,
    "printerIds" JSONB NOT NULL,
    "audience" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shop_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "shop_enrollments_proofHash_key" ON "shop_enrollments"("proofHash");
CREATE INDEX IF NOT EXISTS "shop_enrollments_bridgeId_idx" ON "shop_enrollments"("bridgeId");
CREATE INDEX IF NOT EXISTS "shop_bridges_tenantId_idx" ON "shop_bridges"("tenantId");

ALTER TABLE "shop_printer_configs" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "shop_printer_configs" ADD COLUMN IF NOT EXISTS "bridgeId" UUID;
ALTER TABLE "shop_printer_configs" ADD COLUMN IF NOT EXISTS "configVersion" INTEGER NOT NULL DEFAULT 1;
