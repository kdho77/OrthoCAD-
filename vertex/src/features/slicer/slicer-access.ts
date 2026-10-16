// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { isLicenseValid } from "@/features/licensing/license";
import type { License, UserProfile } from "@/types";

export interface SlicerAccess {
    ok: boolean;
    reason?: string;
}

/**
 * Super admin is never blocked. Other roles need a signed-in user and a valid
 * license. Slicing does not consume export tokens.
 */
export function canUseSlicer(user: UserProfile | null, license: License | null): SlicerAccess {
    if (user?.role === "super_admin") return { ok: true };
    if (!user) return { ok: false, reason: "Sign in to slice." };
    const lic = isLicenseValid(license);
    if (!lic.ok) return { ok: false, reason: lic.reason ?? "No active license" };
    return { ok: true };
}
