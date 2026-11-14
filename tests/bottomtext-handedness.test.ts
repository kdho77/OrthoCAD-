// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { buildExportGeometry, buildValidatedExportGeometry } from "@/lib/geometry/export-geometry";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { binaryStlToGeometry, geometryToBinarySTL } from "@/lib/geometry/stl";
import { assertExactManifold } from "@/lib/geometry/text-marking/boolean";
import type { BottomOutlineWorld } from "@/lib/geometry/text-marking/bottom-engrave";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { useClientStore } from "@/stores/client-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";
import {
    diagnosticPngLegibility,
    encodePng,
    projectPlantarBelow,
    renderPlantarFromBelow,
    type SoleHeightmap,
    soleHeightmapFromBelow,
} from "./helpers/render-png";

const SAMPLE_TOP_FIXTURE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const DIAG_DIR = resolve(process.cwd(), "docs/diagnostics/bottom-text-1114");
const STL_DIR = resolve(DIAG_DIR, "stl");
const M9_LENGTH_MM = 275;
const PNG_W = 1080;
const PNG_H = 1280;

const PATIENTS = [
    { first: "JOHN", last: "SMITH", slug: "john-smith" },
    { first: "TIMOTHY", last: "HARTER", slug: "timothy-harter" },
] as const;

function viewFromBelow(p: { x: number; y: number }): { x: number; y: number } {
    return { x: p.x, y: -p.y };
}

function glyphCentroid(outline: BottomOutlineWorld): { x: number; y: number; z: number } {
    const pts = outline.outer;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
        z += p.z;
    }
    const n = Math.max(1, pts.length);
    return { x: x / n, y: y / n, z: z / n };
}

function textCentroids(geo: BufferGeometry): Array<{ x: number; y: number; z: number }> {
    return (
        (geo.userData as { textMarking?: { centroids?: Array<{ x: number; y: number; z: number }> } })
            .textMarking?.centroids ?? []
    );
}

function jHookBias(outline: BottomOutlineWorld): number {
    const pts = outline.outer;
    if (!pts.length) return 0;
    const c = glyphCentroid(outline);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of pts) {
        const v = viewFromBelow({ x: p.x - c.x, y: p.y - c.y });
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
    }
    return maxX + minX;
}

function bootDesignExportHarness(firstName: string, lastName: string): void {
    resetSampleTopGeometryCache();
    const buf = readFileSync(SAMPLE_TOP_FIXTURE);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("SAMPLE_Top")) {
            return new Response(buf, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
        }
        throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    useClientStore.setState({
        activeClientId: "bottomtext-client",
        clients: [
            {
                id: "bottomtext-client",
                firstName,
                lastName,
                displayName: "",
                reference: "BT-1",
                dateOfBirth: null,
                notes: "",
                shoeChart: {
                    shoeSizeUs: 9,
                    shoeSizesSplit: false,
                    shoeSizeLeftUs: 9,
                    shoeSizeRightUs: 9,
                    shoeWidth: "medium",
                },
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                archivedAt: null,
            },
        ],
    });

    const design = createDesignWithStockPlaceholder();
    design.usMenSize = 9;
    design.textMarking = {
        ...defaultTextMarking("bottom"),
        addPatientName: true,
        text: "",
        feet: "both",
    };
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({
        design,
        viewer: { ...viewer, wallModel: "procedural", wallStyle: "straight" },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
}

function bottomOutlines(geo: BufferGeometry): BottomOutlineWorld[] {
    return (geo.userData as { bottomOutlineWorld?: BottomOutlineWorld[] }).bottomOutlineWorld ?? [];
}

function writeDiagnosticPng(geo: BufferGeometry, side: Side, slug: string): Uint8Array {
    mkdirSync(DIAG_DIR, { recursive: true });
    const pos = geo.getAttribute("position").array as Float32Array;
    const idx = geo.getIndex()?.array ?? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    const loops = bottomOutlines(geo).map((g) => g.outer);
    const rgb = renderPlantarFromBelow(pos, idx, PNG_W, PNG_H, loops);
    writeFileSync(resolve(DIAG_DIR, `${side}-${slug}-from-below.png`), encodePng(PNG_W, PNG_H, rgb));
    return rgb;
}

/** From-below, the name is a horizontal band: long in +X, short in the cap. */
function assertOutlineSpansFrame(geo: BufferGeometry, outlines: BottomOutlineWorld[]): void {
    const pos = posOf(geo);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const g of outlines) {
        for (const p of g.outer) {
            const s = projectPlantarBelow(p, pos, PNG_W, PNG_H);
            minX = Math.min(minX, s.x);
            maxX = Math.max(maxX, s.x);
            minY = Math.min(minY, s.y);
            maxY = Math.max(maxY, s.y);
        }
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    expect(spanX).toBeGreaterThan(PNG_W * 0.12);
    expect(spanX).toBeGreaterThan(spanY * 2);
    expect(spanY).toBeGreaterThan(20);
    expect(spanY).toBeLessThan(PNG_H * 0.45);
}

function posOf(geo: BufferGeometry): Float32Array {
    return geo.getAttribute("position").array as Float32Array;
}

function openEdgeCount(geo: BufferGeometry): number {
    const index = geo.getIndex();
    if (!index) return -1;
    const edge = new Map<string, number>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let t = 0; t + 2 < index.count; t += 3) {
        const a = index.getX(t);
        const b = index.getX(t + 1);
        const c = index.getX(t + 2);
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = key(u, v);
            edge.set(k, (edge.get(k) ?? 0) + 1);
        }
    }
    let open = 0;
    for (const n of edge.values()) if (n !== 2) open++;
    return open;
}

