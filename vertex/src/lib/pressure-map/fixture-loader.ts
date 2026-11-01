// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { detectContentBoundsFromRgba } from "@/lib/pressure-map/content-bounds";
import { analyzeFromRgba } from "@/lib/pressure-map/orientation";
import { DEFAULT_PRESSURE_MAP_ALIGNMENT } from "@/lib/pressure-map/types";
import type { PressureMapFoot, Side } from "@/types";

const FIXTURE_DIR = resolve(process.cwd(), "vertex/tests/pressure-map/fixtures");

/** Load committed PNG fixtures without browser Image decode (rstest / Node). */
export function loadPressureMapFixturePng(side: Side, fileName: string): PressureMapFoot {
    const png = PNG.sync.read(readFileSync(resolve(FIXTURE_DIR, fileName)));
    const rgba = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
    const contentBounds = detectContentBoundsFromRgba(png.width, png.height, rgba);
    const orientation = analyzeFromRgba(rgba, png.width, png.height, side);
    const dataUrl = `data:image/png;base64,${readFileSync(resolve(FIXTURE_DIR, fileName)).toString("base64")}`;
    return {
        imageDataUrl: dataUrl,
        mimeType: "image/png",
        fileName,
        visible: true,
        imageWidth: png.width,
        imageHeight: png.height,
        contentBounds,
        alignment: { ...DEFAULT_PRESSURE_MAP_ALIGNMENT },
        orientation,
    };
}
