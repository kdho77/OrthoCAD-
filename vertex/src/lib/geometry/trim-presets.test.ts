// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, type Vector3 } from "three";
import { binaryStlToGeometry, geometryToBinarySTL } from "@/lib/geometry/stl";
import { buildTrimPresetCurve, TRIM_PRESET_LANDMARK_U } from "@/lib/geometry/trim-presets";
import {
    clipGeometryToOutline,
    extractMeshOutline,
    sampleDefaultOutline,
    type TrimlineCurve,
} from "@/lib/geometry/trimline";
import { cncToolpath } from "@/lib/kiri/cnc";
import { GcodeBuilder } from "@/lib/kiri/gcode";

describe("trim presets", () => {
    test("sulcus shortens distal AP vs full", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const full = buildTrimPresetCurve("full", { lengthMm, widthMm });
        const sulcus = buildTrimPresetCurve("sulcus", { lengthMm, widthMm });
        const maxFull = Math.max(...full.points.map((p) => p.x));
        const maxSulcus = Math.max(...sulcus.points.map((p) => p.x));
        expect(maxSulcus).toBeLessThan(maxFull - 5);
    });

    test("met-head is shorter than sulcus", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const sulcus = buildTrimPresetCurve("sulcus", { lengthMm, widthMm });
        const met = buildTrimPresetCurve("met_head", { lengthMm, widthMm });
        const maxSulcus = Math.max(...sulcus.points.map((p) => p.x));
        const maxMet = Math.max(...met.points.map((p) => p.x));
        expect(maxMet).toBeLessThan(maxSulcus);
    });

    test("respects ±3 mm distal offset", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const base = sampleDefaultOutline(lengthMm, widthMm);
        const a = buildTrimPresetCurve("sulcus", {
            lengthMm,
            widthMm,
            baseCurve: base,
            distalApOffsetMm: -3,
        });
        const b = buildTrimPresetCurve("sulcus", { lengthMm, widthMm, baseCurve: base, distalApOffsetMm: 3 });
        const maxA = Math.max(...a.points.map((p) => p.x));
        const maxB = Math.max(...b.points.map((p) => p.x));
        expect(maxB - maxA).toBeGreaterThanOrEqual(5);
    });
});

function lengthOf(points: Vector3[]): { axis: "x" | "y"; heel: number; toe: number; span: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }
    if (maxX - minX >= maxY - minY) return { axis: "x", heel: minX, toe: maxX, span: maxX - minX };
    return { axis: "y", heel: minY, toe: maxY, span: maxY - minY };
}

function coord(p: Vector3, axis: "x" | "y"): number {
    return axis === "x" ? p.x : p.y;
}

function maxEdgeMm(points: Vector3[]): number {
    let max = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        max = Math.max(max, Math.hypot(a.x - b.x, a.y - b.y));
    }
    return max;
}

function segmentsCross(a: Vector3, b: Vector3, c: Vector3, d: Vector3): boolean {
    const orient = (p: Vector3, q: Vector3, r: Vector3) =>
        Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) return false;
    return o1 !== o2 && o3 !== o4;
}

function selfIntersects(points: Vector3[]): boolean {
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        for (let j = i + 1; j < n; j++) {
            const sharesVertex = j === i || j === (i + 1) % n || (j + 1) % n === i || (i + 1) % n === j;
            if (sharesVertex) continue;
            // Closing edge meets the first edge at a vertex.
            if ((i + 1) % n === 0 && j === 0) continue;
            if (segmentsCross(a, b, points[j]!, points[(j + 1) % n]!)) return true;
        }
    }
    return false;
}

function pointInPolygon(x: number, y: number, poly: Vector3[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i]!.y;
        const yj = poly[j]!.y;
        const xi = poly[i]!.x;
        const xj = poly[j]!.x;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** Indexed foot slab. Medial is the narrower border: −Y left, +Y right. */
function makeFoot(opts?: {
    lengthMm?: number;
    widthMm?: number;
    heel?: number;
    side?: "left" | "right";
    lengthAxis?: "x" | "y";
}): BufferGeometry {
    const lengthMm = opts?.lengthMm ?? 260;
    const widthMm = opts?.widthMm ?? 92;
    const heel = opts?.heel ?? 0;
    const side = opts?.side ?? "left";
    const lengthAxis = opts?.lengthAxis ?? "x";
    const nx = 36;
    const ny = 12;
    const positions: number[] = [];
    const indices: number[] = [];
    const at = (i: number, j: number) => i * (ny + 1) + j;
    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const along = heel + u * lengthMm;
        const hw = (widthMm / 2) * (0.42 + 0.58 * Math.sin(Math.PI * u));
        for (let j = 0; j <= ny; j++) {
            const v = (j / ny) * 2 - 1;
            const narrow = v < 0 ? 0.72 : 1;
            let across = v * hw * narrow;
            if (side === "right") across = -across;
            const x = lengthAxis === "y" ? across : along;
            const y = lengthAxis === "y" ? along : across;
            positions.push(x, y, 4);
        }
    }
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1));
            indices.push(at(i, j), at(i + 1, j + 1), at(i, j + 1));
        }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    g.setIndex(indices);
    g.computeBoundingBox();
    return g;
}

