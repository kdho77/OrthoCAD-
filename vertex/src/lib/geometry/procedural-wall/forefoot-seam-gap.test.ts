// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Printed insoles showed a straight unbonded line through the forefoot.
// This guards the mesh step: a medial/lateral or top/base slit would show up
// as an open edge, a second coronal loop, or a hairline pinch. See
// docs/diagnostics/2026-11-13-forefoot-seam-gap.md.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { defaultElementPose } from "@/lib/geometry/elements";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { effectiveHardnessRegions } from "@/lib/hardness/collect";
import { mirrorGeometry } from "@/lib/library/loaders";
import { defaultDesign } from "@/stores/design-store";
import type { PlacedElement, Side } from "@/types";
import { reconstructProceduralPreview, sampleTopFromArrayBuffer } from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

/** Thinner than a 0.4 mm bead. A real slit the slicer would wall on both sides. */
const SLIT_MM = 0.4;

type Seg = { ax: number; ay: number; bx: number; by: number };

function topology(geo: BufferGeometry) {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    const nT = (index ? index.count : pos.count) / 3;
    const at = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    const q = 1e4;
    const key = (i: number) =>
        `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    const edge = new Map<string, number>();
    const faces = new Map<string, number>();
    const buckets = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) buckets.set(key(i), (buckets.get(key(i)) ?? 0) + 1);
    let unweldedGroups = 0;
    for (const n of buckets.values()) if (n > 1) unweldedGroups++;
    for (let t = 0; t < nT; t++) {
        const ids = [at(t, 0), at(t, 1), at(t, 2)];
        const ks = ids.map(key).sort();
        const fk = ks.join("|");
        faces.set(fk, (faces.get(fk) ?? 0) + 1);
        for (let e = 0; e < 3; e++) {
            const a = ks[e]!;
            const b = ks[(e + 1) % 3]!;
            if (a === b) continue;
            const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
            edge.set(ek, (edge.get(ek) ?? 0) + 1);
        }
    }
    let open = 0;
    let nonManifold = 0;
    let dupFaces = 0;
    for (const n of edge.values()) {
        if (n === 1) open++;
        else if (n > 2) nonManifold++;
    }
    for (const n of faces.values()) if (n > 1) dupFaces += n;
    return { open, nonManifold, dupFaces, unweldedGroups, tris: nT };
}

function planeSegments(geo: BufferGeometry, value: number): Seg[] {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    const nT = (index ? index.count : pos.count) / 3;
    const at = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    const segs: Seg[] = [];
    for (let t = 0; t < nT; t++) {
        const ids = [at(t, 0), at(t, 1), at(t, 2)];
        const hits: Array<[number, number]> = [];
        for (let e = 0; e < 3; e++) {
            const i0 = ids[e]!;
            const i1 = ids[(e + 1) % 3]!;
            const z0 = pos.getX(i0) - value;
            const z1 = pos.getX(i1) - value;
            if ((z0 < 0 && z1 >= 0) || (z1 < 0 && z0 >= 0)) {
                const s = z0 / (z0 - z1);
                hits.push([
                    pos.getY(i0) + (pos.getY(i1) - pos.getY(i0)) * s,
                    pos.getZ(i0) + (pos.getZ(i1) - pos.getZ(i0)) * s,
                ]);
            }
        }
        if (hits.length < 2) continue;
        const a = hits[0]!;
        const b = hits[1]!;
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4) continue;
        segs.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });
    }
    return segs;
}

function stitch(segs: Seg[], tol = 0.2) {
    const used = new Array(segs.length).fill(false);
    const near = (x0: number, y0: number, x1: number, y1: number) => Math.hypot(x0 - x1, y0 - y1) <= tol;
    const loops: Array<{ closed: boolean; len: number; pts: Array<[number, number]> }> = [];
    for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        const pts: Array<[number, number]> = [
            [segs[i]!.ax, segs[i]!.ay],
            [segs[i]!.bx, segs[i]!.by],
        ];
        let grew = true;
        while (grew) {
            grew = false;
            const head = pts[0]!;
            const tail = pts[pts.length - 1]!;
            for (let j = 0; j < segs.length; j++) {
                if (used[j]) continue;
                const s = segs[j]!;
                if (near(tail[0], tail[1], s.ax, s.ay)) {
                    pts.push([s.bx, s.by]);
                    used[j] = true;
                    grew = true;
                    break;
                }
                if (near(tail[0], tail[1], s.bx, s.by)) {
                    pts.push([s.ax, s.ay]);
                    used[j] = true;
                    grew = true;
                    break;
                }
                if (near(head[0], head[1], s.bx, s.by)) {
                    pts.unshift([s.ax, s.ay]);
                    used[j] = true;
                    grew = true;
                    break;
                }
                if (near(head[0], head[1], s.ax, s.ay)) {
                    pts.unshift([s.bx, s.by]);
                    used[j] = true;
                    grew = true;
                    break;
                }
            }
        }
        let len = 0;
        for (let k = 1; k < pts.length; k++) {
            len += Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]);
        }
        const a = pts[0]!;
        const b = pts[pts.length - 1]!;
        loops.push({ closed: near(a[0], a[1], b[0], b[1]) && pts.length >= 4, len, pts });
    }
    return loops;
}

/** Minimum distance between samples at least `minArc` mm apart along the loop. */
function minThickness(pts: Array<[number, number]>, minArc = 8): number {
    const arc: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
        arc.push(arc[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    }
    const total = arc[arc.length - 1] ?? 0;
    let best = Infinity;
    const step = Math.max(1, Math.floor(pts.length / 160));
    for (let i = 0; i < pts.length; i += step) {
        for (let j = i + step; j < pts.length; j += step) {
            const along = Math.min(Math.abs(arc[j]! - arc[i]!), total - Math.abs(arc[j]! - arc[i]!));
            if (along < minArc) continue;
            best = Math.min(best, Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1]));
        }
    }
    return best;
}

/**
 * One coronal section. A station that lands on a loft ring drops the in-plane
 * edges and leaves a sub-millimetre scrap beside one long chain. That chain
 * counts as the shell when its ends are within 2 mm and nothing else is longer
 * than 2 mm. A second wall (a real slit) is a second chain longer than 2 mm.
 * Stitch tolerance stays at 0.15 mm so a dense contour is not short-circuited
 * across the plate.
 */
function forefootSection(geo: BufferGeometry, u: number) {
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const base = box.min.x + (box.max.x - box.min.x) * u;
    const tried: string[] = [];
    for (const nudge of [0.17, 0.41, -0.29, 0.73, 1.1]) {
        const loops = stitch(planeSegments(geo, base + nudge), 0.15);
        const summary = loops
            .filter((l) => l.len > 2)
            .map((l) => `${l.closed ? "c" : "o"}${l.len.toFixed(1)}`)
            .join(",");
        tried.push(`${nudge}:${summary || "none"}`);
        const long = loops.filter((l) => l.len > 40);
        const mid = loops.filter((l) => l.len > 2 && l.len <= 40);
        if (long.length !== 1 || mid.length !== 0) continue;
        const loop = long[0]!;
        const a = loop.pts[0]!;
        const b = loop.pts[loop.pts.length - 1]!;
        const gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (loop.closed || gap < 2) return { pts: loop.pts, detail: tried[tried.length - 1]! };
    }
    return { pts: null as Array<[number, number]> | null, detail: tried.join(" | ") };
}

function assertNoForefootSlit(geo: BufferGeometry, label: string) {
    const topo = topology(geo);
    expect(topo.open, `${label} open edges`).toBe(0);
    expect(topo.nonManifold, `${label} non-manifold edges`).toBe(0);
    expect(topo.dupFaces, `${label} duplicate faces`).toBe(0);
    expect(topo.unweldedGroups, `${label} unwelded coincident vertices`).toBe(0);
    for (const u of [0.72, 0.82, 0.9]) {
        const section = forefootSection(geo, u);
        expect(section.pts, `${label} u=${u} closed section (${section.detail})`).not.toBeNull();
        const thick = minThickness(section.pts!);
        expect(thick, `${label} u=${u} section thickness`).toBeGreaterThan(SLIT_MM);
    }
}

async function loadSide(side: Side): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "right") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    return raw;
}

function metPad(side: Side, lengthMm: number, widthMm: number): PlacedElement {
    const pose = defaultElementPose("met_pad", side, lengthMm, widthMm);
    return {
        id: `met-${side}`,
        kind: "met_pad",
        side,
        position: pose.position,
        rotationDeg: pose.rotationDeg,
        scale: pose.scale,
        heightMm: pose.heightMm,
        placementMode: pose.placementMode,
    };
}

describe("forefoot seam gap", () => {
    test("a default print has no hardness modifier for the slicer to wall", () => {
        expect(effectiveHardnessRegions(defaultDesign(), "left")).toEqual([]);
        expect(effectiveHardnessRegions(defaultDesign(), "right")).toEqual([]);
    });

    test("left and right shells, with and without a met pad, have no forefoot slit", async () => {
        const layout = insoleLayoutFromDesign(defaultDesign());
        for (const side of ["left", "right"] as const) {
            for (const withPad of [false, true]) {
                const raw = await loadSide(side);
                const design = defaultDesign();
                if (withPad) design.elements = [metPad(side, layout.lengthMm, layout.widthMm)];
                const field = baseModifierField(design, side, design.thicknessMm);
                try {
                    const preview = await reconstructProceduralPreview(raw, {
                        wallStyle: "straight",
                        scanPattern: "full_contact",
                        side,
                        sourceField: field,
                        composedTop: true,
                        thicknessMm: field.thicknessMm,
                        corrections: field.corrections,
                    });
                    assertNoForefootSlit(preview.geometry, `${side}${withPad ? " met pad" : ""}`);
                    preview.geometry.dispose();
                } finally {
                    raw.dispose();
                }
            }
        }
    }, 300_000);
});
