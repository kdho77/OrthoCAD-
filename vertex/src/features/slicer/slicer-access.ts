// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { License, UserProfile } from "@/types";

export interface SlicerAccess {
    ok: boolean;
    reason?: string;
}

/**
 * Self-serve slicer is pay-per-file. License and tokens are CAD-only.
 * Sign-in is optional (account chip) and never required to slice.
 */
export function canUseSlicer(_user?: UserProfile | null, _license?: License | null): SlicerAccess {
    return { ok: true };
}
