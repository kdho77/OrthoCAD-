// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { hausdorffReport } from "@/lib/geometry/procedural-wall/metrics";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import type { ProceduralWallStyle } from "@/lib/geometry/procedural-wall/wall-style";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, SideCorrections } from "@/types";

const BASELINE_DIR = resolve(process.cwd(), "vertex/src/lib/geometry/procedural-wall/baselines");
const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function postingCorrections(): SideCorrections {
    return {
        rearfootWedge: { side: "lateral", value: 4, unit: "deg" },
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

function neutralCorrections(c: SideCorrections): SideCorrections {
    return { ...c, rearfootWedge: undefined, forefootWedge: undefined };
}

function fieldFor(side: Side): HeightFieldParams {
    const corrections = postingCorrections();
    return {
        side,
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections,
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

const MIRROR_WALLED_HAUSDORFF_MM = 1.5;

async function sampleTopForSide(side: Side): Promise<BufferGeometry> {
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

function stlMd5(geo: BufferGeometry): string {
    return createHash("md5")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
}

describe("posted SAMPLE_Top golden (composed top — Corrections viewer path)", () => {
    test("rearfoot wedge 4° composed top STL md5 differs from neutral", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const field = fieldFor("right");
        const neutralField: HeightFieldParams = {
            ...field,
            corrections: neutralCorrections(field.corrections),
        };
        const posted = await composePrintSolidTop(raw, { sourceField: field });
        const neutral = await composePrintSolidTop(raw, { sourceField: neutralField });
        const md5 = stlMd5(posted);
        const neutralMd5 = stlMd5(neutral);
        if (process.env.REGEN_POSTING_GOLDEN === "1") {
            writeFileSync(resolve(BASELINE_DIR, "sample-top-posting-4-composed.stl.md5"), `${md5}\n`);
            writeFileSync(
                resolve(BASELINE_DIR, "sample-top-posting-4-metrics.json"),
                `${JSON.stringify({ composedTop: { stlMd5: md5 } }, null, 2)}\n`,
            );
        }
        const frozen = readFileSync(
            resolve(BASELINE_DIR, "sample-top-posting-4-composed.stl.md5"),
            "utf8",
        ).trim();
        expect(md5).toBe(frozen);
        expect(md5).not.toBe(neutralMd5);
        posted.dispose();
        neutral.dispose();
        raw.dispose();
    });
});

describe("posted SAMPLE_Top WALLED posting-4 S1 parity", () => {
    const styles: ProceduralWallStyle[] = ["straight", "round", "hybrid"];

    for (const wallStyle of styles) {
        test(`${wallStyle} — left vs right md5 and mirror symmetry`, async () => {
            const rawRight = await sampleTopForSide("right");
            const rawLeft = await sampleTopForSide("left");
            const postedRight = await reconstructProceduralPreview(rawRight, {
                sourceField: fieldFor("right"),
                composedTop: true,
                corrections: fieldFor("right").corrections,
                wallStyle,
                scanPattern: "full_contact",
            });
            const postedLeft = await reconstructProceduralPreview(rawLeft, {
                sourceField: fieldFor("left"),
                composedTop: true,
                corrections: fieldFor("left").corrections,
                wallStyle,
                scanPattern: "full_contact",
            });
            expect(stlMd5(postedLeft.geometry)).not.toBe(stlMd5(postedRight.geometry));
            const mirroredRight = mirrorGeometry(postedRight.geometry.clone());
            expect(hausdorffReport(mirroredRight, postedLeft.geometry).maxMm).toBeLessThanOrEqual(
                MIRROR_WALLED_HAUSDORFF_MM,
            );
            mirroredRight.dispose();
            postedRight.geometry.dispose();
            postedLeft.geometry.dispose();
            rawRight.dispose();
            rawLeft.dispose();
        }, 180_000);

        for (const side of ["left", "right"] as Side[]) {
            test(`${wallStyle} ${side} — posted STL md5 frozen and differs from unmodified`, async () => {
                const raw = await sampleTopForSide(side);
                const sourceField = fieldFor(side);
                const neutralField: HeightFieldParams = {
                    ...sourceField,
                    corrections: neutralCorrections(sourceField.corrections),
                };
                const postedPreview = await reconstructProceduralPreview(raw, {
                    sourceField,
                    composedTop: true,
                    corrections: sourceField.corrections,
                    wallStyle,
                    scanPattern: "full_contact",
                });
                const neutralPreview = await reconstructProceduralPreview(raw, {
                    sourceField: neutralField,
                    composedTop: true,
                    corrections: neutralField.corrections,
                    wallStyle,
                    scanPattern: "full_contact",
                });
                const md5 = stlMd5(postedPreview.geometry);
                const neutralMd5 = stlMd5(neutralPreview.geometry);
                const baselineName = `sample-top-posting-4-${wallStyle}-${side}.stl.md5`;
                if (process.env.REGEN_POSTING_GOLDEN === "1") {
                    writeFileSync(resolve(BASELINE_DIR, baselineName), `${md5}\n`);
                }
                const frozen = readFileSync(resolve(BASELINE_DIR, baselineName), "utf8").trim();
                expect(md5).toBe(frozen);
                expect(md5).not.toBe(neutralMd5);
                postedPreview.geometry.dispose();
                neutralPreview.geometry.dispose();
                raw.dispose();
            }, 180_000);
        }
    }
});
