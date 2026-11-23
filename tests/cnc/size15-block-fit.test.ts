// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { workpiecesFromDesign } from "@/lib/cnc/compose";
import { generateCncJob } from "@/lib/cnc/export";
import { internalSideForPhysicalFoot, millExportSides } from "@/lib/cnc/order-sides";
import {
    machineXY,
    placeWorkpieces,
    placeWorkpiecesInPockets,
    wholeBlockUnslidTx,
} from "@/lib/cnc/placement";
import { bboxOf, pointInPoly } from "@/lib/cnc/polygon";
import { renderToolpathPreview } from "@/lib/cnc/preview";
import { cloneProfile, IDAHO_PROFILE, toolRadiusMm } from "@/lib/cnc/profile";
import type { CncJobResult, MillingProfile, PlacedPart, Point } from "@/lib/cnc/types";
import { CncExportError } from "@/lib/cnc/types";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import type { DesignState, Side } from "@/types";
import { cncPairGcodeFilename, SAMPLE_TOP_TEMPLATE_ASSET_ID } from "../../vertex/shared/export-filename";
import { encodePng } from "../helpers/render-png";
import { loadSampleTop, syntheticWorkpiece } from "./helpers";

const SIZES = [13, 13.5, 14, 15] as const;
const PASSING_SIZES = [9, 12, 13] as const;

function sideRank(side: string): number {
    if (side === "left") return 0;
    if (side === "right") return 1;
    return 2;
}

function orderedParts(placed: PlacedPart[]): PlacedPart[] {
    return placed.slice().sort((a, b) => sideRank(a.side) - sideRank(b.side));
}

interface CutPoly {
    slot: number;
    kind: "surface" | "perimeter";
    pts: Point[];
}

function parseCuts(gcode: string): { polys: CutPoly[]; moves: Point[] } {
    const polys: CutPoly[] = [];
    const moves: Point[] = [];
    let surfaceSlot = -1;
    let perimeterSlot = -1;
    let active: { slot: number; kind: "surface" | "perimeter" } | null = null;
    let current: Point[] | null = null;
    let x = 0;
    let y = 0;
    const flush = () => {
        if (current && current.length > 1 && active) {
            polys.push({ slot: active.slot, kind: active.kind, pts: current });
        }
        current = null;
    };
    for (const line of gcode.split(/\n/)) {
        if (line.startsWith("; surface ")) {
            flush();
            surfaceSlot += 1;
            active = { slot: surfaceSlot, kind: "surface" };
            current = [];
            continue;
        }
        if (line.startsWith("; perimeter ")) {
            flush();
            perimeterSlot += 1;
            active = { slot: perimeterSlot, kind: "perimeter" };
            current = [];
            continue;
        }
        if (!line.startsWith("G0") && !line.startsWith("G1")) continue;
        const xm = line.match(/X(-?\d+(?:\.\d+)?)/);
        const ym = line.match(/Y(-?\d+(?:\.\d+)?)/);
        if (xm) x = Number(xm[1]);
        if (ym) y = Number(ym[1]);
        moves.push({ x, y });
        if (line.startsWith("G0")) {
            flush();
            if (active) current = [];
            continue;
        }
        if (active) {
            if (!current) current = [];
            current.push({ x, y });
        }
    }
    flush();
    return { polys, moves };
}

function distPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / len2)) : 0;
    return Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
}

