// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Combined validation matrix for rim-conformity (Step 5) — width / depth /
 * arch / combined screenshot scenario on post-#109 base.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    ANTERIOR_U0,
    applyBaseModifiers,
    PLANTAR_Z_MAX_MM,
    RIM_PAIR_TOL_MM,
    WALL_TOP_MIN_Z_MM,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    closeGlbInsoleToSolid,
    extractOrderedBoundaryLoopWithIndices,
    submeshByVertexRange,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");
const REPORT = "/tmp/rim-matrix-report.json";

function neu(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(patch: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "right",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections: { ...neu(), ...patch },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

interface Frame {
    lengthAxis: number;
    widthAxis: number;
    thickAxis: number;
    lenMin: number;
    lenSize: number;
    topN: number;
    count: number;
}

function resolveFrame(geo: BufferGeometry): Frame {
    const arr = geo.getAttribute("position")!.array as Float32Array;
    const count = arr.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let a = 0; a < 3; a++) {
            const c = arr[i * 3 + a]!;
            if (c < min[a]!) min[a] = c;
            if (c > max[a]!) max[a] = c;
        }
    }
    const sizes: [number, number][] = [
        [0, max[0]! - min[0]!],
        [1, max[1]! - min[1]!],
        [2, max[2]! - min[2]!],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    const topN = (geo.userData as { topVertexCount?: number }).topVertexCount ?? count;
    return {
        thickAxis: sizes[0]![0],
        widthAxis: sizes[1]![0],
        lengthAxis: sizes[2]![0],
        lenMin: min[sizes[2]![0]]!,
        lenSize: max[sizes[2]![0]]! - min[sizes[2]![0]]! || 1,
        topN,
        count,
    };
}

function topRim(geo: BufferGeometry, topN: number): number[] {
    const sub = submeshByVertexRange(geo, 0, topN);
    try {
        return extractOrderedBoundaryLoopWithIndices(sub).indices;
    } finally {
        sub.dispose();
    }
}

function plantarDrift(base: Float32Array, mod: Float32Array, f: Frame): number {
    // F≈0 ground-contact plantar (forefoot u≥0.80 / ultra-posterior u≤0.05).
    // Arch bump bleeds into u≈0.1–0.3 so mid-heel plantar lifts under shell sync.
    let m = 0;
    for (let i = f.topN; i < f.count; i++) {
        if (base[i * 3 + f.thickAxis]! > PLANTAR_Z_MAX_MM) continue;
        const u = (base[i * 3 + f.lengthAxis]! - f.lenMin) / (f.lenSize || 1);
        if (u > 0.05 && u < 0.8) continue;
        const d = Math.hypot(
            mod[i * 3]! - base[i * 3]!,
            mod[i * 3 + 1]! - base[i * 3 + 1]!,
            mod[i * 3 + 2]! - base[i * 3 + 2]!,
        );
        if (d > m) m = d;
    }
    return m;
}

/** Max ‖Δ_wall − Δ_rim‖ on deduped heel wall-top seeds (u≤U0). */
function maxDeltaMismatch(base: Float32Array, mod: Float32Array, f: Frame, rim: number[]): number {
    const HQ = 20;
    const hash = new Map<string, number[]>();
    for (let i = f.topN; i < f.count; i++) {
        const k = `${Math.round(base[i * 3 + f.lengthAxis]! * HQ)},${Math.round(base[i * 3 + f.widthAxis]! * HQ)}`;
        let list = hash.get(k);
        if (!list) {
            list = [];
            hash.set(k, list);
        }
        list.push(i);
    }
    const byWall = new Map<number, { j: number; pairD: number }>();
    for (const j of rim) {
        const u = (base[j * 3 + f.lengthAxis]! - f.lenMin) / f.lenSize;
        if (u > ANTERIOR_U0) continue;
        const lx = base[j * 3 + f.lengthAxis]!;
        const wy = base[j * 3 + f.widthAxis]!;
        const bins = Math.ceil(RIM_PAIR_TOL_MM * HQ) + 2;
        const cx = Math.round(lx * HQ);
        const cy = Math.round(wy * HQ);
        let best = -1;
        let bestZ = -Infinity;
        let bestD = Infinity;
        for (let dx = -bins; dx <= bins; dx++) {
            for (let dy = -bins; dy <= bins; dy++) {
                const list = hash.get(`${cx + dx},${cy + dy}`);
                if (!list) continue;
                for (const bi of list) {
                    const d = Math.hypot(base[bi * 3 + f.lengthAxis]! - lx, base[bi * 3 + f.widthAxis]! - wy);
                    if (d > RIM_PAIR_TOL_MM) continue;
                    const z = base[bi * 3 + f.thickAxis]!;
                    if (z < WALL_TOP_MIN_Z_MM) continue;
                    if (z > bestZ + 1e-9 || (Math.abs(z - bestZ) <= 1e-9 && d < bestD)) {
                        bestZ = z;
                        best = bi;
                        bestD = d;
                    }
                }
            }
        }
        if (best < 0) continue;
        const prev = byWall.get(best);
        if (prev && prev.pairD <= bestD) continue;
        byWall.set(best, { j, pairD: bestD });
    }
    let maxM = 0;
    for (const [wall, s] of byWall) {
        const mismatch = Math.hypot(
            mod[wall * 3]! - base[wall * 3]! - (mod[s.j * 3]! - base[s.j * 3]!),
            mod[wall * 3 + 1]! - base[wall * 3 + 1]! - (mod[s.j * 3 + 1]! - base[s.j * 3 + 1]!),
            mod[wall * 3 + 2]! - base[wall * 3 + 2]! - (mod[s.j * 3 + 2]! - base[s.j * 3 + 2]!),
        );
        if (mismatch > maxM) maxM = mismatch;
    }
    return maxM;
}

describe("rim-conformity combined validation matrix", () => {
    let baseGeo: BufferGeometry;
    let frame: Frame;
    let rimIdx: number[];
    let baseArr: Float32Array;
    const rows: Record<string, unknown>[] = [];

    beforeAll(async () => {
        expect(existsSync(FIXTURE)).toBe(true);
        const buf = readFileSync(FIXTURE);
        const group = await loadGlbFromBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        baseGeo = extractMergedGeometry(group)!.geometry;
        frame = resolveFrame(baseGeo);
        rimIdx = topRim(baseGeo, frame.topN);
        baseArr = new Float32Array(baseGeo.getAttribute("position")!.array as Float32Array);
        expect(rimIdx.length).toBeGreaterThan(400);
    });

    const configs: Array<{ name: string; patch: Partial<SideCorrections> }> = [
        { name: "width-0.5", patch: { heelCupWidthMm: 0.5 } },
        { name: "width-5", patch: { heelCupWidthMm: 5 } },
        { name: "width-10", patch: { heelCupWidthMm: 10 } },
        { name: "depth-3", patch: { heelCupDepthMm: 3 } },
        { name: "depth-8", patch: { heelCupDepthMm: 8 } },
        { name: "depth-15", patch: { heelCupDepthMm: 15 } },
        { name: "arch-height", patch: { archHeightMm: 12 } },
        { name: "apex-shift", patch: { apexMoveMm: 10 } },
        {
            name: "combined-screenshot",
            patch: { heelCupWidthMm: 5, heelCupDepthMm: 5, archHeightMm: 10, apexMoveMm: 5 },
        },
    ];

    for (const cfg of configs) {
        test(cfg.name, () => {
            const mod = applyBaseModifiers(baseGeo, field(cfg.patch));
            const modArr = new Float32Array(mod.getAttribute("position")!.array as Float32Array);
            const rim = topRim(mod, frame.topN);
            const solid = closeGlbInsoleToSolid(mod);
            const report = validateManifold(solid);
            const plantar = plantarDrift(baseArr, modArr, frame);
            const mismatch = maxDeltaMismatch(baseArr, modArr, frame, rimIdx);

            // Idempotency
            const mod2 = applyBaseModifiers(baseGeo, field(cfg.patch));
            const mod2Arr = new Float32Array(mod2.getAttribute("position")!.array as Float32Array);
            let idemp = 0;
            for (let i = 0; i < frame.count * 3; i++) {
                idemp = Math.max(idemp, Math.abs(modArr[i]! - mod2Arr[i]!));
            }

            const row = {
                name: cfg.name,
                topRim: rim.length,
                openEdges: report.openEdges,
                plantarDriftMm: Number(plantar.toFixed(6)),
                deltaMismatchMm: Number(mismatch.toFixed(6)),
                idempotencyMaxDiff: idemp,
            };
            rows.push(row);
            writeFileSync(REPORT, JSON.stringify(rows, null, 2));

            expect(rim.length).toBeGreaterThan(400);
            expect(rim.length).toBeLessThan(500);
            expect(report.openEdges).toBe(0);
            expect(plantar).toBeLessThan(0.05);
            // Width cases: legacy rim-conformity (strict). Field-sync: allow larger
            // 3D mismatch from nearest-rim vs pair-rim depth noise; Z-gap covered
            // by synced-bottom-shell-field.test.ts (≤0.05 mm).
            const widthActive = (cfg.patch.heelCupWidthMm ?? 0) > 0;
            expect(mismatch).toBeLessThan(widthActive ? 0.1 : 0.8);
            expect(idemp).toBe(0);

            solid.dispose();
            mod.dispose();
            mod2.dispose();
        });
    }
});
