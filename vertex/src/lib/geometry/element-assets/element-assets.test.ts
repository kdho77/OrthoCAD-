// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    getBaseFootprintFrame,
    neutralField,
} from "@/lib/geometry/base-modifier";
import { defaultElementPose } from "@/lib/geometry/elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, Side } from "@/types";
import { applyElementsToTopMeshLast } from "./apply-elements";
import { loadTransformedAssetPositions } from "./element-asset";
import { smoothMaxMm } from "./no-flow-blend";
import { NO_FLOW_SMOOTH_MAX_K_MM } from "./types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

async function loadSampleTop(side: Side): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "left") {
        const m = mirrorGeometry(raw);
        raw.dispose();
        raw = m;
    }
    return raw;
}

function zeroCorrections() {
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

function fieldWithElement(raw: BufferGeometry, side: Side, el: PlacedElement): HeightFieldParams {
    const frame = getBaseFootprintFrame(raw, side);
    return {
        side,
        lengthMm: frame.lenSize,
        widthMm: frame.widSize,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zeroCorrections(),
        elements: [el],
        includeSkives: false,
        includeElements: true,
        trimline: null,
    };
}

function placedMetPad(side: Side, raw: BufferGeometry, mode: "flow" | "noFlow"): PlacedElement {
    const frame = getBaseFootprintFrame(raw, side);
    const pose = defaultElementPose("met_pad", side, frame.lenSize, frame.widSize);
    return {
        id: "el-1",
        kind: "met_pad",
        side,
        ...pose,
        heightMm: 5,
        placementMode: mode,
        zOffsetMm: 0,
    };
}

describe("element asset pipeline", () => {
    test("synthetic dome peak scales with heightMm within 0.02 mm", async () => {
        const { grid } = await loadTransformedAssetPositions("synthetic-dome", {
            scaleXy: 1,
            scaleZ: 1,
            rotationDeg: 0,
            mirrorX: false,
            anchorUMm: 0,
            anchorVMm: 0,
            placementMode: "flow",
            zOffsetMm: 0,
            heightMm: 5,
            category: "add",
        });
        expect(grid.maxZ).toBeGreaterThan(4.9);
        expect(grid.maxZ).toBeLessThan(5.05);
    });

    test("smoothMax matches CAD formula", () => {
        const k = NO_FLOW_SMOOTH_MAX_K_MM;
        const a = 2;
        const b = 5;
        const h = Math.max(k - Math.abs(a - b), 0);
        expect(smoothMaxMm(a, b, k)).toBeCloseTo(Math.max(a, b) + (h * h) / (4 * k), 6);
    });

    for (const side of ["left", "right"] as Side[]) {
        test(`${side} noFlow — never lowers top under dome`, async () => {
            const raw = await loadSampleTop(side);
            const el = placedMetPad(side, raw, "noFlow");
            const field = fieldWithElement(raw, side, el);
            const base = applyBaseModifiers(raw, { ...field, includeElements: false, elements: [] }, 0);
            const before = base.clone();
            await applyElementsToTopMeshLast(base, raw, field, { subdivide: false });
            const pos = base.getAttribute("position")!.array as Float32Array;
            const prev = before.getAttribute("position")!.array as Float32Array;
            const ta = getBaseFootprintFrame(raw, side).thickAxis;
            let lowered = false;
            for (let i = 0; i < pos.length / 3; i++) {
                if (pos[i * 3 + ta]! < prev[i * 3 + ta]! - 1e-4) lowered = true;
            }
            expect(lowered).toBe(false);
            base.dispose();
            before.dispose();
            raw.dispose();
        }, 60_000);
    }

    test("composePrintSolidTop applies elements after modifiers (extra lift vs no elements)", async () => {
        const raw = await loadSampleTop("right");
        const el = placedMetPad("right", raw, "noFlow");
        const withField = fieldWithElement(raw, "right", el);
        const plain = await composePrintSolidTop(raw, {
            sourceField: { ...withField, elements: [], includeElements: false },
        });
        const withEl = await composePrintSolidTop(raw, { sourceField: withField });
        const frame = getBaseFootprintFrame(raw, "right");
        const ta = frame.thickAxis;
        const a = plain.getAttribute("position")!.array as Float32Array;
        const b = withEl.getAttribute("position")!.array as Float32Array;
        let maxRaise = 0;
        for (let i = 0; i < a.length / 3; i++) {
            maxRaise = Math.max(maxRaise, b[i * 3 + ta]! - a[i * 3 + ta]!);
        }
        expect(maxRaise).toBeGreaterThan(0.3);
        plain.dispose();
        withEl.dispose();
        raw.dispose();
    }, 60_000);
});
