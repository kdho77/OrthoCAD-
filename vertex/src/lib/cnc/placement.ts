// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import type { Side } from "@/types";
import { ENVELOPE_CLEARANCE_MM, footprintOverhangMm, polygonsOverlap, toolFootprintLocal } from "./envelope";
import { bboxOf, centroid } from "./polygon";
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

/**
 * Auto-position inset of the outline bbox, from the tool-footprint envelope.
 * Left/right alignment uses that side's overhang plus {@link ENVELOPE_CLEARANCE_MM}.
 */
export function placementMarginMm(profile: MillingProfile, outline?: Point[], rotationDeg = 0): number {
    if (!outline || outline.length < 3) return ENVELOPE_CLEARANCE_MM;
    const footprint = toolFootprintLocal(outline, profile);
    if (footprint.length < 3) return ENVELOPE_CLEARANCE_MM;
    const c = centroid(outline);
    const over = footprintOverhangMm(outline, footprint, rotationDeg, c.x, c.y);
    const side =
        profile.alignX === "right"
            ? over.right
            : profile.alignX === "center"
              ? Math.max(over.left, over.right)
              : over.left;
    return Math.max(0, side) + ENVELOPE_CLEARANCE_MM;
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
    margin = ENVELOPE_CLEARANCE_MM,
): { tx: number; ty: number } {
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

/** Axis-aligned milling rectangle: declared table grown to cover every pocket. */
export function tableBoundsMm(profile: MillingProfile): { width: number; length: number } {
    let width = profile.tableWidthMm;
    let length = profile.tableLengthMm;
    for (const pk of profile.pockets) {
        width = Math.max(width, pk.x + pk.width);
        length = Math.max(length, pk.y + pk.length);
    }
    return { width, length };
}

export function worldFootprint(placed: PlacedPart, profile: MillingProfile): Point[] {
    return toolFootprintLocal(placed.outline, profile).map((p) => worldPoint(p, placed));
}

/** Red/green fit: the tool envelope must keep 1 mm inside the pocket and the table. */
export function evaluatePlacedPart(placed: PlacedPart, profile: MillingProfile): PlacementIssue {
    const pocket = profile.pockets[placed.pocketIndex];
    if (!pocket) return { ok: false, reason: "Milling table has no pocket for this insole" };
    const table = tableBoundsMm(profile);
    const env = worldFootprint(placed, profile);
    if (env.length < 3) return { ok: false, reason: "Tool envelope is empty" };
    const bb = bboxOf(env);
    const clearance = ENVELOPE_CLEARANCE_MM;
    if (
        bb.minX < clearance - 1e-4 ||
        bb.maxX > table.width - clearance + 1e-4 ||
        bb.minY < clearance - 1e-4 ||
        bb.maxY > table.length - clearance + 1e-4
    ) {
        return {
            ok: false,
            reason: `Tool envelope leaves the milling table (needs ${clearance.toFixed(0)} mm clearance)`,
        };
    }
    if (
        bb.minX < pocket.x + clearance - 1e-4 ||
        bb.maxX > pocket.x + pocket.width - clearance + 1e-4 ||
        bb.minY < pocket.y + clearance - 1e-4 ||
        bb.maxY > pocket.y + pocket.length - clearance + 1e-4
    ) {
        return {
            ok: false,
            reason: `Tool envelope does not fit pocket ${placed.pocketIndex + 1} (needs ${clearance.toFixed(0)} mm clearance)`,
        };
    }
    if (placed.zMax > profile.materialHeightMm + 1e-6) {
        return {
            ok: false,
            reason: `Part max height ${placed.zMax.toFixed(1)} mm exceeds the block depth (${profile.materialHeightMm} mm)`,
        };
    }
    return { ok: true };
}

/** Per-side fit, including no overlap between the L and R tool envelopes. */
export function evaluateAllPlacements(
    placed: PlacedPart[],
    profile: MillingProfile,
): Record<string, PlacementIssue> {
    const footprints = new Map<string, Point[]>();
    for (const part of placed) footprints.set(part.side, worldFootprint(part, profile));
    const out: Record<string, PlacementIssue> = {};
    for (const part of placed) {
        const self = evaluatePlacedPart(part, profile);
        if (!self.ok) {
            out[part.side] = self;
            continue;
        }
        let issue: PlacementIssue = { ok: true };
        const mine = footprints.get(part.side) ?? [];
        for (const other of placed) {
            if (other.side === part.side) continue;
            if (polygonsOverlap(mine, footprints.get(other.side) ?? [])) {
                issue = { ok: false, reason: `Tool envelope overlaps the ${other.side} insole` };
                break;
            }
        }
        out[part.side] = issue;
    }
    return out;
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
        const margin = placementMarginMm(profile, wp.outline, rotationDeg);
        const auto = autoTranslate(profile, pocket, rotBb, margin);
        const tx = override?.tx ?? auto.tx;
        const ty = override?.ty ?? auto.ty;
        const skinClear = profile.materialHeightMm - 1;
        if (options?.validate !== false && wp.zMax > skinClear + 1e-6) {
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
            mesh: wp.mesh,
        };
        if (options?.validate !== false) {
            const fit = evaluatePlacedPart(placed, profile);
            if (!fit.ok) {
                throw new CncExportError(
                    "no_fit",
                    fit.reason ??
                        `Tool envelope does not fit pocket ${i + 1} (${partW.toFixed(1)}×${partH.toFixed(1)} mm, pocket ${pocket.width}×${pocket.length} mm, margin ${margin.toFixed(1)} mm)`,
                );
            }
        }
        out.push(placed);
    }
    if (options?.validate !== false && out.length > 1) {
        const all = evaluateAllPlacements(out, profile);
        for (const part of out) {
            const issue = all[part.side];
            if (issue && !issue.ok)
                throw new CncExportError("no_fit", issue.reason ?? "Tool envelopes overlap");
        }
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
