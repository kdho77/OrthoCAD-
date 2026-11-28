// Frozen heel-lift cup-depth gates.
// Production compose path for SAMPLE_Top US M11 medium.
// Do not edit after the gates pull request is opened.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BufferGeometry } from "three";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import { defaultDesign } from "@/stores/design-store";
import type { Side } from "@/types";
import type { LiftComparison } from "./measure";
import { type BeltSample, compareLift, type SheetSample, sampleBelt, sampleSheet } from "./measure";

const SAMPLE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

export async function loadSampleTop(side: Side): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE);
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

/** composePrintSolidTop inside reconstructProceduralPreview (sourceField + composedTop). */
export async function buildProductionSolid(side: Side, heelLiftMm: number): Promise<BufferGeometry> {
    const raw = await loadSampleTop(side);
    const design = defaultDesign();
    design.usMenSize = 11;
    design.shoeWidth = "medium";
    design.method = "printing_solid";
    design.pattern = "full_contact";
    design.sizeSystem = "us";
    design.corrections[side].heelLiftMm = heelLiftMm;
    const field = baseModifierField(design, side, design.thicknessMm);
    const preview = await reconstructProceduralPreview(
        raw,
        printSolidOptions({
            design,
            side,
            field,
            viewer: { wallStyle: "round", deviceType: "functional" },
            trimline: null,
            bottomPattern: null,
        }),
    );
    raw.dispose();
    const top = preview.model.top.meshPositions;
    const rim = preview.model.top.rimLocal;
    if (!top || !rim) {
        preview.geometry.dispose();
        throw new Error("composed top sheet missing");
    }
    preview.geometry.userData.heelGateTop = top;
    preview.geometry.userData.heelGateRim = rim;
    return preview.geometry;
}

export function sheetOf(geometry: BufferGeometry): { pos: Float32Array; rim: number[] } {
    const pos = geometry.userData.heelGateTop as Float32Array | undefined;
    const rim = geometry.userData.heelGateRim as number[] | undefined;
    if (!pos || !rim) throw new Error("production solid is missing the composed top sheet");
    return { pos, rim };
}

export function beltOf(geometry: BufferGeometry, side: Side): BeltSample {
    const frame = getBaseFootprintFrame(geometry, side);
    const pos = geometry.getAttribute("position")!.array as Float32Array;
    return sampleBelt(pos, frame.lengthAxis, frame.thickAxis, frame.lenMin, frame.lenSize);
}

export function stlSha256(geometry: BufferGeometry): string {
    return createHash("sha256")
        .update(Buffer.from(geometryToBinarySTL(geometry)))
        .digest("hex");
}

export function contactSample(geometry: BufferGeometry): SheetSample {
    const { pos, rim } = sheetOf(geometry);
    return sampleSheet(pos, rim);
}

export function comparison(zero: BufferGeometry, lift: BufferGeometry, side: Side): LiftComparison {
    const z = sheetOf(zero);
    const lifted = sheetOf(lift);
    return compareLift(contactSample(zero), z.pos, lifted.pos, beltOf(lift, side));
}