function segmentsCross(
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

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
    if (segmentsCross(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) return 0;
    return Math.min(
        distPointToSegment(a.x, a.y, c.x, c.y, d.x, d.y),
        distPointToSegment(b.x, b.y, c.x, c.y, d.x, d.y),
        distPointToSegment(c.x, c.y, a.x, a.y, b.x, b.y),
        distPointToSegment(d.x, d.y, a.x, a.y, b.x, b.y),
    );
}

function sweepClearanceMm(polys: CutPoly[], outlines: Point[][], profile: MillingProfile): number {
    const surfaceR = toolRadiusMm(profile.toolpathCutter.diameterMm);
    const contourR = toolRadiusMm(profile.contourCutter.diameterMm);
    let min = Infinity;
    for (let i = 0; i < outlines.length; i++) {
        const outline = outlines[i];
        if (!outline || outline.length < 3) continue;
        const bb = bboxOf(outline);
        for (const poly of polys) {
            if (poly.slot === i || poly.pts.length < 2) continue;
            const radius = poly.kind === "perimeter" ? contourR : surfaceR;
            for (let k = 1; k < poly.pts.length; k++) {
                const a = poly.pts[k - 1]!;
                const b = poly.pts[k]!;
                const minX = Math.min(a.x, b.x);
                const maxX = Math.max(a.x, b.x);
                const minY = Math.min(a.y, b.y);
                const maxY = Math.max(a.y, b.y);
                const dx = maxX < bb.minX ? bb.minX - maxX : minX > bb.maxX ? minX - bb.maxX : 0;
                const dy = maxY < bb.minY ? bb.minY - maxY : minY > bb.maxY ? minY - bb.maxY : 0;
                if (Math.hypot(dx, dy) - radius >= min) continue;
                if (pointInPoly(a.x, a.y, outline) || pointInPoly(b.x, b.y, outline)) return -radius;
                let best = Infinity;
                for (let e = 0; e < outline.length; e++) {
                    const c = outline[e]!;
                    const d = outline[(e + 1) % outline.length]!;
                    const dist = segmentDistance(a, b, c, d);
                    if (dist < best) best = dist;
                }
                const clearance = best - radius;
                if (clearance < min) min = clearance;
            }
        }
    }
    return min;
}

function machineOutlines(placed: PlacedPart[], profile: MillingProfile): Point[][] {
    return orderedParts(placed).map((part) => part.outline.map((p) => machineXY(p, part, profile)));
}

function poseKey(placed: PlacedPart[]): Array<[number, number, number, number, string]> {
    return placed.map((part) => [part.tx, part.ty, part.rotationDeg, part.pocketIndex, part.side]);
}

function designAt(menSize: number, assetId?: string): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "milling_3axis";
    design.sizeSystem = "us";
    design.usMenSize = menSize;
    if (assetId) {
        if (design.base) design.base = { ...design.base, assetId };
        if (design.paired?.leftBase) design.paired.leftBase = { ...design.paired.leftBase, assetId };
        if (design.paired?.rightBase) design.paired.rightBase = { ...design.paired.rightBase, assetId };
    }
    return design;
}

function loader(raw: BufferGeometry): (side: Side) => Promise<BufferGeometry> {
    return async (side) => {
        const geo = raw.clone();
        if (side !== "right") return geo;
        const mirrored = mirrorGeometry(geo);
        geo.dispose();
        return mirrored;
    };
}

function disposeParts(parts: { mesh?: { dispose: () => void } }[]): void {
    for (const part of parts) part.mesh?.dispose();
}

