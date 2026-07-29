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
import { type BufferGeometry, ShapeUtils, Vector2 } from "three";
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

/** Pinned shipping closed-solid hashes (pre Option-3 fix). G1 STOP if these drift. */
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
