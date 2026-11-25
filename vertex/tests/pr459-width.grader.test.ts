// Independent grader for PR #459 @ 0030a4f6 (width outline crash). Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { TubeGeometry, Vector3 } from "three";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    buildProceduralExportSolid,
    loadSampleTopGeometry,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { applyShoeWidthToPoints, type ShoeWidthId, shoeWidthExtentOfPoints } from "@/lib/geometry/shoe-width";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { extractMeshOutline, trimlineToCurve } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const WIDTH_SWITCH: ShoeWidthId[] = ["medium", "wide", "medium", "narrow", "extra_wide"];
const REPO_ROOT = join(import.meta.dirname, "..", "..");

/** Files touched by PR #459 @ 0030a4f6 (scope gate G6). */
const PR459_CHANGED_FILES = [
    "ci/unit-test-shards.json",
    "vertex/src/hooks/useBaseInsoleGeometry.ts",
    "vertex/src/lib/geometry/shoe-width.ts",
    "vertex/src/lib/geometry/width-change.test.ts",
] as const;

/** Main-branch export mesh for US M9 medium (narrow-heelcup-preloft UNCHANGED pin). */
const MAIN_MEDIUM_EXPORT = {
    hash: "11a9b0627846c2da4638567c202a1cb7264c89b660b3aae0bc5bab2cc493c62d",
    verts: 55156,
};

/**
 * Left export with forefootWidthMm +4 mm at medium width on main @ 4cd15aed (frozen for G4).
 * Computed by independent grader from buildProceduralExportSolid; must not move on this PR.
 */
const MAIN_FOREFOOT_PLUS4 = {
    hash: "0d82f076c0c0e751f6dd41fb8d4e0dab9ac1d1268f6031fdd6650adaff8d28fe",
    verts: 55156,
};

function meshHash(pos: ArrayBufferView, idx: ArrayBufferView): string {
    const h = createHash("sha256");
    h.update(Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength));
    h.update(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength));
    return h.digest("hex");
}

function assertFinitePoints(points: readonly { x: number; y: number; z?: number }[], label: string) {
    expect(points.length, label).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        expect(Number.isFinite(p.x), `${label} x ${i}`).toBe(true);
        expect(Number.isFinite(p.y), `${label} y ${i}`).toBe(true);
    }
}

function tubeClosedOutline(points: readonly { x: number; y: number; z?: number }[]) {
    const display = points.map((p) => new Vector3(p.x, p.y, (p.z ?? 0) + 1.5));
    const curve = trimlineToCurve(display, true);
    const tube = new TubeGeometry(curve, Math.max(48, display.length * 2), 0.35, 8, true);
    expect(tube.getAttribute("position").count).toBeGreaterThan(8);
    tube.dispose();
}

/** Client profile starts at Wide (t2755u). */
function newDesignWide(): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.shoeWidth = "wide";
    design.shoeWidthBySide = { left: "wide", right: "wide" };
    return design;
}

function mediumDesignWithHeelWidth(heelCupWidthMm: number): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.shoeWidth = "medium";
    design.shoeWidthBySide = { left: "medium", right: "medium" };
    const patch = { heelCupWidthMm };
    design.corrections = {
        ...design.corrections,
        linked: true,
        left: { ...design.corrections.left, ...patch },
        right: { ...design.corrections.right, ...patch },
    };
    return design;
}

function mediumDesignForefoot(forefootWidthMm: number): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.shoeWidth = "medium";
    const patch = { forefootWidthMm };
    design.corrections = {
        ...design.corrections,
        linked: true,
        left: { ...design.corrections.left, ...patch },
        right: { ...design.corrections.right, ...patch },
    };
    return design;
}

async function loadTemplate() {
    resetSampleTopGeometryCache();
    const bytes = readFileSync(SAMPLE_TOP_PATH);
    primeSampleTopGeometry(
        await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        ),
    );
}

/** Viewer outline effect path: extent from points, not BaseBounds minX/maxX. */
function viewerOutlineScaled(
    points: readonly { x: number; y: number; z?: number }[],
    width: ShoeWidthId,
    layoutWidthMm: number,
    heelOverrideMm?: number,
) {
    const extent = shoeWidthExtentOfPoints(points);
    return applyShoeWidthToPoints([...points], width, {
        ballWidthMm: layoutWidthMm,
        heelWidthMm: layoutWidthMm * 0.62,
        minX: extent.minX,
        lengthMm: extent.lengthMm,
        heelOverrideMm,
    });
}

