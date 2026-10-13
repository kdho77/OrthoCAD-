// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Corrections, SideCorrections, WedgeCorrection } from "@/types";

function postingDegToWedge(deg: number): WedgeCorrection | undefined {
    if (!Number.isFinite(deg) || Math.abs(deg) < 1e-9) return undefined;
    // Legacy centreline posting: +deg raised lateral (pronation), −deg raised medial (supination).
    if (deg > 0) return { side: "lateral", value: deg, unit: "deg" };
    return { side: "medial", value: -deg, unit: "deg" };
}

function mergeWedge(
    existing: WedgeCorrection | undefined,
    fromPosting: WedgeCorrection | undefined,
): WedgeCorrection | undefined {
    if (!fromPosting) return existing;
    if (!existing || (existing.value ?? 0) <= 0) return fromPosting;
    return existing;
}

/**
 * One-time shape upgrades for persisted corrections (posting+wedge merge, arch fill removal).
 * Idempotent: safe to run on every load.
 */
export function migrateSideCorrections(c: SideCorrections): SideCorrections {
    const next: SideCorrections = { ...c };

    if ((next.archFillMm ?? 0) !== 0) {
        next.archHeightMm = (next.archHeightMm ?? 0) + (next.archFillMm ?? 0);
        next.archFillMm = 0;
    }

    if ((next.rearfootPostingDeg ?? 0) !== 0) {
        next.rearfootWedge = mergeWedge(next.rearfootWedge, postingDegToWedge(next.rearfootPostingDeg));
        next.rearfootPostingDeg = 0;
    }
    if ((next.forefootPostingDeg ?? 0) !== 0) {
        next.forefootWedge = mergeWedge(next.forefootWedge, postingDegToWedge(next.forefootPostingDeg));
        next.forefootPostingDeg = 0;
    }

    if (next.archEaseMm == null || !Number.isFinite(next.archEaseMm)) {
        next.archEaseMm = 0;
    }

    return next;
}

export function migrateCorrections(corrections: Corrections): Corrections {
    return {
        ...corrections,
        left: migrateSideCorrections(corrections.left),
        right: migrateSideCorrections(corrections.right),
    };
}
