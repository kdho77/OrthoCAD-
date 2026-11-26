// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Side } from "@/types";
import { buildContourPass } from "./contour";
import { ENVELOPE_CLEARANCE_MM, footprintOverhangMm, polygonsOverlap, toolFootprintLocal } from "./envelope";
import {
    bboxOf,
    centroid,
    pointInPoly,
    resampleToSpacing,
    TOOLPATH_CHORD_DEV_MM,
    TOOLPATH_SPACING_MM,
} from "./polygon";
import { toolRadiusMm } from "./profile";
import { planCenterSpiral, zigzagXy } from "./spiral";
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
    // Pocket edges that lie on the table read as a table miss if the table is
    // checked first. Report the pocket, with the envelope that actually overflowed.
    const pocketReason = pocketOverflowReason(bb, pocket, clearance, placed.pocketIndex);
    if (pocketReason) return { ok: false, reason: pocketReason };
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
    if (placed.zMax > profile.materialHeightMm + 1e-6) {
        return {
            ok: false,
            reason: `Part max height ${placed.zMax.toFixed(1)} mm exceeds the block depth (${profile.materialHeightMm} mm)`,
        };
    }
    return { ok: true };
}

/**
 * Pocket-fit sentence. The span is the axis that is short of the usable opening
 * (pocket size minus the 1 mm clearance on both sides).
 */
function pocketOverflowReason(
    bb: { minX: number; maxX: number; minY: number; maxY: number },
    pocket: { x: number; y: number; width: number; length: number },
    clearance: number,
    pocketIndex: number,
): string | null {
    const xClear = Math.min(bb.minX - pocket.x, pocket.x + pocket.width - bb.maxX);
    const yClear = Math.min(bb.minY - pocket.y, pocket.y + pocket.length - bb.maxY);
    if (xClear >= clearance - 1e-4 && yClear >= clearance - 1e-4) return null;
    const alongY = yClear <= xClear;
    const span = alongY ? bb.maxY - bb.minY : bb.maxX - bb.minX;
    const usable = (alongY ? pocket.length : pocket.width) - 2 * clearance;
    return (
        `Tool envelope does not fit pocket ${pocketIndex + 1} ` +
        `(envelope ${span.toFixed(3)} mm, usable ${usable.toFixed(3)} mm)`
    );
}

const ROTATION_SEARCH_STEP_DEG = 0.5;
const ROTATION_SEARCH_MAX_DEG = 8;

function userLockedPlacement(override: PartPlacement | undefined): boolean {
    if (!override) return false;
    return override.tx !== undefined || override.ty !== undefined || override.rotationDeg !== undefined;
}

function rotationIs180(rotationDeg: number): boolean {
    return Math.abs((((rotationDeg % 360) + 360) % 360) - 180) < 1e-6;
}

/**
 * Outline auto-position, then replace each centered axis with the tool-envelope
 * bbox. Left/right and front/back stay on the outline margin.
 */
function poseCentredOnEnvelope(
    profile: MillingProfile,
    outline: Point[],
    pocket: { x: number; y: number; width: number; length: number },
    cx: number,
    cy: number,
    rotationDeg: number,
): { tx: number; ty: number } {
    const rotBb = rotatedLocalBbox(outline, cx, cy, rotationDeg);
    const margin = placementMarginMm(profile, outline, rotationDeg);
    const auto = autoTranslate(profile, pocket, rotBb, margin);
    if (profile.alignX !== "center" && profile.alignY !== "center") return auto;
    const footprint = toolFootprintLocal(outline, profile);
    if (footprint.length < 3) return auto;
    const envBb = rotatedLocalBbox(footprint, cx, cy, rotationDeg);
    const env = autoTranslate(profile, pocket, envBb, ENVELOPE_CLEARANCE_MM);
    return {
        tx: profile.alignX === "center" ? env.tx : auto.tx,
        ty: profile.alignY === "center" ? env.ty : auto.ty,
    };
}

/** Smallest gap from the envelope to the pocket on axes that are centered. */
function centeredClearanceMm(placed: PlacedPart, profile: MillingProfile): number {
    const pocket = profile.pockets[placed.pocketIndex];
    if (!pocket) return Number.NEGATIVE_INFINITY;
    const bb = bboxOf(worldFootprint(placed, profile));
    const gaps: number[] = [];
    if (profile.alignX === "center") {
        gaps.push(bb.minX - pocket.x, pocket.x + pocket.width - bb.maxX);
    }
    if (profile.alignY === "center") {
        gaps.push(bb.minY - pocket.y, pocket.y + pocket.length - bb.maxY);
    }
    if (gaps.length === 0) return Number.NEGATIVE_INFINITY;
    return Math.min(...gaps);
}

