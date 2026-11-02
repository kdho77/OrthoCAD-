// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Four landmarks orient the scan preview and measure arch height.
// They are not used to build or replace the manufacturing mesh.

export interface ScanDot {
    /** 0–1 across the placement pad. */
    x: number;
    y: number;
}

export interface FootDots {
    firstMet: ScanDot;
    fifthMet: ScanDot;
    heel: ScanDot;
    archApex: ScanDot;
}

export const DOT_ORDER = ["firstMet", "fifthMet", "heel", "archApex"] as const;
export type DotKey = (typeof DOT_ORDER)[number];

export const DOT_LABELS: Record<DotKey, string> = {
    firstMet: "1st met head",
    fifthMet: "5th met head",
    heel: "Heel center",
    archApex: "Arch apex",
};

function midpoint(a: ScanDot, b: ScanDot): ScanDot {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Arch height in millimetres. The heel center and the midpoint of the two
 * met heads are the plantar reference. The apex's perpendicular distance from
 * that line is scaled so the heel–met length equals the chart foot length.
 */
export function archHeightFromDots(dots: FootDots, footLengthMm: number): number {
    if (!Number.isFinite(footLengthMm) || footLengthMm <= 0) return 0;
    const met = midpoint(dots.firstMet, dots.fifthMet);
    const dx = met.x - dots.heel.x;
    const dy = met.y - dots.heel.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return 0;
    const cross = Math.abs((dots.archApex.x - dots.heel.x) * dy - (dots.archApex.y - dots.heel.y) * dx);
    return (cross / len / len) * footLengthMm;
}

/** Degrees that rotate the pad so the heel–met line points to the top of the screen. */
export function heelToToeAngleDeg(dots: Pick<FootDots, "firstMet" | "fifthMet" | "heel">): number {
    const met = midpoint(dots.firstMet, dots.fifthMet);
    const dx = met.x - dots.heel.x;
    const dy = met.y - dots.heel.y;
    if (Math.hypot(dx, dy) < 1e-6) return 0;
    const current = Math.atan2(dy, dx);
    const up = -Math.PI / 2;
    return ((up - current) * 180) / Math.PI;
}
