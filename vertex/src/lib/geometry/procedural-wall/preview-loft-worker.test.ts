// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildProceduralViewerPatternInWorker } from "./preview-loft-worker";
import { buildProceduralViewerPattern, sampleTopFromArrayBuffer } from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");

describe("preview loft worker pattern parity", () => {
    test("worker faired pattern matches main-thread bytes for L and R corrections", async () => {
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const leftGeo = await sampleTopFromArrayBuffer(buf);
        const rightGeo = leftGeo.clone();
        const mainLeft = buildProceduralViewerPattern(leftGeo, "full_contact", { heelCupHeightMm: 0 });
        const mainRight = buildProceduralViewerPattern(rightGeo, "full_contact", {
            heelCupHeightMm: 0,
            forefootWidthMm: 2,
        });
        const workerLeft = await buildProceduralViewerPatternInWorker(leftGeo, "full_contact", {
            heelCupHeightMm: 0,
        });
        const workerRight = await buildProceduralViewerPatternInWorker(rightGeo, "full_contact", {
            heelCupHeightMm: 0,
            forefootWidthMm: 2,
        });
        expect(workerLeft).toEqual(mainLeft);
        expect(workerRight).toEqual(mainRight);
        leftGeo.dispose();
        rightGeo.dispose();
    });
});
