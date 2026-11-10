// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Installed print-bridge version. Auto-update compares this string to a signed manifest.

export const PRINT_BRIDGE_VERSION = "2026.11.10.1";

export const PRINT_BRIDGE_PRODUCT = "orthocad-print-bridge";

/** Numeric dotted versions only, such as 2026.11.10.1. */
export function compareBridgeVersions(left: string, right: string): number | null {
    const a = parseBridgeVersion(left);
    const b = parseBridgeVersion(right);
    if (!a || !b) return null;
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
        const difference = (a[index] ?? 0) - (b[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

function parseBridgeVersion(value: string): number[] | null {
    if (!/^\d+(?:\.\d+){1,5}$/.test(value)) return null;
    return value.split(".").map((part) => Number(part));
}
