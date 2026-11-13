// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { PNG } from "pngjs";
import { BufferAttribute, BufferGeometry } from "three";
import { generateGcode } from "@/lib/kiri/engine";
import { PRINTER_PRESETS } from "@/lib/kiri/presets";
import { type Move, sliceFdm } from "@/lib/kiri/slicer";
import { buildCurledAfoCast } from "./curled-afo-cast";
import { AFO_EDGE_MM, AFO_FLARE_MM } from "./defaults";
import { buildAfoShell, trimPolygonForShell } from "./shell";
import { flatPlateLockOf } from "./shell-flatten";
import { flatPlateTrimLoop } from "./trim-spline";
import type { AfoTriMesh, AfoVec3 } from "./types";

const OUT = join(process.cwd(), "docs/afo-flat");

describe("AFO flat plate review", () => {
    test("side profile and cross-sections show the original curl against the plate", () => {
        mkdirSync(OUT, { recursive: true });
        for (const side of ["left", "right"] as const) {
            const cast = buildCurledAfoCast(side, 36, 16);
            const shell = buildAfoShell(cast.mesh, [0, 1, 2], {
                thicknessMm: 4,
                edgeMm: AFO_EDGE_MM,
                flareMm: AFO_FLARE_MM,
                trimPolygon: trimPolygonForShell(footplate(cast.mesh, side), true) ?? undefined,
                heelSeed: cast.heel,
                flatPlate: { heel: cast.heel, m1: cast.m1, m5: cast.m5, thicknessMm: 4 },
            });
            const lock = flatPlateLockOf(shell);
            expect(lock, side).toBeTruthy();
            const lift = lock!.planes.origin.z;
            const metX = (cast.m1.x + cast.m5.x) / 2;
            const sidePng = renderSide(cast.mesh, shell, lift);
            const sectionPng = renderSections(cast.mesh, shell, lift, [28, 108, metX, 186]);
            expect(filledPixels(sidePng), side).toBeGreaterThan(8000);
            expect(filledPixels(sectionPng), side).toBeGreaterThan(1500);
            writePng(join(OUT, `${side}-side.png`), sidePng);
            writePng(join(OUT, `${side}-sections.png`), sectionPng);
        }
    });

    test("bottom and oblique views of the ragged edge and the smooth plate trim", () => {
        mkdirSync(OUT, { recursive: true });
        const cast = buildCurledAfoCast("left", 36, 16);
        const spec = { heel: cast.heel, m1: cast.m1, m5: cast.m5, thicknessMm: 4 };
        const ragged = footplate(cast.mesh, "left");
        const smooth = flatPlateTrimLoop(cast.mesh, spec).curve;
        const options = {
            thicknessMm: 4,
            edgeMm: AFO_EDGE_MM,
            flareMm: AFO_FLARE_MM,
            heelSeed: cast.heel,
            flatPlate: spec,
        };
        const before = buildAfoShell(cast.mesh, [0, 1, 2], {
            ...options,
            trimPolygon: trimPolygonForShell(ragged, true) ?? undefined,
        });
        const after = buildAfoShell(cast.mesh, [0, 1, 2], {
            ...options,
            trimPolygon: trimPolygonForShell(smooth, true) ?? undefined,
        });
        const shots: Array<["before" | "after", "bottom" | "oblique", AfoTriMesh, AfoVec3[]]> = [
            ["before", "bottom", before, ragged],
            ["before", "oblique", before, ragged],
            ["after", "bottom", after, smooth],
            ["after", "oblique", after, smooth],
        ];
        for (const [name, view, mesh, curve] of shots) {
            const png = renderPlate(mesh, curve, view);
            expect(filledPixels(png), `${name}-${view}`).toBeGreaterThan(4000);
            writePng(join(OUT, `${name}-${view}.png`), png);
        }
    });

    test("local slicer only: the shell preset's first layer is one sole footprint", () => {
        const cast = buildCurledAfoCast("left", 28, 12);
        const shell = buildAfoShell(cast.mesh, [0, 1, 2], {
            thicknessMm: 4,
            edgeMm: AFO_EDGE_MM,
            flareMm: 0,
            trimPolygon: trimPolygonForShell(footplate(cast.mesh, "left"), true) ?? undefined,
            heelSeed: cast.heel,
            flatPlate: { heel: cast.heel, m1: cast.m1, m5: cast.m5, thicknessMm: 4 },
        });
        const preset = PRINTER_PRESETS.find((p) => p.id === "apex-belt-v2-shell");
        expect(preset?.method).toBe("printing_shell");
        const geo = new BufferGeometry();
        geo.setAttribute("position", new BufferAttribute(shell.positions, 3));
        geo.setIndex(new BufferAttribute(shell.indices, 1));
        const moves = sliceFdm(geo, {
            layerHeightMm: preset!.layerHeightMm ?? 0.3,
            perimeters: 2,
            infillDensity: 0,
            extrusionWidthMm: (preset!.nozzleMm ?? 0.6) * 1.2,
        });
        const layer = firstLayer(moves);
        const gcode = generateGcode(geo, preset!, { infillDensity: 0 }).gcode;
        expect(layer.extrude).toBeGreaterThan(20);
        expect(layer.regions).toBeGreaterThan(0);
        expect(layer.regions).toBeLessThan(8);
        expect(layer.footprintMm2).toBeGreaterThan(4000);
        expect(layer.z).toBeCloseTo(0.3, 5);
        expect(gcode.length).toBeGreaterThan(500);
        expect(gcode).toContain("G1");
        writeFileSync(
            join(OUT, "slice-first-layer.json"),
            `${JSON.stringify(
                {
                    path: "local-slicer-only",
                    productionVertexSlice: false,
                    note: "Production G-code goes through generateHybridGcode to VertexSlice generateSolid. This record is the local Kiri slicer and is not production-belt-proven.",
                    ...layer,
                    gcodeChars: gcode.length,
                    preset: preset!.id,
                    method: preset!.method,
                },
                null,
                2,
            )}\n`,
        );
    });
});

