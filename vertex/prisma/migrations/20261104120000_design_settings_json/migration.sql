-- Design parameters only. Meshes are regenerated on open and are not stored here.
-- Additive: one nullable column. No drops, renames, or rewrites of existing columns.
-- Do not apply this file to preview or production until Kendon approves it.
-- The vertex-api start command runs `prisma migrate deploy`, so merging and
-- deploying this branch applies the statement below.

ALTER TABLE "designs" ADD COLUMN IF NOT EXISTS "settingsJson" JSONB;
