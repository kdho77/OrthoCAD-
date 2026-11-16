-- Expand integration-link shoe width checks to match the MCP saved-design catalog enum.
-- Reversible: drop this constraint and re-add the prior IN ('narrow', 'medium', 'wide') list.

ALTER TABLE "integration_clients" DROP CONSTRAINT IF EXISTS "integration_clients_shoeWidth_check";
ALTER TABLE "integration_clients" ADD CONSTRAINT "integration_clients_shoeWidth_check" CHECK ("shoeWidth" IN ('extra_narrow', 'narrow', 'medium', 'wide', 'extra_wide', 'xx_wide'));

ALTER TABLE "integration_designs" DROP CONSTRAINT IF EXISTS "integration_designs_shoeWidth_check";
ALTER TABLE "integration_designs" ADD CONSTRAINT "integration_designs_shoeWidth_check" CHECK ("shoeWidth" IN ('extra_narrow', 'narrow', 'medium', 'wide', 'extra_wide', 'xx_wide'));