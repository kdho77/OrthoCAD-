// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    applyLedgerWrite,
    assertLedgerBalanced,
    auditRowsToCsv,
    balanceFromLedger,
    buildAuditEntry,
    computeLicenseExpiry,
    DEMO_TENANTS,
    demoUsersForTenant,
    displayTenantStatus,
    extendExpiry,
    grantPreview,
    isAdminPath,
    isValidAdminEmail,
    matchesTenantFilters,
    parseAdminInstant,
    parseAdminPath,
    parseTenantListSearch,
    relativeActivityTime,
    serializeTenantListSearch,
    sortTenants,
    tileCounts,
} from "./admin-domain";

describe("tenant token ledger", () => {
    test("balance is the sum of append-only amounts", () => {
        const rows = [
            { amount: 100, balanceAfter: 100 },
            { amount: -12, balanceAfter: 88 },
            { amount: 25, balanceAfter: 113 },
        ];
        expect(balanceFromLedger(rows)).toBe(113);
        expect(assertLedgerBalanced(rows)).toBe(113);
    });

    test("corrections are adjustment rows, never a direct balance edit", () => {
        const existing = [{ amount: 50 }, { amount: -5 }];
        const write = applyLedgerWrite(existing, {
            type: "adjustment",
            amount: -10,
            reason: "Correction: duplicate grant",
        });
        expect(write.type).toBe("adjustment");
        expect(write.balanceAfter).toBe(35);
        expect(balanceFromLedger([...existing, write])).toBe(35);
    });

    test("rejects zero amounts and missing reasons", () => {
        expect(() => applyLedgerWrite([], { type: "grant", amount: 0, reason: "Purchase" })).toThrow(
            /non-zero/,
        );
        expect(() => applyLedgerWrite([], { type: "grant", amount: 10, reason: "  " })).toThrow(/reason/);
    });

    test("detects a mutated snapshot (append-only integrity)", () => {
        expect(() =>
            assertLedgerBalanced([
                { amount: 10, balanceAfter: 10 },
                { amount: 5, balanceAfter: 99 },
            ]),
        ).toThrow(/mismatch/);
    });
});

describe("admin audit writes", () => {
    test("every write requires a reason", () => {
        expect(() => buildAuditEntry({ action: "tenant.suspend", reason: "" })).toThrow(/reason/);
        const entry = buildAuditEntry({
            action: "tenant.grant_tokens",
            reason: "Purchase",
            before: { tokenBalance: 10 },
            after: { tokenBalance: 60 },
        });
        expect(entry.reason).toBe("Purchase");
        expect(entry.before).toEqual({ tokenBalance: 10 });
        expect(entry.after).toEqual({ tokenBalance: 60 });
    });

    test("CSV export includes before/after JSON", () => {
        const csv = auditRowsToCsv([
            {
                id: "a1",
                actorId: "u1",
                actorEmail: "kdho@vertexorthopedic.com",
                tenantId: "t1",
                tenantName: "Apex Clinic",
                action: "tenant.grant_tokens",
                before: { tokenBalance: 10 },
                after: { tokenBalance: 60 },
                reason: "Purchase",
                ipAddress: null,
                createdAt: "2026-10-15T00:00:00.000Z",
            },
        ]);
        expect(csv.split("\n")[0]).toBe("when,actor,tenant,action,before,after,reason");
        expect(csv).toContain("tenant.grant_tokens");
        expect(csv).toContain("tokenBalance");
        expect(csv).toContain("Purchase");
    });
});

