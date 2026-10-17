// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Side } from "@/types";
import { bboxOf, centroid } from "./polygon";
import { toolRadiusMm } from "./profile";
import type { CncWorkpiece, MillingProfile, PlacedPart, Point } from "./types";
import { CncExportError } from "./types";

export interface PartPlacement {
    side: Side;
    tx?: number;
    ty?: number;
    rotationDeg?: number;
}

export interface PlacementIssue {
    ok: boolean;
    reason?: string;
}

export function placementMarginMm(profile: MillingProfile): number {
    const r = Math.max(
        toolRadiusMm(profile.toolpathCutter.diameterMm),
        toolRadiusMm(profile.contourCutter.diameterMm),
    );
    return r + profile.topOffsetMm + 2;
}

export function defaultRotationDeg(profile: MillingProfile): number {
    return profile.heelDirection === "xmax" ? 180 : 0;
}

export function rotateAround(x: number, y: number, cx: number, cy: number, deg: number): Point {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dx = x - cx;
    const dy = y - cy;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

export function worldPoint(local: Point, placed: PlacedPart): Point {
    const r = rotateAround(local.x, local.y, placed.cx, placed.cy, placed.rotationDeg);
    return { x: r.x + placed.tx, y: r.y + placed.ty, z: local.z };
}

export function localPoint(world: Point, placed: PlacedPart): Point {
    const x = world.x - placed.tx;
    const y = world.y - placed.ty;
    return rotateAround(x, y, placed.cx, placed.cy, -placed.rotationDeg);
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

export function transformOutline(outline: Point[], placed: PlacedPart): Point[] {
    return outline.map((p) => worldPoint(p, placed));
}

export function rotatedLocalBbox(
    outline: Point[],
    cx: number,
    cy: number,
    rotationDeg: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
    return bboxOf(outline.map((p) => rotateAround(p.x, p.y, cx, cy, rotationDeg)));
}

export function autoTranslate(
    profile: MillingProfile,
    pocket: { x: number; y: number; width: number; length: number },
    rotated: { minX: number; maxX: number; minY: number; maxY: number },
): { tx: number; ty: number } {
    const margin = placementMarginMm(profile);
    let tx = 0;
    let ty = 0;
    if (profile.alignX === "left") tx = pocket.x + margin - rotated.minX;
    else if (profile.alignX === "right") tx = pocket.x + pocket.width - margin - rotated.maxX;
    else tx = pocket.x + pocket.width / 2 - (rotated.minX + rotated.maxX) / 2;
    if (profile.alignY === "front") ty = pocket.y + margin - rotated.minY;
    else if (profile.alignY === "back") ty = pocket.y + pocket.length - margin - rotated.maxY;
    else ty = pocket.y + pocket.length / 2 - (rotated.minY + rotated.maxY) / 2;
    return { tx, ty };
}

export function evaluatePlacedPart(placed: PlacedPart, profile: MillingProfile): PlacementIssue {
    const pocket = profile.pockets[placed.pocketIndex];
    if (!pocket) return { ok: false, reason: "Milling table has no pocket for this insole" };
    const margin = placementMarginMm(profile);
    const world = transformOutline(placed.outline, placed);
    const bb = bboxOf(world);
    const minX = bb.minX - margin;
    const maxX = bb.maxX + margin;
    const minY = bb.minY - margin;
    const maxY = bb.maxY + margin;
    if (
        minX < -1e-6 ||
        maxX > profile.tableWidthMm + 1e-6 ||
        minY < -1e-6 ||
        maxY > profile.tableLengthMm + 1e-6
    ) {
        return {
            ok: false,
            reason: `Part plus margin leaves the milling table (${(maxX - minX).toFixed(1)}×${(maxY - minY).toFixed(1)} mm)`,
        };
    }
    if (
        minX < pocket.x - 1e-6 ||
        maxX > pocket.x + pocket.width + 1e-6 ||
        minY < pocket.y - 1e-6 ||
        maxY > pocket.y + pocket.length + 1e-6
    ) {
        return {
            ok: false,
            reason: `Part plus margin does not fit pocket ${placed.pocketIndex + 1} (leaves pocket)`,
        };
    }
    return { ok: true };
}

export function placeWorkpieces(
    profile: MillingProfile,
    parts: CncWorkpiece[],
    overrides: PartPlacement[] = [],
    options?: { validate?: boolean },
): PlacedPart[] {
    if (parts.length === 0) return [];
    const pockets = profile.pockets;
    if (pockets.length === 0) {
        throw new CncExportError("no_fit", "Milling table has no pockets");
    }
    const margin = placementMarginMm(profile);
    const out: PlacedPart[] = [];
    for (let i = 0; i < parts.length; i++) {
        const wp = parts[i];
        const pocket = pockets[Math.min(i, pockets.length - 1)];
        if (!wp || !pocket) continue;
        const c = centroid(wp.outline);
        const override = overrides.find((o) => o.side === wp.side);
        const rotationDeg = override?.rotationDeg ?? defaultRotationDeg(profile);
        const rotBb = rotatedLocalBbox(wp.outline, c.x, c.y, rotationDeg);
        if (!profile.insolesHorizontal) {
            throw new CncExportError("no_fit", "Vertical insole placement is not supported");
        }
        const partW = rotBb.maxX - rotBb.minX;
        const partH = rotBb.maxY - rotBb.minY;
        const auto = autoTranslate(profile, pocket, rotBb);
        const tx = override?.tx ?? auto.tx;
        const ty = override?.ty ?? auto.ty;
        const skinClear = profile.materialHeightMm - 1;
        if (wp.zMax > skinClear + 1e-6) {
            throw new CncExportError(
                "too_tall",
                `Part max Z ${wp.zMax.toFixed(3)} mm exceeds material height − 1 (${skinClear} mm)`,
            );
        }
        const placed: PlacedPart = {
            side: wp.side,
            pocketIndex: Math.min(i, pockets.length - 1),
            rot180: Math.abs((((rotationDeg % 360) + 360) % 360) - 180) < 1e-6,
            rotationDeg,
            cx: c.x,
            cy: c.y,
            tx,
            ty,
            outline: wp.outline,
            heightmap: wp.heightmap,
            zMin: wp.zMin,
            zMax: wp.zMax,
        };
        if (options?.validate !== false) {
            const fit = evaluatePlacedPart(placed, profile);
            if (!fit.ok) {
                throw new CncExportError(
                    "no_fit",
                    fit.reason ??
                        `Part plus margin does not fit pocket ${i + 1} (${partW.toFixed(1)}×${(partH).toFixed(1)} mm, pocket ${pocket.width}×${pocket.length} mm, margin ${margin.toFixed(1)} mm)`,
                );
            }
        }
        out.push(placed);
    }
    return out;
}

export function defaultPlacements(profile: MillingProfile, parts: CncWorkpiece[]): PartPlacement[] {
    return placeWorkpieces(profile, parts).map((p) => ({
        side: p.side,
        tx: p.tx,
        ty: p.ty,
        rotationDeg: p.rotationDeg,
    }));
}