/**
 * Runs only after the outline-centered pose failed, and only when this side has
 * no tx/ty/rotation override and at least one axis is centered.
 * Step 1 recenters that axis on the envelope. Step 2 tries ±0.5° up to ±8°
 * and keeps the passing angle with the most clearance on the centered axis.
 */
function recoverCenteredPlacement(
    profile: MillingProfile,
    placed: PlacedPart,
    pocket: { x: number; y: number; width: number; length: number },
    override: PartPlacement | undefined,
): { tx: number; ty: number; rotationDeg: number } | null {
    if (userLockedPlacement(override)) return null;
    if (profile.alignX !== "center" && profile.alignY !== "center") return null;

    const step1 = poseCentredOnEnvelope(
        profile,
        placed.outline,
        pocket,
        placed.cx,
        placed.cy,
        placed.rotationDeg,
    );
    const recentered: PlacedPart = { ...placed, tx: step1.tx, ty: step1.ty };
    if (evaluatePlacedPart(recentered, profile).ok) {
        return { tx: step1.tx, ty: step1.ty, rotationDeg: placed.rotationDeg };
    }

    const base = placed.rotationDeg;
    const steps = Math.round(ROTATION_SEARCH_MAX_DEG / ROTATION_SEARCH_STEP_DEG);
    let best: { tx: number; ty: number; rotationDeg: number; clearance: number; abs: number } | null = null;
    for (let i = 1; i <= steps; i++) {
        const mag = i * ROTATION_SEARCH_STEP_DEG;
        for (const sign of [1, -1]) {
            const rotationDeg = base + sign * mag;
            const pose = poseCentredOnEnvelope(
                profile,
                placed.outline,
                pocket,
                placed.cx,
                placed.cy,
                rotationDeg,
            );
            const candidate: PlacedPart = {
                ...placed,
                ...pose,
                rotationDeg,
                rot180: rotationIs180(rotationDeg),
            };
            if (!evaluatePlacedPart(candidate, profile).ok) continue;
            const clearance = centeredClearanceMm(candidate, profile);
            const abs = Math.abs(sign * mag);
            if (
                !best ||
                clearance > best.clearance + 1e-6 ||
                (Math.abs(clearance - best.clearance) <= 1e-6 && abs < best.abs - 1e-9)
            ) {
                best = { tx: pose.tx, ty: pose.ty, rotationDeg, clearance, abs };
            }
        }
    }
    if (!best) return null;
    return { tx: best.tx, ty: best.ty, rotationDeg: best.rotationDeg };
}

/** Slot label for pocket 1 / pocket 2. Issues are stored here so two copies of one side do not collide. */
export function placementSlotKey(slotIndex: number): string {
    return `pocket ${slotIndex + 1}`;
}

/**
 * Per-slot fit, including no overlap between tool envelopes.
 * A unique side also keeps the historical `left` / `right` key. Two copies of one
 * side are distinguished only by slot.
 */
export function evaluateAllPlacements(
    placed: PlacedPart[],
    profile: MillingProfile,
): Record<string, PlacementIssue> {
    const footprints = placed.map((part) => worldFootprint(part, profile));
    const sideCount = new Map<string, number>();
    for (const part of placed) sideCount.set(part.side, (sideCount.get(part.side) ?? 0) + 1);
    const out: Record<string, PlacementIssue> = {};
    for (let i = 0; i < placed.length; i++) {
        const part = placed[i]!;
        const self = evaluatePlacedPart(part, profile);
        let issue: PlacementIssue = self;
        if (self.ok) {
            const mine = footprints[i] ?? [];
            for (let j = 0; j < placed.length; j++) {
                if (j === i) continue;
                if (polygonsOverlap(mine, footprints[j] ?? [])) {
                    issue = { ok: false, reason: `Tool envelope overlaps the ${placed[j]!.side} insole` };
                    break;
                }
            }
        }
        out[placementSlotKey(i)] = issue;
        if ((sideCount.get(part.side) ?? 0) === 1) out[part.side] = issue;
    }
    return out;
}