function triangleCount(geo: BufferGeometry): number {
    const index = geo.getIndex();
    const pos = geo.getAttribute("position");
    if (index) return index.count / 3;
    return Math.floor(pos.count / 3);
}

function bboxMm(geo: BufferGeometry): { x: number; y: number; z: number } {
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return { x: 0, y: 0, z: 0 };
    return {
        x: bb.max.x - bb.min.x,
        y: bb.max.y - bb.min.y,
        z: bb.max.z - bb.min.z,
    };
}

const ENGRAVE_FLOOR_LO = 0.45;
const ENGRAVE_FLOOR_HI = 0.85;

function isFloor(z: number): boolean {
    return Number.isFinite(z) && z > ENGRAVE_FLOOR_LO && z < ENGRAVE_FLOOR_HI;
}

/**
 * From-below heightmap of the exported sole. Screen-right is +X, screen-up is
 * −Y. TIMOTHY is wider than HARTER, so a left-to-right name puts the longer
 * glyph run on the reader's left. The leftmost glyph is T; its crossbar is the
 * widest floor row and sits toward −Y when the cap is upright.
 */
function assertTimothyReadsFromBelow(geo: BufferGeometry, side: Side): void {
    const pos = posOf(geo);
    const hm = soleHeightmapFromBelow(pos, geo.getIndex()?.array ?? null, 0.4);
    const midY = midfootCentroidY(hm);
    expect(side === "left" ? midY : -midY, `${side} medial arch`).toBeGreaterThan(0.5);

    const { y0, y1 } = textBand(hm);
    expect(y1 - y0, "engrave band height in rows").toBeGreaterThan(12);
    const spans = glyphSpans(hm, y0, y1);
    expect(spans.length).toBeGreaterThanOrEqual(10);

    const textMid = (spans[0]![0] + spans[spans.length - 1]![1]) / 2;
    let gapAt = 0;
    let gap = 0;
    let gapDist = Infinity;
    for (let i = 1; i < spans.length; i++) {
        const g = spans[i]![0] - spans[i - 1]![1];
        if (g < 8) continue;
        const mid = (spans[i - 1]![1] + spans[i]![0]) / 2;
        const dist = Math.abs(mid - textMid);
        if (dist < gapDist) {
            gapDist = dist;
            gap = g;
            gapAt = i;
        }
    }
    expect(gap, "word space between TIMOTHY and HARTER").toBeGreaterThan(8);
    const left = spans.slice(0, gapAt);
    const right = spans.slice(gapAt);
    expect(left.length).toBeGreaterThanOrEqual(5);
    expect(right.length).toBeGreaterThanOrEqual(4);
    const leftMm = (left[left.length - 1]![1] - left[0]![0]) * hm.step;
    const rightMm = (right[right.length - 1]![1] - right[0]![0]) * hm.step;
    expect(left[0]![0], `${side}: first glyph column is on the reader's left`).toBeLessThan(textMid);
    expect(leftMm, `${side}: TIMOTHY is on the reader's left`).toBeGreaterThan(rightMm + 4);
    assertTeeBarTowardScreenUp(hm, spans[0]!, y0, y1, side);
    assertOpenCounters(hm, left, right, y0, y1, side);
}

const SOLE_Z = 0.25;

interface SoleBlob {
    ix: number;
    iy: number;
    z: number;
    n: number;
    strokeZ: number;
    centered: boolean;
}

