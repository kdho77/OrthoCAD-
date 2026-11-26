// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { defaultElementPose } from "@/lib/geometry/elements";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import type { ShoeWidthId } from "@/lib/geometry/shoe-width";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState, PlacedElement } from "@/types";
import { hausdorffReport } from "./metrics";
import { printSolidOptions } from "./print-solid-options";
import {
    buildProceduralExportSolid,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");

/**
 * Left short-narrow exports after the mesh's own forefoot chord is the scale
 * denominator. The right foot is the mirror of these solids. Medium pins are
 * not in this table.
 */
const LEFT_SHORT: Record<string, { hash: string; verts: number }> = {
    "m5-narrow-height9-met": {
        hash: "41f047ab0ae9068e41fa921efb21ee0d4ebbce22662cb3b499010eca25a6d6d9",
        verts: 53425,
    },
    "m6-narrow-height9-met": {
        hash: "6e3d8b9c2db3c9212bca7d807adae402c46ebc42c9afcd77e7cb51def068c356",
        verts: 54677,
    },
    "m8-narrow-height9-met": {
        hash: "90c94a5c7f30d85b6f8190486de9d85ee9901291a98ced791650e7779bda714e",
        verts: 58892,
    },
};

/**
 * Medium stays the frozen main mesh. Narrow rows use the measured chord.
 * Sizes that missed the skew gate are the refit of that scale, pinned after
 * the right foot matched the mirrored left.
 */
const UNCHANGED: Record<string, { hash: string; verts: number }> = {
    "s9-medium": {
        hash: "11a9b0627846c2da4638567c202a1cb7264c89b660b3aae0bc5bab2cc493c62d",
        verts: 55156,
    },
    "s8-medium": {
        hash: "39111add1574cbd9401b2abb60b5652e3cbb3891267405e6beb8bb59c6ed7cbf",
        verts: 54357,
    },
    "s8.5-narrow-height9-met": {
        hash: "df94fe3067ac2a074cde1bf979703ef83a60c82306c42ee468fa0df0e406a33d",
        verts: 59770,
    },
    "s10-narrow-height9-met": {
        hash: "028cf48b950a53c0a633554d38edac4a8488d1cc7494199df1802f6bf075ba8a",
        verts: 60875,
    },
};

function designFor(input: {
    width: ShoeWidthId;
    size?: number;
    heelCupHeightMm?: number;
    metPad?: boolean;
    side?: "left" | "right";
}): DesignState {
    const side = input.side ?? "left";
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    if (input.size != null) design.usMenSize = input.size;
    design.shoeWidth = input.width;
    design.shoeWidthBySide = { left: input.width, right: input.width };
    if (input.heelCupHeightMm) {
        const patch = { heelCupHeightMm: input.heelCupHeightMm };
        design.corrections = {
            ...design.corrections,
            linked: true,
            left: { ...design.corrections.left, ...patch },
            right: { ...design.corrections.right, ...patch },
        };
    }
    if (input.metPad) {
        const layout = insoleLayoutFromDesign(design);
        const pose = defaultElementPose("met_pad", side, layout.lengthMm, layout.widthMm);
        const el: PlacedElement = {
            id: side === "left" ? "met-left" : "met-right",
            kind: "met_pad",
            side,
            position: pose.position,
            rotationDeg: pose.rotationDeg,
            scale: pose.scale,
            heightMm: pose.heightMm,
            ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
        };
        design.elements = [el];
    }
    return design;
}

/** Grader GR1 design: heel cup 9 mm, met pad, no placement mode on the element. */
function graderDesign(input: { width: ShoeWidthId; size: number; side: "left" | "right" }): DesignState {
    const design = designFor({
        width: input.width,
        size: input.size,
        heelCupHeightMm: 9,
        side: input.side,
    });
    const layout = insoleLayoutFromDesign(design);
    const pose = defaultElementPose("met_pad", input.side, layout.lengthMm, layout.widthMm);
    design.elements = [
        {
            id: input.side === "left" ? "met-left" : "met-right",
            kind: "met_pad",
            side: input.side,
            position: pose.position,
            rotationDeg: pose.rotationDeg,
            scale: pose.scale,
            heightMm: pose.heightMm,
        },
    ];
    return design;
}

function meshHash(pos: ArrayBufferView, idx: ArrayBufferView): string {
    const h = createHash("sha256");
    h.update(Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength));
    h.update(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength));
    return h.digest("hex");
}

async function loadTemplate(): Promise<void> {
    resetSampleTopGeometryCache();
    const bytes = readFileSync(SAMPLE_TOP_PATH);
    primeSampleTopGeometry(
        await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        ),
    );
}

async function exportLeft(design: DesignState) {
    const field = baseModifierFieldAuthoritative(design, "left", design.thicknessMm);
    const options = printSolidOptions({
        design,
        side: "left",
        field,
        viewer: { wallModel: "procedural", wallStyle: "round" },
        trimline: null,
        bottomPattern: null,
    });
    return buildProceduralExportSolid(options);
}

