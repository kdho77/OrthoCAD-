-- Billing term on commercial tenants (Monthly / Annual). Do not apply from the agent.
-- Preview/prod remain usable without this file: the API defaults billingTerm to monthly
-- when the column is missing.

DO $$ BEGIN
    CREATE TYPE "TenantBillingTerm" AS ENUM ('monthly', 'annual');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billingTerm" "TenantBillingTerm" NOT NULL DEFAULT 'monthly';
