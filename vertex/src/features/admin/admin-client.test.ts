// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { isMissingTenantMigration } from "./admin-client";

describe("isMissingTenantMigration", () => {
    test("detects the unmigrated tenant-table error", () => {
        expect(
            isMissingTenantMigration(
                new Error(
                    "Tenant tables are not migrated. Apply vertex/prisma/migrations/20261015120000_super_admin_tenants/migration.sql in Supabase SQL editor.",
                ),
            ),
        ).toBe(true);
        expect(isMissingTenantMigration({ data: { code: "PRECONDITION_FAILED" }, message: "nope" })).toBe(
            true,
        );
        expect(isMissingTenantMigration(new Error("Tenant not found"))).toBe(false);
    });
});