function footplate(mesh: AfoTriMesh, side: "left" | "right"): AfoVec3[] {
    const s = side === "left" ? -1 : 1;
    const raw: AfoVec3[] = [
        { x: 48, y: s * 34, z: 6 },
        { x: 110, y: s * 34, z: 8 },
        { x: 160, y: s * 28, z: 12 },
        { x: 190, y: s * 12, z: 18 },
        { x: 194, y: 0, z: 20 },
        { x: 190, y: -s * 12, z: 18 },
        { x: 160, y: -s * 28, z: 12 },
        { x: 110, y: -s * 34, z: 6 },
        { x: 48, y: -s * 34, z: 6 },
        { x: 24, y: -s * 30, z: 40 },
        { x: 26, y: -s * 36, z: 80 },
        { x: 20, y: -s * 26, z: 40 },
        { x: 24, y: s * 30, z: 40 },
    ];
    const dense: AfoVec3[] = [];
    for (let i = 0; i < raw.length; i++) {
        const a = raw[i] ?? raw[0]!;
        const b = raw[(i + 1) % raw.length] ?? a;
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 7));
        for (let k = 0; k < steps; k++) {
            const t = k / steps;
            dense.push(
                nearest(mesh, {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                    z: a.z + (b.z - a.z) * t,
                }),
            );
        }
    }
    return dense;
}

function nearest(mesh: AfoTriMesh, p: AfoVec3): AfoVec3 {
    const n = (mesh.positions.length / 3) | 0;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
        const dx = (mesh.positions[i * 3] ?? 0) - p.x;
        const dy = (mesh.positions[i * 3 + 1] ?? 0) - p.y;
        const dz = (mesh.positions[i * 3 + 2] ?? 0) - p.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return {
        x: mesh.positions[best * 3] ?? 0,
        y: mesh.positions[best * 3 + 1] ?? 0,
        z: mesh.positions[best * 3 + 2] ?? 0,
    };
}

