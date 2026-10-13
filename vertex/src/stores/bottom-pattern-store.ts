// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";
import { create } from "zustand";
import type { PolyPoint } from "@/lib/geometry/procedural-wall/curves";
import { cloneTrimline, type TrimlineCurve } from "@/lib/geometry/trimline";
import type { Side } from "@/types";

/** Viewer-only faired bottom pattern. Independent of `design.trimlines`. */
export interface BottomPatternStore {
    patterns: Partial<Record<Side, TrimlineCurve>>;
    generatedKey: Partial<Record<Side, string>>;
    /** Min inset of B vs composed top rim R (mm). Negative = B outside R. */
    rimInsetMm: Partial<Record<Side, number>>;
    setPattern: (side: Side, curve: TrimlineCurve) => void;
    setRimInsetMm: (side: Side, insetMm: number) => void;
    ensureGenerated: (side: Side, key: string, points: PolyPoint[]) => TrimlineCurve;
    getPattern: (side: Side) => TrimlineCurve | null;
    clearSide: (side: Side) => void;
    clear: () => void;
}

export function polyPointsToCurve(points: PolyPoint[]): TrimlineCurve {
    return { points: points.map((p) => new THREE.Vector3(p.x, p.y, p.z ?? 0)) };
}

export function curveToPolyPoints(curve: TrimlineCurve): PolyPoint[] {
    return curve.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

export const useBottomPatternStore = create<BottomPatternStore>((set, get) => ({
    patterns: {},
    generatedKey: {},
    rimInsetMm: {},

    setRimInsetMm: (side, insetMm) =>
        set((s) => ({
            rimInsetMm: { ...s.rimInsetMm, [side]: insetMm },
        })),

    setPattern: (side, curve) =>
        set((s) => {
            const generatedKey = { ...s.generatedKey };
            delete generatedKey[side];
            return {
                patterns: { ...s.patterns, [side]: cloneTrimline(curve) },
                generatedKey,
            };
        }),

    ensureGenerated: (side, key, points) => {
        const existing = get().patterns[side];
        if (existing && get().generatedKey[side] === key) return cloneTrimline(existing);
        const curve = polyPointsToCurve(points);
        set((s) => ({
            patterns: { ...s.patterns, [side]: cloneTrimline(curve) },
            generatedKey: { ...s.generatedKey, [side]: key },
        }));
        return cloneTrimline(curve);
    },

    getPattern: (side) => {
        const curve = get().patterns[side];
        return curve ? cloneTrimline(curve) : null;
    },

    clearSide: (side) =>
        set((s) => {
            const patterns = { ...s.patterns };
            const generatedKey = { ...s.generatedKey };
            const rimInsetMm = { ...s.rimInsetMm };
            delete patterns[side];
            delete generatedKey[side];
            delete rimInsetMm[side];
            return { patterns, generatedKey, rimInsetMm };
        }),

    clear: () => set({ patterns: {}, generatedKey: {}, rimInsetMm: {} }),
}));
