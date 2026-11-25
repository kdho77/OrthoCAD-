// Frozen rigid heel-lift cup-depth gates.
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
import type { BeltSample, LiftComparison, PlateSample, SheetSample } from "./measure";
import { assertIsLowestHeelSeat, compareLift, sampleBelt, sampleSheet } from "./measure";

const SAMPLE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

export async function loadSampleTop(side: Side): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE);
    const loaded = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    // Export treats the reoriented SAMPLE_Top as the right foot and mirrors left.
    if (side === "left") {
        const mirrored = mirrorGeometry(loaded);
        loaded.dispose();
        return mirrored;
    }
    return loaded;
}

function numericUserData(geometry: BufferGeometry, key: string): number {
    const value = (geometry.userData as Record<string, unknown>)[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`production solid is missing numeric userData.${key}`);
    }
    return value;
}

/**
 * composePrintSolidTop inside reconstructProceduralPreview.
 * printSolidOptions sets sourceField and composedTop on the printing_solid path.
 */
export async function buildProductionSolid(side: Side, heelLiftMm: number): Promise<BufferGeometry> {
    const raw = await loadSampleTop(side);
    const design = defaultDesign();
    design.usMenSize = 11;
    design.shoeWidth = "medium";
    design.method = "printing_solid";
    design.pattern = "full_contact";
    design.corrections = {
        ...design.corrections,
        [side]: { ...design.corrections[side], heelLiftMm },
    };
    const field = baseModifierField(design, side, design.thicknessMm);
    const options = printSolidOptions({
        design,
        side,
        field,
        viewer: { wallStyle: "round" },
        trimline: null,
        bottomPattern: null,
    });
    if (!options.sourceField) throw new Error("production path missing sourceField");
    if (options.composedTop !== true) throw new Error("production path missing composedTop");
    if (options.wallStyle !== "round")
        throw new Error(`wall style ${String(options.wallStyle)} is not round`);
    if (options.sourceField.corrections?.heelLiftMm !== heelLiftMm) {
        throw new Error("sourceField heelLiftMm was not applied");
    }
    const preview = await reconstructProceduralPreview(raw, options);
    raw.dispose();
    const top = preview.model.top.meshPositions;
    const rim = preview.model.top.rimLocal;
    if (!top || !rim || rim.length < 8) {
        preview.geometry.dispose();
        throw new Error("composed top sheet missing");
    }
    if (preview.geometry.userData.composedTop !== true) {
        preview.geometry.dispose();
        throw new Error("reconstructProceduralPreview did not loft with composedTop");
    }
    preview.geometry.userData.heelGateTop = new Float32Array(top);
    preview.geometry.userData.heelGateRim = rim.slice();
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
    const pos = geometry.getAttribute("position");
    if (!pos) throw new Error("production solid is missing positions");
    return sampleBelt(
        pos.array as Float32Array,
        frame.lengthAxis,
        frame.thickAxis,
        frame.lenMin,
        frame.lenSize,
    );
}

export function plateOf(zero: BufferGeometry, lift: BufferGeometry): PlateSample {
    return {
        meshMinZ: numericUserData(lift, "meshMinZ"),
        plantarAbsMaxZ: numericUserData(lift, "plantarAbsMaxZ"),
        zeroMeshMinZ: numericUserData(zero, "meshMinZ"),
        zeroPlantarAbsMaxZ: numericUserData(zero, "plantarAbsMaxZ"),
    };
}

export function stlSha256(geometry: BufferGeometry): string {
    return createHash("sha256")
        .update(Buffer.from(geometryToBinarySTL(geometry)))
        .digest("hex");
}

export function contactSample(geometry: BufferGeometry): SheetSample {
    const { pos, rim } = sheetOf(geometry);
    const sample = sampleSheet(pos, rim);
    assertIsLowestHeelSeat(pos, rim, sample.seat.i);
    return sample;
}

export function comparison(zero: BufferGeometry, lift: BufferGeometry, side: Side): LiftComparison {
    const z = sheetOf(zero);
    const lifted = sheetOf(lift);
    return compareLift(contactSample(zero), z.pos, lifted.pos, beltOf(lift, side), plateOf(zero, lift));
}