/** Today's half-pocket placement. Callers that need the size-15 block fallback use {@link placeWorkpieces}. */
export function placeWorkpiecesInPockets(
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
                const recovered = recoverCenteredPlacement(profile, placed, pocket, override);
                if (!recovered) {
                    throw new CncExportError(
                        "no_fit",
                        fit.reason ??
                            `Tool envelope does not fit pocket ${i + 1} (${partW.toFixed(1)}×${partH.toFixed(1)} mm, pocket ${pocket.width}×${pocket.length} mm, margin ${margin.toFixed(1)} mm)`,
                    );
                }
                placed.tx = recovered.tx;
                placed.ty = recovered.ty;
                placed.rotationDeg = recovered.rotationDeg;
                placed.rot180 = rotationIs180(recovered.rotationDeg);
            }
        }
        out.push(placed);
    }
    if (options?.validate !== false && out.length > 1) {
        const all = evaluateAllPlacements(out, profile);
        for (let i = 0; i < out.length; i++) {
            const issue = all[placementSlotKey(i)];
            if (issue && !issue.ok)
                throw new CncExportError("no_fit", issue.reason ?? "Tool envelopes overlap");
        }
    }
    return out;
}

/** Second slot may move toward the toe (+X, heel stays at X0) by at most this much. */
export const MAX_TOE_SLIDE_MM = 30;

/** Minimum distance from a tool sweep to the other insole outline. */
export const SWEEP_OUTLINE_CLEARANCE_MM = 1;

/**
 * The envelope bbox sits on the 1 mm line, but an emitted centreline can land a few
 * thousandths of a millimetre outside it. This pad is only for the whole-block pose.
 */
const BLOCK_EDGE_GCODE_PAD_MM = 0.01;

/**
 * Resampled surface chords may leave the planned path by {@link TOOLPATH_CHORD_DEV_MM}.
 * The gate adds that so the cut G-code stays at least {@link SWEEP_OUTLINE_CLEARANCE_MM} off.
 */
const SWEEP_GATE_MM = SWEEP_OUTLINE_CLEARANCE_MM + TOOLPATH_CHORD_DEV_MM;

interface SweepPolyline {
    pts: Point[];
    radius: number;
}

const sweepCache = new Map<string, SweepPolyline[]>();
const MAX_SWEEP_CACHE = 8;

function sweepKey(outline: Point[], profile: MillingProfile): string {
    let h = 2166136261;
    for (const p of outline) {
        h ^= Math.round(p.x * 1000);
        h = Math.imul(h, 16777619);
        h ^= Math.round(p.y * 1000);
        h = Math.imul(h, 16777619);
    }
    return [
        outline.length,
        h >>> 0,
        profile.strategy,
        profile.topOffsetMm,
        profile.sampleMm,
        profile.chordTolMm,
        profile.contourEnabled ? 1 : 0,
        profile.contourCutter.diameterMm,
        profile.toolpathCutter.diameterMm,
    ].join("|");
}

/** Local cutting centreline. Contour (lead-in, finish, lead-out) then the surface pass. */
function cuttingSweepsLocal(outline: Point[], profile: MillingProfile): SweepPolyline[] {
    const key = sweepKey(outline, profile);
    const hit = sweepCache.get(key);
    if (hit) return hit;
    const sweeps: SweepPolyline[] = [];
    if (profile.contourEnabled && outline.length >= 3) {
        const pass = buildContourPass(outline, profile);
        const radius = toolRadiusMm(profile.contourCutter.diameterMm);
        if (pass.leadIn.length > 1) sweeps.push({ pts: pass.leadIn, radius });
        if (pass.finish.length > 1) sweeps.push({ pts: pass.finish, radius });
        if (pass.leadOut.length > 1) sweeps.push({ pts: pass.leadOut, radius });
    }
    const radius = toolRadiusMm(profile.toolpathCutter.diameterMm);
    const raw =
        profile.strategy === "zigzag"
            ? zigzagXy(outline, profile, profile.toolpathCutter.type)
            : planCenterSpiral(outline, profile, profile.toolpathCutter.type).samples;
    const spaced = resampleToSpacing(raw, TOOLPATH_SPACING_MM, TOOLPATH_CHORD_DEV_MM, false);
    if (spaced.length > 1) sweeps.push({ pts: spaced, radius });
    sweepCache.set(key, sweeps);
    if (sweepCache.size > MAX_SWEEP_CACHE) {
        const oldest = sweepCache.keys().next().value;
        if (oldest !== undefined) sweepCache.delete(oldest);
    }
    return sweeps;
}

