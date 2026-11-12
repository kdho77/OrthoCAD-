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
            const original = samples(cast.mesh, () => true).map((p) => ({ x: p.x, y: p.y, z: p.z + lift }));
            const n = shell.outerVertex0 ?? 0;
            const inner = samples(shell, (_p, i) => i < n);
            const outer = samples(shell, (_p, i) => i >= n && i < n * 2);
            writePng(join(OUT, `${side}-side.png`), sideView(original, inner, outer));
            const metX = (cast.m1.x + cast.m5.x) / 2;
            writePng(
                join(OUT, `${side}-sections.png`),
                sections(original, inner, outer, [28, 108, metX, 186]),
            );
        }
    });

    test("the shell preset's first layer is one sole footprint, and G-code is produced", () => {
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
            `${JSON.stringify({ ...layer, gcodeChars: gcode.length, preset: preset!.id, method: preset!.method }, null, 2)}\n`,
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

function samples(mesh: AfoTriMesh, keep: (p: AfoVec3, i: number) => boolean): AfoVec3[] {
    const n = (mesh.positions.length / 3) | 0;
    const out: AfoVec3[] = [];
    for (let i = 0; i < n; i++) {
        const p = {
            x: mesh.positions[i * 3] ?? 0,
            y: mesh.positions[i * 3 + 1] ?? 0,
            z: mesh.positions[i * 3 + 2] ?? 0,
        };
        if (keep(p, i)) out.push(p);
    }
    return out;
}

type Plot = { x: number; y: number; z: number };

function sideView(original: Plot[], inner: Plot[], outer: Plot[]): PNG {
    const png = blank(920, 420);
    const foot = (p: Plot) => p.z < 55;
    const map = scaler(
        [...original, ...inner, ...outer].filter(foot),
        (p) => p.x,
        (p) => p.z,
        40,
        36,
        860,
        350,
    );
    dots(png, original.filter(foot), map, [170, 170, 170]);
    dots(png, inner.filter(foot), map, [30, 90, 180]);
    dots(png, outer.filter(foot), map, [20, 130, 70]);
    return png;
}

function sections(original: Plot[], inner: Plot[], outer: Plot[], xs: number[]): PNG {
    const png = blank(1100, 320);
    const w = 260;
    xs.forEach((x0, i) => {
        const near = (p: Plot) => Math.abs(p.x - x0) < 6;
        const all = [...original, ...inner, ...outer].filter(near);
        const map = scaler(
            all,
            (p) => p.y,
            (p) => p.z,
            16 + i * w,
            28,
            w - 28,
            270,
        );
        dots(png, original.filter(near), map, [160, 160, 160]);
        dots(png, inner.filter(near), map, [30, 90, 180]);
        dots(png, outer.filter(near), map, [20, 130, 70]);
    });
    return png;
}

function scaler(
    pts: Plot[],
    fx: (p: Plot) => number,
    fy: (p: Plot) => number,
    left: number,
    top: number,
    width: number,
    height: number,
): (p: Plot) => [number, number] {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
        const x = fx(p);
        const y = fy(p);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    const sx = width / Math.max(1, maxX - minX);
    const sy = height / Math.max(1, maxY - minY);
    return (p) => [left + (fx(p) - minX) * sx, top + height - (fy(p) - minY) * sy];
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

function dots(
    png: PNG,
    pts: Plot[],
    map: (p: Plot) => [number, number],
    rgb: [number, number, number],
): void {
    for (const p of pts) {
        const [x, y] = map(p);
        stamp(png, x, y, rgb);
    }
}

function stamp(png: PNG, x: number, y: number, rgb: [number, number, number]): void {
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const px = Math.round(x + dx);
            const py = Math.round(y + dy);
            if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
            const i = (py * png.width + px) * 4;
            png.data[i] = rgb[0];
            png.data[i + 1] = rgb[1];
            png.data[i + 2] = rgb[2];
            png.data[i + 3] = 255;
        }
    }
}

function writePng(path: string, png: PNG): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, PNG.sync.write(png));
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