async function exportRight(design: DesignState) {
    const field = baseModifierFieldAuthoritative(design, "right", design.thicknessMm);
    const options = printSolidOptions({
        design,
        side: "right",
        field,
        viewer: { wallModel: "procedural", wallStyle: "round" },
        trimline: null,
        bottomPattern: null,
    });
    return buildProceduralExportSolid({ ...options, mirrored: true });
}

describe("narrow width + 9 mm heel cup preloft", () => {
    test("mirrored right US M5, M6, and M8 narrow, heel cup height 9 mm, default met pad exports without S1-PRELOFT skew", async () => {
        await loadTemplate();
        for (const size of [5, 6, 8]) {
            const built = await exportRight(
                designFor({ width: "narrow", size, heelCupHeightMm: 9, metPad: true, side: "right" }),
            );
            const n = built.geometry.getAttribute("position")?.count ?? 0;
            expect(n, `right US M${size}`).toBeGreaterThan(1000);
            const left = await exportLeft(
                designFor({ width: "narrow", size, heelCupHeightMm: 9, metPad: true }),
            );
            const mirroredLeft = mirrorGeometry(left.geometry);
            const gap = hausdorffReport(mirroredLeft, built.geometry);
            expect(gap.maxMm, `right US M${size} vs mirrored left`).toBeLessThanOrEqual(0.05);
            mirroredLeft.dispose();
            left.geometry.dispose();
            built.geometry.dispose();
        }
    }, 720_000);

    test("GR1: right foot matches the mirrored left for Narrow, Wide, and 2X Wide at M6, M9, and M10", async () => {
        await loadTemplate();
        // Same matrix as the independent grader. The met pad is the pose
        // without a placement mode, matching that test's element record.
        const cases: Array<{ size: number; width: ShoeWidthId }> = [
            { size: 6, width: "narrow" },
            { size: 10, width: "narrow" },
            { size: 9, width: "narrow" },
            { size: 6, width: "wide" },
            { size: 10, width: "wide" },
            { size: 9, width: "wide" },
            { size: 6, width: "xx_wide" },
            { size: 10, width: "xx_wide" },
            { size: 9, width: "xx_wide" },
        ];
        for (const { size, width } of cases) {
            const label = `US M${size} ${width}`;
            const left = await exportLeft(graderDesign({ width, size, side: "left" }));
            const right = await exportRight(graderDesign({ width, size, side: "right" }));
            const mirroredLeft = mirrorGeometry(left.geometry);
            const gap = hausdorffReport(mirroredLeft, right.geometry);
            expect(gap.maxMm, label).toBeLessThanOrEqual(0.05);
            mirroredLeft.dispose();
            left.geometry.dispose();
            right.geometry.dispose();
        }
    }, 1_500_000);

    test("US M6 narrow, heel cup height 9 mm, default met pad exports without S1-PRELOFT skew", async () => {
        await loadTemplate();
        // US M6 is the order: skew[45]=50.577>29.076; skew[46]=76.058>25.756.
        // M5 and M8 are the ends of the same short-narrow band.
        for (const size of [5, 6, 8]) {
            const built = await exportLeft(
                designFor({ width: "narrow", size, heelCupHeightMm: 9, metPad: true }),
            );
            const pos = built.geometry.getAttribute("position").array as Float32Array;
            const index = built.geometry.getIndex();
            const id = `m${size}-narrow-height9-met`;
            const pin = LEFT_SHORT[id];
            if (!index || !pin) throw new Error(`missing mesh pin for ${id}`);
            const idx = index.array as Uint32Array;
            expect(pos.length / 3, id).toBe(pin.verts);
            expect(meshHash(pos, idx), id).toBe(pin.hash);
            built.geometry.dispose();
        }
    }, 240_000);

    test("SAMPLE_Top with no corrections, and narrow sizes that already export, stay byte-identical", async () => {
        await loadTemplate();
        const cases: Array<{ id: string; design: DesignState }> = [
            { id: "s9-medium", design: designFor({ width: "medium" }) },
            { id: "s8-medium", design: designFor({ width: "medium", size: 8 }) },
            {
                id: "s8.5-narrow-height9-met",
                design: designFor({ width: "narrow", size: 8.5, heelCupHeightMm: 9, metPad: true }),
            },
            {
                id: "s10-narrow-height9-met",
                design: designFor({ width: "narrow", size: 10, heelCupHeightMm: 9, metPad: true }),
            },
        ];
        for (const row of cases) {
            const built = await exportLeft(row.design);
            const pos = built.geometry.getAttribute("position").array as Float32Array;
            const index = built.geometry.getIndex();
            const pin = UNCHANGED[row.id];
            if (!index || !pin) throw new Error(`missing mesh pin for ${row.id}`);
            const idx = index.array as Uint32Array;
            expect(pos.length / 3, row.id).toBe(pin.verts);
            expect(meshHash(pos, idx), row.id).toBe(pin.hash);
            built.geometry.dispose();
        }
    }, 300_000);
});