function worldSweeps(sweeps: SweepPolyline[], placed: PlacedPart): SweepPolyline[] {
    return sweeps.map((sweep) => ({
        radius: sweep.radius,
        pts: sweep.pts.map((p) => worldPoint(p, placed)),
    }));
}

function bboxGapOfSegment(
    a: Point,
    b: Point,
    bb: { minX: number; maxX: number; minY: number; maxY: number },
): number {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const dx = maxX < bb.minX ? bb.minX - maxX : minX > bb.maxX ? minX - bb.maxX : 0;
    const dy = maxY < bb.minY ? bb.minY - maxY : minY > bb.maxY ? minY - bb.maxY : 0;
    return Math.hypot(dx, dy);
}

function distPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / len2)) : 0;
    return Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
}

function segmentsProperlyIntersect(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
): boolean {
    const cross = (x1: number, y1: number, x2: number, y2: number) => x1 * y2 - y1 * x2;
    const d1 = cross(bx - ax, by - ay, cx - ax, cy - ay);
    const d2 = cross(bx - ax, by - ay, dx - ax, dy - ay);
    const d3 = cross(dx - cx, dy - cy, ax - cx, ay - cy);
    const d4 = cross(dx - cx, dy - cy, bx - cx, by - cy);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentSegmentDistance(a: Point, b: Point, c: Point, d: Point): number {
    if (segmentsProperlyIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) return 0;
    return Math.min(
        distPointToSegment(a.x, a.y, c.x, c.y, d.x, d.y),
        distPointToSegment(b.x, b.y, c.x, c.y, d.x, d.y),
        distPointToSegment(c.x, c.y, a.x, a.y, b.x, b.y),
        distPointToSegment(d.x, d.y, a.x, a.y, b.x, b.y),
    );
}

/** Distance from the cutter body (centreline offset by that pass's radius) to a filled outline. */
function minSweepToOutlineMm(sweeps: SweepPolyline[], outline: Point[], stopBelow?: number): number {
    if (outline.length < 3) return Number.NEGATIVE_INFINITY;
    const bb = bboxOf(outline);
    let min = Infinity;
    for (const sweep of sweeps) {
        const pts = sweep.pts;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1]!;
            const b = pts[i]!;
            const limit = stopBelow ?? min;
            if (bboxGapOfSegment(a, b, bb) - sweep.radius >= limit) continue;
            if (pointInPoly(a.x, a.y, outline) || pointInPoly(b.x, b.y, outline)) return -sweep.radius;
            let best = Infinity;
            for (let e = 0; e < outline.length; e++) {
                const c = outline[e]!;
                const d = outline[(e + 1) % outline.length]!;
                const dist = segmentSegmentDistance(a, b, c, d);
                if (dist < best) best = dist;
            }
            const clearance = best - sweep.radius;
            if (clearance < min) min = clearance;
            if (stopBelow !== undefined && min < stopBelow) return min;
        }
    }
    return min;
}

function envelopeInsideBlock(placed: PlacedPart, profile: MillingProfile): boolean {
    const table = tableBoundsMm(profile);
    const bb = bboxOf(worldFootprint(placed, profile));
    const clearance = ENVELOPE_CLEARANCE_MM;
    if (
        bb.minX < clearance - 1e-4 ||
        bb.maxX > table.width - clearance + 1e-4 ||
        bb.minY < clearance - 1e-4 ||
        bb.maxY > table.length - clearance + 1e-4
    ) {
        return false;
    }
    return placed.zMax <= profile.materialHeightMm + 1e-6;
}

/**
 * Heel X follows today's align rule on the full block. Y pushes the tool envelope
 * to one block edge. The inset is 1 mm plus {@link BLOCK_EDGE_GCODE_PAD_MM} so the
 * emitted centreline stays at least 1 mm off the block after the tool radius.
 */