/** Sole-height island enclosed by the engraved stroke. */
function enclosedBlobs(hm: SoleHeightmap, span: [number, number], y0: number, y1: number): SoleBlob[] {
    let fx0 = span[1];
    let fx1 = span[0];
    let fy0 = y1;
    let fy1 = y0;
    let any = false;
    for (let iy = y0; iy <= y1; iy++) {
        for (let ix = span[0]; ix <= span[1]; ix++) {
            if (!isFloor(hm.z[iy * hm.nx + ix]!)) continue;
            any = true;
            fx0 = Math.min(fx0, ix);
            fx1 = Math.max(fx1, ix);
            fy0 = Math.min(fy0, iy);
            fy1 = Math.max(fy1, iy);
        }
    }
    if (!any || fx1 - fx0 < 4 || fy1 - fy0 < 4) return [];
    const w = fx1 - fx0 + 1;
    const h = fy1 - fy0 + 1;
    const soleAt = (ix: number, iy: number) => {
        const z = hm.z[iy * hm.nx + ix]!;
        return Number.isFinite(z) && z < SOLE_Z;
    };
    const seen = new Uint8Array(w * h);
    const at = (ix: number, iy: number) => (iy - fy0) * w + (ix - fx0);
    const q: number[] = [];
    const pushOpen = (ix: number, iy: number) => {
        if (ix < fx0 || ix > fx1 || iy < fy0 || iy > fy1) return;
        const k = at(ix, iy);
        if (seen[k] || !soleAt(ix, iy)) return;
        seen[k] = 1;
        q.push(ix, iy);
    };
    for (let ix = fx0; ix <= fx1; ix++) {
        pushOpen(ix, fy0);
        pushOpen(ix, fy1);
    }
    for (let iy = fy0; iy <= fy1; iy++) {
        pushOpen(fx0, iy);
        pushOpen(fx1, iy);
    }
    for (let qi = 0; qi < q.length; qi += 2) {
        const ix = q[qi]!;
        const iy = q[qi + 1]!;
        pushOpen(ix - 1, iy);
        pushOpen(ix + 1, iy);
        pushOpen(ix, iy - 1);
        pushOpen(ix, iy + 1);
    }
    const blobs: SoleBlob[] = [];
    for (let iy = fy0 + 1; iy < fy1; iy++) {
        for (let ix = fx0 + 1; ix < fx1; ix++) {
            const k = at(ix, iy);
            if (seen[k] || !soleAt(ix, iy)) continue;
            let n = 0;
            let sx = 0;
            let sy = 0;
            let sz = 0;
            const bq = [ix, iy];
            seen[k] = 1;
            for (let bi = 0; bi < bq.length; bi += 2) {
                const bx = bq[bi]!;
                const by = bq[bi + 1]!;
                n++;
                sx += bx;
                sy += by;
                sz += hm.z[by * hm.nx + bx]!;
                for (const [dx, dy] of [
                    [1, 0],
                    [-1, 0],
                    [0, 1],
                    [0, -1],
                ] as const) {
                    const nx = bx + dx;
                    const ny = by + dy;
                    if (nx <= fx0 || nx >= fx1 || ny <= fy0 || ny >= fy1) continue;
                    const nk = at(nx, ny);
                    if (seen[nk] || !soleAt(nx, ny)) continue;
                    seen[nk] = 1;
                    bq.push(nx, ny);
                }
            }
            if (n < 8) continue;
            const cx = sx / n;
            const cy = sy / n;
            let strokeZ = Number.NaN;
            let best = Infinity;
            for (let syy = fy0; syy <= fy1; syy++) {
                for (let sxx = fx0; sxx <= fx1; sxx++) {
                    const z = hm.z[syy * hm.nx + sxx]!;
                    if (!isFloor(z)) continue;
                    const d = (sxx - cx) ** 2 + (syy - cy) ** 2;
                    if (d < best) {
                        best = d;
                        strokeZ = z;
                    }
                }
            }
            const midX = (fx0 + fx1) / 2;
            const midY = (fy0 + fy1) / 2;
            blobs.push({
                ix: Math.round(cx),
                iy: Math.round(cy),
                z: sz / n,
                n,
                strokeZ,
                centered: Math.abs(cx - midX) < w * 0.22 && Math.abs(cy - midY) < h * 0.22,
            });
        }
    }
    return blobs;
}

