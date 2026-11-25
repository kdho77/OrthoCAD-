// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PrescriptionParseResult, SideCorrections } from "@/types";

export function correctionRowKeys(
    left?: Partial<SideCorrections>,
    right?: Partial<SideCorrections>,
): string[] {
    const keys = new Set<string>();
    for (const k of Object.keys(left ?? {})) keys.add(k);
    for (const k of Object.keys(right ?? {})) keys.add(k);
    return [...keys].sort();
}

function patchValueEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

export function patchesAsymmetric(
    left: Partial<SideCorrections> | undefined,
    right: Partial<SideCorrections> | undefined,
    keys: string[],
    included: Record<string, boolean>,
): boolean {
    const active = keys.filter((k) => included[k] !== false);
    for (const key of active) {
        const l = (left as Record<string, unknown> | undefined)?.[key];
        const r = (right as Record<string, unknown> | undefined)?.[key];
        if (!patchValueEqual(l, r)) return true;
    }
    return false;
}

export function countIncluded(keys: string[], included: Record<string, boolean>): number {
    return keys.filter((k) => included[k] !== false).length;
}

export function buildPrescriptionToApply(
    base: PrescriptionParseResult,
    draftLeft: Partial<SideCorrections>,
    draftRight: Partial<SideCorrections>,
    included: Record<string, boolean>,
): PrescriptionParseResult {
    const keys = correctionRowKeys(draftLeft, draftRight);
    const filterSide = (side: Partial<SideCorrections>): Partial<SideCorrections> | undefined => {
        const out: Record<string, unknown> = {};
        for (const key of keys) {
            if (included[key] === false) continue;
            const value = (side as Record<string, unknown>)[key];
            if (value !== undefined) out[key] = value;
        }
        return Object.keys(out).length > 0 ? (out as Partial<SideCorrections>) : undefined;
    };
    return {
        ...base,
        corrections: {
            left: filterSide(draftLeft),
            right: filterSide(draftRight),
        },
    };
}

export function initialReviewDraft(result: PrescriptionParseResult): {
    left: Partial<SideCorrections>;
    right: Partial<SideCorrections>;
    included: Record<string, boolean>;
} {
    const left = { ...(result.corrections.left ?? {}) };
    const right = { ...(result.corrections.right ?? {}) };
    const keys = correctionRowKeys(left, right);
    const included = Object.fromEntries(keys.map((k) => [k, true]));
    return { left, right, included };
}
