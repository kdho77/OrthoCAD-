// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    measureProceduralWallSmoothness,
    validateManifoldIndexed,
    WALL_COLUMN_TURN_MAX_DEG,
    WALL_FOLD_MAX_DEG,
    WALL_OFFSET_STEP_MM,
} from "@/lib/geometry/mesh-close";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import type { SideCorrections } from "@/types";
import { reconstructProceduralPreview, sampleTopFromArrayBuffer } from "./sample-top-preview";
import type { ProceduralWallStyle } from "./wall-style";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const SIZES = [1, 8.5, 9, 16] as const;
const STYLES: ProceduralWallStyle[] = ["hybrid", "straight", "round"];

function zero(): SideCorrections {
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

function field(lengthMm: number, widthMm: number): HeightFieldParams {
    return {
        side: "left",
        lengthMm,
        widthMm,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zero(),
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

async function loadLeft(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    const { mirrorGeometry } = await import("@/lib/library/loaders");
    const raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    const mirrored = mirrorGeometry(raw);
    raw.dispose();
    return mirrored;
}

describe("procedural wall smoothness", () => {
    for (const wallStyle of STYLES) {
        test(`${wallStyle} stays smooth at M1, M8.5, M9 and M16`, async () => {
            const raw = await loadLeft();
            const rows: string[] = [];
            const problems: string[] = [];
            const check = (ok: boolean, label: string) => {
                if (!ok) problems.push(label);
            };
            try {
                for (const menSize of SIZES) {
                    const layout = insoleLayoutForUsMenSize(menSize);
                    const preview = await reconstructProceduralPreview(raw, {
                        sourceField: field(layout.lengthMm, layout.widthMm),
                        composedTop: true,
                        footprintLengthMm: layout.lengthMm,
                        footprintWidthMm: layout.widthMm,
                        sizeLabel: `US M${menSize}`,
                        wallStyle,
                        side: "left",
                        scanPattern: "full_contact",
                    });
                    const topo = validateManifoldIndexed(preview.geometry);
                    const smooth = measureProceduralWallSmoothness(preview.geometry);
                    const heel = preview.model.bounds.maxX - preview.model.bounds.minX;
                    const ball = preview.model.bounds.maxY - preview.model.bounds.minY;
                    const ud = preview.geometry.userData as {
                        nRound?: number;
                        nLine?: number;
                        stationCount?: number;
                    };
                    const turn = smooth?.maxColumnTurnDeg;
                    const off = smooth?.maxOffsetStepMm;
                    rows.push(
                        [
                            `M${menSize}`,
                            `naked=${topo.openEdges}`,
                            `shared=${topo.nonManifoldEdges}`,
                            `euler=${topo.eulerCharacteristic}`,
                            `fold30=${smooth?.foldOver30 ?? "na"}`,
                            `fold60=${smooth?.foldOver60 ?? "na"}`,
                            `inward=${smooth?.inwardFaces ?? "na"}`,
                            `turn=${turn?.toFixed(2) ?? "na"}@${smooth?.worstTurnX.toFixed(1) ?? "na"}`,
                            `mono=${smooth?.monotonicArc ?? "na"}`,
                            `off=${off?.toFixed(3) ?? "na"}`,
                            `quads=${smooth?.wallQuads ?? "na"}`,
                            `nS=${ud.stationCount ?? "na"}`,
                            `heel=${heel.toFixed(2)}`,
                            `ball=${ball.toFixed(2)}`,
                        ].join(" "),
                    );
                    check(topo.openEdges === 0, `M${menSize} naked`);
                    check(topo.nonManifoldEdges === 0, `M${menSize} shared`);
                    check(topo.eulerCharacteristic === 2, `M${menSize} euler`);
                    check(smooth != null, `M${menSize} measured`);
                    if (smooth) {
                        check(smooth.foldOver30 === 0, `M${menSize} fold30=${smooth.foldOver30}`);
                        check(smooth.inwardFaces === 0, `M${menSize} inward=${smooth.inwardFaces}`);
                        check(
                            smooth.maxColumnTurnDeg <= WALL_COLUMN_TURN_MAX_DEG + 1e-3,
                            `M${menSize} turn=${smooth.maxColumnTurnDeg.toFixed(2)}`,
                        );
                        check(smooth.monotonicArc, `M${menSize} monotonic`);
                        check(
                            smooth.maxOffsetStepMm <= WALL_OFFSET_STEP_MM + 1e-3,
                            `M${menSize} offset=${smooth.maxOffsetStepMm.toFixed(3)}`,
                        );
                        check(
                            smooth.maxFoldDeg <= WALL_FOLD_MAX_DEG + 1e-6,
                            `M${menSize} maxFold=${smooth.maxFoldDeg.toFixed(2)}`,
                        );
                    }
                    if (menSize === 9) {
                        check(Math.abs(heel - 275) <= 0.2, `M9 heel=${heel.toFixed(2)}`);
                        check(Math.abs(ball - 92.73) <= 0.2, `M9 ball=${ball.toFixed(2)}`);
                    }
                    preview.geometry.dispose();
                }
                expect(problems, `${rows.join("\n")}\n${problems.join("; ")}`).toEqual([]);
            } finally {
                raw.dispose();
            }
        }, 900_000);
    }
});
