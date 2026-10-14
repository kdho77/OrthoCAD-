// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    classifyBaseTopFactors,
    correctionDeltaAt,
    getBaseFootprintFrame,
    neutralField,
    vertexFootprintAt,
} from "@/lib/geometry/base-modifier";
import { defaultElementPose, ELEMENT_PROFILES } from "@/lib/geometry/elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, Side, SideCorrections } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const LIFT_TOL_MM = 0.01;

function zeroCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function fieldForSampleTop(
    raw: BufferGeometry,
    side: Side,
    patch: Partial<HeightFieldParams> & { corrections?: SideCorrections },
): HeightFieldParams {
    const frame = getBaseFootprintFrame(raw, side);
    return {
        side,
        lengthMm: frame.lenSize,
        widthMm: frame.widSize,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: patch.corrections ?? zeroCorrections(),
        elements: patch.elements ?? [],
        includeSkives: false,
        includeElements: patch.includeElements ?? true,
        trimline: null,
        ...patch,
    };
}

async function loadSampleTop(side: Side): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "left") {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    return raw;
}

function worstLiftErrorMm(raw: BufferGeometry, modified: BufferGeometry, field: HeightFieldParams): number {
    const frame = getBaseFootprintFrame(raw, field.side);
    const neutral = neutralField(field);
    const basePos = raw.getAttribute("position")!.array as Float32Array;
    const modPos = modified.getAttribute("position")!.array as Float32Array;
    const ta = frame.thickAxis;
    const n = basePos.length / 3;
    let worst = 0;
    for (let i = 0; i < n; i++) {
        const { u, vSigned } = vertexFootprintAt(frame, basePos, i);
        const intended = correctionDeltaAt(u, vSigned, field, neutral);
        const applied = modPos[i * 3 + ta]! - basePos[i * 3 + ta]!;
        worst = Math.max(worst, Math.abs(applied - intended));
    }
    return worst;
}

describe("SAMPLE_Top top-only applyBaseModifiers lift (PR #188)", () => {
    test("classifyBaseTopFactors is null (open top sheet)", async () => {
        const raw = await loadSampleTop("right");
        expect(classifyBaseTopFactors(raw)).toBeNull();
        raw.dispose();
    });

    for (const side of ["left", "right"] as Side[]) {
        test(`${side} — arch raise applied lift matches intended`, async () => {
            const raw = await loadSampleTop(side);
            const field = fieldForSampleTop(raw, side, {
                corrections: { ...zeroCorrections(), archHeightMm: 18 },
                includeElements: false,
            });
            const modified = applyBaseModifiers(raw, field, 0);
            expect(worstLiftErrorMm(raw, modified, field)).toBeLessThanOrEqual(LIFT_TOL_MM);
            modified.dispose();
            raw.dispose();
        }, 60_000);

        test(`${side} — default met pad applied lift matches intended`, async () => {
            const raw = await loadSampleTop(side);
            const frame = getBaseFootprintFrame(raw, side);
            const pose = defaultElementPose("met_pad", side, frame.lenSize, frame.widSize);
            const el: PlacedElement = {
                id: "met-test",
                kind: "met_pad",
                side,
                ...pose,
            };
            const field = fieldForSampleTop(raw, side, {
                corrections: zeroCorrections(),
                elements: [el],
                includeElements: true,
            });
            const modified = applyBaseModifiers(raw, field, 0);
            expect(worstLiftErrorMm(raw, modified, field)).toBeLessThanOrEqual(LIFT_TOL_MM);
            modified.dispose();
            raw.dispose();
        }, 60_000);
    }
});
