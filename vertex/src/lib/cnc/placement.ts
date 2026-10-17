// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { bboxOf, centroid } from "./polygon";
import { toolRadiusMm } from "./profile";
import type { CncWorkpiece, MillingProfile, PlacedPart, Point } from "./types";
import { CncExportError } from "./types";

export function placementMarginMm(profile: MillingProfile): number {
    const r = Math.max(
        toolRadiusMm(profile.toolpathCutter.diameterMm),
        toolRadiusMm(profile.contourCutter.diameterMm),
    );
    return r + profile.topOffsetMm + 2;
}

export function worldPoint(local: Point, placed: PlacedPart): Point {
    let x = local.x;
    let y = local.y;
    if (placed.rot180) {
        x = 2 * placed.cx - x;
        y = 2 * placed.cy - y;
    }
    return { x: x + placed.tx, y: y + placed.ty, z: local.z };
}

export function localPoint(world: Point, placed: PlacedPart): Point {
    let x = world.x - placed.tx;
    let y = world.y - placed.ty;
    if (placed.rot180) {
        x = 2 * placed.cx - x;
        y = 2 * placed.cy - y;
    }
    return { x, y, z: world.z };
}

function applyZero(x: number, y: number, profile: MillingProfile): Point {
    const xx = profile.zeroX === "right" ? profile.tableWidthMm - x : x;
    const yy = profile.zeroY === "back" ? profile.tableLengthMm - y : y;
    return { x: xx, y: yy };
}

export function machineXY(local: Point, placed: PlacedPart, profile: MillingProfile): Point {
    const w = worldPoint(local, placed);
    return applyZero(w.x, w.y, profile);
}

export function placeWorkpieces(profile: MillingProfile, parts: CncWorkpiece[]): PlacedPart[] {
    if (parts.length === 0) return [];
    const pockets = profile.pockets;
    if (pockets.length === 0) {
        throw new CncExportError("no_fit", "Milling table has no pockets");
    }
    const margin = placementMarginMm(profile);
    const out: PlacedPart[] = [];
    for (let i = 0; i < parts.length; i++) {
        const wp = parts[i]!;
        const pocket = pockets[Math.min(i, pockets.length - 1)]!;
        const bb = bboxOf(wp.outline);
        const c = centroid(wp.outline);
        const rot180 = profile.heelDirection === "xmax";
        let minX = bb.minX;
        let maxX = bb.maxX;
        let minY = bb.minY;
        let maxY = bb.maxY;
        if (rot180) {
            minX = 2 * c.x - bb.maxX;
            maxX = 2 * c.x - bb.minX;
            minY = 2 * c.y - bb.maxY;
            maxY = 2 * c.y - bb.minY;
        }
        if (!profile.insolesHorizontal) {
            throw new CncExportError("no_fit", "Vertical insole placement is not supported");
        }
        const partW = maxX - minX;
        const partH = maxY - minY;
        if (partW + 2 * margin > pocket.width + 1e-6 || partH + 2 * margin > pocket.length + 1e-6) {
            throw new CncExportError(
                "no_fit",
                `Part plus margin does not fit pocket ${i + 1} (${partW.toFixed(1)}×${partH.toFixed(1)} mm, pocket ${pocket.width}×${pocket.length} mm, margin ${margin.toFixed(1)} mm)`,
            );
        }
        const skinClear = profile.materialHeightMm - 1;
        if (wp.zMax > skinClear + 1e-6) {
            throw new CncExportError(
                "too_tall",
                `Part max Z ${wp.zMax.toFixed(3)} mm exceeds material height − 1 (${skinClear} mm)`,
            );
        }
        let tx = 0;
        let ty = 0;
        if (profile.alignX === "left") tx = pocket.x + margin - minX;
        else if (profile.alignX === "right") tx = pocket.x + pocket.width - margin - maxX;
        else tx = pocket.x + pocket.width / 2 - (minX + maxX) / 2;
        if (profile.alignY === "front") ty = pocket.y + margin - minY;
        else if (profile.alignY === "back") ty = pocket.y + pocket.length - margin - maxY;
        else ty = pocket.y + pocket.length / 2 - (minY + maxY) / 2;

        out.push({
            side: wp.side,
            pocketIndex: Math.min(i, pockets.length - 1),
            rot180,
            cx: c.x,
            cy: c.y,
            tx,
            ty,
            outline: wp.outline,
            heightmap: wp.heightmap,
            zMin: wp.zMin,
            zMax: wp.zMax,
        });
    }
    return out;
}
