-- Client chart shoe size, and PHI scan blobs kept apart from design meshes.
-- shoe size defaults to US men's 9 and Medium so existing clients match the
-- reference template. Scan bytes are in client_scan_blobs, not in `scans`.
--
-- Do not apply this file to production. The Founder approves production migrations.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Side') THEN
        CREATE TYPE "Side" AS ENUM ('left', 'right');
    END IF;
END $$;

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "shoeSizeUs" DOUBLE PRECISION NOT NULL DEFAULT 9;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "shoeSizesSplit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "shoeSizeLeftUs" DOUBLE PRECISION NOT NULL DEFAULT 9;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "shoeSizeRightUs" DOUBLE PRECISION NOT NULL DEFAULT 9;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "shoeWidth" TEXT NOT NULL DEFAULT 'medium';

CREATE TABLE IF NOT EXISTS "client_scans" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "tenantId" UUID,
    "side" "Side" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_scans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "client_scan_blobs" (
    "scanId" UUID NOT NULL,
    "body" BYTEA NOT NULL,
    CONSTRAINT "client_scan_blobs_pkey" PRIMARY KEY ("scanId")
);

CREATE INDEX IF NOT EXISTS "client_scans_clientId_idx" ON "client_scans"("clientId");
CREATE INDEX IF NOT EXISTS "client_scans_tenantId_idx" ON "client_scans"("tenantId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_scans_clientId_fkey') THEN
        ALTER TABLE "client_scans"
            ADD CONSTRAINT "client_scans_clientId_fkey"
            FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_scans_ownerId_fkey') THEN
        ALTER TABLE "client_scans"
            ADD CONSTRAINT "client_scans_ownerId_fkey"
            FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_scans_tenantId_fkey') THEN
        ALTER TABLE "client_scans"
            ADD CONSTRAINT "client_scans_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_scan_blobs_scanId_fkey') THEN
        ALTER TABLE "client_scan_blobs"
            ADD CONSTRAINT "client_scan_blobs_scanId_fkey"
            FOREIGN KEY ("scanId") REFERENCES "client_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
