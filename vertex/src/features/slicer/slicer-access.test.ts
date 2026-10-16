// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import type { License, UserProfile } from "@/types";
import { canUseSlicer } from "./slicer-access";

const license: License = {
    id: "lic",
    type: "yearly",
    status: "active",
    seats: 1,
    startsAt: new Date().toISOString(),
    expiresAt: null,
};

function user(role: UserProfile["role"]): UserProfile {
    return { id: "u1", email: "a@b.c", fullName: "A", role, tokenBalance: 0 };
}

describe("canUseSlicer", () => {
    test("super admin is never blocked", () => {
        expect(canUseSlicer(user("super_admin"), null).ok).toBe(true);
        expect(canUseSlicer(user("super_admin"), { ...license, status: "revoked" }).ok).toBe(true);
    });

    test("clinician without a license is blocked", () => {
        expect(canUseSlicer(user("clinician"), null).ok).toBe(false);
        expect(canUseSlicer(user("clinician"), license).ok).toBe(true);
    });
});