function unslidBlockPose(
    profile: MillingProfile,
    outline: Point[],
    edge: "front" | "back",
    rotationDeg: number,
): { tx: number; ty: number; cx: number; cy: number } {
    const c = centroid(outline);
    const rotBb = rotatedLocalBbox(outline, c.x, c.y, rotationDeg);
    const edgeClearance = ENVELOPE_CLEARANCE_MM + BLOCK_EDGE_GCODE_PAD_MM;
    const margin = placementMarginMm(profile, outline, rotationDeg) + BLOCK_EDGE_GCODE_PAD_MM;
    const table = { x: 0, y: 0, width: profile.tableWidthMm, length: profile.tableLengthMm };
    const auto = autoTranslate(profile, table, rotBb, margin);
    const footprint = toolFootprintLocal(outline, profile);
    const envBb = rotatedLocalBbox(footprint.length >= 3 ? footprint : outline, c.x, c.y, rotationDeg);
    const ty =
        edge === "front" ? edgeClearance - envBb.minY : profile.tableLengthMm - edgeClearance - envBb.maxY;
    return { tx: auto.tx, ty, cx: c.x, cy: c.y };
}

/** Heel-edge X of the whole-block pose before the second slot slides toward the toe. */
export function wholeBlockUnslidTx(
    profile: MillingProfile,
    outline: Point[],
    rotationDeg = defaultRotationDeg(profile),
): number {
    return unslidBlockPose(profile, outline, "back", rotationDeg).tx;
}

function makePlaced(
    wp: CncWorkpiece,
    pocketIndex: number,
    rotationDeg: number,
    pose: { tx: number; ty: number; cx: number; cy: number },
): PlacedPart {
    return {
        side: wp.side,
        pocketIndex,
        rot180: rotationIs180(rotationDeg),
        rotationDeg,
        cx: pose.cx,
        cy: pose.cy,
        tx: pose.tx,
        ty: pose.ty,
        outline: wp.outline,
        heightmap: wp.heightmap,
        zMin: wp.zMin,
        zMax: wp.zMax,
        mesh: wp.mesh,
    };
}

function pairSweepClears(
    first: PlacedPart,
    second: PlacedPart,
    firstSweeps: SweepPolyline[],
    secondSweeps: SweepPolyline[],
    profile: MillingProfile,
): boolean {
    if (!envelopeInsideBlock(first, profile) || !envelopeInsideBlock(second, profile)) return false;
    const firstOutline = transformOutline(first.outline, first);
    const secondOutline = transformOutline(second.outline, second);
    const toSecond = minSweepToOutlineMm(worldSweeps(firstSweeps, first), secondOutline, SWEEP_GATE_MM);
    if (toSecond < SWEEP_GATE_MM) return false;
    const toFirst = minSweepToOutlineMm(worldSweeps(secondSweeps, second), firstOutline, SWEEP_GATE_MM);
    return toFirst >= SWEEP_GATE_MM;
}

function ceilHundredth(value: number): number {
    if (value <= 1e-9) return 0;
    return Math.ceil(value * 100 - 1e-9) / 100;
}

/**
 * Whole block, feet on opposite Y edges, heel at X0. One slot then slides toward
 * the toe by the smallest amount in `[0, MAX_TOE_SLIDE_MM]` whose sweeps stay
 * {@link SWEEP_OUTLINE_CLEARANCE_MM} off the other outline. Slot 2 is tried
 * first. A pair of the same physical foot can need that offset on slot 1
 * instead, because slot 2's heel is already on the block edge. No added rotation.
 */
