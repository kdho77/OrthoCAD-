// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import type { UserProfile } from "@/types";
import { licenseFromMe, mergeSessionIdentity, shouldReloadAuthoritativeProfile } from "./session-profile";

const existing: UserProfile = {
    id: "user-1",
    email: "kdho@vertexorthopedic.com",
    fullName: "Admin",
    role: "super_admin",
    tokenBalance: 4497,
};

describe("mergeSessionIdentity", () => {
    test("preserves token balance when the same user is re-hydrated", () => {
        const next = mergeSessionIdentity(existing, {
            id: "user-1",
            email: "kdho@vertexorthopedic.com",
            fullName: "Admin",
            role: "super_admin",
        });
        expect(next.tokenBalance).toBe(4497);
    });

    test("resets token balance when a different user signs in", () => {
        const next = mergeSessionIdentity(existing, {
            id: "user-2",
            email: "other@example.com",
            fullName: null,
            role: "clinician",
        });
        expect(next.tokenBalance).toBe(0);
        expect(next.id).toBe("user-2");
    });

    test("starts at 0 when there is no existing profile", () => {
        const next = mergeSessionIdentity(null, {
            id: "user-1",
            email: "kdho@vertexorthopedic.com",
            fullName: "Admin",
            role: "super_admin",
        });
        expect(next.tokenBalance).toBe(0);
    });
});

describe("shouldReloadAuthoritativeProfile", () => {
    test("reloads on sign-in and initial session, not on token refresh", () => {
        expect(shouldReloadAuthoritativeProfile("SIGNED_IN")).toBe(true);
        expect(shouldReloadAuthoritativeProfile("INITIAL_SESSION")).toBe(true);
        expect(shouldReloadAuthoritativeProfile("USER_UPDATED")).toBe(true);
        expect(shouldReloadAuthoritativeProfile("TOKEN_REFRESHED")).toBe(false);
        expect(shouldReloadAuthoritativeProfile("SIGNED_OUT")).toBe(false);
    });
});

describe("licenseFromMe", () => {
    test("stringifies Date fields from superjson", () => {
        const starts = new Date("2026-01-01T00:00:00.000Z");
        const expires = new Date("2027-01-01T00:00:00.000Z");
        const license = licenseFromMe({
            id: "lic-1",
            type: "yearly",
            status: "active",
            seats: 1,
            startsAt: starts,
            expiresAt: expires,
        });
        expect(license?.startsAt).toBe("2026-01-01T00:00:00.000Z");
        expect(license?.expiresAt).toBe("2027-01-01T00:00:00.000Z");
        expect(license?.status).toBe("active");
    });
});