function assertOpenCounters(
    hm: SoleHeightmap,
    left: Array<[number, number]>,
    right: Array<[number, number]>,
    y0: number,
    y1: number,
    side: Side,
): void {
    const blobsOf = (spans: Array<[number, number]>) =>
        spans.flatMap((span) => enclosedBlobs(hm, span, y0, y1));
    const o = blobsOf(left).find((b) => b.centered);
    expect(o, `${side}: O counter is an unengraved island`).toBeDefined();
    if (!o) return;
    expect(isFloor(o.z), `${side}: O counter centre is not engraved`).toBe(false);
    expect(o.z, `${side}: O counter sits on the sole`).toBeLessThan(SOLE_Z);
    expect(isFloor(o.strokeZ), `${side}: O stroke is engraved`).toBe(true);

    const bowl = blobsOf(right).sort((a, b) => b.n - a.n)[0];
    expect(bowl, `${side}: A or R counter is an unengraved island`).toBeDefined();
    if (!bowl) return;
    expect(isFloor(bowl.z), `${side}: A/R counter centre is not engraved`).toBe(false);
    expect(bowl.z, `${side}: A/R counter sits on the sole`).toBeLessThan(SOLE_Z);
    expect(isFloor(bowl.strokeZ), `${side}: A/R stroke is engraved`).toBe(true);
}

/** Leftmost glyph is T. Its crossbar is the widest floor row and must sit toward −Y. */
function assertTeeBarTowardScreenUp(
    hm: SoleHeightmap,
    span: [number, number],
    y0: number,
    y1: number,
    side: Side,
): void {
    let bestIy = y0;
    let best = -1;
    let minIy = Infinity;
    let maxIy = -Infinity;
    for (let iy = y0; iy <= y1; iy++) {
        let n = 0;
        for (let ix = span[0]; ix <= span[1]; ix++) {
            if (isFloor(hm.z[iy * hm.nx + ix]!)) n++;
        }
        if (n > 0) {
            minIy = Math.min(minIy, iy);
            maxIy = Math.max(maxIy, iy);
        }
        if (n > best) {
            best = n;
            bestIy = iy;
        }
    }
    expect(best, `${side}: T crossbar has floor hits`).toBeGreaterThan(8);
    expect(bestIy, `${side}: T crossbar is toward screen-up (−Y)`).toBeLessThan((minIy + maxIy) / 2);
}

function midfootCentroidY(hm: SoleHeightmap): number {
    const length = hm.nx * hm.step;
    const xLo = hm.minX + length * 0.38;
    const xHi = hm.minX + length * 0.55;
    let sy = 0;
    let n = 0;
    for (let iy = 0; iy < hm.ny; iy++) {
        const y = hm.minY + (iy + 0.5) * hm.step;
        for (let ix = 0; ix < hm.nx; ix++) {
            const x = hm.minX + (ix + 0.5) * hm.step;
            if (x < xLo || x > xHi) continue;
            if (!Number.isFinite(hm.z[iy * hm.nx + ix]!)) continue;
            sy += y;
            n++;
        }
    }
    return n ? sy / n : 0;
}

function textBand(hm: SoleHeightmap): { y0: number; y1: number } {
    const rows = new Int32Array(hm.ny);
    for (let iy = 0; iy < hm.ny; iy++) {
        for (let ix = 0; ix < hm.nx; ix++) {
            const x = hm.minX + (ix + 0.5) * hm.step;
            if (x < 30 || x > 200) continue;
            if (isFloor(hm.z[iy * hm.nx + ix]!)) rows[iy]!++;
        }
    }
    let y0 = -1;
    let y1 = -1;
    for (let iy = 0; iy < hm.ny; iy++) {
        if ((rows[iy] ?? 0) <= 80) continue;
        if (y0 < 0) y0 = iy;
        y1 = iy;
    }
    return { y0, y1 };
}

function glyphSpans(hm: SoleHeightmap, y0: number, y1: number): Array<[number, number]> {
    const col = new Int32Array(hm.nx);
    for (let iy = y0; iy <= y1; iy++) {
        for (let ix = 0; ix < hm.nx; ix++) {
            if (isFloor(hm.z[iy * hm.nx + ix]!)) col[ix]!++;
        }
    }
    const spans: Array<[number, number]> = [];
    let start = -1;
    for (let ix = 0; ix <= hm.nx; ix++) {
        const on = ix < hm.nx && (col[ix] ?? 0) > 3;
        if (on && start < 0) start = ix;
        if (!on && start >= 0) {
            if (ix - start >= 8) spans.push([start, ix - 1]);
            start = -1;
        }
    }
    return spans;
}