describe("tenant list URL filters", () => {
    test("round-trips search state", () => {
        const qs = serializeTenantListSearch({
            q: "apex",
            status: ["active", "trial"],
            plan: ["clinic"],
            expiring: true,
            tile: "low",
            sort: "expiry",
            dir: "desc",
        });
        expect(qs).toContain("q=apex");
        expect(parseTenantListSearch(qs)).toMatchObject({
            q: "apex",
            status: ["active", "trial"],
            plan: ["clinic"],
            expiring: true,
            tile: "low",
            sort: "expiry",
            dir: "desc",
        });
    });

    test("tiles and search filter the demo set", () => {
        const now = new Date();
        const counts = tileCounts(DEMO_TENANTS, now);
        expect(counts.active).toBeGreaterThanOrEqual(1);
        expect(counts.expiring).toBeGreaterThanOrEqual(1);
        expect(counts.suspended).toBe(1);
        expect(counts.low).toBeGreaterThanOrEqual(1);
        const filtered = DEMO_TENANTS.filter((t) =>
            matchesTenantFilters(
                t,
                {
                    ...parseTenantListSearch(""),
                    q: "harbor",
                    status: [],
                    plan: [],
                    expiring: false,
                    tile: null,
                    sort: "name",
                    dir: "asc",
                },
                now,
            ),
        );
        expect(filtered.map((t) => t.slug)).toEqual(["harbor-podiatry"]);
    });

    test("sorts by token balance", () => {
        const sorted = sortTenants(DEMO_TENANTS, "tokens", "desc");
        expect(sorted[0].tokenBalance).toBeGreaterThanOrEqual(sorted[sorted.length - 1].tokenBalance);
    });
});

describe("license helpers", () => {
    test("expired tenants display as Expired even if stored active", () => {
        expect(
            displayTenantStatus({
                status: "active",
                expiresAt: "2020-01-01T00:00:00.000Z",
            }),
        ).toBe("expired");
        expect(displayTenantStatus({ status: "suspended", expiresAt: "2020-01-01T00:00:00.000Z" })).toBe(
            "suspended",
        );
    });

    test("extend previews from the later of now and current expiry", () => {
        const now = new Date("2026-10-15T00:00:00.000Z");
        const next = extendExpiry("2026-10-01T00:00:00.000Z", 30, now);
        expect(next).toBe("2026-11-14T00:00:00.000Z");
    });

    test("grant preview shows old -> new balance", () => {
        expect(grantPreview(40, 25)).toEqual({ from: 40, to: 65 });
    });

    test("trial expires 7 days after start; billing term drives paid expiry", () => {
        expect(computeLicenseExpiry("2026-10-17T00:00:00.000Z", "trial", "annual")).toBe(
            "2026-10-24T00:00:00.000Z",
        );
        expect(computeLicenseExpiry("2026-10-17T00:00:00.000Z", "active", "monthly")).toBe(
            "2026-11-17T00:00:00.000Z",
        );
        expect(computeLicenseExpiry("2026-10-17T00:00:00.000Z", "active", "annual")).toBe(
            "2027-10-17T00:00:00.000Z",
        );
    });

    test("admin email and seeded users are validated", () => {
        expect(isValidAdminEmail("admin@clinic.com")).toBe(true);
        expect(isValidAdminEmail("not-an-email")).toBe(false);
        expect(demoUsersForTenant(DEMO_TENANTS[0]).length).toBe(DEMO_TENANTS[0].seatsUsed);
        expect(demoUsersForTenant(DEMO_TENANTS[0])[0]?.role).toBe("admin");
    });
});

describe("admin timestamps", () => {
    test("naive UTC timestamps are not shifted into the future", () => {
        const now = new Date("2026-10-17T07:00:00.000Z");
        expect(parseAdminInstant("2026-10-17T01:00:00")?.toISOString()).toBe("2026-10-17T01:00:00.000Z");
        expect(relativeActivityTime("2026-10-17T01:00:00", now)).toBe("6 hours ago");
        expect(relativeActivityTime(null, now)).toBe("Never");
    });
});

describe("admin routes", () => {
    test("parses tenants, detail tabs, and global audit", () => {
        expect(isAdminPath("/admin")).toBe(true);
        expect(isAdminPath("/")).toBe(false);
        expect(parseAdminPath("/admin", "?tile=active")).toMatchObject({
            page: "tenants",
            filters: { tile: "active" },
        });
        expect(parseAdminPath("/admin/tenants/abc", "?tab=tokens")).toEqual({
            page: "tenant",
            id: "abc",
            tab: "tokens",
        });
        expect(parseAdminPath("/admin/tenants/abc", "?tab=users")).toEqual({
            page: "tenant",
            id: "abc",
            tab: "users",
        });
        expect(parseAdminPath("/admin/audit")).toEqual({ page: "audit" });
        expect(parseAdminPath("/production")).toEqual({ page: "none" });
    });
});
