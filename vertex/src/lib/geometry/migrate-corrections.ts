// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import type { Corrections, DesignState, PlacedSink, Side, SideCorrections, WedgeCorrection } from "@/types";

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

    if (next.forefootWidthMm == null || !Number.isFinite(next.forefootWidthMm)) {
        next.forefootWidthMm = 0;
    }

    return next;
}

/** Sinks for one foot. A legacy flat list (pre per-side) is shared by both feet. */
export function sinksForSide(design: DesignState, side: Side): PlacedSink[] | undefined {
    const raw = design.sinks as { left?: PlacedSink[]; right?: PlacedSink[] } | PlacedSink[] | undefined;
    if (!raw) return undefined;
    const list = Array.isArray(raw) ? raw : raw[side];
    return list && list.length > 0 ? list : undefined;
}

/** Styloid thickening for one foot. A legacy boolean applies to both feet. */
export function sinkStyloidThickenForSide(design: DesignState, side: Side): boolean {
    const raw = design.sinkStyloidThicken as boolean | { left?: boolean; right?: boolean } | undefined;
    if (typeof raw === "boolean") return raw;
    return raw?.[side] === true;
}

/**
 * Moves a legacy design-wide sink list onto both feet. An absent list stays
 * absent — writing `sinks: []` into every saved design would change persisted JSON.
 */
export function migrateDesignSinks(design: DesignState): DesignState {
    const sinksRaw = design.sinks as unknown;
    const thickRaw = design.sinkStyloidThicken as unknown;
    const sinksIsArray = Array.isArray(sinksRaw);
    const thickIsBool = typeof thickRaw === "boolean";
    if (!sinksIsArray && !thickIsBool) return design;
    const list = sinksIsArray ? (sinksRaw as PlacedSink[]) : undefined;
    const sinks = sinksIsArray
        ? list && list.length > 0
            ? { left: list, right: list.map((s) => ({ ...s })) }
            : undefined
        : design.sinks;
    const sinkStyloidThicken = thickIsBool
        ? thickRaw
            ? { left: true, right: true }
            : undefined
        : design.sinkStyloidThicken;
    return { ...design, sinks, sinkStyloidThicken };
}

export function migrateCorrections(corrections: Corrections): Corrections {
    return {
        ...corrections,
        left: migrateSideCorrections(corrections.left),
        right: migrateSideCorrections(corrections.right),
    };
}
