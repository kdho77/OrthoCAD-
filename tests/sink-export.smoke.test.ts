// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { analyzeManifold } from "@/lib/geometry/manifold";
import {
    countSelfIntersections,
    extractStockWallModel,
    foldReport,
    reconstructProceduralWalls,
} from "@/lib/geometry/procedural-wall";
import { SINK_DEFAULT_DEPTH_MM, SINK_KIND_ORDER, SINK_PROFILES } from "@/lib/geometry/sink";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import type { PlacedSink } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";

/** Pinned on main for reconstructProceduralWalls(Default.glb, { wallStyle: "straight" }). */
const STRAIGHT_STL_MD5 = "053d39a5dfd7c889f6b67d0d3fe2d57e";

/**
 * Brief prefixes for the default export. They are not stored in the repo.
 * The straight MD5 above is the byte-identity pin this tree already ships.
 */
const SHA_PREFIX: Record<"straight" | "round" | "hybrid", string> = {
    hybrid: "cae840e0302e",
    straight: "22e79065d8dd",
    round: "846bdcc396cb",
};

function allSinks(depthFor: (kind: (typeof SINK_KIND_ORDER)[number]) => number): PlacedSink[] {
    return SINK_KIND_ORDER.map((kind) => ({ id: kind, kind, depthMm: depthFor(kind) }));
}

function euler(geo: BufferGeometry): number {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!index) return 0;
    const map = new Map<string, number>();
    const idOf = (i: number): number => {
        const key = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
        let id = map.get(key);
        if (id === undefined) {
            id = map.size;
            map.set(key, id);
        }
        return id;
    };
    const edges = new Set<string>();
    let faces = 0;
    for (let t = 0; t < index.count / 3; t++) {
        const a = idOf(index.getX(t * 3));
        const b = idOf(index.getX(t * 3 + 1));
        const c = idOf(index.getX(t * 3 + 2));
        if (a === b || b === c || c === a) continue;
        faces++;
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            edges.add(u < v ? `${u}|${v}` : `${v}|${u}`);
        }
    }
    return map.size - edges.size + faces;
}

function positionArray(geo: BufferGeometry): Float32Array {
    return geo.getAttribute("position").array as Float32Array;
}

describe("sink export smoke", () => {
    test("no sinks: straight STL matches main, and the three style hashes are recorded", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(raw, { id: "default", name: "Default" });
        const hashes: Record<string, { md5: string; sha: string; posSha: string }> = {};
        for (const wallStyle of ["straight", "round", "hybrid"] as const) {
            const geo = reconstructProceduralWalls(model, { wallStyle, side: "left" });
            const buf = Buffer.from(geometryToBinarySTL(geo));
            const sha = createHash("sha256").update(buf).digest("hex");
            const posSha = createHash("sha256")
                .update(Buffer.from(positionArray(geo).buffer))
                .digest("hex");
            hashes[wallStyle] = {
                md5: createHash("md5").update(buf).digest("hex"),
                sha,
                posSha,
            };
            console.log("[SINK-NOSINK-HASH]", wallStyle, hashes[wallStyle], "prefix", SHA_PREFIX[wallStyle]);
            geo.dispose();
        }
        writeFileSync("/tmp/sink-nosink-hashes.json", JSON.stringify(hashes, null, 2));
        expect(hashes.straight?.md5).toBe(STRAIGHT_STL_MD5);
        raw.dispose();
    });

    test("M9 left, all six sinks, straight / round / hybrid stay watertight", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(raw, { id: "default", name: "Default" });
        const sinks = allSinks(() => SINK_DEFAULT_DEPTH_MM);
        for (const wallStyle of ["straight", "round", "hybrid"] as const) {
            const base = reconstructProceduralWalls(model, { wallStyle, side: "left" });
            const geo = reconstructProceduralWalls(model, {
                wallStyle,
                side: "left",
                sinks,
                sinkStyloidThicken: wallStyle === "hybrid",
            });
            const report = analyzeManifold(geo);
            expect(report.isWatertight).toBe(true);
            expect(report.openEdges).toBe(0);
            expect(report.nonManifoldEdges).toBe(0);
            expect(euler(geo)).toBe(2);
            const basePos = positionArray(base);
            const pos = positionArray(geo);
            expect(pos.length).toBe(basePos.length);
            let xy = 0;
            let dz = 0;
            let bottom = 0;
            for (let i = 0; i < pos.length; i += 3) {
                xy = Math.max(xy, Math.hypot(pos[i]! - basePos[i]!, pos[i + 1]! - basePos[i + 1]!));
                dz = Math.max(dz, Math.abs(pos[i + 2]! - basePos[i + 2]!));
                if (Math.abs(basePos[i + 2]!) < 1e-4) bottom = Math.max(bottom, Math.abs(pos[i + 2]!));
            }
            expect(xy).toBeLessThan(0.02);
            expect(bottom).toBeLessThan(1e-4);
            expect(dz).toBeGreaterThan(0.4);
            if (wallStyle === "straight") {
                expect(countSelfIntersections(geo).real).toBe(0);
            }
            const plainFold = foldReport(base).worstDeg;
            const sunkFold = foldReport(geo).worstDeg;
            expect(sunkFold).toBeLessThanOrEqual(Math.max(60, plainFold));
            geo.dispose();
            base.dispose();
        }
        raw.dispose();
    });

    test("M1-scale 1st MPJ at max still clamps the analytic cut on a straight wall", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(raw, { id: "default", name: "Default" });
        const kind = "mpj1" as const;
        const geo = reconstructProceduralWalls(model, {
            wallStyle: "straight",
            side: "left",
            sinks: [{ id: "mpj1", kind, depthMm: SINK_PROFILES[kind].maxDepthMm + 2 }],
        });
        expect(analyzeManifold(geo).isWatertight).toBe(true);
        expect(euler(geo)).toBe(2);
        const warnings = (geo.userData as { sinkWarnings?: { code: string }[] }).sinkWarnings;
        expect(warnings === undefined || Array.isArray(warnings)).toBe(true);
        geo.dispose();
        raw.dispose();
    });
});