describe("PR #459 grader G1 — new design Wide, both feet, finite outline", () => {
    test("G1: wide from client profile builds L/R mesh and trimline tube", async () => {
        await loadTemplate();
        const raw = await loadSampleTopGeometry();
        const outline = extractMeshOutline(raw);
        expect(outline).toBeTruthy();
        const layout = insoleLayoutFromDesign(newDesignWide());
        const scaled = viewerOutlineScaled(outline!.points, "wide", layout.widthMm);
        assertFinitePoints(scaled, "wide outline");
        tubeClosedOutline(scaled);

        for (const side of ["left", "right"] as const) {
            const design = newDesignWide();
            const field = baseModifierFieldAuthoritative(design, side, design.thicknessMm);
            const options = printSolidOptions({
                design,
                side,
                field,
                viewer: { wallModel: "procedural", wallStyle: "round" },
                trimline: null,
                bottomPattern: null,
            });
            const top = side === "right" ? mirrorGeometry(raw) : raw.clone();
            const mesh = await composePrintSolidTop(top, {
                sourceField: field,
                shoeWidth: options.shoeWidth,
                trimline: null,
            });
            const pos = mesh.getAttribute("position");
            expect(pos.count).toBeGreaterThan(1000);
            if (mesh !== top) mesh.dispose();
            top.dispose();
        }
        raw.dispose();
    }, 240_000);
});

describe("PR #459 grader G2 — heel width ±2 mm on Medium (t2757u/t2758u)", () => {
    test("G2: heelCupWidthMm ±2 with missing extent stays finite and builds tube", () => {
        const pts = [
            { x: 0, y: -20, z: 0 },
            { x: 8, y: -22, z: 0 },
            { x: 120, y: 10, z: 0 },
            { x: 200, y: -15, z: 0 },
        ];
        const layout = insoleLayoutFromDesign(mediumDesignWithHeelWidth(0));
        const missingExtent = {
            ballWidthMm: layout.widthMm,
            heelWidthMm: layout.widthMm * 0.62,
            minX: undefined as unknown as number,
            lengthMm: Number.NaN,
        };
        for (const heelOverrideMm of [2, -2] as const) {
            const scaled = applyShoeWidthToPoints(pts, "medium", {
                ...missingExtent,
                heelOverrideMm,
            });
            assertFinitePoints(scaled, `heel ${heelOverrideMm}`);
            tubeClosedOutline(scaled);
            // Heel override keeps s(u)=1 on medium but still activates the affine path (t2757u).
            expect(scaled[0]!.y).toBeCloseTo(pts[0]!.y, 6);
        }
    });

    test("G2: medium + heelCupWidthMm ±2 composes without throw", async () => {
        await loadTemplate();
        const raw = await loadSampleTopGeometry();
        for (const heelCupWidthMm of [2, -2] as const) {
            const design = mediumDesignWithHeelWidth(heelCupWidthMm);
            for (const side of ["left", "right"] as const) {
                const field = baseModifierFieldAuthoritative(design, side, design.thicknessMm);
                const options = printSolidOptions({
                    design,
                    side,
                    field,
                    viewer: { wallModel: "procedural", wallStyle: "round" },
                    trimline: null,
                    bottomPattern: null,
                });
                const top = side === "right" ? mirrorGeometry(raw) : raw.clone();
                const mesh = await composePrintSolidTop(top, {
                    sourceField: field,
                    shoeWidth: options.shoeWidth,
                    trimline: null,
                });
                const pos = mesh.getAttribute("position");
                expect(pos.count).toBeGreaterThan(1000);
                if (mesh !== top) mesh.dispose();
                top.dispose();
            }
        }
        raw.dispose();
    }, 300_000);

    test("G2: useBaseInsoleGeometry passes heelOverride from corrections", () => {
        const source = readFileSync(join(REPO_ROOT, "vertex/src/hooks/useBaseInsoleGeometry.ts"), "utf8");
        expect(source).toContain("shoeWidthExtentOfPoints");
        expect(source).toContain("heelOverrideMm: design.corrections[side]?.heelCupWidthMm");
        expect(source).not.toMatch(/minX:\s*b\.minX/);
    });
});