type RGB = [number, number, number];
type V3 = [number, number, number];

function vert(mesh: AfoTriMesh, i: number, lift: number): V3 {
    return [
        mesh.positions[i * 3] ?? 0,
        mesh.positions[i * 3 + 1] ?? 0,
        (mesh.positions[i * 3 + 2] ?? 0) + lift,
    ];
}

/** Side profile, camera looking along +Y. Original curl in gray, finished solid over it. */
function renderSide(original: AfoTriMesh, finished: AfoTriMesh, lift: number): PNG {
    const png = blank(960, 440);
    const frame = boundsOf(original, finished, lift, 55);
    paintMesh(png, original, lift, frame, [186, 190, 194], 55);
    paintMesh(png, finished, 0, frame, [36, 92, 150], 55);
    return png;
}

/** Heel, arch, met heads, toe. Plane cuts of the original and the finished solid. */
function renderSections(original: AfoTriMesh, finished: AfoTriMesh, lift: number, xs: number[]): PNG {
    const png = blank(1200, 380);
    const panel = 290;
    xs.forEach((x0, i) => {
        const left = 16 + i * panel;
        const segs = [...sectionSegments(original, lift, x0), ...sectionSegments(finished, 0, x0)];
        let minY = Infinity;
        let maxY = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const [a, b] of segs) {
            minY = Math.min(minY, a[0], b[0]);
            maxY = Math.max(maxY, a[0], b[0]);
            minZ = Math.min(minZ, a[1], b[1]);
            maxZ = Math.max(maxZ, a[1], b[1]);
        }
        if (!Number.isFinite(minY)) return;
        const pad = 4;
        minY -= pad;
        maxY += pad;
        minZ = Math.min(minZ, 0) - pad;
        maxZ += pad;
        const map = (y: number, z: number): [number, number] => [
            left + ((y - minY) / Math.max(1, maxY - minY)) * (panel - 36),
            24 + (1 - (z - minZ) / Math.max(1, maxZ - minZ)) * 320,
        ];
        for (const [a, b] of sectionSegments(original, lift, x0)) {
            line(png, map(a[0], a[1]), map(b[0], b[1]), [168, 172, 176], 2);
        }
        for (const [a, b] of sectionSegments(finished, 0, x0)) {
            line(png, map(a[0], a[1]), map(b[0], b[1]), [20, 110, 78], 3);
        }
    });
    return png;
}

function boundsOf(original: AfoTriMesh, finished: AfoTriMesh, lift: number, zMax: number) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const take = (mesh: AfoTriMesh, dz: number) => {
        const n = (mesh.positions.length / 3) | 0;
        for (let i = 0; i < n; i++) {
            const z = (mesh.positions[i * 3 + 2] ?? 0) + dz;
            if (z > zMax) continue;
            const x = mesh.positions[i * 3] ?? 0;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        }
    };
    take(original, lift);
    take(finished, 0);
    return { minX, maxX, minZ, maxZ };
}

function paintMesh(
    png: PNG,
    mesh: AfoTriMesh,
    lift: number,
    frame: ReturnType<typeof boundsOf>,
    rgb: RGB,
    zMax: number,
) {
    const tris: { y: number; p: [V3, V3, V3] }[] = [];
    const faces = (mesh.indices.length / 3) | 0;
    for (let f = 0; f < faces; f++) {
        const p = [0, 1, 2].map((k) => vert(mesh, mesh.indices[f * 3 + k] ?? 0, lift)) as [V3, V3, V3];
        const zc = (p[0][2] + p[1][2] + p[2][2]) / 3;
        if (zc > zMax) continue;
        tris.push({ y: (p[0][1] + p[1][1] + p[2][1]) / 3, p });
    }
    tris.sort((a, b) => a.y - b.y);
    const sx = 880 / Math.max(1, frame.maxX - frame.minX);
    const sy = 380 / Math.max(1, frame.maxZ - frame.minZ);
    const project = (p: V3): [number, number] => [
        40 + (p[0] - frame.minX) * sx,
        24 + (frame.maxZ - p[2]) * sy,
    ];
    for (const tri of tris) {
        const [a, b, c] = tri.p;
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
        const nl = Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, ny, e1[0]! * e2[1]! - e1[1]! * e2[0]!);
        const facing = nl > 1e-8 ? Math.abs(ny) / nl : 0.4;
        const shade = 0.42 + 0.58 * facing;
        fillTri(png, project(a), project(b), project(c), [
            Math.round(rgb[0] * shade),
            Math.round(rgb[1] * shade),
            Math.round(rgb[2] * shade),
        ]);
    }
}

