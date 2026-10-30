// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import { isApiConfigured } from "@/lib/trpc";
import { createTenant, fetchTenant, isMissingTenantMigration, resetAdminDemoFallback } from "./admin-client";

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

describe("demo tenant create", () => {
    test("creates a primary admin, trial expiry, and Never activity", async () => {
        if (isApiConfigured()) return;
        resetAdminDemoFallback();
        const { tenant, admin } = await createTenant({
            name: "Cedar Clinic",
            plan: "starter",
            seats: 4,
            status: "trial",
            billingTerm: "monthly",
            adminName: "Jordan Admin",
            adminEmail: "jordan@cedar.example",
            reason: "New customer",
        });
        expect(tenant.seatsUsed).toBe(1);
        expect(tenant.lastActivityAt).toBeNull();
        expect(tenant.billingTerm).toBe("monthly");
        expect(tenant.expiresAt).toBeTruthy();
        expect(admin.email).toBe("jordan@cedar.example");
        expect(admin.role).toBe("admin");
        expect(admin.tempPassword).toBeTruthy();
        const detail = await fetchTenant(tenant.id);
        expect(detail.users).toHaveLength(1);
        expect(detail.users[0]?.email).toBe("jordan@cedar.example");
    });
});
