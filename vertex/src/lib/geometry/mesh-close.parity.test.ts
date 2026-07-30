// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Option 3 parity / winding-agnostic mesh-close guards (G1, G3, G4, G5).
 *
 * LEFT (odd-parity reorient) is the only path whose closed solid may change.
 * RIGHT (reorient+mirror) and unreoriented must stay byte-identical to the
 * pinned shipping hashes. Euler=3 is a known bowtie defect under a separate
 * contract — do not re-pin DEFAULT_GLB_CLOSED_BASELINE when it moves.
 */

import { createHash } from "node:crypto";
import { describe, expect, test } from "@rstest/core";
import { type BufferGeometry, ShapeUtils, Vector2, Vector3 } from "three";
import { detectArchSideSign } from "@/lib/geometry/base-modifier";
import {
    closeGlbInsoleToSolid,
    DEFAULT_GLB_CLOSED_BASELINE,
    extractAllBoundaryCyclesForTest,
    submeshByVertexRange,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import {
    DEFAULT_GLB_SUCCESS_CYCLE_MULTISET,
    loadDefaultGlbRowB,
    loadProductionDefaultGlb,
    loadRawDefaultGlb,
} from "../../../../tests/helpers/load-production-default-glb";

/** Pinned shipping closed-solid hashes (pre Option-3 fix). G1 STOP if these drift.
 * Asserted as literal constants below — a RIGHT/RAW regression must fail loudly,
 * not silently via a recomputed "live" pin. */
const G1_RIGHT = {
    pos: "1f53430e3291b2c7a75d30ae32e48c17",
    idx: "aa81d0db90896adcf243b6eb4afa5946",
} as const;
const G1_RAW = {
    pos: "faa5bac8c4ebf1ceb229d56136dea646",
    idx: "aa81d0db90896adcf243b6eb4afa5946",
} as const;

function hashAttr(arr: ArrayLike<number> & ArrayBufferView): string {
    return createHash("sha256")
        .update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength))
        .digest("hex")
        .slice(0, 32);
}

function hashClosed(geo: BufferGeometry): { pos: string; idx: string; V: number; I: number } {
    const pos = geo.getAttribute("position")!.array as Float32Array;
    const idx = geo.index!.array as Uint32Array | Uint16Array;
    return {
        V: pos.length / 3,
        I: idx.length,
        pos: hashAttr(pos),
        idx: hashAttr(idx),
    };
}

function bottomCycleLengths(geo: BufferGeometry): number[] {
    const topN = (geo.userData as { topVertexCount: number }).topVertexCount;
    const bot = submeshByVertexRange(geo, topN, geo.getAttribute("position").count);
    const cycles = extractAllBoundaryCyclesForTest(bot);
    bot.dispose();
    return cycles.map((c) => c.length).sort((a, b) => b - a);
}

function contourSigns(geo: BufferGeometry): number[] {
    const topN = (geo.userData as { topVertexCount: number }).topVertexCount;
    const bot = submeshByVertexRange(geo, topN, geo.getAttribute("position").count);
    const cycles = extractAllBoundaryCyclesForTest(bot)
        .slice()
        .sort((a, b) => b.length - a.length);
    const signs = cycles.map((loop) => {
        const area = ShapeUtils.area(loop.map((p) => new Vector2(p.x, p.y)));
        return Math.sign(area);
    });
    bot.dispose();
    return signs;
}

function expectClosedSolid(geo: BufferGeometry, label: string): BufferGeometry {
    const closed = closeGlbInsoleToSolid(geo.clone());
    const report = validateManifold(closed);
    expect(report.openEdges, `${label} openEdges`).toBe(0);
    expect(report.nonManifoldEdges, `${label} nonManifold`).toBe(0);
    // euler===3 is a KNOWN DEFECT (vertex pinches / bowties) under a separate
    // contract — not a correct topological sphere. Do not treat improvement
    // toward 2 as a baseline update without the euler contract's scrutiny.
    expect(report.eulerCharacteristic, `${label} euler`).toBe(
        DEFAULT_GLB_CLOSED_BASELINE.eulerCharacteristic,
    );
    return closed;
}

