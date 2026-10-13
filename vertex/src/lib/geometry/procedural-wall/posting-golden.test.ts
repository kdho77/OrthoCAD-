// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { geometryToBinarySTL } from "@/lib/geometry/stl";

const BASELINE_DIR = resolve(process.cwd(), "vertex/src/lib/geometry/procedural-wall/baselines");
const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

describe("posted SAMPLE_Top golden (composed top — Corrections viewer path)", () => {
    test("rearfoot wedge 4° composed top STL md5 differs from neutral", async () => {
        const buf = readFileSync(SAMPLE_TOP_PATH);
        const raw = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const posting = {
            rearfootWedge: { side: "lateral" as const, value: 4, unit: "deg" as const },
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
        const field: HeightFieldParams = {
            side: "right",
            lengthMm: 266,
            widthMm: 95,
            thicknessMm: 3,
            corrections: posting,
            elements: [],
        };
        const neutralField: HeightFieldParams = {
            ...field,
            corrections: {
                ...posting,
                rearfootWedge: undefined,
                forefootWedge: undefined,
            },
        };
        const posted = composePrintSolidTop(raw, { sourceField: field });
        const neutral = composePrintSolidTop(raw, { sourceField: neutralField });
        const md5 = createHash("md5")
            .update(Buffer.from(geometryToBinarySTL(posted)))
            .digest("hex");
        const neutralMd5 = createHash("md5")
            .update(Buffer.from(geometryToBinarySTL(neutral)))
            .digest("hex");
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
