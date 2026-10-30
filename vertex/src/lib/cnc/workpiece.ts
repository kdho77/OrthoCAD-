// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import type { BufferGeometry } from "three";
import { extractOrderedBoundaryLoop } from "@/lib/geometry/mesh-close";
import type { Side } from "@/types";
import { DESIGN_PITCH_MM, SKIN_FLOOR_MM } from "./drop-cutter";
import { heightmapRange, rasterizeTop } from "./heightmap";
import { closeOutline, ensureCcw, startAtHeel } from "./polygon";
import { skinZ, toolRadiusMm } from "./profile";
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
    const pitch = Math.min(DESIGN_PITCH_MM, Math.max(0.05, profile.sampleMm));
    const heightmap = rasterizeTop(geometry, outline, pitch, band, Math.max(SKIN_FLOOR_MM, skinZ(profile)));
    const { zMin, zMax } = heightmapRange(heightmap);
    return { side, outline, heightmap, zMin, zMax };
}