function placePairOnWholeBlock(profile: MillingProfile, parts: CncWorkpiece[]): PlacedPart[] {
    const firstWp = parts[0];
    const secondWp = parts[1];
    if (!firstWp || !secondWp) {
        throw new CncExportError("no_fit", "Milling block fallback needs two insoles");
    }
    const skinClear = profile.materialHeightMm - 1;
    for (const wp of [firstWp, secondWp]) {
        if (wp.zMax > skinClear + 1e-6) {
            throw new CncExportError(
                "too_tall",
                `Part max Z ${wp.zMax.toFixed(3)} mm exceeds material height − 1 (${skinClear} mm)`,
            );
        }
    }
    const rotationDeg = defaultRotationDeg(profile);
    const firstPose = unslidBlockPose(profile, firstWp.outline, "front", rotationDeg);
    const secondPose = unslidBlockPose(profile, secondWp.outline, "back", rotationDeg);
    const firstSweeps = cuttingSweepsLocal(firstWp.outline, profile);
    const secondSweeps = cuttingSweepsLocal(secondWp.outline, profile);
    const pairAt = (slideMm: number, slot: 0 | 1): [PlacedPart, PlacedPart] => {
        const first = makePlaced(firstWp, 0, rotationDeg, {
            ...firstPose,
            tx: firstPose.tx + (slot === 0 ? slideMm : 0),
        });
        const second = makePlaced(secondWp, 1, rotationDeg, {
            ...secondPose,
            tx: secondPose.tx + (slot === 1 ? slideMm : 0),
        });
        return [first, second];
    };
    const clears = (slideMm: number, slot: 0 | 1) => {
        const [a, b] = pairAt(slideMm, slot);
        return pairSweepClears(a, b, firstSweeps, secondSweeps, profile);
    };

    const coarse = 1;
    let prevFail = -1;
    let passAt: number | null = null;
    let passSlot: 0 | 1 = 1;
    for (let s = 0; s <= MAX_TOE_SLIDE_MM + 1e-9; s += coarse) {
        const slide = Math.min(MAX_TOE_SLIDE_MM, Math.round(s * 1000) / 1000);
        if (clears(slide, 1)) {
            passAt = slide;
            passSlot = 1;
            break;
        }
        if (clears(slide, 0)) {
            passAt = slide;
            passSlot = 0;
            break;
        }
        prevFail = slide;
        if (slide >= MAX_TOE_SLIDE_MM - 1e-9) break;
    }
    if (passAt === null) {
        throw new CncExportError(
            "no_fit",
            `Tool sweep comes within ${SWEEP_OUTLINE_CLEARANCE_MM.toFixed(1)} mm of an insole outline ` +
                `with a toe slide up to ${MAX_TOE_SLIDE_MM.toFixed(0)} mm. Refusing to cut closer.`,
        );
    }
    if (passAt === 0) return pairAt(0, 1);

    let lo = prevFail;
    let hi = passAt;
    for (let i = 0; i < 16 && hi - lo > 0.005; i++) {
        const mid = (lo + hi) / 2;
        if (clears(mid, passSlot)) hi = mid;
        else lo = mid;
    }
    let best = Math.min(MAX_TOE_SLIDE_MM, ceilHundredth(hi));
    while (best <= passAt + 1e-9 && !clears(best, passSlot)) {
        best = Math.min(MAX_TOE_SLIDE_MM, ceilHundredth(best + 0.01));
    }
    if (!clears(best, passSlot)) best = passAt;
    return pairAt(best, passSlot);
}

function canUseWholeBlock(
    profile: MillingProfile,
    parts: CncWorkpiece[],
    overrides: PartPlacement[],
): boolean {
    if (!profile.insolesHorizontal) return false;
    if (parts.length !== 1 && parts.length !== 2) return false;
    return !overrides.some((override) => userLockedPlacement(override));
}

/**
 * One foot on the front edge of the block, heel at X0, no toe slide.
 * The same inset as a pair's unslid pose. Returns null when that pose leaves
 * the table, so the caller keeps the pocket guard's refusal.
 */
function placeSingleOnWholeBlock(profile: MillingProfile, wp: CncWorkpiece): PlacedPart[] | null {
    const rotationDeg = defaultRotationDeg(profile);
    const pose = unslidBlockPose(profile, wp.outline, "front", rotationDeg);
    const placed = makePlaced(wp, 0, rotationDeg, pose);
    if (!envelopeInsideBlock(placed, profile)) return null;
    return [placed];
}

/**
 * Half-pocket placement first. A pair or a single foot that already fits is
 * returned unchanged. Pocket overflow or envelope overlap falls back to the
 * whole block. One foot uses the front edge and does not slide.
 */
export function placeWorkpieces(
    profile: MillingProfile,
    parts: CncWorkpiece[],
    overrides: PartPlacement[] = [],
    options?: { validate?: boolean },
): PlacedPart[] {
    if (options?.validate === false) return placeWorkpiecesInPockets(profile, parts, overrides, options);
    try {
        return placeWorkpiecesInPockets(profile, parts, overrides, options);
    } catch (error) {
        if (!(error instanceof CncExportError) || error.code !== "no_fit") throw error;
        if (!canUseWholeBlock(profile, parts, overrides)) throw error;
        if (parts.length === 1) {
            const wp = parts[0];
            if (!wp || profile.pockets.length === 0) throw error;
            const single = placeSingleOnWholeBlock(profile, wp);
            if (!single) throw error;
            return single;
        }
        return placePairOnWholeBlock(profile, parts);
    }
}

export function defaultPlacements(profile: MillingProfile, parts: CncWorkpiece[]): PartPlacement[] {
    return placeWorkpieces(profile, parts).map((p) => ({
        side: p.side,
        tx: p.tx,
        ty: p.ty,
        rotationDeg: p.rotationDeg,
    }));
}