function sectionSegments(
    mesh: AfoTriMesh,
    lift: number,
    x0: number,
): Array<[[number, number], [number, number]]> {
    const out: Array<[[number, number], [number, number]]> = [];
    const faces = (mesh.indices.length / 3) | 0;
    for (let f = 0; f < faces; f++) {
        const p = [0, 1, 2].map((k) => vert(mesh, mesh.indices[f * 3 + k] ?? 0, lift)) as [V3, V3, V3];
        const hits: [number, number][] = [];
        for (let e = 0; e < 3; e++) {
            const a = p[e]!;
            const b = p[(e + 1) % 3]!;
            const da = a[0] - x0;
            const db = b[0] - x0;
            if (da === 0 && db === 0) continue;
            if (da * db > 0) continue;
            const den = da - db;
            if (Math.abs(den) < 1e-12) continue;
            const t = da / den;
            if (t < -1e-6 || t > 1 + 1e-6) continue;
            hits.push([a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        }
        if (hits.length >= 2) out.push([hits[0]!, hits[1]!]);
    }
    return out;
}

function fillTri(png: PNG, a: [number, number], b: [number, number], c: [number, number], rgb: RGB) {
    const pts = [a, b, c].sort((p, q) => p[1] - q[1]);
    const y0 = Math.max(0, Math.ceil(pts[0]![1]));
    const y1 = Math.min(png.height - 1, Math.floor(pts[2]![1]));
    for (let y = y0; y <= y1; y++) {
        const long = span(pts[0]!, pts[2]!, y);
        const short = y < pts[1]![1] ? span(pts[0]!, pts[1]!, y) : span(pts[1]!, pts[2]!, y);
        const x0 = Math.max(0, Math.ceil(Math.min(long, short)));
        const x1 = Math.min(png.width - 1, Math.floor(Math.max(long, short)));
        for (let x = x0; x <= x1; x++) plot(png, x, y, rgb);
    }
}

function span(a: [number, number], b: [number, number], y: number): number {
    const dy = b[1] - a[1];
    if (Math.abs(dy) < 1e-6) return a[0];
    return a[0] + ((y - a[1]) / dy) * (b[0] - a[0]);
}

function line(png: PNG, a: [number, number], b: [number, number], rgb: RGB, width: number) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = a[0] + (b[0] - a[0]) * t;
        const y = a[1] + (b[1] - a[1]) * t;
        for (let dy = -width; dy <= width; dy++) {
            for (let dx = -width; dx <= width; dx++) {
                if (dx * dx + dy * dy > width * width) continue;
                plot(png, Math.round(x + dx), Math.round(y + dy), rgb);
            }
        }
    }
}

function plot(png: PNG, x: number, y: number, rgb: RGB) {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const i = (y * png.width + x) * 4;
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
}

function filledPixels(png: PNG): number {
    let n = 0;
    for (let i = 0; i < png.data.length; i += 4) {
        if (png.data[i] !== 255 || png.data[i + 1] !== 255 || png.data[i + 2] !== 255) n++;
    }
    return n;
}

function blank(width: number, height: number): PNG {
    const png = new PNG({ width, height });
    for (let i = 0; i < png.data.length; i += 4) {
        png.data[i] = 255;
        png.data[i + 1] = 255;
        png.data[i + 2] = 255;
        png.data[i + 3] = 255;
    }
    return png;
}

function writePng(path: string, png: PNG): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, PNG.sync.write(png));
}

