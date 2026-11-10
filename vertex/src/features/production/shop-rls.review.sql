-- Review SQL. DO NOT APPLY this file from application code.
-- DO NOT copy it into vertex/prisma/migrations.
-- Render start runs `npx prisma migrate deploy`. A file in that folder would apply on the next API start.
--
-- Apply order, only after Founder approval:
--   1. vertex/prisma/migrations/20261101170000_production_jobs
--   2. vertex/src/features/production/dispatch-ledger.review.sql
--   3. vertex/src/features/production/print-bridge.review.sql
--   4. this file
--
-- The five ledger and bridge tables already have row level security enabled and no policies:
--   shop_printer_configs, shop_dispatch_records, shop_dispatch_events, shop_bridges, shop_enrollments.
-- This file enables row level security on the foundation tables that still have it off.
-- No policies are created. The API uses Prisma as the table owner, which bypasses row level security.
-- Anon and authenticated roles gain no grants from this file.
-- ENABLE ROW LEVEL SECURITY is idempotent.
--
-- Revert:
--   ALTER TABLE "shop_printers" DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE "shop_jobs" DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE "job_gcode" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "shop_printers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shop_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_gcode" ENABLE ROW LEVEL SECURITY;
