-- Optional "Ordered by" label on client files (customer account that placed the order).
-- Do not apply this file to preview or production until the Founder approves it.

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "orderedBy" TEXT;
