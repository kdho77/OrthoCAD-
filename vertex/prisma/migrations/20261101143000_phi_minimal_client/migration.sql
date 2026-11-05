-- PHI-minimal client columns.
-- displayName is the label shown in the app (a name or initials).
-- mrn is the medical record number and stays empty unless STORE_PHI is on.
-- reference remains the internal client reference. Existing values are not moved
-- into mrn, because that column is the non-PHI identifier.
--
-- Do not apply this file to production. The Founder approves production migrations.

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "mrn" TEXT;

UPDATE "clients"
SET "displayName" = CASE
    WHEN "lastName" = 'Unassigned' AND COALESCE("firstName", '') = '' THEN 'Unassigned'
    WHEN COALESCE("firstName", '') = '' THEN "lastName"
    WHEN COALESCE("lastName", '') = '' THEN "firstName"
    ELSE "lastName" || ', ' || "firstName"
END
WHERE "displayName" IS NULL;
