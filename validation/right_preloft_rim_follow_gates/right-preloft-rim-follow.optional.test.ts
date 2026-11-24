// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Frozen gates for the Right-foot [S1-PRELOFT] rim-follow fix.
// Written against main f759bde1e212ae99d475601fc58dd89dd37469c7.
// Do not edit after the gates pull request is opened.
//
// This file is *.optional.test.ts so the default unit shards do not run it.
// On unfixed main the Right cases throw [S1-PRELOFT] skew. That failure is the no-op proof.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { defaultElementPose } from "@/lib/geometry/elements";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    buildProceduralExportSolid,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { SKEW_INSET_RATIO } from "@/lib/geometry/procedural-wall/station-gates";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import type { ShoeWidthId } from "@/lib/geometry/shoe-width";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState, PlacedElement, Side } from "@/types";

const GATES = resolve(process.cwd(), "validation/right_preloft_rim_follow_gates");
const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");

const LEFT_PINS: Record<string, { hash: string; verts: number }> = JSON.parse(
    readFileSync(resolve(GATES, "frozen/left-pins.json"), "utf8"),
);

function designFor(input: {
    width: ShoeWidthId;
    size?: number;
    heelCupHeightMm?: number;
    metPad?: boolean;
    metSide?: Side;
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
        const side = input.metSide ?? "left";
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

async function exportMirroredRight(design: DesignState) {
    const right = design.paired?.rightBase;
    if (!right?.mirrored) {
        throw new Error("Right base is not mirrored SAMPLE_Top");
    }
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

describe("right preloft rim-follow gates", () => {
    test("SKEW_INSET_RATIO stays 0.5", () => {
        expect(SKEW_INSET_RATIO).toBe(0.5);
    });

    test("mirrored Right US M5/M6/M8 narrow, 9 mm heel cup, default met pad pass S1-PRELOFT", async () => {
        expect(SKEW_INSET_RATIO).toBe(0.5);
        await loadTemplate();
        const misses: string[] = [];
        for (const size of [5, 6, 8]) {
            try {
                const built = await exportMirroredRight(
                    designFor({
                        width: "narrow",
                        size,
                        heelCupHeightMm: 9,
                        metPad: true,
                        metSide: "right",
                    }),
                );
                const n = built.geometry.getAttribute("position")?.count ?? 0;
                if (n <= 1000) misses.push(`Right US M${size} verts ${n}`);
                built.geometry.dispose();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                misses.push(`Right US M${size}: ${message}`);
            }
        }
        expect(misses, misses.join("\n")).toEqual([]);
    }, 360_000);

    test("existing Left narrow-heelcup-preloft pins stay SHA-256 identical to main", async () => {
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
            const pin = LEFT_PINS[row.id];
            if (!index || !pin) throw new Error(`missing mesh pin for ${row.id}`);
            const idx = index.array as Uint32Array;
            expect(pos.length / 3, row.id).toBe(pin.verts);
            expect(meshHash(pos, idx), row.id).toBe(pin.hash);
            built.geometry.dispose();
        }
    }, 300_000);
});
