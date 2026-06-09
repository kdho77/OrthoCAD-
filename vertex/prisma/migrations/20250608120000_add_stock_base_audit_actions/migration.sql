-- Add stock base audit actions
-- These actions support the admin-managed stock base (GLB template) system.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'stock_base_created';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'stock_base_updated';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'stock_base_deleted';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'stock_base_resolved';