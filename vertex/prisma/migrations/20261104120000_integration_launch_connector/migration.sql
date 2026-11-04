-- VO2 / 3D OrthoCloud launch connector.
-- Adds the server-to-server credential, client, design, scan upload, launch
-- token, and design.exported webhook tables. API keys are hashes. Webhook
-- signing secrets are ciphertext. This does not create tenants and it does
-- not change an order status.
--
-- Do not apply this file to production. Kendon approves production migrations.
-- prisma migrate deploy must not be run against production from this change.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntegrationSource') THEN
        CREATE TYPE "IntegrationSource" AS ENUM ('vo2', 'orthocloud');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShoeSizeSystem') THEN
        CREATE TYPE "ShoeSizeSystem" AS ENUM ('US_M', 'US_W', 'EU');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntegrationScanSide') THEN
        CREATE TYPE "IntegrationScanSide" AS ENUM ('left', 'right', 'combined');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntegrationLaunchActor') THEN
        CREATE TYPE "IntegrationLaunchActor" AS ENUM ('clinic', 'vertex_staff');
    END IF;
END $$;

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "shoeSizeSystem" "ShoeSizeSystem" NOT NULL DEFAULT 'US_M';
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "shoeSizeDeclared" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "integration_credentials" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "webhookSecretCiphertext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_credentials_keyHash_key" ON "integration_credentials"("keyHash");

CREATE TABLE IF NOT EXISTS "integration_credential_tenants" (
    "credentialId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    CONSTRAINT "integration_credential_tenants_pkey" PRIMARY KEY ("credentialId", "tenantId")
);

CREATE INDEX IF NOT EXISTS "integration_credential_tenants_tenantId_idx" ON "integration_credential_tenants"("tenantId");

CREATE TABLE IF NOT EXISTS "integration_clients" (
    "id" UUID NOT NULL,
    "source" "IntegrationSource" NOT NULL,
    "tenantId" UUID NOT NULL,
    "externalClientId" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "shoeSizeSystem" "ShoeSizeSystem" NOT NULL,
    "shoeSize" DOUBLE PRECISION NOT NULL,
    "shoeSizeLeft" DOUBLE PRECISION,
    "shoeSizeRight" DOUBLE PRECISION,
    "shoeWidth" TEXT NOT NULL,
    "shoeSizeMismatch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_clients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_clients_shoeWidth_check" CHECK ("shoeWidth" IN ('narrow', 'medium', 'wide'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_clients_source_tenantId_externalClientId_key"
    ON "integration_clients"("source", "tenantId", "externalClientId");
CREATE INDEX IF NOT EXISTS "integration_clients_clientId_idx" ON "integration_clients"("clientId");
CREATE INDEX IF NOT EXISTS "integration_clients_tenantId_idx" ON "integration_clients"("tenantId");

CREATE TABLE IF NOT EXISTS "integration_designs" (
    "id" UUID NOT NULL,
    "source" "IntegrationSource" NOT NULL,
    "tenantId" UUID NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "designId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "kind" "DesignKind" NOT NULL,
    "sides" TEXT NOT NULL,
    "rxText" TEXT,
    "notes" TEXT,
    "orderReference" TEXT,
    "orderedByAccount" TEXT,
    "parentExternalOrderId" TEXT,
    "parentDesignId" UUID,
    "shoeSizeSystem" "ShoeSizeSystem" NOT NULL,
    "shoeSize" DOUBLE PRECISION NOT NULL,
    "shoeSizeLeft" DOUBLE PRECISION,
    "shoeSizeRight" DOUBLE PRECISION,
    "shoeWidth" TEXT NOT NULL,
    "shoeSizeMismatch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_designs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_designs_sides_check" CHECK ("sides" IN ('pair', 'left', 'right')),
    CONSTRAINT "integration_designs_shoeWidth_check" CHECK ("shoeWidth" IN ('narrow', 'medium', 'wide'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_designs_designId_key" ON "integration_designs"("designId");
CREATE UNIQUE INDEX IF NOT EXISTS "integration_designs_source_tenantId_externalOrderId_key"
    ON "integration_designs"("source", "tenantId", "externalOrderId");
CREATE INDEX IF NOT EXISTS "integration_designs_tenantId_idx" ON "integration_designs"("tenantId");
CREATE INDEX IF NOT EXISTS "integration_designs_clientId_idx" ON "integration_designs"("clientId");

CREATE TABLE IF NOT EXISTS "integration_scan_uploads" (
    "id" UUID NOT NULL,
    "integrationDesignId" UUID NOT NULL,
    "side" "IntegrationScanSide" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "uploadUrl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "format" TEXT,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_scan_uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "integration_scan_uploads_integrationDesignId_idx"
    ON "integration_scan_uploads"("integrationDesignId");

CREATE TABLE IF NOT EXISTS "integration_launch_tokens" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tenantId" UUID NOT NULL,
    "designId" UUID NOT NULL,
    "actorKind" "IntegrationLaunchActor" NOT NULL,
    "actorUserId" UUID,
    "actorRole" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_launch_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_launch_tokens_actorRole_not_super_admin" CHECK ("actorRole" <> 'super_admin')
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_launch_tokens_tokenHash_key" ON "integration_launch_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "integration_launch_tokens_designId_idx" ON "integration_launch_tokens"("designId");
CREATE INDEX IF NOT EXISTS "integration_launch_tokens_tenantId_idx" ON "integration_launch_tokens"("tenantId");

CREATE TABLE IF NOT EXISTS "integration_webhook_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "tenantId" UUID NOT NULL,
    "designId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "integration_webhook_events_tenantId_idx" ON "integration_webhook_events"("tenantId");
CREATE INDEX IF NOT EXISTS "integration_webhook_events_nextAttemptAt_idx" ON "integration_webhook_events"("nextAttemptAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_credential_tenants_credentialId_fkey') THEN
        ALTER TABLE "integration_credential_tenants"
            ADD CONSTRAINT "integration_credential_tenants_credentialId_fkey"
            FOREIGN KEY ("credentialId") REFERENCES "integration_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_credential_tenants_tenantId_fkey') THEN
        ALTER TABLE "integration_credential_tenants"
            ADD CONSTRAINT "integration_credential_tenants_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_clients_tenantId_fkey') THEN
        ALTER TABLE "integration_clients"
            ADD CONSTRAINT "integration_clients_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_clients_clientId_fkey') THEN
        ALTER TABLE "integration_clients"
            ADD CONSTRAINT "integration_clients_clientId_fkey"
            FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_designs_tenantId_fkey') THEN
        ALTER TABLE "integration_designs"
            ADD CONSTRAINT "integration_designs_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_designs_designId_fkey') THEN
        ALTER TABLE "integration_designs"
            ADD CONSTRAINT "integration_designs_designId_fkey"
            FOREIGN KEY ("designId") REFERENCES "designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_scan_uploads_integrationDesignId_fkey') THEN
        ALTER TABLE "integration_scan_uploads"
            ADD CONSTRAINT "integration_scan_uploads_integrationDesignId_fkey"
            FOREIGN KEY ("integrationDesignId") REFERENCES "integration_designs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_launch_tokens_actorUserId_fkey') THEN
        ALTER TABLE "integration_launch_tokens"
            ADD CONSTRAINT "integration_launch_tokens_actorUserId_fkey"
            FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