function writeStlProofPng(solid: BufferGeometry, filenameBase: string): Uint8Array {
    const pos = solid.getAttribute("position").array as Float32Array;
    const idx = solid.getIndex()?.array ?? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    const loops = bottomOutlines(solid).map((g) => g.outer);
    const rgb = renderPlantarFromBelow(pos, idx, PNG_W, PNG_H, loops);
    writeFileSync(resolve(STL_DIR, `${filenameBase}-from-below.png`), encodePng(PNG_W, PNG_H, rgb));
    return rgb;
}

describe("bottom patient-name text reads from below (export mesh)", () => {
    afterEach(() => resetSampleTopGeometryCache());

    for (const patient of PATIENTS) {
        test(`${patient.first} ${patient.last}: handedness + diagnostic PNGs`, async () => {
            bootDesignExportHarness(patient.first, patient.last);
            const readSign: Partial<Record<Side, number>> = {};
            const hookSign: Partial<Record<Side, number>> = {};

            for (const side of ["left", "right"] as const) {
                const geo = await buildExportGeometry(side);
                try {
                    const ud = geo.userData as { textFitError?: string };
                    expect(ud.textFitError ?? "").toBe("");
                    const outlines = bottomOutlines(geo);
                    const cents = textCentroids(geo);
                    expect(cents.length).toBeGreaterThanOrEqual(8);
                    expect(outlines.length).toBeGreaterThan(0);

                    const read = Math.sign((cents[cents.length - 1]?.x ?? 0) - (cents[0]?.x ?? 0));
                    expect(read).not.toBe(0);
                    readSign[side] = read;

                    const hook = jHookBias(outlines[0]!);
                    expect(Math.sign(hook)).not.toBe(0);
                    hookSign[side] = Math.sign(hook);

                    const rgb = writeDiagnosticPng(geo, side, patient.slug);
                    const leg = diagnosticPngLegibility(rgb, PNG_W, PNG_H);
                    expect(leg.toneRange).toBeGreaterThan(70);
                    expect(leg.inkPixels).toBeGreaterThan(2000);
                    assertOutlineSpansFrame(geo, outlines);
                } finally {
                    geo.dispose();
                }
            }

            if (patient.slug === "john-smith") {
                expect(readSign.left).toBe(readSign.right);
                expect(hookSign.left).toBe(hookSign.right);
            }
        }, 360_000);
    }
});

describe("diagnostic printable STLs (TIMOTHY HARTER)", () => {
    afterEach(() => resetSampleTopGeometryCache());

    test("Timothy_Harter_ApexCore L/R closed export STL", async () => {
        bootDesignExportHarness("Timothy", "Harter");
        mkdirSync(STL_DIR, { recursive: true });
        const metrics: Record<string, unknown> = { patient: "TIMOTHY HARTER", m9LengthMm: M9_LENGTH_MM };

        for (const side of ["left", "right"] as const) {
            const solid = await buildValidatedExportGeometry(side);
            const outlines = bottomOutlines(solid);
            expect(outlines.length).toBeGreaterThan(0);

            const suffix = side === "left" ? "L" : "R";
            const filename = `Timothy_Harter_ApexCore_${suffix}.stl`;
            const base = filename.replace(/\.stl$/, "");
            const proofRgb = writeStlProofPng(solid, base);

            const stlBytes = geometryToBinarySTL(solid);
            writeFileSync(resolve(STL_DIR, filename), Buffer.from(stlBytes));

            const reloaded = binaryStlToGeometry(stlBytes);
            try {
                assertTimothyReadsFromBelow(reloaded, side);
                await assertExactManifold(solid);
                const manifold = analyzeManifold(reloaded);
                expect(manifold.isWatertight).toBe(true);
                const tris = triangleCount(reloaded);
                expect(tris).toBeLessThanOrEqual(132_000);
                const bbox = bboxMm(reloaded);
                expect(bbox.x).toBeGreaterThan(M9_LENGTH_MM - 8);
                expect(bbox.x).toBeLessThan(M9_LENGTH_MM + 8);

                const leg = diagnosticPngLegibility(proofRgb, PNG_W, PNG_H);
                expect(leg.toneRange).toBeGreaterThan(50);
                expect(leg.inkPixels).toBeGreaterThan(2000);

                metrics[side] = {
                    filename,
                    triangles: tris,
                    openEdges: 0,
                    bboxMm: bbox,
                    legibility: leg,
                };
            } finally {
                reloaded.dispose();
                solid.dispose();
            }
        }

        writeFileSync(resolve(STL_DIR, "export-metrics.json"), JSON.stringify(metrics, null, 2));
    }, 420_000);
});