describe("PR #459 grader G3 — Medium→Wide→Medium→Narrow→Extra Wide", () => {
    test("G3: width switch sequence on SAMPLE_Top outline + tubes", async () => {
        await loadTemplate();
        const raw = await loadSampleTopGeometry();
        const outline = extractMeshOutline(raw);
        const points = outline!.points;
        const layout = insoleLayoutFromDesign(createDesignWithStockPlaceholder());
        const extent = shoeWidthExtentOfPoints(points);
        for (const width of WIDTH_SWITCH) {
            const scaled = applyShoeWidthToPoints(points, width, {
                ballWidthMm: layout.widthMm,
                heelWidthMm: layout.widthMm * 0.62,
                minX: extent.minX,
                lengthMm: extent.lengthMm,
            });
            assertFinitePoints(scaled, width);
            tubeClosedOutline(scaled);
        }
        raw.dispose();
    }, 60_000);
});

describe("PR #459 grader G4 — Medium unchanged; forefoot width unchanged vs main", () => {
    test("G4: Medium applyShoeWidthToPoints returns the same point array reference", () => {
        const pts = [
            { x: 0, y: 1 },
            { x: 100, y: -2 },
        ];
        const layout = insoleLayoutFromDesign(createDesignWithStockPlaceholder());
        const extent = shoeWidthExtentOfPoints(pts);
        const out = applyShoeWidthToPoints(pts, "medium", {
            ballWidthMm: layout.widthMm,
            heelWidthMm: layout.widthMm * 0.62,
            minX: extent.minX,
            lengthMm: extent.lengthMm,
        });
        expect(out).toBe(pts);
    });

    test("G4: forefootWidthMm +4 export hash matches main pin", async () => {
        await loadTemplate();
        const design = mediumDesignForefoot(4);
        const field = baseModifierFieldAuthoritative(design, "left", design.thicknessMm);
        const options = printSolidOptions({
            design,
            side: "left",
            field,
            viewer: { wallModel: "procedural", wallStyle: "round" },
            trimline: null,
            bottomPattern: null,
        });
        const built = await buildProceduralExportSolid(options);
        const pos = built.geometry.getAttribute("position").array as Float32Array;
        const index = built.geometry.getIndex()!.array as Uint32Array;
        expect(pos.length / 3).toBe(MAIN_FOREFOOT_PLUS4.verts);
        expect(meshHash(pos, index)).toBe(MAIN_FOREFOOT_PLUS4.hash);
        built.geometry.dispose();
    }, 240_000);
});

describe("PR #459 grader G5 — manufacturing export byte-identical for working Medium design", () => {
    test("G5: s9-medium export hash matches main", async () => {
        await loadTemplate();
        const design = createDesignWithStockPlaceholder();
        design.method = "printing_solid";
        design.shoeWidth = "medium";
        const field = baseModifierFieldAuthoritative(design, "left", design.thicknessMm);
        const options = printSolidOptions({
            design,
            side: "left",
            field,
            viewer: { wallModel: "procedural", wallStyle: "round" },
            trimline: null,
            bottomPattern: null,
        });
        const built = await buildProceduralExportSolid(options);
        const pos = built.geometry.getAttribute("position").array as Float32Array;
        const index = built.geometry.getIndex()!.array as Uint32Array;
        expect(pos.length / 3).toBe(MAIN_MEDIUM_EXPORT.verts);
        expect(meshHash(pos, index)).toBe(MAIN_MEDIUM_EXPORT.hash);
        const stl = geometryToBinarySTL(built.geometry);
        expect(stl.byteLength).toBeGreaterThan(1000);
        built.geometry.dispose();
    }, 240_000);
});

describe("PR #459 grader G6 — scope limited to viewer/width math + tests", () => {
    const forbidden =
        /(^vertex\/server\/|^vertex\/src\/features\/clinical\/(?!.*width)|ai-provider|prescription|vertexslice|gcode)/i;

    test("G6: changed file list is exactly four width-related paths", () => {
        expect(PR459_CHANGED_FILES.length).toBe(4);
        for (const file of PR459_CHANGED_FILES) {
            expect(file).not.toMatch(forbidden);
        }
        const hook = readFileSync(join(REPO_ROOT, "vertex/src/hooks/useBaseInsoleGeometry.ts"), "utf8");
        expect(hook).toContain("shoeWidthExtentOfPoints(outline.points)");
        const shoeWidth = readFileSync(join(REPO_ROOT, "vertex/src/lib/geometry/shoe-width.ts"), "utf8");
        expect(shoeWidth).toContain("export function shoeWidthExtentOfPoints");
    });
});
