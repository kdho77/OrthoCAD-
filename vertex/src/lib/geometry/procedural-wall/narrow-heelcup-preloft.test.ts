// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { defaultElementPose } from "@/lib/geometry/elements";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import type { ShoeWidthId } from "@/lib/geometry/shoe-width";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState, PlacedElement } from "@/types";
import { printSolidOptions } from "./print-solid-options";
import {
    buildProceduralExportSolid,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");

/**
 * Meshes that already cleared S1-PRELOFT on main, hashed before the
 * shoe-width pattern align. A retry must not touch them.
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
        hash: "9a302d9dc56f56e481726194e8a24ed3cd289087964e6e128002c08e0265fb2a",
        verts: 57012,
    },
    "s10-narrow-height9-met": {
        hash: "439fffc428be4c3dfa697908af48a67594bd6a65c71cc1ebe3b63442fbb7984a",
        verts: 58421,
    },
};

function designFor(input: {
    width: ShoeWidthId;
    size?: number;
    heelCupHeightMm?: number;
    metPad?: boolean;
}): DesignState {
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
        const pose = defaultElementPose("met_pad", "left", layout.lengthMm, layout.widthMm);
        const el: PlacedElement = {
            id: "met-left",
            kind: "met_pad",
            side: "left",
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

describe("narrow width + 9 mm heel cup preloft", () => {
    test("US M6 narrow, heel cup height 9 mm, default met pad exports without S1-PRELOFT skew", async () => {
        await loadTemplate();
        // US M6 is the order: skew[45]=50.577>29.076; skew[46]=76.058>25.756.
        // M5 and M8 are the ends of the same short-narrow band.
        for (const size of [5, 6, 8]) {
            const built = await exportLeft(
                designFor({ width: "narrow", size, heelCupHeightMm: 9, metPad: true }),
            );
            const n = built.geometry.getAttribute("position")?.count ?? 0;
            expect(n, `US M${size}`).toBeGreaterThan(1000);
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