function meshBounds(geometry: BufferGeometry): { minX: number; maxX: number; minY: number; maxY: number } {
    const pos = geometry.getAttribute("position");
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        minX = Math.min(minX, pos.getX(i));
        maxX = Math.max(maxX, pos.getX(i));
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
    }
    return { minX, maxX, minY, maxY };
}

function gcodeOf(geometry: BufferGeometry): string {
    const moves = cncToolpath(geometry, {
        toolDiameterMm: 6,
        stepoverFraction: 1,
        clearanceMm: 5,
        sampleMm: 4,
    });
    const g = new GcodeBuilder();
    for (const move of moves) {
        if (move.type === "cut") g.cutTo(move.x, move.y, move.z, 1200);
        else g.travel(move.x, move.y, move.z, 4000);
    }
    return g.toString();
}

function gcodeCutMax(gcode: string, axis: "X" | "Y"): number {
    let max = -Infinity;
    for (const line of gcode.split("\n")) {
        if (!line.startsWith("G1 ")) continue;
        const match = new RegExp(`${axis}(-?\\d+(?:\\.\\d+)?)`).exec(line);
        if (!match) continue;
        max = Math.max(max, Number(match[1]));
    }
    return max;
}

describe("sulcus and met-head 3/4 trim", () => {
    test("full preset keeps the base curve byte-for-byte", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const centered = sampleDefaultOutline(lengthMm, widthMm);
        for (const p of centered.points) p.x -= lengthMm / 2;
        for (const base of [sampleDefaultOutline(lengthMm, widthMm), centered]) {
            const full = buildTrimPresetCurve("full", { lengthMm, widthMm, baseCurve: base });
            expect(full.points.length).toBe(base.points.length);
            for (let i = 0; i < base.points.length; i++) {
                expect(full.points[i]!.x).toBe(base.points[i]!.x);
                expect(full.points[i]!.y).toBe(base.points[i]!.y);
                expect(full.points[i]!.z).toBe(base.points[i]!.z);
            }
        }
    });

    test("cut is measured from the outline heel when the frame is not x = 0", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const base = sampleDefaultOutline(lengthMm, widthMm);
        const heel = -40;
        for (const p of base.points) p.x += heel;
        for (const preset of ["sulcus", "met_head"] as const) {
            const curve = buildTrimPresetCurve(preset, {
                lengthMm: 400,
                widthMm,
                baseCurve: base,
            });
            const frame = lengthOf(curve.points);
            const landmark = heel + TRIM_PRESET_LANDMARK_U[preset] * lengthMm;
            expect(frame.axis).toBe("x");
            expect(frame.heel).toBeCloseTo(heel, 3);
            expect(frame.toe).toBeCloseTo(landmark, 3);
            // 400 * 0.66 is past this toe. That is the old x = 0 assumption.
            expect(frame.toe).toBeLessThan(400 * TRIM_PRESET_LANDMARK_U[preset] - 20);
        }
    });

    test("sulcus and met-head are closed, simple, and rounded for both feet", () => {
        for (const side of ["left", "right"] as const) {
            for (const preset of ["sulcus", "met_head"] as const) {
                const heel = side === "left" ? -130 : 15;
                const mesh = makeFoot({ heel, side, lengthMm: 260, widthMm: 92 });
                const outline = extractMeshOutline(mesh, 48);
                expect(outline, `${side} outline`).toBeTruthy();
                const curve = buildTrimPresetCurve(preset, {
                    lengthMm: 180,
                    widthMm: 70,
                    baseCurve: outline!,
                });
                const meshFrame = lengthOf(outline!.points);
                const cutFrame = lengthOf(curve.points);
                const landmark = meshFrame.heel + TRIM_PRESET_LANDMARK_U[preset] * meshFrame.span;
                expect(cutFrame.axis, side).toBe(meshFrame.axis);
                expect(cutFrame.heel, `${preset} ${side} heel`).toBeCloseTo(meshFrame.heel, 0);
                expect(Math.abs(cutFrame.toe - landmark), `${preset} ${side} landmark`).toBeLessThan(1.5);
                expect(maxEdgeMm(curve.points), `${preset} ${side} spike`).toBeLessThan(40);
                expect(selfIntersects(curve.points), `${preset} ${side} crossing`).toBe(false);
                const atApex = curve.points.filter(
                    (p) => Math.abs(coord(p, cutFrame.axis) - cutFrame.toe) < 0.05,
                );
                expect(atApex.length, `${preset} ${side} round`).toBe(1);

                const heelPoint =
                    meshFrame.axis === "x"
                        ? { x: meshFrame.heel + meshFrame.span * 0.12, y: 0 }
                        : { x: 0, y: meshFrame.heel + meshFrame.span * 0.12 };
                const toePoint =
                    meshFrame.axis === "x"
                        ? { x: meshFrame.heel + meshFrame.span * 0.94, y: 0 }
                        : { x: 0, y: meshFrame.heel + meshFrame.span * 0.94 };
                expect(
                    pointInPolygon(heelPoint.x, heelPoint.y, curve.points),
                    `${preset} ${side} heel in`,
                ).toBe(true);
                expect(
                    pointInPolygon(toePoint.x, toePoint.y, curve.points),
                    `${preset} ${side} toe out`,
                ).toBe(false);

                const mid = meshFrame.heel + meshFrame.span * 0.4;
                const station = curve.points.filter((p) => Math.abs(coord(p, meshFrame.axis) - mid) < 8);
                const neg = Math.min(...station.map((p) => (meshFrame.axis === "x" ? p.y : p.x)));
                const pos = Math.max(...station.map((p) => (meshFrame.axis === "x" ? p.y : p.x)));
                if (side === "left") expect(Math.abs(neg), "left medial").toBeLessThan(Math.abs(pos) - 2);
                else expect(Math.abs(pos), "right medial").toBeLessThan(Math.abs(neg) - 2);
                mesh.dispose();
            }
        }
    });

    test("clipped mesh, STL, and G-code end at the landmark for both feet", () => {
        for (const side of ["left", "right"] as const) {
            for (const preset of ["sulcus", "met_head"] as const) {
                const heel = side === "right" ? -20 : 0;
                const mesh = makeFoot({ heel, side, lengthMm: 260, widthMm: 92 });
                const before = meshBounds(mesh);
                const outline = extractMeshOutline(mesh, 48);
                expect(outline).toBeTruthy();
                const curve: TrimlineCurve = buildTrimPresetCurve(preset, {
                    lengthMm: 260,
                    widthMm: 92,
                    baseCurve: outline!,
                });
                const clipped = clipGeometryToOutline(mesh, curve, 0.4);
                const after = meshBounds(clipped);
                const span = before.maxX - before.minX;
                const landmark = before.minX + TRIM_PRESET_LANDMARK_U[preset] * span;
                const label = `${preset} ${side}`;
                expect(after.minX, `${label} heel`).toBeLessThan(before.minX + 5);
                expect(Math.abs(after.maxX - landmark), `${label} mesh`).toBeLessThan(10);
                expect(after.maxX, `${label} shorter`).toBeLessThan(before.maxX - 30);

                const stl = binaryStlToGeometry(geometryToBinarySTL(clipped));
                const stlBox = meshBounds(stl);
                expect(Math.abs(stlBox.maxX - landmark), `${label} stl`).toBeLessThan(10);
                expect(stlBox.minX, `${label} stl heel`).toBeLessThan(before.minX + 5);

                const gcode = gcodeOf(clipped);
                const cutMax = gcodeCutMax(gcode, "X");
                expect(cutMax, `${label} gcode`).toBeGreaterThan(landmark - 12);
                expect(cutMax, `${label} gcode end`).toBeLessThan(landmark + 10);
                expect(gcode, `${label} has cuts`).toContain("G1 ");

                stl.dispose();
                clipped.dispose();
                mesh.dispose();
            }
        }
    });

    test("a mesh whose length runs along Y is cut on Y", () => {
        const mesh = makeFoot({ lengthAxis: "y", lengthMm: 260, widthMm: 90, heel: 5 });
        const before = meshBounds(mesh);
        const outline = extractMeshOutline(mesh, 48);
        expect(outline).toBeTruthy();
        const curve = buildTrimPresetCurve("met_head", {
            lengthMm: 260,
            widthMm: 90,
            baseCurve: outline!,
        });
        const source = lengthOf(outline!.points);
        const frame = lengthOf(curve.points);
        expect(frame.axis).toBe("y");
        expect(source.axis).toBe("y");
        const landmark = before.minY + TRIM_PRESET_LANDMARK_U.met_head * (before.maxY - before.minY);
        expect(
            Math.abs(frame.toe - (source.heel + TRIM_PRESET_LANDMARK_U.met_head * source.span)),
        ).toBeLessThan(1.5);
        const clipped = clipGeometryToOutline(mesh, curve, 0.4);
        const after = meshBounds(clipped);
        expect(Math.abs(after.maxY - landmark)).toBeLessThan(12);
        expect(after.maxX).toBeGreaterThan(before.maxX - 8);
        expect(selfIntersects(curve.points)).toBe(false);
        const gcode = gcodeOf(clipped);
        const cutMaxY = gcodeCutMax(gcode, "Y");
        expect(cutMaxY).toBeGreaterThan(landmark - 14);
        expect(cutMaxY).toBeLessThan(landmark + 12);
        clipped.dispose();
        mesh.dispose();
    });
});
