// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { buildExportGeometry } from "@/lib/geometry/export-geometry";
import { pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import type { BottomOutlineWorld } from "@/lib/geometry/text-marking/bottom-engrave";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

const SAMPLE_TOP_FIXTURE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const NAME = "CASEY";

function boot(withMortons: boolean): void {
    resetSampleTopGeometryCache();
    const viewer = useDesignStore.getState().viewer;
    const design = createDesignWithStockPlaceholder();
    design.usMenSize = 9;
    design.elements = [];
    design.textMarking = { ...defaultTextMarking("bottom"), text: NAME, feet: "both", mode: "engrave" };
    useDesignStore.setState({
        design,
        viewer: { ...viewer, wallModel: "procedural", wallStyle: "straight" },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
    if (withMortons) useDesignStore.getState().addElement("mortons_extension", "left");
}

function requiredGeo(geo: BufferGeometry | undefined, label: string): BufferGeometry {
    if (!geo) throw new Error(`missing ${label} mesh`);
    return geo;
}

function outlinesOf(geo: BufferGeometry): BottomOutlineWorld[] {
    return (geo.userData as { bottomOutlineWorld?: BottomOutlineWorld[] }).bottomOutlineWorld ?? [];
}

function centroidsOf(geo: BufferGeometry): Array<{ x: number; y: number; z: number }> {
    return (
        (geo.userData as { textMarking?: { centroids?: Array<{ x: number; y: number; z: number }> } })
            .textMarking?.centroids ?? []
    );
}

/** Vertices on the letter floor (z = engrave depth), inside a glyph and not in a counter. */
function floorVerts(geo: BufferGeometry, depthMm: number): number {
    const pos = geo.getAttribute("position");
    const glyphs = outlinesOf(geo);
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getZ(i) - depthMm) > 0.05) continue;
        const x = pos.getX(i);
        const y = pos.getY(i);
        for (const g of glyphs) {
            if (g.outer.length < 3 || !pointInPoly(x, y, g.outer)) continue;
            if (g.holes.some((h) => h.length >= 3 && pointInPoly(x, y, h))) continue;
            n++;
            break;
        }
    }
    return n;
}

/** Host vertices above the sole pocket. The engrave does not move these. */
function highVertices(geo: BufferGeometry): string[] {
    const pos = geo.getAttribute("position");
    const rows: string[] = [];
    for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        if (z <= 1.5) continue;
        rows.push(`${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${z.toFixed(4)}`);
    }
    rows.sort();
    return rows;
}

describe("bottom name on a Morton's extension foot", () => {
    beforeEach(() => {
        const buf = readFileSync(SAMPLE_TOP_FIXTURE);
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.includes("SAMPLE_Top")) {
                return new Response(buf, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
            }
            throw new Error(`unexpected fetch ${url}`);
        }) as typeof fetch;
    });

    afterEach(() => resetSampleTopGeometryCache());

    test("the engraved name is on the Morton's foot and the other foot is unchanged", async () => {
        boot(true);
        const placed = useDesignStore.getState().design.elements;
        expect(placed).toHaveLength(1);
        expect(placed[0]?.kind).toBe("mortons_extension");
        expect(placed[0]?.side).toBe("left");
        expect(placed[0]?.heightMm).toBe(3);

        const marked: Partial<Record<Side, BufferGeometry>> = {};
        try {
            for (const side of ["left", "right"] as const) {
                marked[side] = await buildExportGeometry(side);
            }
            boot(false);
            const plainRight = await buildExportGeometry("right");
            const plainLeft = await buildExportGeometry("left");
            boot(true);
            designTextOff();
            const mortonsBare = await buildExportGeometry("left");
            try {
                const leftMarked = requiredGeo(marked.left, "left");
                const rightMarkedGeo = requiredGeo(marked.right, "right");
                for (const geo of [leftMarked, rightMarkedGeo]) {
                    const side = geo === leftMarked ? "left" : "right";
                    const ud = geo.userData as { textFitError?: string; textMarking?: { depthMm?: number } };
                    expect(ud.textFitError ?? "", side).toBe("");
                    const outlines = outlinesOf(geo);
                    expect(outlines.length, side).toBe(NAME.length);
                    const cents = centroidsOf(geo);
                    expect(cents.length, side).toBeGreaterThanOrEqual(NAME.length);
                    const depth = ud.textMarking?.depthMm ?? 0;
                    expect(depth, side).toBeCloseTo(0.6, 5);
                    expect(floorVerts(geo, depth), side).toBeGreaterThan(30);
                    const first = cents[0];
                    const last = cents[cents.length - 1];
                    expect(first, side).toBeDefined();
                    expect(last, side).toBeDefined();
                    expect(Math.sign((last?.x ?? 0) - (first?.x ?? 0)), side).toBe(1);
                }

                const rightMarked = geometryToBinarySTL(rightMarkedGeo);
                const rightPlain = geometryToBinarySTL(plainRight);
                expect(Buffer.from(rightMarked).equals(Buffer.from(rightPlain))).toBe(true);

                const leftCents = centroidsOf(leftMarked);
                const plainCents = centroidsOf(plainLeft);
                expect(leftCents.length).toBe(plainCents.length);
                for (let i = 0; i < leftCents.length; i++) {
                    const a = leftCents[i];
                    const b = plainCents[i];
                    expect(a).toBeDefined();
                    expect(b).toBeDefined();
                    expect(a?.x).toBeCloseTo(b?.x ?? 0, 3);
                    expect(a?.y).toBeCloseTo(b?.y ?? 0, 3);
                }

                expect(highVertices(leftMarked)).toEqual(highVertices(mortonsBare));
            } finally {
                plainRight.dispose();
                plainLeft.dispose();
                mortonsBare.dispose();
            }
        } finally {
            marked.left?.dispose();
            marked.right?.dispose();
        }
    }, 360_000);
});

function designTextOff(): void {
    const design = useDesignStore.getState().design;
    useDesignStore.setState({
        design: { ...design, textMarking: undefined },
    });
}
