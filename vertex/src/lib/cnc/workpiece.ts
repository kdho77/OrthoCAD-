// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { extractOrderedBoundaryLoop } from "@/lib/geometry/mesh-close";
import type { Side } from "@/types";
import { heightmapRange, rasterizeTop } from "./heightmap";
import { closeOutline, ensureCcw, startAtHeel } from "./polygon";
import { toolRadiusMm } from "./profile";
import type { CncWorkpiece, MillingProfile, Point } from "./types";
import { CncExportError } from "./types";

const CLOSED_GAP_MM = 2;

export function outlineFromGeometry(geometry: BufferGeometry): Point[] {
    const loop = extractOrderedBoundaryLoop(geometry);
    const pts: Point[] = loop.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    if (pts.length < 3) {
        throw new CncExportError("outline_open", `Insole outline is not closed (points=${pts.length})`);
    }
    return startAtHeel(ensureCcw(closeOutline(pts, CLOSED_GAP_MM)));
}

export function workpieceFromGeometry(
    geometry: BufferGeometry,
    side: Side,
    profile: MillingProfile,
): CncWorkpiece {
    const outline = outlineFromGeometry(geometry);
    const band =
        profile.topOffsetMm +
        Math.max(
            toolRadiusMm(profile.toolpathCutter.diameterMm),
            toolRadiusMm(profile.contourCutter.diameterMm),
        );
    const heightmap = rasterizeTop(geometry, outline, Math.min(0.25, profile.sampleMm), band);
    const { zMin, zMax } = heightmapRange(heightmap);
    return { side, outline, heightmap, zMin, zMax };
}
