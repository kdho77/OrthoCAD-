// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { defaultElementPose } from "@/lib/geometry/elements";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { mirrorGeometry } from "@/lib/library/loaders";
import { defaultDesign } from "@/stores/design-store";
import type { ElementKind, PlacedElement, Side } from "@/types";
import { reconstructProceduralPreview, sampleTopFromArrayBuffer } from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

const COMBOS: Array<{ name: string; kinds: ElementKind[] }> = [
    { name: "reverse+cluffy", kinds: ["reverse_mortons", "cluffy_wedge"] },
    { name: "reverse", kinds: ["reverse_mortons"] },
    { name: "cluffy", kinds: ["cluffy_wedge"] },
    { name: "mortons+cluffy", kinds: ["mortons_extension", "cluffy_wedge"] },
];

async function loadSide(side: Side) {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    // SAMPLE_Top is the left foot. Output Right mirrors it, matching export.
    if (side === "right") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    return raw;
}

function placed(kind: ElementKind, side: Side, lengthMm: number, widthMm: number): PlacedElement {
    const pose = defaultElementPose(kind, side, lengthMm, widthMm);
    return {
        id: `${kind}-${side}`,
        kind,
        side,
        position: pose.position,
        rotationDeg: pose.rotationDeg,
        scale: pose.scale,
        heightMm: pose.heightMm,
        ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
    };
}

async function loftCombo(side: Side, kinds: ElementKind[]): Promise<string | null> {
    const raw = await loadSide(side);
    const design = defaultDesign();
    design.usMenSize = 15;
    design.shoeWidth = "medium";
    design.method = "printing_solid";
    design.pattern = "full_contact";
    const layout = insoleLayoutForUsMenSize(15);
    design.elements = kinds.map((kind) => placed(kind, side, layout.lengthMm, layout.widthMm));
    const field = baseModifierField(design, side, design.thicknessMm);
    try {
        const preview = await reconstructProceduralPreview(raw, {
            wallStyle: "round",
            scanPattern: "full_contact",
            side,
            sourceField: field,
            composedTop: true,
            footprintScale: layout.scale,
            shoeWidth: {
                width: "medium",
                ballWidthMm: layout.widthMm,
                heelWidthMm: layout.widthMm * 0.62,
            },
            thicknessMm: field.thicknessMm,
            stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
            corrections: field.corrections,
        });
        const n = preview.geometry.getAttribute("position")?.count ?? 0;
        preview.geometry.dispose();
        if (n < 100) return `empty mesh (${n})`;
        return null;
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    } finally {
        raw.dispose();
    }
}

describe("Round grinding with a first-ray element stack (US M15)", () => {
    test("Reverse Morton's, Cluffy, and Morton's stacks loft on both feet", async () => {
        const rows: string[] = [];
        for (const side of ["right", "left"] as const) {
            for (const combo of COMBOS) {
                const err = await loftCombo(side, combo.kinds);
                rows.push(`${side} ${combo.name}: ${err ? `THROW ${err}` : "ok"}`);
            }
        }
        const throws = rows.filter((row) => row.includes("THROW"));
        expect(throws, rows.join("\n")).toEqual([]);
    }, 900_000);
});