function meshCentroid(geo: BufferGeometry): Vector3 {
    const pos = geo.getAttribute("position")!;
    const c = new Vector3();
    for (let i = 0; i < pos.count; i++) c.add(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    return c.multiplyScalar(1 / pos.count);
}

/** Signed volume (mm³) via triangle sum v0·(v1×v2)/6. Positive ⇒ outward winding. */
function signedVolumeMm3(geo: BufferGeometry): number {
    const pos = geo.getAttribute("position")!;
    const index = geo.index!;
    let vol = 0;
    const a = new Vector3(),
        b = new Vector3(),
        c = new Vector3();
    for (let t = 0; t < index.count; t += 3) {
        a.set(pos.getX(index.getX(t)), pos.getY(index.getX(t)), pos.getZ(index.getX(t)));
        b.set(pos.getX(index.getX(t + 1)), pos.getY(index.getX(t + 1)), pos.getZ(index.getX(t + 1)));
        c.set(pos.getX(index.getX(t + 2)), pos.getY(index.getX(t + 2)), pos.getZ(index.getX(t + 2)));
        vol += a.dot(new Vector3().crossVectors(b, c));
    }
    return vol / 6;
}

/** Facet outward spot-check: normal · (faceCentroid − meshCentroid) > 0. */
function outwardSpotCheck(
    geo: BufferGeometry,
    nSamples: number,
    seed = 1,
): { n: number; outward: number; inward: number; fracOutward: number } {
    const pos = geo.getAttribute("position")!;
    const index = geo.index!;
    const triCount = index.count / 3;
    const centroid = meshCentroid(geo);
    let outward = 0,
        inward = 0;
    let state = seed >>> 0;
    const seen = new Set<number>();
    const target = Math.min(nSamples, triCount);
    while (seen.size < target) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const ti = state % triCount;
        if (seen.has(ti)) continue;
        seen.add(ti);
        const i0 = index.getX(ti * 3),
            i1 = index.getX(ti * 3 + 1),
            i2 = index.getX(ti * 3 + 2);
        const a = new Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
        const b = new Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
        const c = new Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
        const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
        const faceC = new Vector3()
            .add(a)
            .add(b)
            .add(c)
            .multiplyScalar(1 / 3);
        const dot = normal.dot(new Vector3().subVectors(faceC, centroid));
        if (dot > 1e-9) outward++;
        else if (dot < -1e-9) inward++;
    }
    return { n: target, outward, inward, fracOutward: outward / target };
}

