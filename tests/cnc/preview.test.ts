// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { generateCncJob } from "@/lib/cnc/export";
import { renderToolpathPreview } from "@/lib/cnc/preview";
import { cloneProfile } from "@/lib/cnc/profile";
import { encodePng } from "../helpers/render-png";
import { syntheticWorkpiece } from "./helpers";

describe("CNC toolpath preview", () => {
    test("writes XY preview PNGs", () => {
        const profile = cloneProfile();
        const job = generateCncJob(profile, [
            syntheticWorkpiece(profile, "left"),
            syntheticWorkpiece(profile, "right"),
        ]);
        const preview = renderToolpathPreview(job.gcode, profile, 900, 640);
        expect(preview.rgb.length).toBe(900 * 640 * 3);
        const png = encodePng(preview.width, preview.height, preview.rgb);
        const dirs = [
            resolve("/opt/cursor/artifacts/screenshots"),
            resolve(process.cwd(), "tests/cnc/previews"),
        ];
        for (const dir of dirs) {
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, "cnc-toolpath-table.png"), png);
        }
        expect(png[0]).toBe(137);
    });
});