function drawSegments(
    rgb: Uint8Array,
    width: number,
    height: number,
    profile: MillingProfile,
    pts: Point[],
    color: [number, number, number],
): void {
    const pad = 28;
    const s = Math.min((width - 2 * pad) / profile.tableWidthMm, (height - 2 * pad) / profile.tableLengthMm);
    const ox = pad + (width - 2 * pad - s * profile.tableWidthMm) / 2;
    const oy = pad + (height - 2 * pad - s * profile.tableLengthMm) / 2;
    const toPx = (p: Point): [number, number] => [ox + p.x * s, height - (oy + p.y * s)];
    const stamp = (x: number, y: number) => {
        const px = Math.round(x);
        const py = Math.round(y);
        if (px < 0 || py < 0 || px >= width || py >= height) return;
        const i = (py * width + px) * 3;
        rgb[i] = color[0];
        rgb[i + 1] = color[1];
        rgb[i + 2] = color[2];
    };
    for (let i = 1; i < pts.length; i++) {
        const a = toPx(pts[i - 1]!);
        const b = toPx(pts[i]!);
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
        for (let t = 0; t <= steps; t++) {
            const u = t / steps;
            stamp(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
        }
    }
    if (pts.length > 2) {
        const a = toPx(pts[pts.length - 1]!);
        const b = toPx(pts[0]!);
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
        for (let t = 0; t <= steps; t++) {
            const u = t / steps;
            stamp(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
        }
    }
}

function writeLayout(name: string, gcode: string, profile: MillingProfile, outlines: Point[][]): void {
    const dir = process.env.CNC_LAYOUT_ARTIFACT_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${name}.gcode`), gcode);
    const preview = renderToolpathPreview(gcode, profile, 1100, 780);
    const colors: Array<[number, number, number]> = [
        [255, 220, 60],
        [255, 120, 40],
    ];
    outlines.forEach((outline, index) => {
        drawSegments(
            preview.rgb,
            preview.width,
            preview.height,
            profile,
            outline,
            colors[index] ?? colors[0]!,
        );
    });
    writeFileSync(resolve(dir, `${name}.png`), encodePng(preview.width, preview.height, preview.rgb));
}

describe("EVA CNC size-15 fit and single-side milling", () => {
    test("a pair that fits the half pockets is byte-identical to today's placement", () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const left = syntheticWorkpiece(profile, "left");
        const right = syntheticWorkpiece(profile, "right");
        right.outline = left.outline.map((point) => ({ ...point }));
        const legacy = placeWorkpiecesInPockets(profile, [left, right]);
        const next = placeWorkpieces(profile, [left, right]);
        expect(poseKey(next)).toEqual(poseKey(legacy));
        const auto = generateCncJob(profile, [left, right]);
        const locked = generateCncJob(profile, [left, right], {
            placements: legacy.map((part) => ({
                side: part.side,
                tx: part.tx,
                ty: part.ty,
                rotationDeg: part.rotationDeg,
            })),
        });
        expect(auto.gcode).toBe(locked.gcode);
        expect(auto.gcode).toContain("; foot: left+right");
    });

    test("mill_side omitted and LR keep order sides; RR and LL copy the physical foot", async () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const sample = designAt(9);
        expect(sample.base?.assetId).toBe(SAMPLE_TOP_TEMPLATE_ASSET_ID);
        const orderSides = millExportSides(sample);
        expect(millExportSides(sample, undefined, "LR")).toEqual(orderSides);
        expect(millExportSides(sample, undefined, null)).toEqual(orderSides);
        expect(millExportSides(sample, undefined, "RR")).toEqual(["left", "left"]);
        expect(millExportSides(sample, undefined, "LL")).toEqual(["right", "right"]);
        expect(internalSideForPhysicalFoot(sample, "right")).toBe("left");
        expect(internalSideForPhysicalFoot(sample, "left")).toBe("right");

        const clinical = designAt(9, "clinical-scan");
        expect(millExportSides(clinical, undefined, "RR")).toEqual(["right", "right"]);
        expect(millExportSides(clinical, undefined, "LL")).toEqual(["left", "left"]);
        expect(internalSideForPhysicalFoot(clinical, "right")).toBe("right");
        expect(internalSideForPhysicalFoot(clinical, "left")).toBe("left");
        expect(millExportSides(clinical)).toEqual(millExportSides(clinical, undefined, "LR"));

        expect(
            cncPairGcodeFilename({
                firstName: "Fixture",
                lastName: "Sample",
                material: "EVA",
                sides: orderSides,
            }),
        ).toBe("Fixture_Sample_EVA_LR.gcode");
        expect(
            cncPairGcodeFilename({
                firstName: "Fixture",
                lastName: "Sample",
                material: "EVA",
                sides: orderSides,
                millSide: "LR",
            }),
        ).toBe("Fixture_Sample_EVA_LR.gcode");

        const raw = await loadSampleTop();
        const load = loader(raw);
        const left = await workpiecesFromDesign(sample, ["left"], profile, load);
        const right = await workpiecesFromDesign(sample, ["right"], profile, load);
        const rr = await workpiecesFromDesign(
            sample,
            millExportSides(sample, undefined, "RR"),
            profile,
            load,
        );
        const clinicalRr = await workpiecesFromDesign(
            clinical,
            millExportSides(clinical, undefined, "RR"),
            profile,
            load,
        );
        expect(rr.map((part) => part.side)).toEqual(["left", "left"]);
        expect(clinicalRr.map((part) => part.side)).toEqual(["right", "right"]);
        const sig = (pts: Point[]) => pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(";");
        const leftSig = sig(left[0]?.outline ?? []);
        const rightSig = sig(right[0]?.outline ?? []);
        expect(leftSig).not.toBe(rightSig);
        expect(sig(rr[0]?.outline ?? [])).toBe(leftSig);
        expect(sig(rr[1]?.outline ?? [])).toBe(leftSig);
        expect(sig(clinicalRr[0]?.outline ?? [])).toBe(rightSig);
        disposeParts([...left, ...right, ...rr, ...clinicalRr]);
        raw.dispose();
    }, 120_000);

    test("M13 through M15 place, and M15 RR/LL mill the physical foot", async () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        expect(toolRadiusMm(profile.toolpathCutter.diameterMm)).toBe(5);
        expect(toolRadiusMm(profile.contourCutter.diameterMm)).toBe(5);
        const raw = await loadSampleTop();
        const load = loader(raw);
        const rows: Array<Record<string, number | string | boolean>> = [];

        const runPair = async (
            menSize: number,
            millSide: "LR" | "RR" | "LL" | undefined,
            artifact: string | null,
        ): Promise<{ job: CncJobResult; clearanceMm: number; slideMm: number; fallback: boolean }> => {
            const design = designAt(menSize);
            const sides = millExportSides(design, undefined, millSide);
            const parts = await workpiecesFromDesign(design, sides, profile, load);
            expect(parts.length).toBe(2);
            let fallback = false;
            try {
                placeWorkpiecesInPockets(profile, parts);
            } catch (error) {
                expect(error).toBeInstanceOf(CncExportError);
                expect((error as CncExportError).code).toBe("no_fit");
                fallback = true;
            }
            const legacy = fallback ? null : placeWorkpiecesInPockets(profile, parts);
            const placed = placeWorkpieces(profile, parts);
            expect(placed).toHaveLength(2);
            if (legacy) expect(poseKey(placed)).toEqual(poseKey(legacy));
            const slideMm = fallback
                ? Math.max(
                      ...placed.map(
                          (part) => part.tx - wholeBlockUnslidTx(profile, part.outline, part.rotationDeg),
                      ),
                  )
                : 0;
            expect(slideMm).toBeGreaterThanOrEqual(-1e-6);
            expect(slideMm).toBeLessThanOrEqual(30 + 1e-6);
            const job = generateCncJob(profile, parts);
            if (legacy) {
                const locked = generateCncJob(profile, parts, {
                    placements: legacy.map((part) => ({
                        side: part.side,
                        tx: part.tx,
                        ty: part.ty,
                        rotationDeg: part.rotationDeg,
                    })),
                });
                expect(job.gcode).toBe(locked.gcode);
            }
            const parsed = parseCuts(job.gcode);
            const table = { width: profile.tableWidthMm, length: profile.tableLengthMm };
            expect(parsed.moves.length).toBeGreaterThan(10);
            for (const move of parsed.moves) {
                expect(move.x).toBeGreaterThanOrEqual(-1e-3);
                expect(move.x).toBeLessThanOrEqual(table.width + 1e-3);
                expect(move.y).toBeGreaterThanOrEqual(-1e-3);
                expect(move.y).toBeLessThanOrEqual(table.length + 1e-3);
            }
            const outlines = machineOutlines(job.placed, profile);
            const clearanceMm = sweepClearanceMm(parsed.polys, outlines, profile);
            expect(clearanceMm).toBeGreaterThanOrEqual(1);
            expect(parsed.polys.some((poly) => poly.slot === 0)).toBe(true);
            expect(parsed.polys.some((poly) => poly.slot === 1)).toBe(true);
            if (artifact) writeLayout(artifact, job.gcode, profile, outlines);
            disposeParts(parts);
            rows.push({
                size: menSize,
                millSide: millSide ?? "omitted",
                fallback,
                slideMm: +slideMm.toFixed(2),
                clearanceMm: +clearanceMm.toFixed(3),
                lengthMm: +insoleLayoutForUsMenSize(menSize).lengthMm.toFixed(2),
                widthMm: +insoleLayoutForUsMenSize(menSize).widthMm.toFixed(2),
            });
            return { job, clearanceMm, slideMm, fallback };
        };

        for (const menSize of PASSING_SIZES) {
            const design = designAt(menSize);
            const parts = await workpiecesFromDesign(design, ["left", "right"], profile, load);
            let passed = true;
            try {
                const legacy = placeWorkpiecesInPockets(profile, parts);
                const next = placeWorkpieces(profile, parts);
                expect(poseKey(next)).toEqual(poseKey(legacy));
            } catch (error) {
                expect(error).toBeInstanceOf(CncExportError);
                passed = false;
            }
            disposeParts(parts);
            if (menSize < 13) expect(passed).toBe(true);
        }

        for (const menSize of SIZES) {
            const result = await runPair(menSize, "LR", menSize === 15 ? "Fixture_Sample_EVA_LR" : null);
            expect(result.clearanceMm).toBeGreaterThanOrEqual(1);
            expect(result.slideMm).toBeLessThanOrEqual(30);
        }

        const sample = designAt(15);
        const rrSides = millExportSides(sample, undefined, "RR");
        const llSides = millExportSides(sample, undefined, "LL");
        expect(rrSides).toEqual(["left", "left"]);
        expect(llSides).toEqual(["right", "right"]);
        const rr = await runPair(15, "RR", "Fixture_Sample_EVA_RR");
        const ll = await runPair(15, "LL", "Fixture_Sample_EVA_LL");
        expect(rr.job.gcode).toContain("; foot: left+left");
        expect(ll.job.gcode).toContain("; foot: right+right");
        expect(rr.job.placed.every((part) => part.side === "left")).toBe(true);
        expect(ll.job.placed.every((part) => part.side === "right")).toBe(true);

        const dir = process.env.CNC_LAYOUT_ARTIFACT_DIR;
        if (dir) {
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, "clearances.json"), JSON.stringify(rows, null, 2));
        }
        console.log(`SIZE15_CLEARANCE ${JSON.stringify(rows)}`);
        raw.dispose();
    }, 600_000);
});