/** Bottom view looks down +Z. Oblique looks from the front-lateral side, above the plate. */
function renderPlate(mesh: AfoTriMesh, curve: AfoVec3[], view: "bottom" | "oblique"): PNG {
    const png = blank(880, 640);
    const project = (p: V3): [number, number, number] => {
        if (view === "bottom") return [p[0], -p[1], p[2]];
        return [p[0] * 0.78 + p[1] * 0.5, -p[2] * 0.92 + p[1] * 0.22 + p[0] * 0.08, -p[1] * 0.65 + p[2] * 0.35 + p[0] * 0.12];
    };
    const faces = (mesh.indices.length / 3) | 0;
    const tris: { depth: number; p: [V3, V3, V3] }[] = [];
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    const consider = (q: [number, number, number]) => {
        minU = Math.min(minU, q[0]);
        maxU = Math.max(maxU, q[0]);
        minV = Math.min(minV, q[1]);
        maxV = Math.max(maxV, q[1]);
    };
    for (let f = 0; f < faces; f++) {
        const p = [0, 1, 2].map((k) => vert(mesh, mesh.indices[f * 3 + k] ?? 0, 0)) as [V3, V3, V3];
        tris.push({ depth: (project(p[0]).at(2)! + project(p[1]).at(2)! + project(p[2]).at(2)!) / 3, p });
        for (const corner of p) consider(project(corner));
    }
    for (const point of curve) consider(project([point.x, point.y, point.z]));
    const sx = 800 / Math.max(1, maxU - minU);
    const sy = 560 / Math.max(1, maxV - minV);
    const scale = Math.min(sx, sy);
    const toPx = (q: [number, number, number]): [number, number] => [
        40 + (q[0] - minU) * scale,
        40 + (maxV - q[1]) * scale,
    ];
    const light: V3 = [0.35, -0.72, 0.6];
    tris.sort((a, b) => a.depth - b.depth);
    for (const tri of tris) {
        const [a, b, c] = tri.p;
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n: V3 = [
            e1[1]! * e2[2]! - e1[2]! * e2[1]!,
            e1[2]! * e2[0]! - e1[0]! * e2[2]!,
            e1[0]! * e2[1]! - e1[1]! * e2[0]!,
        ];
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        const facing = Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / nl);
        const shade = 0.38 + 0.62 * facing;
        const rgb: RGB = [Math.round(36 * shade), Math.round(92 * shade), Math.round(150 * shade)];
        fillTri(png, toPx(project(a)), toPx(project(b)), toPx(project(c)), rgb);
    }
    for (let i = 0; i < curve.length; i++) {
        const a = curve[i]!;
        const b = curve[(i + 1) % curve.length]!;
        line(png, toPx(project([a.x, a.y, a.z])), toPx(project([b.x, b.y, b.z])), [232, 176, 32], 2);
    }
    return png;
}

function firstLayer(moves: Move[]): { z: number; regions: number; extrude: number; footprintMm2: number } {
    const extrude = moves.filter((m) => m.type === "extrude");
    const z = extrude[0]?.z ?? 0;
    const layer = moves.filter((m) => Math.abs(m.z - z) < 1e-4);
    const loops: Array<Array<{ x: number; y: number }>> = [];
    let cur: Array<{ x: number; y: number }> = [];
    for (const m of layer) {
        if (m.type === "travel") {
            if (cur.length > 2) loops.push(cur);
            cur = [];
        }
        cur.push({ x: m.x, y: m.y });
    }
    if (cur.length > 2) loops.push(cur);
    let footprint = 0;
    for (const loop of loops) {
        let area = 0;
        for (let i = 0; i < loop.length; i++) {
            const a = loop[i]!;
            const b = loop[(i + 1) % loop.length]!;
            area += a.x * b.y - b.x * a.y;
        }
        footprint = Math.max(footprint, Math.abs(area) / 2);
    }
    return {
        z,
        regions: loops.length,
        extrude: layer.filter((m) => m.type === "extrude").length,
        footprintMm2: footprint,
    };
}
