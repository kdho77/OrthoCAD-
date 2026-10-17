-- Super-admin tenant dashboard: customer orgs, append-only token ledger, immutable audit.
-- CAD continues to use per-user licenses + users.tokenBalance.

CREATE TYPE "TenantPlan" AS ENUM ('starter', 'professional', 'clinic', 'enterprise');
CREATE TYPE "TenantStatus" AS ENUM ('active', 'trial', 'suspended', 'expired', 'archived');
CREATE TYPE "TokenLedgerType" AS ENUM ('grant', 'usage', 'adjustment', 'expiry');

CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'trial',
    "plan" "TenantPlan" NOT NULL DEFAULT 'starter',
    "seats" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "tokenBalance" INTEGER NOT NULL DEFAULT 0,
    "tokenThreshold" INTEGER NOT NULL DEFAULT 50,
    "lastActivityAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE INDEX "tenants_status_idx" ON "tenants"("status");
CREATE INDEX "tenants_plan_idx" ON "tenants"("plan");
CREATE INDEX "tenants_expiresAt_idx" ON "tenants"("expiresAt");

CREATE TABLE "tenant_token_ledger" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "TokenLedgerType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "actorId" UUID,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_token_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_token_ledger_tenantId_createdAt_idx" ON "tenant_token_ledger"("tenantId", "createdAt");

CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "tenantId" UUID,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_tenantId_idx" ON "admin_audit_logs"("tenantId");
CREATE INDEX "admin_audit_logs_action_idx" ON "admin_audit_logs"("action");
CREATE INDEX "admin_audit_logs_createdAt_idx" ON "admin_audit_logs"("createdAt");

-- No UPDATE/DELETE grants for ledger or admin audit (append-only at the SQL layer).
REVOKE UPDATE, DELETE ON TABLE "tenant_token_ledger" FROM PUBLIC;
REVOKE UPDATE, DELETE ON TABLE "admin_audit_logs" FROM PUBLIC;

ALTER TABLE "users" ADD COLUMN "tenantId" UUID;
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

ALTER TABLE "users"
    ADD CONSTRAINT "users_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tenant_token_ledger"
    ADD CONSTRAINT "tenant_token_ledger_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_token_ledger"
    ADD CONSTRAINT "tenant_token_ledger_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
