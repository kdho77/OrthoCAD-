-- Permanent storage path for the submitted manufacturing STL (audit / traceability).
ALTER TABLE "exports" ADD COLUMN "sourceStlPath" TEXT;
