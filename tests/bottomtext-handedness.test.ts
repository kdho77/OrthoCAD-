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

/** Engrave outlines must span the frame (not a tight grey crop). */
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
    expect(maxX - minX).toBeGreaterThan(PNG_W * 0.035);
    expect(maxY - minY).toBeGreaterThan(PNG_H * 0.1);
    expect(maxY - minY).toBeLessThan(PNG_H * 0.45);
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

/** First glyph sits to the left of the last on screen when read in the string direction (below view, toe up). */
function assertScreenLtrFromBelow(geo: BufferGeometry, outlines: BottomOutlineWorld[]): void {
    const pos = posOf(geo);
    const first = projectPlantarBelow(glyphCentroid(outlines[0]!), pos, PNG_W, PNG_H);
    const last = projectPlantarBelow(glyphCentroid(outlines[outlines.length - 1]!), pos, PNG_W, PNG_H);
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
        expect(dx).toBeGreaterThan(8);
    } else {
        expect(dy).toBeGreaterThan(8);
    }
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
            assertScreenLtrFromBelow(solid, outlines);

            const suffix = side === "left" ? "L" : "R";
            const filename = `Timothy_Harter_ApexCore_${suffix}.stl`;
            const base = filename.replace(/\.stl$/, "");
            const proofRgb = writeStlProofPng(solid, base);

            const stlBytes = geometryToBinarySTL(solid);
            writeFileSync(resolve(STL_DIR, filename), Buffer.from(stlBytes));

            const reloaded = binaryStlToGeometry(stlBytes);
            try {
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