describe("Default.glb mesh-close parity (Option 3)", () => {
    test("G1: RIGHT (reorient+mirror) closed solid is byte-identical to shipping pin", async () => {
        const geo = await loadProductionDefaultGlb({ primarySide: "left", slot: "right" });
        expect(bottomCycleLengths(geo)).toEqual([...DEFAULT_GLB_SUCCESS_CYCLE_MULTISET]);
        const closed = expectClosedSolid(geo, "RIGHT");
        expect(hashClosed(closed)).toMatchObject(G1_RIGHT);
        closed.dispose();
        geo.dispose();
    });

    test("G1: unreoriented / custom-prefab closed solid is byte-identical to shipping pin", async () => {
        const geo = await loadProductionDefaultGlb({ slot: "unreoriented" });
        expect(bottomCycleLengths(geo)).toEqual([...DEFAULT_GLB_SUCCESS_CYCLE_MULTISET]);
        const closed = expectClosedSolid(geo, "RAW");
        expect(hashClosed(closed)).toMatchObject(G1_RAW);
        closed.dispose();
        geo.dispose();
    });

    test("G3 Row B: success cycles + uniform contour sign; closes after cap fix", async () => {
        const rowB = await loadDefaultGlbRowB();
        expect(bottomCycleLengths(rowB)).toEqual([...DEFAULT_GLB_SUCCESS_CYCLE_MULTISET]);
        const signs = contourSigns(rowB);
        // Diagnostic: success paths are uniform-sign; LEFT mixed pre-fix.
        // Post-fix all paths (including Row B) must be uniform.
        expect(new Set(signs.map((s) => Math.sign(s))).size).toBe(1);
        const closed = expectClosedSolid(rowB, "ROW_B");
        closed.dispose();
        rowB.dispose();
    });

    test("LEFT (reorient-only) closes with success cycles; positions match reorient input", async () => {
        const geo = await loadProductionDefaultGlb({ primarySide: "left", slot: "left" });
        expect(bottomCycleLengths(geo)).toEqual([...DEFAULT_GLB_SUCCESS_CYCLE_MULTISET]);
        const inputPos = hashAttr(geo.getAttribute("position")!.array as Float32Array);
        const closed = expectClosedSolid(geo, "LEFT");
        expect(hashClosed(closed).pos).toBe(inputPos);
        closed.dispose();
        geo.dispose();
    });

    test("V1: LEFT closed solid is outward-correct, positive volume≈RIGHT, arch on width−", async () => {
        const leftIn = await loadProductionDefaultGlb({ primarySide: "left", slot: "left" });
        const rightIn = await loadProductionDefaultGlb({ primarySide: "left", slot: "right" });
        const left = expectClosedSolid(leftIn, "LEFT");
        const right = expectClosedSolid(rightIn, "RIGHT");

        // Centroid·normal spot-check is imperfect on a concave heel cup (some
        // plantar/wall faces point toward the mesh centroid while still
        // outward-oriented). Compare LEFT vs RIGHT under the same sample —
        // an inverted shell would invert the majority and the signed volume.
        const spotL = outwardSpotCheck(left, 500);
        const spotR = outwardSpotCheck(right, 500);
        expect(spotL.fracOutward).toBeGreaterThan(0.85);
        expect(spotR.fracOutward).toBeGreaterThan(0.85);
        expect(Math.abs(spotL.inward - spotR.inward)).toBeLessThanOrEqual(5);

        const volL = signedVolumeMm3(left);
        const volR = signedVolumeMm3(right);
        expect(volL).toBeGreaterThan(0);
        expect(volR).toBeGreaterThan(0);
        // Near-mirror-equal volumes (relative |Δ| < 1%).
        expect(Math.abs(volL - volR) / Math.max(volL, volR)).toBeLessThan(0.01);

        // Builtin Default.glb arch sits on width− after reorient.
        expect(detectArchSideSign(left)).toBe(-1);

        console.log("[V1]", {
            volL,
            volR,
            relDiff: Math.abs(volL - volR) / Math.max(volL, volR),
            spotL,
            spotR,
            arch: detectArchSideSign(left),
        });

        left.dispose();
        right.dispose();
        leftIn.dispose();
        rightIn.dispose();
    });

    test("G5: primarySide×slot combinations and unreoriented all close", async () => {
        const cases: Array<{ primarySide: "left" | "right"; slot: "left" | "right" | "unreoriented" }> = [
            { primarySide: "left", slot: "left" },
            { primarySide: "left", slot: "right" },
            { primarySide: "right", slot: "left" },
            { primarySide: "right", slot: "right" },
            { primarySide: "left", slot: "unreoriented" },
        ];
        for (const c of cases) {
            const geo = await loadProductionDefaultGlb(c);
            const label = `primarySide=${c.primarySide} slot=${c.slot}`;
            const closed = expectClosedSolid(geo, label);
            closed.dispose();
            geo.dispose();
        }
    });

    test("raw fixture loads and matches unreoriented helper", async () => {
        const raw = await loadRawDefaultGlb();
        const via = await loadProductionDefaultGlb({ slot: "unreoriented" });
        expect(raw.getAttribute("position").count).toBe(via.getAttribute("position").count);
        expect(hashAttr(raw.getAttribute("position")!.array as Float32Array)).toBe(
            hashAttr(via.getAttribute("position")!.array as Float32Array),
        );
        raw.dispose();
        via.dispose();
    });
});
