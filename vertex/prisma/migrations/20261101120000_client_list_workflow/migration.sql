-- Client List workflow.
-- Adds design type, client DOB, archive, and 30-day design soft-delete.
-- Orphan designs (no matching client row) are attached to one "Unassigned"
-- client per organization. Design createdAt / updatedAt are preserved.
-- Existing designs receive kind = insole via the column DEFAULT, so no UPDATE
-- touches their timestamps.
--
-- Do not apply this file to production until the Founder approves it.
-- Rollback is in the PR description. Rolling back columns does not delete designs.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'client_created';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'client_updated';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'client_archived';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'client_restored';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'client_deleted';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'design_archived';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'design_restored';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'design_deleted';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'design_duplicated';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DesignKind') THEN
        CREATE TYPE "DesignKind" AS ENUM ('insole', 'afo');
    END IF;
END $$;

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "dateOfBirth" DATE;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "tenantId" UUID;

ALTER TABLE "designs" ADD COLUMN IF NOT EXISTS "kind" "DesignKind" NOT NULL DEFAULT 'insole';
ALTER TABLE "designs" ADD COLUMN IF NOT EXISTS "notes" VARCHAR(500);
ALTER TABLE "designs" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "designs" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'clients_tenantId_fkey'
    ) THEN
        ALTER TABLE "clients"
            ADD CONSTRAINT "clients_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "clients_tenantId_idx" ON "clients"("tenantId");
CREATE INDEX IF NOT EXISTS "clients_archivedAt_idx" ON "clients"("archivedAt");
CREATE INDEX IF NOT EXISTS "designs_deletedAt_idx" ON "designs"("deletedAt");

-- One Unassigned client per organization (users.tenantId).
-- Owners with no tenant get their own Unassigned client so a design is never dropped.
-- Only designs whose clientId does not match a clients row are moved.
-- Timestamps on those design rows are written back to the values read before the update.

CREATE TEMP TABLE "client_file_orphan" AS
SELECT
    d.id AS design_id,
    d."ownerId" AS owner_id,
    d."createdAt" AS created_at,
    d."updatedAt" AS updated_at,
    u."tenantId" AS tenant_id
FROM "designs" d
LEFT JOIN "clients" c ON c.id = d."clientId"
INNER JOIN "users" u ON u.id = d."ownerId"
WHERE c.id IS NULL;

CREATE TEMP TABLE "client_file_bucket" AS
SELECT
    CASE WHEN tenant_id IS NULL THEN owner_id ELSE tenant_id END AS bucket_id,
    tenant_id,
    MIN(owner_id::text)::uuid AS owner_id,
    gen_random_uuid() AS client_id
FROM "client_file_orphan"
GROUP BY 1, 2;

INSERT INTO "clients" (
    "id", "firstName", "lastName", "notes", "ownerId", "tenantId", "createdAt", "updatedAt"
)
SELECT
    client_id,
    '',
    'Unassigned',
    'Designs that had no client file were attached here. Their created and modified dates were not changed.',
    owner_id,
    tenant_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "client_file_bucket";

UPDATE "designs" AS d
SET
    "clientId" = b.client_id,
    "createdAt" = o.created_at,
    "updatedAt" = o.updated_at
FROM "client_file_orphan" AS o
JOIN "client_file_bucket" AS b
    ON b.bucket_id = CASE WHEN o.tenant_id IS NULL THEN o.owner_id ELSE o.tenant_id END
WHERE d.id = o.design_id;
