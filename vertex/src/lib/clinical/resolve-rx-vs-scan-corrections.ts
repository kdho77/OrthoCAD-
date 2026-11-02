// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PrescriptionParseResult, Side, SideCorrections } from "@/types";

const RX_PRIORITY_KEYS: (keyof SideCorrections)[] = [
    "forefootPostingDeg",
    "rearfootPostingDeg",
    "medialSkiveMm",
    "lateralSkiveMm",
    "archFillMm",
    "archHeightMm",
    "archEaseMm",
    "heelCupDepthMm",
    "heelCupHeightMm",
    "heelCupWidthMm",
    "forefootWidthMm",
    "heelLiftMm",
    "apexMoveMm",
    "medialFlangeMm",
    "lateralFlangeMm",
    "rearfootWedge",
    "forefootWedge",
    "fullLengthWedge",
];

function sideHasRxPatch(
    rx: PrescriptionParseResult | null | undefined,
    side: Side,
): Partial<SideCorrections> | undefined {
    return rx?.corrections[side];
}

/** True when Rx explicitly sets this key (including wedge cleared with undefined). */
export function rxOverridesKey(
    rx: PrescriptionParseResult | null | undefined,
    side: Side,
    key: keyof SideCorrections,
): boolean {
    const patch = sideHasRxPatch(rx, side);
    if (!patch) return false;
    return Object.hasOwn(patch, key);
}

/**
 * Merge scan-derived anatomy fit with Rx. Explicit Rx keys win; scan fills the rest.
 * Never copies corrections between left and right.
 */
export function mergeScanFitWithPrescription(args: {
    side: Side;
    scanFit: Partial<SideCorrections>;
    rx: PrescriptionParseResult | null | undefined;
}): { merged: Partial<SideCorrections>; rxKeys: string[]; scanOnlyKeys: string[] } {
    const rxPatch = sideHasRxPatch(args.rx, args.side) ?? {};
    const merged: Partial<SideCorrections> = { ...args.scanFit, ...rxPatch };
    const rxKeys: string[] = [];
    const scanOnlyKeys: string[] = [];
    for (const key of RX_PRIORITY_KEYS) {
        if (rxOverridesKey(args.rx, args.side, key)) {
            rxKeys.push(String(key));
        } else if (args.scanFit[key] !== undefined) {
            scanOnlyKeys.push(String(key));
        }
    }
    return { merged, rxKeys, scanOnlyKeys };
}

export function detectRxConflicts(rx: PrescriptionParseResult | null | undefined): string[] {
    if (!rx) return [];
    const warnings: string[] = [];
    if (rx.confidence < 0.35) {
        warnings.push("Low Rx parse confidence — review all applied corrections");
    }
    const left = rx.corrections.left;
    const right = rx.corrections.right;
    if (left?.rearfootWedge && right?.rearfootWedge) {
        if (left.rearfootWedge.side !== right.rearfootWedge.side) {
            warnings.push("Left and right rearfoot wedges differ — verify bilateral Rx");
        }
    }
    return warnings;
}
